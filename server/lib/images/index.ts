import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';

export interface StoredImage {
  bytes: Uint8Array;
  mediaType: string;
}

export type ImageKind = 'portraits' | 'scenes';

/**
 * Where generated images live. Vercel Blob (public) when BLOB_READ_WRITE_TOKEN (or a Blob store id with
 * OIDC) is configured; otherwise an in-process map served by GET /api/image?id=… so the iOS simulator can
 * load images straight from the local dev server.
 */
export interface ImageStore {
  /** Saves the image and returns its public absolute URL. `origin` is the API's own origin (local fallback). */
  save(image: StoredImage, kind: ImageKind, origin: string): Promise<string>;
  /** Loads an image this store saved (e.g. a portrait to use as a reference), or null for any other URL. */
  load(url: string): Promise<StoredImage | null>;
}

const extension = (mediaType: string) => (mediaType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');

export class BlobImageStore implements ImageStore {
  async save(image: StoredImage, kind: ImageKind, _origin: string) {
    const blob = await put(`${kind}/${randomUUID()}.${extension(image.mediaType)}`, Buffer.from(image.bytes), {
      access: 'public',
      contentType: image.mediaType,
    });
    return blob.url;
  }

  async load(url: string) {
    // Only fetch from Vercel Blob: portrait URLs come from clients, so never fetch arbitrary hosts.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return null;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mediaType: response.headers.get('content-type') ?? 'image/png',
    };
  }
}

export class MemoryImageStore implements ImageStore {
  private images = new Map<string, StoredImage>();

  async save(image: StoredImage, _kind: ImageKind, origin: string) {
    const id = randomUUID();
    this.images.set(id, image);
    return `${origin}/api/image?id=${id}`;
  }

  async load(url: string) {
    const id = url.match(/\/api\/image\?id=([0-9a-f-]{36})$/)?.[1];
    return id ? this.get(id) : null;
  }

  get(id: string): StoredImage | null {
    return this.images.get(id) ?? null;
  }
}

const g = globalThis as typeof globalThis & { __ddImages?: ImageStore };

export function getImageStore(): ImageStore {
  if (!g.__ddImages) {
    const blob = process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN);
    g.__ddImages = blob ? new BlobImageStore() : new MemoryImageStore();
  }
  return g.__ddImages;
}
