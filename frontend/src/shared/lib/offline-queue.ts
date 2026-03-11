const DB_NAME = 'insighta-offline';
const STORE_NAME = 'pending-mutations';
const DB_VERSION = 1;

export interface PendingMutation {
  id?: number;
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueue(mutation: Omit<PendingMutation, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({ ...mutation, createdAt: Date.now() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll(): Promise<PendingMutation[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function remove(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushQueue(): Promise<{ succeeded: number; failed: number }> {
  const mutations = await getAll();
  let succeeded = 0;
  let failed = 0;

  for (const mutation of mutations) {
    try {
      await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body,
      });
      if (mutation.id != null) await remove(mutation.id);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { succeeded, failed };
}
