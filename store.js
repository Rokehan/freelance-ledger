// App state: saved in localStorage, receipt files in IndexedDB, synced to Drive.
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './seed.js';

const KEY = 'fl_data_v1';
const COLLECTIONS = ['clients', 'jobs', 'receipts', 'invoices'];
const listeners = new Set();

export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

function blank() {
  return {
    version: 1, updatedAt: now(), dirty: false,
    profile: { ...DEFAULT_PROFILE, bank: { ...DEFAULT_PROFILE.bank }, updatedAt: '1970-01-01T00:00:00Z' },
    settings: { ...DEFAULT_SETTINGS, updatedAt: '1970-01-01T00:00:00Z' },
    clients: [], jobs: [], receipts: [], invoices: [],
    drive: { folders: {}, dataFileId: null, lastSync: null },
  };
}

export let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    const b = blank();
    return { ...b, ...d, drive: { ...b.drive, ...(d.drive || {}) }, settings: { ...b.settings, ...(d.settings || {}) } };
  } catch { return blank(); }
}

export function save({ silent = false } = {}) {
  data.updatedAt = now();
  data.dirty = true;
  localStorage.setItem(KEY, JSON.stringify(data));
  if (!silent) listeners.forEach((fn) => fn());
}
export function saveQuiet() { localStorage.setItem(KEY, JSON.stringify(data)); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const live = (name) => data[name].filter((x) => !x.deleted);
export const byId = (name, id) => data[name].find((x) => x.id === id && !x.deleted) || null;

export function upsert(name, item) {
  item.updatedAt = now();
  const i = data[name].findIndex((x) => x.id === item.id);
  if (i >= 0) data[name][i] = item; else data[name].push(item);
  save();
  return item;
}
/** Save a change to an item without redrawing the screen. */
export function touch(item) { item.updatedAt = now(); save({ silent: true }); }
export function remove(name, id) {
  const item = data[name].find((x) => x.id === id);
  if (item) { item.deleted = true; item.updatedAt = now(); save(); }
}
export function setProfile(p) { data.profile = { ...p, updatedAt: now() }; save(); }
export function setSettings(s) { data.settings = { ...data.settings, ...s, updatedAt: now() }; save(); }

/** Merge remote copy into local: newest item wins, per item. */
export function mergeRemote(remote) {
  if (!remote) return false;
  let changed = false;
  for (const name of COLLECTIONS) {
    const map = new Map(data[name].map((x) => [x.id, x]));
    for (const r of remote[name] || []) {
      const l = map.get(r.id);
      if (!l || (r.updatedAt || '') > (l.updatedAt || '')) {
        map.set(r.id, r);
        changed = true;
      }
    }
    data[name] = [...map.values()];
  }
  for (const k of ['profile', 'settings']) {
    if (remote[k] && (remote[k].updatedAt || '') > (data[k].updatedAt || '')) { data[k] = remote[k]; changed = true; }
  }
  return changed;
}

/** What gets uploaded to Drive (no device-only fields). */
export function exportable() {
  const strip = (x) => { const { localFile, ...rest } = x; return rest; };
  return {
    version: 1, exportedAt: now(), profile: data.profile, settings: data.settings,
    clients: data.clients, jobs: data.jobs, receipts: data.receipts.map(strip), invoices: data.invoices,
  };
}

export function importBackup(obj) {
  if (!obj || !Array.isArray(obj.jobs)) throw new Error('Not a backup file from this app');
  mergeRemote({ ...obj, profile: { ...obj.profile, updatedAt: now() }, settings: { ...obj.settings, updatedAt: now() } });
  save();
}

export function addHistory(seed) {
  for (const name of COLLECTIONS) {
    for (const item of seed[name]) {
      if (!data[name].some((x) => x.id === item.id)) data[name].push({ ...item, updatedAt: now() });
    }
  }
  save();
}

// ---------- IndexedDB for receipt files ----------
let dbp;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('fl_files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function putFile(key, blob) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function getFile(key) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction('files').objectStore('files').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
export async function deleteFile(key) {
  const d = await db();
  return new Promise((res) => { const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = res; tx.onerror = res; });
}
