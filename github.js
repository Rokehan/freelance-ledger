// In-app updater: publishes new app files to your GitHub repo in one commit.
// GitHub Pages then republishes the site and every device picks it up.
import { unzip } from './unzip.js?v=1.8.0';

const API = 'https://api.github.com';
const K = { owner: 'fl_gh_owner', repo: 'fl_gh_repo', token: 'fl_gh_token', branch: 'fl_gh_branch' };

export function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const first = location.pathname.split('/').filter(Boolean)[0] || '';
  return { owner: m ? m[1] : '', repo: m ? (first && !first.includes('.') ? first : `${m[1]}.github.io`) : '' };
}
export function getConfig() {
  const g = guessRepo();
  return {
    owner: localStorage.getItem(K.owner) || g.owner,
    repo: localStorage.getItem(K.repo) || g.repo,
    branch: localStorage.getItem(K.branch) || 'main',
    token: localStorage.getItem(K.token) || '',
  };
}
export function setConfig({ owner, repo, branch, token }) {
  if (owner != null) localStorage.setItem(K.owner, owner.trim());
  if (repo != null) localStorage.setItem(K.repo, repo.trim());
  if (branch != null) localStorage.setItem(K.branch, branch.trim() || 'main');
  if (token != null) localStorage.setItem(K.token, token.trim());
}
export const hasToken = () => !!localStorage.getItem(K.token);
export const forgetToken = () => localStorage.removeItem(K.token);

function explain(status, text) {
  if (status === 401) return 'GitHub says the key is wrong or has expired. Make a new key (step 1 above) and paste it again.';
  if (status === 403) return 'The key isn\'t allowed to change this repo. Check it has "Contents: Read and write" for freelance-ledger.';
  if (status === 404) return 'GitHub can\'t find that repo with this key. Check the owner + repo name, and that the key was given access to that repo.';
  if (status === 409) return 'The repo is empty. Upload the app once through github.com first.';
  if (status === 422) return 'GitHub refused the update (it may have changed at the same time). Try again.';
  return `GitHub error ${status}: ${String(text).slice(0, 140)}`;
}

async function gh(cfg, path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('Couldn\'t reach GitHub. Are you online?'); }
  if (!r.ok) throw new Error(explain(r.status, await r.text()));
  return r.json();
}

/** Checks the key can see the repo + branch. */
export async function test(cfg = getConfig()) {
  if (!cfg.token) throw new Error('Paste your GitHub key first');
  const repo = await gh(cfg, '');
  await gh(cfg, `/git/ref/heads/${cfg.branch}`);
  return repo.full_name;
}

const ALLOWED = /\.(html|js|css|webmanifest|png|svg|ico|md)$/i;

/** Turns a chosen .zip (or several loose files) into the list of files to publish. */
export async function prepare(fileList, profile = {}) {
  let entries = [];
  for (const f of fileList) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3)) entries.push(...await unzip(buf.buffer));
    else entries.push({ name: f.name, data: buf });
  }
  const files = new Map();
  const skipped = [];
  for (const e of entries) {
    const parts = e.name.split('/');
    const base = parts[parts.length - 1];
    if (!base || base.startsWith('.') || parts.includes('__MACOSX')) continue;
    if (base !== 'version.json' && !ALLOWED.test(base)) { skipped.push(base); continue; }
    files.set(base, e.data);
  }
  if (!files.has('index.html') || !files.has('app.js')) throw new Error('This doesn\'t look like an app update (no index.html / app.js inside)');
  // Never publish personal details to a public repo.
  const secrets = [profile.bank?.number, (profile.phone || '').replace(/\D/g, '')].filter((s) => s && s.length >= 6);
  const dec = new TextDecoder();
  for (const [name, data] of files) {
    if (!/\.(html|js|css|webmanifest|md|json)$/i.test(name)) continue;
    const txt = dec.decode(data);
    const digits = txt.replace(/\D/g, '');
    if (secrets.some((s) => txt.includes(s) || digits.includes(s))) throw new Error(`${name} contains your personal details. Not publishing it to a public repo.`);
  }
  let version = '';
  if (files.has('version.json')) { try { version = JSON.parse(dec.decode(files.get('version.json'))).version || ''; } catch {} }
  return { files: [...files].map(([path, data]) => ({ path, data })), version, skipped };
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One commit with all files. onStep(text) reports progress. */
export async function publish(files, message, onStep = () => {}, cfg = getConfig()) {
  if (!cfg.token) throw new Error('Set up the GitHub key first');
  onStep('Talking to GitHub…');
  const ref = await gh(cfg, `/git/ref/heads/${cfg.branch}`);
  const head = ref.object.sha;
  const commit = await gh(cfg, `/git/commits/${head}`);
  const tree = [];
  let i = 0;
  for (const f of files) {
    onStep(`Uploading ${++i} of ${files.length}: ${f.path}`);
    const blob = await gh(cfg, '/git/blobs', { method: 'POST', body: { content: b64(f.data), encoding: 'base64' } });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  onStep('Saving…');
  const t = await gh(cfg, '/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
  const c = await gh(cfg, '/git/commits', { method: 'POST', body: { message, tree: t.sha, parents: [head] } });
  await gh(cfg, `/git/refs/heads/${cfg.branch}`, { method: 'PATCH', body: { sha: c.sha } });
  return c.sha;
}

/** Waits until the live site serves the new version (GitHub Pages takes ~1 min). */
export async function waitForLive(version, onStep = () => {}, maxMs = 6 * 60 * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const secs = Math.round((Date.now() - t0) / 1000);
    onStep(`Waiting for GitHub to publish it… ${secs}s (usually about a minute)`);
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) { const v = (await r.json()).version; if (!version || v === version) return true; }
    } catch {}
    await new Promise((res) => setTimeout(res, 8000));
  }
  return false;
}

export async function reloadFresh() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  location.reload();
}
