// Liefert die zwischengespeicherte Beitragsliste an die Website (ohne Schlüssel, ohne Meta-URLs).
import { FEED, readJson, json } from './_ig.js';

export async function GET() {
  const feed = await readJson(FEED);
  const items = (feed?.items || []).map((i) => ({
    href: i.permalink,
    src: `/api/instagram-img?id=${encodeURIComponent(i.id)}`,
    alt: i.alt,
    video: i.video,
  }));
  // Leere Liste nicht zwischenspeichern, damit neue Beiträge sofort sichtbar werden
  const cache = items.length ? 'public, max-age=0, s-maxage=900, stale-while-revalidate=86400' : 'no-store';
  return json({ items }, 200, cache);
}
