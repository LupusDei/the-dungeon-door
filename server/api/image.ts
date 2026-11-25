import { getImageStore, MemoryImageStore } from '../lib/images/index.ts';

/**
 * GET /api/image?id=… — serves images from the in-memory image store (local dev without Blob). Open to
 * everyone (image views can't send headers); ids are unguessable UUIDs. 404 when Blob is in use.
 */
export async function GET(request: Request): Promise<Response> {
  const store = getImageStore();
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const image = store instanceof MemoryImageStore ? store.get(id) : null;
  if (!image) return Response.json({ error: 'no such image' }, { status: 404 });
  return new Response(Buffer.from(image.bytes), {
    headers: { 'content-type': image.mediaType, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
