const DB_NAME = 'condo.obras.draft.files.v1';
const DB_VERSION = 1;
const STORE = 'pending';

export type ObrasPendingFilesScope = 'note' | 'budget' | 'legal';

type StoredItem = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

type StoredRecord = {
  key: string;
  items: StoredItem[];
};

export function obrasPendingFilesDraftKey(
  condominiumId: string,
  workId: string,
  scope: ObrasPendingFilesScope,
): string {
  return `${condominiumId}:${workId}:${scope}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB_unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('idb_open_failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
  });
}

function runTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = run(store);
        req.onerror = () => reject(req.error ?? new Error('idb_tx_failed'));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('idb_tx_failed'));
        };
      }),
  );
}

/** Grava anexos pendentes (IndexedDB; suporta ficheiros grandes). */
export async function writeObrasPendingFilesDraft(
  key: string,
  files: File[],
): Promise<boolean> {
  try {
    if (files.length === 0) {
      await runTx('readwrite', (store) => store.delete(key));
      return true;
    }
    const items: StoredItem[] = files.map((f) => ({
      name: f.name,
      type: f.type || 'application/octet-stream',
      lastModified: f.lastModified,
      blob: f,
    }));
    await runTx('readwrite', (store) =>
      store.put({ key, items } satisfies StoredRecord),
    );
    return true;
  } catch {
    return false;
  }
}

export async function readObrasPendingFilesDraft(key: string): Promise<File[]> {
  try {
    const record = await runTx<StoredRecord | undefined>('readonly', (store) =>
      store.get(key),
    );
    if (!record?.items?.length) {
      return [];
    }
    return record.items.map(
      (item) =>
        new File([item.blob], item.name, {
          type: item.type,
          lastModified: item.lastModified,
        }),
    );
  } catch {
    return [];
  }
}

export async function clearObrasPendingFilesDraft(key: string): Promise<void> {
  await writeObrasPendingFilesDraft(key, []);
}
