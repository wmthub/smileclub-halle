// Liefert ein zwischengespeichertes Instagram-Bild vom eigenen Server aus.
import { get } from '@vercel/blob';
import { imgPath } from './_ig.js';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9]{5,30}$/.test(id)) return new Response('Bad request', { status: 400 });

  const r = await get(imgPath(id), { access: 'private' });
  if (r?.statusCode !== 200) return new Response('Not found', { status: 404 });

  return new Response(r.stream, {
    headers: {
      'Content-Type': r.blob.contentType || 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
