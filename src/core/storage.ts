// Projects and their videos live in IndexedDB, in this browser only. Nothing is uploaded.

import type { AssetKind, Project } from './types';

const DB = 'clipglow';
const VERSION = 1;

let db: Promise<IDBDatabase> | null = null;

function connect(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id' });
      req.result.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(store: 'projects' | 'assets', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return connect().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
      }),
  );
}

export const listProjects = () =>
  run<Project[]>('projects', 'readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.updatedAt - a.updatedAt));

export const getProject = (id: string) => run<Project | undefined>('projects', 'readonly', (s) => s.get(id));

export const saveProject = (project: Project) => run('projects', 'readwrite', (s) => void s.put(project));

const key = (id: string, kind: AssetKind) => `${id}:${kind}`;

export const getAsset = (id: string, kind: AssetKind) => run<Blob | undefined>('assets', 'readonly', (s) => s.get(key(id, kind)));

export const saveAsset = (id: string, kind: AssetKind, blob: Blob) => run('assets', 'readwrite', (s) => void s.put(blob, key(id, kind)));

export const deleteAsset = (id: string, kind: AssetKind) => run('assets', 'readwrite', (s) => void s.delete(key(id, kind)));

export async function deleteProject(id: string) {
  await run('projects', 'readwrite', (s) => void s.delete(id));
  for (const kind of ['screen', 'webcam', 'background', 'thumbnail'] as AssetKind[]) await deleteAsset(id, kind);
}

/** Asks the browser not to clear our storage when space runs low. Recordings are big and precious. */
export async function persist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported; nothing to do.
  }
}
