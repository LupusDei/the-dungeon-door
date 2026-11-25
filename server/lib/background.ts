import { waitUntil } from '@vercel/functions';

const pending = new Set<Promise<void>>();

/**
 * Runs slow work (DM writing, painting) after the response is sent. On Vercel, waitUntil keeps the
 * function alive until it finishes (up to maxDuration); elsewhere the promise simply runs on.
 */
export function runInBackground(label: string, task: () => Promise<void>): void {
  const promise: Promise<void> = task()
    .catch((error) => console.error(`background task "${label}" failed:`, error))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  waitUntil(promise);
}

/** Tests and scripts: wait until all background work (including work it starts) is done. */
export async function settle(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
