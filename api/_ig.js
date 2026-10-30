// Gemeinsame Helfer für den Instagram-Feed.
// Der Zugangsschlüssel liegt nur in der Umgebungsvariable INSTAGRAM_TOKEN
// bzw. nach der ersten Erneuerung im privaten Blob-Speicher – nie im Quelltext.
import { get, put } from '@vercel/blob';

export const STATE = 'ig/state.json';
export const FEED = 'ig/feed.json';
export const imgPath = (id) => `ig/img/${id}.jpg`;

export async function readJson(pathname) {
  try {
    const r = await get(pathname, { access: 'private' });
    if (r?.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch {
    return null;
  }
}

export async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export function json(data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}
