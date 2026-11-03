// Google Drive sync. Uses Google Identity Services (token flow) + Drive REST.
// Scopes: drive.file (only files this app creates) + drive.appdata (hidden data file).
import { data, saveQuiet, mergeRemote, exportable, getFile, putFile } from './store.js';
import { yearOf } from './calc.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const DATA_NAME = 'freelance-ledger-data.json';
const ROOT_NAME = 'Freelance Ledger';
const CID_KEY = 'fl_google_client_id';

let token = null, tokenExp = 0, client = null, gisLoaded = null;
const TOK_KEY = 'fl_drive_tok';
try { const t = JSON.parse(localStorage.getItem(TOK_KEY) || 'null'); if (t && t.e > Date.now()) { token = t.t; tokenExp = t.e; } } catch {}
const keepToken = () => { try { localStorage.setItem(TOK_KEY, JSON.stringify({ t: token, e: tokenExp })); } catch {} };
export const state = { status: 'off', message: '' }; // off | ready | syncing | ok | error
const subs = new Set();
export const onDrive = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const set = (status, message = '') => { state.status = status; state.message = message; subs.forEach((f) => f()); };

// Built-in Google Client ID (public identifier, not a secret). config.json can override it.
const BUILT_IN_ID = '109860717713-sm9j7n830bcb0b5cvovbaaufl6q56lde.apps.googleusercontent.com';
let sharedId = BUILT_IN_ID;
export const setSharedClientId = (v) => { sharedId = (v || '').trim() || BUILT_IN_ID; };
export const getClientId = () => localStorage.getItem(CID_KEY) || sharedId || '';
export const isShared = (v = getClientId()) => !!v && v === sharedId;
export const setClientId = (v) => { localStorage.setItem(CID_KEY, v.trim()); client = null; };
export const isConnected = () => !!token && Date.now() < tokenExp;
export const wasConnected = () => localStorage.getItem('fl_drive_on') === '1';

function loadGis() {
  gisLoaded ||= new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoaded = null; rej(new Error('Could not load Google sign-in (are you online?)')); };
    document.head.appendChild(s);
  });
  return gisLoaded;
}

export const preload = () => loadGis().catch(() => {});

/** Must be called from a tap (Google shows a popup). */
export async function connect(prompt = '') {
  const cid = getClientId();
  if (!cid) throw new Error('Add your Google Client ID in More → Google Drive first');
  await loadGis();
  return new Promise((res, rej) => {
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPES,
      callback: (r) => {
        if (r.error) { set('error', r.error_description || r.error); return rej(new Error(r.error_description || r.error)); }
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000; keepToken();
        localStorage.setItem('fl_drive_on', '1');
        set('ready'); res();
      },
      error_callback: (e) => { set('error', e?.message || 'Sign-in cancelled'); rej(new Error(e?.message || 'Sign-in cancelled')); },
    });
    client.requestAccessToken({ prompt });
  });
}
export function disconnect() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null; tokenExp = 0; localStorage.removeItem('fl_drive_on'); localStorage.removeItem(TOK_KEY); set('off');
}

async function api(url, opts = {}) {
  if (!isConnected()) throw new Error('Google Drive not connected');
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (r.status === 401) { token = null; localStorage.removeItem(TOK_KEY); set('off', 'Google sign-in expired. Tap Sync to reconnect'); throw new Error('Sign-in expired'); }
  if (!r.ok) throw new Error(`Drive error ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r;
}

async function findOne(q, spaces = 'drive') {
  const r = await api(`${API}/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&pageSize=10`);
  return (await r.json()).files[0] || null;
}

function multipart(meta, blob) {
  const b = 'fl' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`,
  ]);
  return { body, type: `multipart/related; boundary=${b}` };
}

export async function uploadFile({ name, blob, parent, fileId }) {
  const meta = fileId ? { name } : { name, parents: [parent] };
  const m = multipart(meta, blob);
  const url = fileId ? `${UP}/files/${fileId}?uploadType=multipart&fields=id,webViewLink` : `${UP}/files?uploadType=multipart&fields=id,webViewLink`;
  const r = await api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': m.type }, body: m.body });
  return r.json();
}

async function folder(name, parent) {
  const key = parent ? `${parent}/${name}` : name;
  const cached = data.drive.folders[key];
  if (cached) return cached;
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
  let f = await findOne(q);
  if (!f) {
    const r = await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }) });
    f = await r.json();
  }
  data.drive.folders[key] = f.id; saveQuiet();
  return f.id;
}
/** e.g. kind 'Invoices', year 2026 -> folder id of Freelance Ledger/Invoices/2026 */
export async function yearFolder(kind, year) {
  const root = await folder(ROOT_NAME);
  const k = await folder(kind, root);
  return folder(String(year), k);
}

/** Pull, merge, push. Also uploads receipt files that aren't on Drive yet. */
export async function sync() {
  if (!isConnected()) throw new Error('Google Drive not connected');
  set('syncing', 'Syncing…');
  try {
    let fileId = data.drive.dataFileId;
    if (!fileId) { const f = await findOne(`name='${DATA_NAME}'`, 'appDataFolder'); fileId = f?.id || null; }
    if (fileId) {
      try {
        const r = await api(`${API}/files/${fileId}?alt=media`);
        mergeRemote(await r.json());
      } catch (e) { if (!String(e.message).includes('404')) throw e; fileId = null; }
    }
    // receipts: upload new local files
    for (const rc of data.receipts) {
      if (rc.deleted || !rc.hasFile || rc.driveId) continue;
      const blob = await getFile(rc.id);
      if (!blob) continue;
      const parent = await yearFolder('Receipts', yearOf(rc.date));
      const up = await uploadFile({ name: rc.fileName || `${rc.date}_receipt.jpg`, blob, parent });
      rc.driveId = up.id; rc.updatedAt = new Date().toISOString();
    }
    const blob = new Blob([JSON.stringify(exportable())], { type: 'application/json' });
    const meta = fileId ? { name: DATA_NAME } : { name: DATA_NAME, parents: ['appDataFolder'] };
    const m = multipart(meta, blob);
    const url = fileId ? `${UP}/files/${fileId}?uploadType=multipart&fields=id` : `${UP}/files?uploadType=multipart&fields=id`;
    const r = await api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': m.type }, body: m.body });
    data.drive.dataFileId = (await r.json()).id;
    data.drive.lastSync = new Date().toISOString();
    data.dirty = false;
    saveQuiet();
    set('ok', 'Synced');
    return true;
  } catch (e) { set('error', e.message); throw e; }
}

/** Get a receipt's file: this device first, then Drive. */
export async function receiptBlob(rc) {
  let b = await getFile(rc.id);
  if (b) return b;
  if (rc.driveId && isConnected()) {
    const r = await api(`${API}/files/${rc.driveId}?alt=media`);
    b = await r.blob();
    if (rc.mime) b = new Blob([b], { type: rc.mime });
    await putFile(rc.id, b);
    return b;
  }
  return null;
}

export async function saveInvoicePdf(inv, file) {
  const parent = await yearFolder('Invoices', yearOf(inv.issueDate));
  const up = await uploadFile({ name: file.name, blob: file, parent, fileId: inv.driveId || undefined });
  inv.driveId = up.id; inv.driveLink = up.webViewLink || inv.driveLink || '';
  return up;
}
