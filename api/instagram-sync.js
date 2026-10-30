// Holt die neuesten Instagram-Beiträge und legt Bilder + Liste im privaten Blob ab.
// Läuft täglich per Vercel Cron (siehe vercel.json). Besucher laden nie etwas von Meta.
import { put } from '@vercel/blob';
import { STATE, FEED, imgPath, readJson, writeJson, json } from './_ig.js';

const GRAPH = 'https://graph.instagram.com';
const COUNT = 6;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // Schlüssel wöchentlich verlängern
const MIN_INTERVAL_MS = 10 * 60 * 1000; // höchstens alle 10 Minuten

export async function GET() {
  const state = (await readJson(STATE)) || {};
  const now = Date.now();

  if (state.syncedAt && now - state.syncedAt < MIN_INTERVAL_MS) {
    return json({ ok: true, skipped: 'zu kurz nach dem letzten Abruf' });
  }

  // Variante ohne eigene Meta-App: Behold-JSON-Feed (nur Instagram-Login nötig)
  if (process.env.BEHOLD_FEED_URL) return syncBehold(now);

  let token = state.token || process.env.INSTAGRAM_TOKEN;
  // Ohne Schlüssel: eigene Lösung über das öffentliche Profil (kein Facebook, kein Drittanbieter)
  if (!token) return syncPublic(now, process.env.INSTAGRAM_USERNAME || 'smileclub.halle');

  // Langlebigen Schlüssel regelmäßig verlängern (gilt sonst 60 Tage)
  if (!state.refreshedAt || now - state.refreshedAt > REFRESH_AFTER_MS) {
    const r = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (r.ok) {
      const d = await r.json();
      if (d.access_token) token = d.access_token;
      state.refreshedAt = now;
    }
  }

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const res = await fetch(`${GRAPH}/me/media?fields=${fields}&limit=20&access_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    state.token = token;
    state.lastError = `Instagram ${res.status}`;
    await writeJson(STATE, state);
    return json({ ok: false, error: state.lastError }, 502);
  }
  const { data = [] } = await res.json();

  const items = [];
  for (const m of data) {
    if (items.length >= COUNT) break;
    const src = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
    if (!src) continue;
    const img = await fetch(src);
    if (!img.ok) continue;
    await put(imgPath(m.id), Buffer.from(await img.arrayBuffer()), {
      access: 'private',
      contentType: img.headers.get('content-type') || 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const caption = (m.caption || '').replace(/\s+/g, ' ').trim();
    items.push({
      id: m.id,
      permalink: m.permalink,
      alt: caption ? caption.slice(0, 120) : 'Instagram-Beitrag von Smile Club',
      video: m.media_type === 'VIDEO',
      timestamp: m.timestamp,
    });
  }

  await writeJson(FEED, { updatedAt: new Date(now).toISOString(), items });
  await writeJson(STATE, { token, refreshedAt: state.refreshedAt, syncedAt: now, lastError: null });

  return json({ ok: true, count: items.length });
}

async function storeImage(id, src) {
  const img = await fetch(src);
  if (!img.ok) return false;
  await put(imgPath(id), Buffer.from(await img.arrayBuffer()), {
    access: 'private',
    contentType: img.headers.get('content-type') || 'image/jpeg',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return true;
}

async function syncBehold(now) {
  const res = await fetch(process.env.BEHOLD_FEED_URL);
  if (!res.ok) {
    await writeJson(STATE, { syncedAt: now, lastError: `Behold ${res.status}` });
    return json({ ok: false, error: `Behold ${res.status}` }, 502);
  }
  const { posts = [] } = await res.json();
  const items = [];
  for (const p of posts) {
    if (items.length >= COUNT) break;
    const id = String(p.id || '').replace(/\D/g, '');
    const src = p.sizes?.medium?.mediaUrl || p.thumbnailUrl || (p.mediaType !== 'VIDEO' ? p.mediaUrl : null);
    if (!id || !src || !(await storeImage(id, src))) continue;
    const caption = (p.altText || p.prunedCaption || p.caption || '').replace(/\s+/g, ' ').trim();
    items.push({
      id,
      permalink: p.permalink,
      alt: caption ? caption.slice(0, 120) : 'Instagram-Beitrag von Smile Club',
      video: p.mediaType === 'VIDEO',
      timestamp: p.timestamp,
    });
  }
  await writeJson(FEED, { updatedAt: new Date(now).toISOString(), items });
  await writeJson(STATE, { syncedAt: now, lastError: null, source: 'behold' });
  return json({ ok: true, count: items.length, source: 'behold' });
}

// --- Öffentliches Profil -------------------------------------------------
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function fetchProfile(username) {
  const tries = [];
  // 1) Web-Schnittstelle, die auch instagram.com selbst nutzt
  try {
    const r = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'de-DE,de;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://www.instagram.com/${username}/`,
      },
    });
    const text = await r.text();
    tries.push({ src: 'web_profile_info', status: r.status, head: text.slice(0, 200) });
    if (r.ok) {
      const edges = JSON.parse(text)?.data?.user?.edge_owner_to_timeline_media?.edges || [];
      if (edges.length) {
        return {
          posts: edges.map(({ node: n }) => ({
            id: String(n.id),
            permalink: `https://www.instagram.com/p/${n.shortcode}/`,
            src: n.display_url || n.thumbnail_src,
            caption: n.accessibility_caption || n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            video: !!n.is_video,
            timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
          })),
          tries,
        };
      }
    }
  } catch (e) {
    tries.push({ src: 'web_profile_info', error: String(e) });
  }
  return { posts: [], tries };
}

async function syncPublic(now, username) {
  const state = (await readJson(STATE)) || {};
  if (state.attemptAt && now - state.attemptAt < 2 * 60 * 1000) {
    return json({ ok: false, skipped: 'Versuch läuft bereits' }, 429);
  }
  const { posts, tries } = await fetchProfile(username);
  if (!posts.length) {
    await writeJson(STATE, { ...state, attemptAt: now, lastError: 'Profil nicht abrufbar', tries });
    return json({ ok: false, error: 'Profil nicht abrufbar', tries }, 502);
  }
  const items = [];
  for (const p of posts) {
    if (items.length >= COUNT) break;
    if (!/^[0-9]{5,30}$/.test(p.id) || !p.src || !(await storeImage(p.id, p.src))) continue;
    const caption = p.caption.replace(/\s+/g, ' ').trim();
    items.push({
      id: p.id,
      permalink: p.permalink,
      alt: caption ? caption.slice(0, 120) : 'Instagram-Beitrag von Smile Club',
      video: p.video,
      timestamp: p.timestamp,
    });
  }
  await writeJson(FEED, { updatedAt: new Date(now).toISOString(), items });
  await writeJson(STATE, { syncedAt: now, attemptAt: now, lastError: null, source: 'public' });
  return json({ ok: true, count: items.length, source: 'public' });
}
