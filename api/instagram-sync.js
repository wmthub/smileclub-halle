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

  let token = state.token || process.env.INSTAGRAM_TOKEN;
  if (!token) return json({ ok: false, error: 'INSTAGRAM_TOKEN fehlt' }, 503);

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
