/**
 * Offline check-in / check-out queue.
 *
 * If the user taps "Check in" without a network (subway, dead spot in the
 * basement, captive-portal Wi-Fi), we don't want their attendance to fail
 * silently. We:
 *   1. Stash the request in IndexedDB.
 *   2. Try ``navigator.serviceWorker.sync.register`` — modern Chrome/Edge
 *      will replay the queue automatically when connectivity returns.
 *   3. Fall back to a simple in-tab flusher (``online`` event +
 *      ``setInterval``) for browsers without Background Sync (Safari).
 *
 * Schema is kept minimal: id, kind ("in" | "out"), captured_at (ISO),
 * latitude, longitude, accuracy_m, selfie_base64. The selfie is base64 in
 * the same row so we don't need a separate Blob store.
 */

const DB_NAME = "wtp.queue";
const STORE = "checkins";
const DB_VERSION = 1;

export type Mode = "in" | "out";

export interface QueuedCheckin {
  id: string;
  kind: Mode;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  selfie_base64: string;
  attempts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const r = fn(store);
    if (r instanceof IDBRequest) {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } else {
      Promise.resolve(r).then(resolve, reject);
    }
    t.oncomplete = () => db.close();
    t.onabort = () => reject(t.error);
  });
}

export async function enqueueCheckin(
  data: Omit<QueuedCheckin, "id" | "attempts">
): Promise<QueuedCheckin> {
  const row: QueuedCheckin = {
    ...data,
    id: crypto.randomUUID(),
    attempts: 0,
  };
  await tx("readwrite", (s) => s.put(row));
  await registerBackgroundSync();
  return row;
}

export async function listQueued(): Promise<QueuedCheckin[]> {
  return tx("readonly", (s) => s.getAll() as IDBRequest<QueuedCheckin[]>);
}

export async function dequeue(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function bumpAttempt(id: string): Promise<void> {
  await tx("readwrite", (s) => {
    const get = s.get(id);
    get.onsuccess = () => {
      const row = get.result as QueuedCheckin | undefined;
      if (!row) return;
      row.attempts = (row.attempts || 0) + 1;
      s.put(row);
    };
    return get;
  });
}

async function registerBackgroundSync(): Promise<void> {
  // ``sync`` is a non-standard permission/feature; check before calling.
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (reg.sync) {
      await reg.sync.register("wtp-checkin-flush");
    }
  } catch {
    // best-effort
  }
}

/**
 * Flush the queue against the live API. Used both by the in-tab fallback
 * and (via ``postMessage``) by the SW's Background Sync handler.
 *
 * Returns ``{ ok, failed }`` so the UI can toast the outcome.
 */
export async function flushQueue(
  postFn: (kind: Mode, body: unknown) => Promise<unknown>
): Promise<{ ok: number; failed: number }> {
  const rows = await listQueued();
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await postFn(r.kind, {
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy_m: r.accuracy_m,
        selfie_base64: r.selfie_base64,
        // Help the backend correlate offline-captured timestamps with their
        // server-side record. The backend currently stamps the receive time;
        // a future enhancement could honor this when present.
        captured_at: r.captured_at,
      });
      await dequeue(r.id);
      ok += 1;
    } catch {
      await bumpAttempt(r.id);
      failed += 1;
    }
  }
  return { ok, failed };
}

/** Clear the entire queue — used when the user explicitly logs out. */
export async function clearQueue(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}
