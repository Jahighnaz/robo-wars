// IndexedDB save storage with a localStorage mirror as a fallback.
import { defaultSave, hydrate, serialize, validSave, type Save } from './save';

const DB_NAME = 'scrap-evolution';
const STORE = 'saves';
const KEY = 'main';
const LS_KEY = 'scrapEvolution.v1'; // same key as the prototype

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ||= openDb());

async function idbGet(): Promise<string | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(json: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(json, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function parse(raw: string | null | undefined): Save | null {
  if (!raw) return null;
  try { const s = JSON.parse(raw); return validSave(s) ? hydrate(s) : null; } catch { return null; }
}

export async function loadSave(): Promise<Save> {
  let s: Save | null = null;
  try { s = parse(await idbGet()); } catch { /* IndexedDB unavailable */ }
  if (!s) { try { s = parse(localStorage.getItem(LS_KEY)); } catch { /* storage unavailable */ } }
  return s || defaultSave();
}

let pending: string | null = null;
let writing = false;

/** Persist the save; writes are coalesced so rapid UI taps don't queue many transactions. */
export function persist(s: Save): void {
  const json = serialize(s);
  try { localStorage.setItem(LS_KEY, json); } catch { /* ignore */ }
  pending = json;
  if (writing) return;
  writing = true;
  const flush = async () => {
    while (pending) {
      const j = pending; pending = null;
      try { await idbPut(j); } catch { /* ignore: localStorage mirror holds it */ }
    }
    writing = false;
  };
  void flush();
}

/** Ask the browser not to evict storage (helps on iPadOS home-screen apps). */
export function requestPersistentStorage(): void {
  try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
}
