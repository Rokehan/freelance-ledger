import * as C from './calc.js';
import * as S from './store.js';
import * as D from './drive.js';
import { invoicePdf, invoicePreviewUrl } from './render.js';
import { readReceipt } from './ocr.js';
import { emailFor, canShareFiles, shareFiles, downloadFile, mailtoLink } from './email.js';
import * as G from './github.js';

const VERSION = '1.6.1';
const { data } = S;
const $app = document.getElementById('app');

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v; // only used with static strings
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
/** Safely swap an element's contents: flattens lists and skips empty slots (fixes the [object …] / null bug). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
}
/**
 * File picker that works everywhere: big tap/click zone + drag & drop + a plain fallback input.
 * (Hidden inputs inside labels are unreliable in some browsers, so we click it ourselves.)
 */
function filePicker(label, { accept = '', multiple = false, onFiles, fallback = true, capture = null, hint = true } = {}) {
  const make = (cls) => {
    const i = h('input', { type: 'file', class: cls, accept: accept || null, multiple: multiple || null, capture: capture || null });
    i.addEventListener('change', () => { const f = [...(i.files || [])]; i.value = ''; if (f.length) onFiles(f); });
    return i;
  };
  const hidden = make('vh');
  const zone = h('div', { class: 'filebtn', role: 'button', tabindex: '0' }, label, hint ? h('small', { class: 'drop-hint' }, 'or drag the file here') : null);
  zone.addEventListener('click', () => hidden.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hidden.click(); } });
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); const f = [...(e.dataTransfer?.files || [])]; if (f.length) onFiles(f); });
  return h('div', { class: 'picker' }, zone, hidden,
    fallback ? h('details', { class: 'picker-fallback' }, h('summary', {}, 'Button not working?'), h('p', { class: 'small muted' }, 'Use this plain picker instead:'), make('plain')) : null);
}
// Stop the browser opening a file if it's dropped outside a drop zone.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
let busy = false; // true while an update is being installed: no auto re-render

const chip = (text, kind = '') => h('span', { class: `chip ${kind}` }, text);
const money = C.yen;

function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { prompt('Copy this:', text); }
}
const confirmBox = (msg) => window.confirm(msg);

// ---------- sheet (modal form) ----------
let sheetEl = null;
let sheetOnClose = null;
function openSheet(title, body, actions = [], { onClose = null } = {}) {
  closeSheet();
  sheetOnClose = onClose;
  sheetEl = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === sheetEl) closeSheet(true); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon', onclick: () => closeSheet(true), 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'sheet-body' }, body),
      actions.length ? h('div', { class: 'sheet-actions' }, actions) : null));
  document.body.append(sheetEl);
  document.body.classList.add('noscroll');
}
function closeSheet(byUser = false) {
  const cb = sheetOnClose; sheetOnClose = null;
  sheetEl?.remove(); sheetEl = null; document.body.classList.remove('noscroll');
  if (byUser === true && cb) cb();
}

// form field helpers
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
const inp = (o = {}) => h('input', { type: 'text', ...o });
const sel = (options, value, o = {}) => h('select', o, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) || null }, t)));
const toggle = (label, checked, hint) => {
  const box = h('input', { type: 'checkbox', checked });
  return { el: h('label', { class: 'toggle' }, box, h('span', {}, h('b', {}, label), hint ? h('small', {}, hint) : null)), box };
};
const clientName = (id) => { const c = S.byId('clients', id); return c ? (c.nameEn || c.nameJa) : '—'; };
const clientOptions = (withNew = true) => [['', 'Choose client…'], ...S.live('clients').sort((a, b) => clientName(a.id).localeCompare(clientName(b.id))).map((c) => [c.id, c.nameEn || c.nameJa]), ...(withNew ? [['__new', '+ New client']] : [])];

// ---------- glossary ----------
const GLOSSARY = [
  ['確定申告', 'kakutei shinkoku', 'Your yearly tax return. Needed when side income after expenses is over ¥200,000 in a year. Deadline: 15 March of the next year.'],
  ['源泉徴収', 'gensen chōshū', 'Withholding. Some clients keep 10.21% of your fee and pay it to the tax office for you. It counts toward your tax when you file, so you can get it back.'],
  ['消費税', 'shōhizei', 'Consumption tax (10%). You are not registered, so you don\'t pay it to the government. Anything you charge is just extra income (and counts as income).'],
  ['インボイス / T-number', 'invoice system', 'A tax registration number (T + 13 digits). You don\'t have one. Never put a client\'s T-number on your invoice.'],
  ['立替金', 'tatekae-kin', 'Expenses you paid for the client (taxi, train). They pay you back. Not income, no tax added.'],
  ['住民税', 'jūminzei', 'Resident tax (about 10%). Calculated from your tax return, billed from June of the next year.'],
  ['源泉徴収票', 'gensen chōshū-hyō', 'The year-end salary slip Capsule gives you (December/January). You need it for the tax return.'],
  ['支払調書', 'shiharai chōsho', 'A payment statement some clients send showing what they paid you and withheld. Nice to have, not required.'],
  ['御中 / 様', 'onchū / sama', 'Polite endings: 御中 for companies, 様 for a person.'],
];
function help(term) {
  const g = GLOSSARY.find((x) => x[0].includes(term));
  if (!g) return null;
  return h('button', { class: 'help', type: 'button', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openSheet(g[0], h('div', {}, h('p', { class: 'muted' }, g[1]), h('p', {}, g[2]))); } }, '?');
}

// ---------- router ----------
const routes = {};
let current = '';
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);
// ---------- icons (line icons, inline SVG) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  briefcase: '<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2.5 12.5h19"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  camera: '<path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  id: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9.5h3.5M15 13h3.5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  yen: '<path d="M6 3l6 8 6-8M12 11v10M7 13h10M7 17h10"/>',
};
const icon = (name, cls = '') => h('span', { class: `ic ${cls}`, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>` });

const NAV = [['home', 'home', 'Dashboard', '収支'], ['jobs', 'briefcase', 'Jobs', '仕事'], ['invoices', 'file', 'Invoices', '請求書'], ['receipts', 'camera', 'Receipts', '領収書']];
const NAV2 = [['clients', 'users', 'Clients', '取引先'], ['profile', 'id', 'My details', '自分'], ['settings', 'percent', 'Tax settings', '税金'], ['drive', 'cloud', 'Google Drive', '同期'], ['email', 'mail', 'Email setup', 'メール'], ['updates', 'upload', 'App updates', '更新'], ['data', 'archive', 'Backup', '保存'], ['help', 'book', 'Glossary', '用語集']];
const activeTab = () => ({ invoice: 'invoices' }[current] || current);
const initials = () => (data.profile.signatureEn || data.profile.nameEn || '¥ ¥').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const pageHead = (en, ja, ...right) => h('div', { class: 'pagehead' }, h('div', {}, h('h1', {}, en), ja ? h('div', { class: 'ja-sub' }, ja) : null), h('div', { class: 'row gap wrap' }, right));
const backLink = () => h('a', { href: '#more', class: 'back m-only' }, '‹ Settings');

let configLoaded = false;
const needsGate = () => !data.clients.length && !data.jobs.length && !localStorage.getItem('fl_welcomed');
function render() {
  if (needsGate()) { fill($app, configLoaded ? gateView() : h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, h('span', { class: 'logo big' }, '¥'), h('p', { class: 'muted' }, 'Loading…')))); return; }
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  current = name;
  const view = (routes[name] || routes.home)(arg);
  fill($app, sidebar(), h('div', { class: 'shell' }, header(), syncBar(), h('main', {}, view)), tabs());
}
S.onChange(() => { if (!sheetEl && !busy) render(); scheduleSync(); });
D.onDrive(() => {
  document.querySelectorAll('.sync-pill').forEach((p) => p.replaceWith(syncPill()));
  document.querySelectorAll('.syncbar-slot').forEach((p) => p.replaceWith(syncBar()));
});
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60); if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)} days ago`;
};
/** Big "tap to sync" bar whenever Drive is set up but this device isn't signed in right now. */
function syncBar() {
  if (!D.getClientId() || D.isConnected()) return h('div', { class: 'syncbar-slot' });
  const syncing = D.state.status === 'syncing';
  return h('div', { class: 'syncbar-slot' }, h('button', { class: 'syncbar', onclick: syncTap, disabled: syncing || null },
    icon('cloud'), h('span', { class: 'grow' }, h('b', {}, syncing ? 'Syncing…' : 'Tap to sync with Google Drive'),
      h('small', {}, data.drive.lastSync ? `This device last synced ${ago(data.drive.lastSync)}. Sync before you change anything.` : 'Gets your data from your other devices.')),
    h('span', { class: 'go' }, syncing ? '…' : 'Sync')));
}

function sidebar() {
  const a = activeTab();
  const item = ([k, ic, en, ja]) => h('a', { class: `nav ${a === k ? 'on' : ''}`, href: `#${k}` }, icon(ic), h('span', { class: 'grow' }, en), h('small', {}, ja));
  return h('aside', { class: 'side' },
    h('a', { class: 'brand', href: '#home' }, h('span', { class: 'logo' }, '¥'), h('div', {}, h('b', {}, 'FREELANCE LEDGER'), h('small', {}, 'フリーランス台帳'))),
    h('button', { class: 'btn block', onclick: quickAdd }, icon('plus'), 'New'),
    h('nav', {}, NAV.map(item)),
    h('div', { class: 'side-label' }, 'SETTINGS · 設定'),
    h('nav', {}, NAV2.map(item)),
    h('div', { class: 'grow' }),
    setupCard('side'),
    h('a', { class: 'me', href: '#profile' }, h('span', { class: 'avatar' }, initials()),
      h('div', { class: 'grow' }, h('b', {}, data.profile.signatureEn || 'Your name'), h('small', {}, `v${VERSION}`))));
}

function header() {
  return h('header', { class: 'top' },
    h('a', { class: 'avatar m-only', href: '#profile', 'aria-label': 'My details' }, initials()),
    h('a', { class: 'brand m-only', href: '#home' }, h('span', { class: 'logo sm' }, '¥'), h('b', {}, 'LEDGER')),
    h('div', { class: 'grow' }),
    syncPill(),
    h('a', { class: 'iconbtn m-only', href: '#more', 'aria-label': 'Settings' }, icon('sliders')));
}
function syncPill() {
  const st = D.state.status;
  const label = !D.getClientId() ? 'Drive off' : st === 'syncing' ? 'Syncing…' : st === 'ok' ? (data.dirty ? 'Sync' : 'Synced') : st === 'error' ? 'Sync error' : 'Sync';
  return h('button', { class: `sync-pill ${st} ${data.dirty ? 'dirty' : ''}`, onclick: syncTap }, icon('sync'), label);
}
async function syncTap() {
  if (!D.getClientId()) { go('drive'); return; }
  try {
    if (!D.isConnected()) await D.connect();
    await D.sync(); render(); toast('Synced with Google Drive');
    backupPdfs().catch(() => {});
  } catch (e) { toast(e.message, 'bad'); }
}
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  if (!D.isConnected()) return;
  syncTimer = setTimeout(() => D.sync().then(() => { if (!sheetEl && !busy) render(); return backupPdfs(); }).catch(() => {}), 4000);
}

function tabs() {
  const a = activeTab();
  const t = (k, ic, en) => h('a', { href: `#${k}`, class: a === k ? 'on' : '' }, icon(ic), h('span', {}, en));
  return h('nav', { class: 'tabs' }, t('home', 'home', 'Money'), t('jobs', 'briefcase', 'Jobs'),
    h('button', { class: 'fab', onclick: quickAdd, 'aria-label': 'Add' }, icon('plus')),
    t('invoices', 'file', 'Invoices'), t('receipts', 'camera', 'Receipts'));
}
/** Puts To + Subject at the top of a shared email so they can be copied inside Mail. */
function withCopyHeader(mail) {
  const ja = /[\u3040-\u30ff\u4e00-\u9faf]/.test(mail.body);
  const note = ja ? '▲ To / Subject: copy these into the boxes above, then delete these lines ▲' : '▲ Copy To + Subject into the boxes above, then delete these lines ▲';
  const head = [mail.to ? `To: ${mail.to}` : null, `Subject: ${mail.subject}`, note, '────────────', ''].filter((x) => x != null).join('\n');
  return { ...mail, body: `${head}\n${mail.body}` };
}

function quickAdd() {
  openSheet('Add · 追加', h('div', { class: 'quick' },
    [['camera', 'Snap receipt', '領収書を撮る', () => snapReceipt()], ['briefcase', 'Log work', '仕事を記録', () => jobForm()], ['file', 'New invoice', '請求書', () => invoiceForm()]]
      .map(([ic, en, ja, fn]) => h('button', { class: 'qa', onclick: () => { closeSheet(); fn(); } }, icon(ic), h('b', {}, en), h('small', {}, ja)))));
}

// =====================================================================
// HOME: finance tracker
// =====================================================================
let homeYear = C.yearOf(C.today());
const STATUS_LABEL = { draft: 'To send', sent: 'Sent', overdue: 'Overdue', partial: 'Part paid', paid: 'Paid' };
const byIssueDesc = (a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || String(b.number).localeCompare(String(a.number));

function invoiceRow(inv) {
  const t = C.invoiceTotals(inv, data); const st = C.invoiceStatus(inv, data);
  return h('a', { class: 'rowi', href: `#invoice/${inv.id}` },
    h('div', { class: 'r-main' }, h('b', {}, clientName(inv.clientId)), h('small', {}, `#${inv.number}${inv.project ? ' · ' + inv.project : ''}`)),
    h('div', { class: 'r-mid' }, chip(STATUS_LABEL[st], st)),
    h('div', { class: 'r-end' }, h('b', {}, money(t.total)), h('small', {}, C.fmtDateEn(inv.issueDate))));
}

routes.home = () => {
  const s = C.yearSummary(data, homeYear);
  const years = [...new Set([C.yearOf(C.today()), ...data.jobs.filter((j) => !j.deleted).map((j) => C.yearOf(j.date))])].sort((a, b) => b - a);
  const pctRaw = Math.round((s.net / C.FILING_LINE) * 100);
  const maxM = Math.max(1, ...s.months);
  const laneTotal = Math.max(1, s.income);
  const kpi = (cls, label, ja, value, ...extra) => h('div', { class: `card kpi ${cls}` },
    h('div', { class: 'kpi-label' }, h('span', {}, label), h('small', {}, ja)), h('div', { class: 'kpi-value' }, value), extra);
  const recent = S.live('invoices').sort(byIssueDesc).slice(0, 6);

  return h('div', { class: 'stack' },
    pageHead('Dashboard', `${homeYear}年 · 収支`, sel(years.map((y) => [y, y]), homeYear, { class: 'year', onchange: (e) => { homeYear = Number(e.target.value) || homeYear; render(); } })),
    setupCard('main'),
    h('div', { class: 'kpis' },
      kpi('hero', `Earned in ${homeYear}`, '収入', money(s.net),
        h('div', { class: 'kpi-sub' }, s.expenses ? `${money(s.income)} income − ${money(s.expenses)} costs` : 'after expenses · by the day you worked'),
        h('div', { class: 'lanes' }, Object.entries(C.LANES).map(([k, l]) => h('div', { class: 'lane' },
          h('div', { class: 'row between small' }, h('span', {}, h('i', { class: `dot l-${k}` }), `${l.en}`), h('b', {}, money(s.lanes[k] || 0))),
          h('div', { class: 'lane-bar' }, h('i', { class: `l-${k}`, style: `width:${Math.round(((s.lanes[k] || 0) / laneTotal) * 100)}%` })))))),
      kpi('', 'Put aside for tax', '納税準備', money(s.setAside),
        h('div', { class: 'kpi-sub' }, s.stillToSave ? `${money(s.stillToSave)} still to save` : 'All saved ✓'),
        s.withheld ? h('span', { class: 'chip sent' }, `${money(s.withheld)} already withheld`) : null),
      kpi('', 'Owed to you', '未入金', money(s.owed),
        s.overdueCount ? h('a', { class: 'chip overdue', href: '#invoices' }, `${s.overdueCount} overdue · ${money(s.overdue)}`) : h('span', { class: 'chip paid' }, 'Nothing overdue')),
      kpi(s.overFilingLine ? 'warn' : '', 'Tax return line', '確定申告', `${pctRaw}%`,
        h('div', { class: 'meter' }, h('i', { class: s.overFilingLine ? 'over' : '', style: `width:${Math.min(100, pctRaw)}%` })),
        h('div', { class: 'kpi-sub' }, s.overFilingLine ? `Over ¥200k · file by 15 Mar ${homeYear + 1}` : `${money(s.filingGap)} until you need to file`), help('確定申告'))),
    s.uninvoiced ? h('a', { class: 'notice', href: '#jobs' }, `${money(s.uninvoiced)} of work isn't invoiced yet → invoice it`) : null,
    h('div', { class: 'dash-grid' },
      monthChart(s, maxM),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('h3', {}, 'Tax pot ', h('small', { class: 'ja' }, '納税用の貯金')),
          h('div', { class: 'row gap' },
            field('Saved so far ¥', inp({ type: 'number', inputmode: 'numeric', value: s.saved || '', placeholder: '0', onchange: (e) => { const sa = { ...(data.settings.savedAside || {}) }; sa[homeYear] = Number(e.target.value) || 0; S.setSettings({ savedAside: sa }); } })),
            h('div', { class: 'tile' }, h('small', {}, 'Still to save'), h('b', {}, money(s.stillToSave)))),
          h('details', {}, h('summary', {}, 'How is this worked out?'),
            h('p', { class: 'small' }, `${Math.round(s.rate * 100)}% of ${money(s.net)} = ${money(s.taxEstimate)}${s.withheld ? `, minus ${money(s.withheld)} clients already withheld` : ''}. Side income sits on top of your Capsule salary (about ${money(data.settings.salaryMonthly || 0)}/month), so it's taxed at 5% × 1.021 income tax + 10% resident tax ≈ 15%. ⚠️ Estimate: assumes no bonus or dependents. Check against your 源泉徴収票.`))),
        h('div', { class: 'card small' },
          h('h3', {}, 'Key dates ', h('small', { class: 'ja' }, '予定')),
          h('ul', { class: 'dates' },
            h('li', {}, h('b', {}, 'Month end'), h('span', {}, 'invoice last month\'s work')),
            h('li', {}, h('b', {}, `Dec–Jan`), h('span', {}, '源泉徴収票 from Capsule ', help('源泉徴収票'))),
            h('li', {}, h('b', {}, `16 Feb–15 Mar ${homeYear + 1}`), h('span', {}, 'tax return ', help('確定申告'))),
            h('li', {}, h('b', {}, `Jun ${homeYear + 1}`), h('span', {}, 'resident tax bills ', help('住民税'))))))),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', {}, 'Recent invoices ', h('small', { class: 'ja' }, '最近の請求書')), h('a', { href: '#invoices', class: 'small' }, 'View all ›')),
      recent.length ? h('div', { class: 'rows' }, recent.map(invoiceRow)) : h('p', { class: 'empty' }, 'No invoices yet.')));
};


// ---------- month chart: hover = amount, click = that month's invoices ----------
const shortYen = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v ? C.num(v) : '');
function monthChart(s, maxM) {
  const tip = h('div', { class: 'tip' });
  const show = (bar, i, v) => {
    fill(tip, h('b', {}, `${C.MONTHS[i]} ${homeYear}`), h('span', {}, money(v)), h('small', {}, v ? 'Click to see invoices' : 'Nothing logged'));
    tip.style.left = `${bar.offsetLeft + bar.offsetWidth / 2}px`;
    tip.classList.add('on');
  };
  const hide = () => tip.classList.remove('on');
  const bars = s.months.map((v, i) => {
    const b = h('button', { type: 'button', class: `bar ${v ? '' : 'zero'}`, 'aria-label': `${C.MONTHS[i]}: ${money(v)}`,
      onclick: () => { hide(); monthSheet(homeYear, i + 1); } },
    h('em', {}, shortYen(v)), h('i', { style: `height:${Math.round((v / maxM) * 100)}%` }), h('span', {}, C.MONTHS[i].slice(0, 3)));
    b.addEventListener('mouseenter', () => show(b, i, v));
    b.addEventListener('focus', () => show(b, i, v));
    b.addEventListener('mouseleave', hide);
    b.addEventListener('blur', hide);
    return b;
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', {}, 'By month'), h('span', { class: 'small muted' }, 'by the day you worked')),
    h('div', { class: 'bars' }, bars, tip));
}

function monthSheet(year, month) {
  const d = C.monthDetail(data, year, month);
  const go2 = (hash) => { closeSheet(); go(hash); };
  openSheet(`${C.MONTHS[month - 1]} ${year}`, h('div', { class: 'stack' },
    h('div', { class: 'card hero flat' }, h('div', { class: 'big' }, money(d.total)), h('div', { class: 'muted small' }, `earned from ${d.count} job${d.count === 1 ? '' : 's'} worked this month`)),
    !d.count ? h('p', { class: 'empty' }, 'No work logged this month.') : null,
    d.invoices.length ? [h('h4', {}, 'Invoices'), h('div', { class: 'list' }, d.invoices.map(({ inv, amount, jobs }) => {
      const st = C.invoiceStatus(inv, data); const t = C.invoiceTotals(inv, data);
      return h('div', { class: 'item', onclick: () => go2(`invoice/${inv.id}`) }, h('div', { class: 'grow' },
        h('div', { class: 'row between' }, h('b', {}, `#${inv.number} · ${clientName(inv.clientId)}`), h('b', {}, money(amount))),
        h('div', { class: 'row between small muted' },
          h('span', {}, `${jobs.length} job${jobs.length === 1 ? '' : 's'} this month${t.total !== amount ? ` · invoice total ${money(t.total)}` : ''}`),
          chip(STATUS_LABEL[st], st))), '›');
    }))] : null,
    d.direct.length ? [h('h4', {}, 'Paid without an invoice'), h('div', { class: 'list' }, d.direct.map(({ job, amount }) => h('div', { class: 'item', onclick: () => { closeSheet(); jobForm(job); } }, h('div', { class: 'grow row between' }, h('span', {}, `${C.fmtDateSlash(job.date)} · ${job.description || clientName(job.clientId)}`), h('b', {}, money(amount))))))] : null,
    d.open.length ? [h('h4', {}, 'Not invoiced yet'), h('div', { class: 'list' }, d.open.map(({ job, amount }) => h('div', { class: 'item', onclick: () => { closeSheet(); jobForm(job); } }, h('div', { class: 'grow row between' }, h('span', {}, `${C.fmtDateSlash(job.date)} · ${clientName(job.clientId)} · ${job.description || job.project || ''}`), h('b', {}, money(amount)))))),
      h('button', { class: 'btn', onclick: () => { jobFilter = 'open'; go2('jobs'); } }, 'Invoice these')] : null));
}

// ---------- setup checklist ----------
function setupState() {
  return [
    ['Load your details', !!(data.profile.nameEn && data.clients.length), '#data'],
    ['Connect Google Drive', !!data.drive.lastSync, '#drive'],
    ['Set up email', localStorage.getItem('fl_mail_done') === '1', '#email'],
    ['Set up in-app updates', G.hasToken(), '#updates'],
  ];
}
function setupCard(where = 'main') {
  const st = setupState();
  const done = st.filter((x) => x[1]).length;
  if (done === st.length || localStorage.getItem('fl_setup_hide') === '1') return null;
  return h('div', { class: `card setup setup-${where}` },
    h('div', { class: 'row between' }, h('h3', {}, `Setup ${done}/${st.length} `, h('small', { class: 'ja' }, '初期設定')),
      h('button', { class: 'icon', onclick: () => { localStorage.setItem('fl_setup_hide', '1'); render(); }, 'aria-label': 'Hide' }, '✕')),
    h('div', { class: 'meter' }, h('i', { style: `width:${Math.round((done / st.length) * 100)}%` })),
    h('div', { class: 'checklist' }, st.map(([label, ok, href]) => h('a', { class: `ck ${ok ? 'done' : ''}`, href },
      h('span', { class: 'tick' }, ok ? '✓' : ''), h('span', { class: 'grow' }, label), ok ? null : icon('chevron', 'chev')))));
}

// ---------- guide building blocks ----------
const step = (n, title, ...body) => h('div', { class: 'step' }, h('span', { class: 'num' }, n), h('div', { class: 'grow' }, h('b', {}, title), body));
const linkBtn = (href, label) => h('a', { class: 'btn small ghost', href, target: '_blank', rel: 'noopener' }, `${label} ↗`);
const copyBtn = (text, label = 'Copy') => h('button', { class: 'btn small ghost', type: 'button', onclick: () => copy(text) }, label);
const codeLine = (text) => h('div', { class: 'codeline' }, h('code', {}, text), copyBtn(text));
const p_ = (...k) => h('p', { class: 'small' }, k);
const trouble = (q, a) => h('details', { class: 'trouble' }, h('summary', {}, q), h('p', { class: 'small' }, a));

// =====================================================================
// JOBS
// =====================================================================
let jobFilter = 'all';
let selected = new Set();
routes.jobs = () => {
  let jobs = S.live('jobs').sort((a, b) => b.date.localeCompare(a.date));
  const status = (j) => { if (j.direct) return 'direct'; const inv = C.invoiceForJob(j.id, data); return inv ? inv : null; };
  if (jobFilter === 'open') jobs = jobs.filter((j) => !j.direct && !C.invoiceForJob(j.id, data));
  const groups = {};
  for (const j of jobs) (groups[j.date.slice(0, 7)] ||= []).push(j);
  const selJobs = [...selected].map((id) => S.byId('jobs', id)).filter(Boolean);

  return h('div', { class: 'stack' },
    pageHead('Jobs', '仕事', h('button', { class: 'btn', onclick: () => jobForm() }, icon('plus'), 'Log work')),
    h('div', { class: 'seg' }, [['all', 'All'], ['open', 'Not invoiced']].map(([k, l]) => h('button', { class: jobFilter === k ? 'on' : '', onclick: () => { jobFilter = k; render(); } }, l))),
    selJobs.length ? h('div', { class: 'card selbar' },
      h('span', {}, `${selJobs.length} selected · ${money(selJobs.reduce((s, j) => s + C.jobFee(j), 0))}`),
      h('button', { class: 'btn', onclick: () => {
        const cl = new Set(selJobs.map((j) => j.clientId));
        if (cl.size > 1) return toast('Pick jobs for one client at a time', 'bad');
        invoiceForm(null, { clientId: selJobs[0].clientId, jobIds: selJobs.map((j) => j.id) });
      } }, 'Create invoice'),
      h('button', { class: 'btn ghost', onclick: () => { selected.clear(); render(); } }, 'Clear')) : null,
    !jobs.length ? h('p', { class: 'empty' }, jobFilter === 'open' ? 'All work is invoiced. Nice.' : 'No jobs yet. Tap + after each shoot or teaching day.') : null,
    Object.entries(groups).map(([ym, list]) => h('div', { class: 'card tight' },
      h('div', { class: 'month' }, h('span', {}, C.MONTHS[Number(ym.slice(5)) - 1], ' ', ym.slice(0, 4)), h('b', {}, money(list.reduce((s, j) => s + C.jobFee(j), 0)))),
      h('div', { class: 'rows' }, list.map((j) => {
        const st = status(j);
        return h('div', { class: 'rowi', onclick: () => jobForm(j) },
          !st ? h('input', { type: 'checkbox', class: 'pick', checked: selected.has(j.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? selected.add(j.id) : selected.delete(j.id); render(); } }) : h('span', { class: `lane-tag l-${j.lane}` }),
          h('div', { class: 'r-main' }, h('b', {}, j.description || j.position || j.project || 'Work'), h('small', {}, `${clientName(j.clientId)}${j.project ? ' · ' + j.project : ''}`)),
          h('div', { class: 'r-mid' }, st === 'direct' ? chip('Paid directly', 'paid') : st ? chip(`#${st.number}`, C.invoiceStatus(st, data)) : chip('Not invoiced', 'draft')),
          h('div', { class: 'r-end' }, h('b', {}, money(C.jobFee(j))), h('small', {}, C.fmtDates(C.datesOf(j)))));
      })))));
};

function newClientInline(onDone) { clientForm(null, (c) => onDone(c)); }

/**
 * Work-date picker: one day, a run of days (start → end), or separate days.
 * onChange(dates, mode, prevCount) fires on every change.
 */
function datesControl(initial, mode0, onChange) {
  let dates = initial && initial.length ? [...initial] : [C.today()];
  let mode = mode0 || (dates.length > 1 ? (C.isConsecutive(dates) ? 'range' : 'list') : 'single');
  const wrap = h('div', { class: 'dates' });
  const emit = (prev) => onChange(dates, mode, prev);
  const draw = () => {
    const seg = h('div', { class: 'seg small' }, [['single', 'One day'], ['range', 'Run of days'], ['list', 'Separate days']].map(([k, l]) =>
      h('button', { type: 'button', class: mode === k ? 'on' : '', onclick: () => {
        const prev = dates.length; mode = k;
        if (k === 'single') dates = [dates[0]];
        else if (k === 'range') dates = C.expandRange(dates[0], dates[dates.length - 1] > dates[0] ? dates[dates.length - 1] : C.ymd(new Date(C.parseYmd(dates[0]).getTime() + 86400000)));
        draw(); emit(prev);
      } }, l)));
    let body;
    if (mode === 'single') {
      body = inp({ type: 'date', value: dates[0], onchange: (e) => { if (e.target.value) { const prev = dates.length; dates = [e.target.value]; emit(prev); } } });
    } else if (mode === 'range') {
      const info = h('span', { class: 'chip sent' }, `${dates.length} days`);
      const a = inp({ type: 'date', value: dates[0] }), b = inp({ type: 'date', value: dates[dates.length - 1] });
      const upd = () => {
        if (!a.value || !b.value) return;
        const prev = dates.length;
        dates = a.value <= b.value ? C.expandRange(a.value, b.value) : C.expandRange(b.value, a.value);
        info.textContent = `${dates.length} day${dates.length === 1 ? '' : 's'}`; emit(prev);
      };
      a.onchange = upd; b.onchange = upd;
      body = [h('div', { class: 'grid2' }, field('First day', a), field('Last day', b)), info];
    } else {
      const add = inp({ type: 'date' });
      const addIt = () => { if (add.value && !dates.includes(add.value)) { const prev = dates.length; dates = [...dates, add.value].sort(); draw(); emit(prev); } };
      add.onchange = addIt;
      body = [h('div', { class: 'chips' }, dates.map((d) => h('span', { class: 'chip sent' }, C.fmtDateSlash(d), ' ',
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove day', onclick: () => { if (dates.length > 1) { const prev = dates.length; dates = dates.filter((x) => x !== d); draw(); emit(prev); } } }, '×')))),
        h('div', { class: 'row gap' }, add, h('button', { type: 'button', class: 'btn ghost small', onclick: addIt }, '+ Add day'))];
    }
    fill(wrap, seg, body);
  };
  draw();
  return wrap;
}

function jobForm(job, preset = {}) {
  const isNew = !job;
  const j = job ? { ...job } : { id: S.uid('jb'), deleted: false, clientId: '', lane: 'camera', date: C.today(), qty: 1, unit: 'day', rate: 0, project: '', position: '', description: '', direct: false, notes: '', ...preset };
  const fClient = sel(clientOptions(), j.clientId);
  const fLane = sel(Object.entries(C.LANES).map(([k, l]) => [k, `${l.icon} ${l.en}`]), j.lane);
  let jDates = C.datesOf(j); let jMode = j.dateMode || '';
  const fQty = inp({ type: 'number', step: '0.5', inputmode: 'decimal', value: j.qty });
  const fUnit = sel([['day', 'days'], ['hour', 'hours'], ['item', 'item(s)']], j.unit);
  const fRate = inp({ type: 'number', inputmode: 'numeric', value: j.rate });
  const fDates = datesControl(jDates, jMode, (d, m, prev) => {
    jDates = d; jMode = m;
    // a 3-day run → 3 days, unless you've typed your own quantity
    if (fUnit.value === 'day' && (Number(fQty.value) === prev || !Number(fQty.value))) { fQty.value = d.length; upd(); }
  });
  const fProj = inp({ value: j.project, placeholder: 'e.g. Porter Air Duck' });
  const fPos = inp({ value: j.position, placeholder: 'e.g. 2nd AC' });
  const fDesc = inp({ value: j.description, placeholder: 'Shown on the invoice line, e.g. 2nd AC' });
  const fNotes = h('textarea', { rows: 2 }, j.notes || '');
  const fDirect = toggle('Paid without an invoice', j.direct, 'e.g. clamp rentals paid by Capsule');
  const fee = h('b', {}, money(C.jobFee(j)));
  const upd = () => { fee.textContent = money((Number(fQty.value) || 0) * (Number(fRate.value) || 0)); };
  fQty.oninput = upd; fRate.oninput = upd;
  fClient.onchange = () => {
    if (fClient.value === '__new') return newClientInline((c) => { jobForm(null, { ...collect(), clientId: c.id, lane: c.lane, unit: c.unit, rate: c.rate }); });
    const c = S.byId('clients', fClient.value);
    if (c && isNew) { fLane.value = c.lane || 'camera'; fUnit.value = c.unit || 'day'; if (c.rate) fRate.value = c.rate; upd(); }
  };
  fPos.oninput = () => { if (!fDesc.dataset.touched) fDesc.value = fPos.value; };
  fDesc.oninput = () => { fDesc.dataset.touched = '1'; };
  const collect = () => ({ ...j, clientId: fClient.value === '__new' ? '' : fClient.value, lane: fLane.value, date: jDates[0], dates: jDates, dateMode: jMode, qty: Number(fQty.value) || 0, unit: fUnit.value, rate: Number(fRate.value) || 0, project: fProj.value.trim(), position: fPos.value.trim(), description: fDesc.value.trim() || fPos.value.trim(), direct: fDirect.box.checked, notes: fNotes.value });
  const inv = job ? C.invoiceForJob(job.id, data) : null;

  openSheet(isNew ? 'Log work' : 'Edit job', h('div', { class: 'form' },
    inv ? h('p', { class: 'notice' }, `On invoice #${inv.number}. Changes update that invoice.`) : null,
    field('Client', fClient), field('Type', fLane), field('Dates worked', fDates),
    h('div', { class: 'grid3' }, field('Qty', fQty), field('Unit', fUnit), field('Rate ¥', fRate)),
    h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Fee'), fee),
    h('div', { class: 'grid2' }, field('Project', fProj), field('Position', fPos)),
    field('Invoice line', fDesc), fDirect.el, field('Notes', fNotes)),
  [
    !isNew ? h('button', { class: 'btn ghost bad', onclick: () => { if (inv) return toast('Remove it from the invoice first', 'bad'); if (confirmBox('Delete this job?')) { S.remove('jobs', j.id); closeSheet(); render(); } } }, 'Delete') : null,
    !isNew ? h('button', { class: 'btn ghost', onclick: () => { const c = collect(); closeSheet(); jobForm(null, { ...c, id: S.uid('jb'), date: C.today() }); } }, 'Duplicate') : null,
    h('button', { class: 'btn', onclick: () => {
      const c = collect();
      if (!c.clientId) return toast('Pick a client', 'bad');
      if (!c.date) return toast('Add the days you worked', 'bad');
      S.upsert('jobs', c); closeSheet(); render(); toast(isNew ? 'Work logged' : 'Saved');
    } }, 'Save'),
  ]);
}

// =====================================================================
// INVOICES
// =====================================================================
let invFilter = 'all';
routes.invoices = () => {
  const all = S.live('invoices').sort(byIssueDesc);
  const F = { all: () => true, draft: (i) => C.invoiceStatus(i, data) === 'draft', unpaid: (i) => ['sent', 'overdue', 'partial'].includes(C.invoiceStatus(i, data)), paid: (i) => C.invoiceStatus(i, data) === 'paid' };
  const list = all.filter(F[invFilter] || F.all);
  const count = (k) => all.filter(F[k]).length;
  return h('div', { class: 'stack' },
    pageHead('Invoices', '請求書', h('button', { class: 'btn', onclick: () => invoiceForm() }, icon('plus'), 'New invoice')),
    h('div', { class: 'seg' }, [['all', 'All'], ['draft', 'To send'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([k, l]) => h('button', { class: invFilter === k ? 'on' : '', onclick: () => { invFilter = k; render(); } }, l, h('small', {}, ` ${count(k)}`)))),
    !list.length ? h('p', { class: 'empty' }, all.length ? 'Nothing here.' : 'No invoices yet. Log some work first, then create an invoice from it.') : h('div', { class: 'card tight' }, h('div', { class: 'rows' }, list.map(invoiceRow))));
};

function invoiceForm(inv, preset = {}) {
  const isNew = !inv;
  const base = inv ? { ...inv, ...preset } : { id: S.uid('iv'), deleted: false, legacy: false, number: '', clientId: '', lang: 'ja', issueDate: C.today(), dueDate: C.endOfFollowingMonth(C.today()), project: '', position: '', jobIds: [], receiptIds: [], lines: [], addTax: true, withhold: false, status: 'draft', payments: [], note: '', ...preset };
  let st = { ...base, jobIds: [...base.jobIds], receiptIds: [...base.receiptIds], lines: [...(base.lines || [])] };
  const body = h('div', { class: 'form' });

  const draw = () => {
    const c = S.byId('clients', st.clientId);
    const openJobs = S.live('jobs').filter((j) => j.clientId === st.clientId && !j.direct && (!C.invoiceForJob(j.id, data) || st.jobIds.includes(j.id))).sort((a, b) => a.date.localeCompare(b.date));
    const openRc = S.live('receipts').filter((r) => r.type === 'reimb' && (r.clientId === st.clientId || st.jobIds.includes(r.jobId) || (r.jobId && S.byId('jobs', r.jobId)?.clientId === st.clientId)) && (!C.invoiceForReceipt(r.id, data) || st.receiptIds.includes(r.id)));
    const fClient = sel(clientOptions(), st.clientId, { onchange: (e) => {
      if (e.target.value === '__new') return newClientInline((nc) => { invoiceForm(null, { ...st, clientId: nc.id, lang: nc.lang, addTax: nc.addTax, withhold: nc.withhold, jobIds: [], receiptIds: [] }); });
      const nc = S.byId('clients', e.target.value);
      st = { ...st, clientId: e.target.value, jobIds: [], receiptIds: [], ...(nc ? { lang: nc.lang, addTax: nc.addTax, withhold: nc.withhold } : {}) }; draw();
    } });
    const t = C.invoiceTotals(st, data);
    const totalsView = () => { const t2 = C.invoiceTotals(st, data); return [trow('Fees', t2.fees), st.addTax ? trow('+ 10% tax', t2.tax) : null, st.withhold ? trow('− Withholding', -t2.wh) : null, t2.reimb ? trow('+ Expenses (at cost, no tax)', t2.reimb) : null, trow('Total', t2.total, true)]; };
    const totalsBox = h('div', { class: 'totals' }, totalsView());
    const tax = toggle('Add 10% consumption tax', st.addTax); tax.box.onchange = () => { st.addTax = tax.box.checked; draw(); };
    const wh = toggle('Client withholds 10.21%', st.withhold); wh.box.onchange = () => { st.withhold = wh.box.checked; draw(); };
    const fIssue = inp({ type: 'date', value: st.issueDate, onchange: (e) => { st.issueDate = e.target.value; st.dueDate = C.endOfFollowingMonth(e.target.value); draw(); } });
    const fDue = inp({ type: 'date', value: st.dueDate, onchange: (e) => { st.dueDate = e.target.value; } });

    fill(body, 
      !isNew && base.status !== 'draft' ? h('p', { class: 'notice warn' }, 'This invoice was already sent. Only change it if you\'re re-sending it.') : null,
      field('Client', fClient),
      st.clientId ? [
        h('h4', {}, 'Invoice lines'),
        st.lines.length ? h('div', { class: 'lines' }, st.lines.map((l, idx) => {
          const qty = h('input', { type: 'number', value: l.qty ?? 1, min: '0', step: '0.5', inputmode: 'decimal', oninput: (e) => { l.qty = Number(e.target.value) || 0; refresh(); } });
          const total = h('b', { class: 'line-total' }, money((Number(l.qty) || 0) * (Number(l.rate) || 0)));
          const refresh = () => { total.textContent = money((Number(l.qty) || 0) * (Number(l.rate) || 0)); fill(totalsBox, totalsView()); };
          return h('div', { class: 'line-card' },
            h('div', { class: 'row gap' },
              h('input', { class: 'grow', list: 'line-presets', value: l.description || '', placeholder: 'e.g. Camera Assistant Shoot Day', oninput: (e) => { l.description = e.target.value; } }),
              h('button', { type: 'button', class: 'icon', 'aria-label': 'Remove line', onclick: () => { st.lines = st.lines.filter((_, i) => i !== idx); draw(); } }, '×')),
            h('div', { class: 'grid3' },
              field('Qty', qty),
              field('Rate ¥', h('input', { type: 'number', value: l.rate || '', min: '0', step: '1', inputmode: 'numeric', placeholder: '0', oninput: (e) => { l.rate = Number(e.target.value) || 0; refresh(); } })),
              h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Line total'), total)),
            field('Dates', datesControl(C.datesOf(l).length ? C.datesOf(l) : [st.issueDate], l.dateMode, (d, m, prev) => {
              l.dates = d; l.date = d[0]; l.dateMode = m;
              if (Number(l.qty) === prev) { l.qty = d.length; qty.value = d.length; refresh(); }
            })));
        })) : null,
        h('datalist', { id: 'line-presets' }, ['Camera Assistant Shoot Day', 'Camera Assistant Prep Day', 'Camera Assistant Travel Day', 'Camera Assistant Wrap Day', 'Transcoding', 'Overtime', 'Kit rental', '1st AC Shoot Day', '2nd AC Shoot Day', 'DIT / Data wrangling'].map((v) => h('option', { value: v }))),
        h('button', { class: 'btn ghost small', onclick: () => { st.lines.push({ id: S.uid('ln'), description: '', date: st.issueDate, dates: [st.issueDate], qty: 1, rate: 0 }); draw(); } }, '+ Add line'),
        h('p', { class: 'small muted' }, 'Description, quantity and rate are editable for every invoice. Examples: Camera Assistant Shoot Day, travel day, prep day, transcoding.'),
        h('h4', {}, 'Work on this invoice'),
        openJobs.length ? h('div', { class: 'checks' }, openJobs.map((j) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: st.jobIds.includes(j.id), onchange: (e) => {
            st.jobIds = e.target.checked ? [...st.jobIds, j.id] : st.jobIds.filter((x) => x !== j.id);
            if (e.target.checked && !st.project) { st.project = j.project; st.position = j.position; }
            // auto-add receipts linked to this job
            for (const r of S.live('receipts')) if (r.jobId === j.id && r.type === 'reimb' && !C.invoiceForReceipt(r.id, data)) {
              st.receiptIds = e.target.checked ? [...new Set([...st.receiptIds, r.id])] : st.receiptIds.filter((x) => x !== r.id);
            }
            draw();
          } }),
          h('span', { class: 'grow' }, `${C.fmtDates(C.datesOf(j))} · ${j.description || j.position}`), h('b', {}, money(C.jobFee(j)))))) : h('p', { class: 'small muted' }, 'No uninvoiced work for this client. Log it in Jobs first (or invoice expenses only).'),
        h('h4', {}, 'Expenses to be paid back ', help('立替金')),
        openRc.length ? h('div', { class: 'checks' }, openRc.map((r) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: st.receiptIds.includes(r.id), onchange: (e) => { st.receiptIds = e.target.checked ? [...st.receiptIds, r.id] : st.receiptIds.filter((x) => x !== r.id); draw(); } }),
          h('span', { class: 'grow' }, `${C.fmtDateSlash(r.date)} · ${r.vendor || r.category}`, r.hasFile ? ' 📎' : ''), h('b', {}, money(r.amount))))) : h('p', { class: 'small muted' }, 'No reimbursable receipts yet.'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn small', onclick: () => { const back = () => invoiceForm(isNew ? null : inv, { ...st }); snapReceipt({ clientId: st.clientId, type: 'reimb' }, (r) => invoiceForm(isNew ? null : inv, { ...st, receiptIds: [...new Set([...st.receiptIds, r.id])] }), back); } }, '📷 Snap receipt'),
          h('button', { class: 'btn ghost small', onclick: () => { const back = () => invoiceForm(isNew ? null : inv, { ...st }); receiptForm(null, { clientId: st.clientId, type: 'reimb' }, (r) => invoiceForm(isNew ? null : inv, { ...st, receiptIds: [...new Set([...st.receiptIds, r.id])] }), null, { onCancel: back }); } }, '+ Add receipt (photo or file)')),
        h('p', { class: 'small muted' }, 'Receipts are billed back at what you paid. No extra 10% is added: the price already includes tax.'),
        h('div', { class: 'grid2' }, field('Project (件名)', inp({ value: st.project, oninput: (e) => { st.project = e.target.value; } })), field('Client reference / 案件NO', inp({ value: st.clientReference || '', placeholder: 'e.g. PD0442026', oninput: (e) => { st.clientReference = e.target.value; } })), field('Position', inp({ value: st.position, oninput: (e) => { st.position = e.target.value; } }))),
        h('div', { class: 'grid2' }, field('Language', sel([['ja', '日本語'], ['en', 'English']], st.lang, { onchange: (e) => { st.lang = e.target.value; } })), field('Invoice no.', inp({ value: st.number || '(auto)', disabled: true }))),
        h('div', { class: 'grid2' }, field('Issue date', fIssue), field('Due date', fDue, 'End of next month')),
        tax.el, h('div', { class: 'help-row' }, help('消費税')), wh.el, h('div', { class: 'help-row' }, help('源泉')),
        field('Note on invoice (optional)', inp({ value: st.note, oninput: (e) => { st.note = e.target.value; } })),
        totalsBox,
      ] : h('p', { class: 'small muted' }, 'Pick who this invoice is for.'));
  };
  draw();
  openSheet(isNew ? 'New invoice' : `Edit #${base.number}`, body, [
    h('button', { class: 'btn', onclick: () => {
      if (!st.clientId) return toast('Pick a client', 'bad');
      if (!st.jobIds.length && !st.receiptIds.length && !st.lines.length) return toast('Add a line, work, or expense', 'bad');
      if (!st.number) st.number = C.nextInvoiceNumber(data, st.issueDate);
      S.upsert('invoices', st); closeSheet(); selected.clear(); go(`invoice/${st.id}`); render();
      toast(isNew ? `Invoice #${st.number} created` : 'Saved');
    } }, isNew ? 'Create invoice' : 'Save'),
  ]);
}
const trow = (k, v, b) => h('div', { class: `row between ${b ? 'strong' : ''}` }, h('span', {}, k), h('span', {}, money(v)));

routes.invoice = (id) => {
  const inv = S.byId('invoices', id);
  if (!inv) return h('p', { class: 'empty' }, 'Invoice not found. ', h('a', { href: '#invoices' }, 'Back'));
  const t = C.invoiceTotals(inv, data); const st = C.invoiceStatus(inv, data);
  const c = S.byId('clients', inv.clientId) || {};
  const img = h('img', { class: 'preview', alt: 'Invoice preview' });
  invoicePreviewUrl(inv, data).then((u) => { img.src = u; }).catch(() => {});
  const emailBox = h('div');

  const prepare = async (kind) => {
    fill(emailBox, h('p', { class: 'small muted' }, 'Preparing files…'));
    try {
      const pdf = await invoicePdf(inv, data);
      const files = [pdf];
      const missing = [];
      for (const r of t.receipts) {
        if (!r.hasFile) continue;
        const b = await D.receiptBlob(r).catch(() => null);
        if (b) files.push(new File([b], r.fileName || `receipt_${r.date}.jpg`, { type: b.type || r.mime || 'image/jpeg' })); else missing.push(r);
      }
      if (D.isConnected()) D.saveInvoicePdf(inv, pdf).then(() => { inv.pdfFor = inv.updatedAt; S.saveQuiet(); }).catch(() => {});
      const mail = emailFor(inv, data, kind);
      const share = canShareFiles(files);
      fill(emailBox, h('div', { class: 'card mail' },
        h('h3', {}, kind === 'reminder' ? 'Reminder email' : 'Email ready'),
        missing.length ? h('p', { class: 'notice warn' }, `${missing.length} receipt file(s) are on another device. Sync there first, then connect Drive here.`) : null,
        h('div', { class: 'kv' }, h('span', {}, 'To'), h('span', { class: 'grow' }, mail.to || '(no email saved for this client)'), mail.to ? h('button', { class: 'btn small ghost', onclick: () => copy(mail.to, 'Address copied') }, 'Copy') : null),
        h('div', { class: 'kv' }, h('span', {}, 'Subject'), h('span', { class: 'grow' }, mail.subject), h('button', { class: 'btn small ghost', onclick: () => copy(mail.subject, 'Subject copied') }, 'Copy')),
        h('pre', { class: 'body' }, mail.body),
        h('div', { class: 'small muted' }, `Attachments: ${files.map((f) => f.name).join(', ')}`),
        h('div', { class: 'row gap wrap' },
          share ? h('button', { class: 'btn', onclick: async () => {
            try { if (mail.to) navigator.clipboard?.writeText(mail.to).catch(() => {}); await shareFiles(files, withCopyHeader(mail)); if (mail.to) toast('Client address is copied. Paste it into To'); afterSend(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); }
          } }, 'Share to Mail / Outlook') : null,
          h('button', { class: `btn ${share ? 'ghost' : ''}`, onclick: () => { files.forEach(downloadFile); } }, share ? 'Download files' : 'Download attachments'),
          h('button', { class: 'btn ghost', onclick: () => copy(mail.body, 'Email text copied') }, 'Copy text'),
          !share ? h('a', { class: 'btn ghost', href: mailtoLink(mail) }, 'Open mail app') : null),
        !share ? h('p', { class: 'small muted' }, 'This browser can\'t share files. Download the attachments, then open your mail app and attach them.') : null));
    } catch (e) { fill(emailBox, h('p', { class: 'notice bad' }, e.message)); }
  };
  const afterSend = () => {
    if (inv.status === 'draft' && confirmBox('Mark this invoice as sent?')) { inv.status = 'sent'; inv.sentDate = C.today(); S.upsert('invoices', inv); }
  };

  return h('div', { class: 'stack' },
    h('a', { href: '#invoices', class: 'back' }, '‹ Invoices'),
    h('div', { class: 'row between' }, h('h1', {}, `#${inv.number}`), chip(STATUS_LABEL[st], st)),
    h('p', { class: 'muted' }, `${c.nameEn || c.nameJa || ''}${inv.project ? ' · ' + inv.project : ''} · ${inv.lang === 'en' ? 'English' : '日本語'}`),
    inv.legacy ? h('p', { class: 'notice' }, 'From your 2026 history. The preview is redrawn in the new layout. The one you actually sent may look different.') : null,
    h('div', { class: 'card totals' },
      trow('Fees', t.fees), inv.addTax ? trow('+ 10% tax', t.tax) : null, inv.withhold ? trow('− Withholding (kept by client)', -t.wh) : null,
      t.reimb ? trow('+ Expenses paid back', t.reimb) : null, trow('Total', t.total, true),
      t.paid ? trow('Paid so far', t.paid) : null,
      h('div', { class: 'small muted' }, `Issued ${C.fmtDateSlash(inv.issueDate)} · due ${C.fmtDateSlash(inv.dueDate)}${inv.sentDate && inv.status !== 'draft' ? ' · sent ' + C.fmtDateSlash(inv.sentDate) : ''}`)),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: () => prepare('invoice') }, '✉️ Email invoice'),
      h('button', { class: 'btn ghost', onclick: () => {
        if (inv.status !== 'draft' && !confirmBox('This invoice was already sent. Add a receipt anyway? You\'ll need to send the updated invoice again.')) return;
        snapReceipt({ clientId: inv.clientId, type: 'reimb' }, (r) => { inv.receiptIds = [...new Set([...(inv.receiptIds || []), r.id])]; S.upsert('invoices', inv); toast('Receipt added to the invoice'); });
      } }, '📷 Add receipt'),
      (st === 'overdue' || st === 'sent' || st === 'partial') ? h('button', { class: 'btn ghost', onclick: () => prepare('reminder') }, 'Reminder email') : null,
      h('button', { class: 'btn ghost', onclick: async () => { try { downloadFile(await invoicePdf(inv, data)); } catch (e) { toast(e.message, 'bad'); } } }, 'Download PDF'),
      D.isConnected() ? h('button', { class: 'btn ghost', onclick: async () => { try { await D.saveInvoicePdf(inv, await invoicePdf(inv, data)); inv.pdfFor = inv.updatedAt; S.saveQuiet(); render(); toast('Saved to Drive'); } catch (e) { toast(e.message, 'bad'); } } }, 'Save to Drive') : null),
    emailBox,
    h('div', { class: 'row gap wrap' },
      inv.status === 'draft' ? h('button', { class: 'btn ghost', onclick: () => { inv.status = 'sent'; inv.sentDate = C.today(); S.upsert('invoices', inv); } }, 'Mark sent') : null,
      st !== 'paid' && st !== 'draft' ? h('button', { class: 'btn ok', onclick: () => paymentForm(inv) }, 'Record payment') : null,
      st === 'paid' ? h('button', { class: 'btn ghost', onclick: () => { if (confirmBox('Mark as unpaid again?')) { inv.status = 'sent'; inv.payments = []; S.upsert('invoices', inv); } } }, 'Mark unpaid') : null,
      h('button', { class: 'btn ghost', onclick: () => invoiceForm(inv) }, 'Edit'),
      h('button', { class: 'btn ghost bad', onclick: () => {
        if (!confirmBox(inv.status === 'draft' ? 'Delete this draft? The work goes back to "not invoiced".' : 'This invoice was sent. Delete it anyway? The work goes back to "not invoiced".')) return;
        S.remove('invoices', inv.id); go('invoices');
      } }, 'Delete')),
    (inv.payments || []).length ? h('div', { class: 'card small' }, h('h3', {}, 'Payments'), inv.payments.map((p) => h('div', { class: 'row between' }, h('span', {}, C.fmtDateSlash(p.date)), h('span', {}, money(p.amount))))) : null,
    inv.driveLink ? h('a', { class: 'small', href: inv.driveLink, target: '_blank', rel: 'noopener' }, 'Open PDF in Google Drive ↗') : null,
    img);
};

function paymentForm(inv) {
  const t = C.invoiceTotals(inv, data);
  const fAmt = inp({ type: 'number', inputmode: 'numeric', value: t.owed });
  const fDate = inp({ type: 'date', value: C.today() });
  openSheet(`Payment for #${inv.number}`, h('div', { class: 'form' },
    field('Amount received ¥', fAmt, inv.withhold ? `Expected ${money(t.total)} (withholding already taken off)` : `Expected ${money(t.total)}`),
    field('Date received', fDate)), [
    h('button', { class: 'btn ok', onclick: () => {
      const amt = Number(fAmt.value) || 0;
      if (amt <= 0) return toast('Enter the amount', 'bad');
      inv.payments = [...(inv.payments || []), { date: fDate.value, amount: amt }];
      if (inv.payments.reduce((s, p) => s + p.amount, 0) >= t.total) inv.status = 'paid';
      S.upsert('invoices', inv); closeSheet(); render(); toast('Payment recorded');
    } }, 'Save payment')]);
}

// =====================================================================
// RECEIPTS
// =====================================================================
const CATS = ['Taxi', 'Train / bus', 'Parking / fuel', 'Food', 'Consumables (tape, batteries)', 'Gear / tools', 'Phone / internet', 'Other'];
const thumbs = new Map();
routes.receipts = () => {
  const list = S.live('receipts').sort((a, b) => b.date.localeCompare(a.date));
  return h('div', { class: 'stack' },
    pageHead('Receipts', '領収書', h('button', { class: 'btn', onclick: () => snapReceipt() }, icon('camera'), 'Snap receipt'), h('button', { class: 'btn ghost', onclick: () => receiptForm() }, icon('plus'), 'Add manually')),
    h('p', { class: 'small muted' }, h('b', {}, 'Paid back'), ' = the client pays you back (goes on the invoice as 立替金). ', h('b', {}, 'My cost'), ' = you paid it yourself (lowers your tax).'),
    !list.length ? h('p', { class: 'empty' }, 'No receipts yet. Snap one after every taxi.') : h('div', { class: 'card tight' }, h('div', { class: 'rows' }, list.map((r) => {
      const inv = C.invoiceForReceipt(r.id, data);
      const th = h('div', { class: 'thumb' }, r.hasFile ? (r.mime === 'application/pdf' ? 'PDF' : '') : '—');
      if (r.hasFile && r.mime !== 'application/pdf') loadThumb(r, th);
      const job = r.jobId ? S.byId('jobs', r.jobId) : null;
      return h('div', { class: 'rowi', onclick: () => receiptForm(r) }, th,
        h('div', { class: 'r-main' }, h('b', {}, r.vendor || r.category), h('small', {}, job ? (job.project || clientName(job.clientId)) : r.category)),
        h('div', { class: 'r-mid' }, r.type === 'own' ? chip('My cost', '') : inv ? chip(`#${inv.number}`, C.invoiceStatus(inv, data)) : chip('Not invoiced', 'draft')),
        h('div', { class: 'r-end' }, h('b', {}, money(r.amount)), h('small', {}, C.fmtDateEn(r.date))));
    }))));
};
async function loadThumb(r, el) {
  try {
    let u = thumbs.get(r.id);
    if (!u) { const b = await S.getFile(r.id); if (!b) { el.textContent = r.driveId ? '☁️' : '—'; return; } u = URL.createObjectURL(b); thumbs.set(r.id, u); }
    el.style.backgroundImage = `url(${u})`;
  } catch {}
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
    return blob || file;
  } catch { return file; }
}

function receiptForm(rc, preset = {}, onSaved = null, startFile = null, { onCancel = null } = {}) {
  const isNew = !rc;
  const r = rc ? { ...rc } : { id: S.uid('rc'), deleted: false, date: C.today(), amount: '', vendor: '', category: 'Other', type: 'reimb', jobId: '', clientId: '', notes: '', hasFile: false, ...preset };
  let newFile = null;
  const prev = h('div', { class: 'rprev' }, r.hasFile ? 'File attached' : 'No photo yet');
  if (r.hasFile) S.getFile(r.id).then((b) => { if (b && b.type.startsWith('image/')) fill(prev, h('img', { src: URL.createObjectURL(b) })); else if (b) fill(prev, h('a', { href: URL.createObjectURL(b), target: '_blank' }, 'Open PDF')); else if (r.driveId) prev.textContent = 'Saved on Google Drive'; });
  const onFile = async (files) => {
    const f = files[0]; if (!f) return;
    newFile = await compressImage(f);
    newFile.__name = f.name;
    fill(prev, newFile.type.startsWith('image/') ? h('img', { src: URL.createObjectURL(newFile) }) : h('span', {}, f.name));
    if (f.type.startsWith('image/') && data.settings.autoReadReceipts !== false) autoRead(f);
  };
  // ---- auto-read the photo (on this device) ----
  const touched = new Set();
  const readBox = h('div');
  let readParts = r.parts || [], readItems = r.items || [];
  const splitT = toggle('Save as separate receipts per category', false, 'One receipt per category, each with its share of the total. Same photo on each.');
  const autoRead = async (blob) => {
    const line = h('span', {}, 'Reading the receipt…');
    fill(readBox, h('div', { class: 'notice read' }, h('span', { class: 'spin' }, '◌'), line));
    try {
      const got = await readReceipt(blob, (t) => { line.textContent = t; });
      const filled = [];
      const set = (key, el, v, label) => { if (v == null || v === '' || touched.has(key)) return; el.value = v; el.classList.add('auto'); filled.push(label); };
      set('amount', fAmt, got.amount, `${money(got.amount)}${got.amountSure ? '' : ' (?)'}`);
      set('date', fDate, got.date, got.date ? C.fmtDateSlash(got.date) : '');
      set('vendor', fVendor, got.vendor, got.vendor);
      if (got.category && CATS.includes(got.category)) set('category', fCat, got.category, got.category);
      readItems = got.items || []; readParts = got.parts || [];
      const partsView = readParts.length > 1 ? h('div', { class: 'parts' },
        h('b', { class: 'small' }, `Mixed receipt: ${readItems.length} items`),
        h('div', { class: 'alts' }, readParts.map((p) => h('span', { class: 'chip sent' }, `${p.category.split(' (')[0]} ${money(p.amount)}`))),
        splitT.el,
        h('details', {}, h('summary', {}, 'See the items it read'),
          h('div', { class: 'items' }, readItems.map((it) => h('div', { class: 'row between small' }, h('span', {}, it.name), h('span', { class: 'muted' }, `${it.category.split(' (')[0]} · ${money(it.amount)}`)))))) : null;
      const pick = (el, key, v, label) => h('button', { type: 'button', class: 'chip sent pickme', onclick: () => { el.value = v; el.classList.add('auto'); touched.add(key); } }, label);
      const otherAmts = (got.amountOptions || []).filter((v) => v !== got.amount).slice(0, 4);
      const otherDates = (got.dateOptions || []).filter((v) => v !== got.date).slice(0, 2);
      const alts = (otherAmts.length || otherDates.length) ? h('div', { class: 'alts' },
        h('span', { class: 'small muted' }, 'Wrong? Other numbers on the receipt:'),
        otherAmts.map((v) => pick(fAmt, 'amount', v, money(v))),
        otherDates.map((v) => pick(fDate, 'date', v, C.fmtDateSlash(v)))) : null;
      fill(readBox, filled.length
        ? h('div', { class: 'notice read ok' }, h('b', {}, 'Read from the photo: '), filled.filter(Boolean).join(' · '), h('div', { class: 'small' }, 'Check the highlighted boxes and fix anything wrong.'), alts, partsView)
        : h('div', { class: 'notice warn' }, 'Couldn\'t read this one clearly. Fill it in by hand (a flatter, brighter photo helps).'));
    } catch (e) { fill(readBox, h('div', { class: 'notice warn' }, e.message)); }
  };
  const fDate = inp({ type: 'date', value: r.date });
  const fAmt = inp({ type: 'number', inputmode: 'numeric', value: r.amount, placeholder: '¥' });
  const fVendor = inp({ value: r.vendor, placeholder: 'e.g. Taxi, JR, Yodobashi' });
  const fCat = sel(CATS.map((c) => [c, c]), r.category);
  const fType = sel([['reimb', 'Paid back by client (立替金)'], ['own', 'My cost (lowers tax)']], r.type);
  const recentJobs = S.live('jobs').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const fJob = sel([['', 'Not linked to a job'], ...recentJobs.map((j) => [j.id, `${C.fmtDateSlash(j.date)} · ${clientName(j.clientId)} · ${j.project || j.description || ''}`])], r.jobId);
  const fClient = sel(clientOptions(false).map(([v, t]) => [v, v ? t : 'No client']), r.clientId);
  const fNotes = h('textarea', { rows: 2 }, r.notes || '');
  const inv = rc ? C.invoiceForReceipt(rc.id, data) : null;
  for (const [k, el] of [['amount', fAmt], ['date', fDate], ['vendor', fVendor], ['category', fCat]]) {
    el.addEventListener('input', () => { touched.add(k); el.classList.remove('auto'); });
    el.addEventListener('change', () => { touched.add(k); el.classList.remove('auto'); });
  }
  if (isNew && !preset.category) touched.delete('category');
  if (startFile) setTimeout(() => onFile([startFile]), 0);

  openSheet(isNew ? 'Add receipt' : 'Edit receipt', h('div', { class: 'form' },
    inv ? h('p', { class: 'notice' }, `On invoice #${inv.number}.`) : null,
    h('div', { class: 'grid2' },
      filePicker('📷 Take photo', { accept: 'image/*', capture: 'environment', onFiles: onFile, fallback: false, hint: false }),
      filePicker('📎 Choose file', { accept: 'image/*,application/pdf', onFiles: onFile, fallback: false })),
    h('p', { class: 'small muted' }, '📸 Best results: receipt flat, filling most of the photo, good light, no shadow.'), prev, readBox,
    !isNew && (r.parts || []).length > 1 ? h('div', { class: 'alts' }, h('span', { class: 'small muted' }, 'Breakdown:'), r.parts.map((p) => h('span', { class: 'chip sent' }, `${p.category.split(' (')[0]} ${money(p.amount)}`))) : null,
    h('div', { class: 'grid2' }, field('Date', fDate), field('Amount ¥', fAmt)),
    h('div', { class: 'grid2' }, field('Shop / what', fVendor), field('Category', fCat)),
    field('Who pays?', fType), field('Job', fJob, 'Linking a job adds it to that job\'s invoice automatically'),
    field('Client (if no job)', fClient), field('Notes', fNotes)), [
    !isNew ? h('button', { class: 'btn ghost bad', onclick: async () => { if (inv) return toast('Remove it from the invoice first', 'bad'); if (confirmBox('Delete this receipt?')) { await S.deleteFile(r.id); S.remove('receipts', r.id); closeSheet(); render(); } } }, 'Delete') : null,
    h('button', { class: 'btn', onclick: async () => {
      const amount = Number(fAmt.value) || 0;
      if (!amount) return toast('Enter the amount', 'bad');
      const out = { ...r, date: fDate.value, amount, vendor: fVendor.value.trim(), category: fCat.value, type: fType.value, jobId: fJob.value || null, clientId: fJob.value ? (S.byId('jobs', fJob.value)?.clientId || '') : fClient.value, notes: fNotes.value };
      out.items = readItems; out.parts = readParts;
      if (newFile && splitT.box.checked && readParts.length > 1) {
        // one receipt per category, amounts scaled to what you typed as the total
        const sum = readParts.reduce((a, p) => a + p.amount, 0) || 1;
        let left = amount; const made = [];
        readParts.forEach((p, i) => {
          const amt = i === readParts.length - 1 ? left : Math.round((p.amount / sum) * amount); left -= amt;
          made.push({ ...out, id: i === 0 ? r.id : S.uid('rc'), amount: amt, category: p.category, parts: [], items: readItems.filter((it) => it.category === p.category), notes: [out.notes, `Split from one ${out.vendor || ''} receipt (${money(amount)})`].filter(Boolean).join(' · ') });
        });
        for (const m of made) {
          await S.putFile(m.id, newFile);
          m.hasFile = true; m.mime = newFile.type; m.driveId = null; thumbs.delete(m.id);
          m.fileName = `${m.date}_${(m.vendor || '').replace(/[^A-Za-z0-9]+/g, '') || 'receipt'}_${m.category.replace(/[^A-Za-z]+/g, '')}_${Math.round(m.amount)}.jpg`;
          S.upsert('receipts', m);
        }
        closeSheet(); render(); toast(`Saved as ${made.length} receipts`); if (onSaved) made.forEach((m) => onSaved(m));
        return;
      }
      if (newFile) {
        await S.putFile(r.id, newFile);
        const ext = newFile.type === 'application/pdf' ? 'pdf' : 'jpg';
        out.hasFile = true; out.mime = newFile.type; out.driveId = null; thumbs.delete(r.id);
        out.fileName = `${out.date}_${(out.vendor || '').replace(/[^A-Za-z0-9]+/g, '') || out.category.replace(/[^A-Za-z0-9]+/g, '') || 'receipt'}_${Math.round(amount)}.${ext}`;
      }
      // auto-add to the job's invoice if it's still a draft
      if (isNew && out.type === 'reimb' && out.jobId) {
        const ji = C.invoiceForJob(out.jobId, data);
        if (ji && ji.status === 'draft' && !ji.receiptIds.includes(out.id)) { ji.receiptIds.push(out.id); S.upsert('invoices', ji); }
      }
      S.upsert('receipts', out); closeSheet(); render(); toast('Receipt saved'); if (onSaved) onSaved(out);
    } }, 'Save'),
  ], { onClose: onCancel });
}

// =====================================================================
// MORE: clients, profile, settings, drive, data, help
// =====================================================================
routes.more = () => h('div', { class: 'stack' },
  pageHead('Settings', '設定'),
  h('div', { class: 'card tight' }, h('div', { class: 'rows' },
    [['clients', 'users', 'Clients', 'Who withholds, who gets 10% tax, rates'],
      ['profile', 'id', 'My details', 'Name, address, bank (on every invoice)'],
      ['settings', 'percent', 'Tax settings', 'Set-aside rate, salary'],
      ['drive', 'cloud', 'Google Drive', D.isConnected() ? 'Connected' : (data.drive.lastSync ? 'Set up · tap Sync to sign in' : 'Not set up · guide inside')],
      ['email', 'mail', 'Email setup', localStorage.getItem('fl_mail_done') === '1' ? 'Set up' : 'How sending invoices works'],
      ['updates', 'upload', 'App updates', G.hasToken() ? `v${VERSION} · install updates here` : `v${VERSION} · set up in-app updates`],
      ['data', 'archive', 'Backup', 'What\'s safely in Google Drive, back up now, restore'],
      ['help', 'book', 'Plain-English glossary', 'What all the Japanese tax words mean'],
    ].map(([k, ic, t, s]) => h('a', { class: 'rowi', href: `#${k}` }, h('span', { class: 'ibox' }, icon(ic)), h('div', { class: 'r-main' }, h('b', {}, t), h('small', {}, s)), icon('chevron', 'chev'))))),
  h('p', { class: 'small muted center' }, `Freelance Ledger v${VERSION}`));


routes.clients = () => h('div', { class: 'stack' },
  backLink(),
  h('div', { class: 'row between' }, h('h1', {}, 'Clients'), h('button', { class: 'btn', onclick: () => clientForm() }, '+ Add')),
  h('div', { class: 'list' }, S.live('clients').sort((a, b) => (a.nameEn || '').localeCompare(b.nameEn || '')).map((c) => h('div', { class: 'item', onclick: () => clientForm(c) }, h('div', { class: 'grow' },
    h('b', {}, c.nameEn || c.nameJa),
    h('div', { class: 'small muted' }, [C.LANES[c.lane]?.en, c.lang === 'ja' ? '日本語' : 'English', c.addTax ? '+10% tax' : 'no tax', c.withhold ? 'withholds' : null, c.rate ? `${money(c.rate)}/${c.unit === 'hour' ? 'h' : c.unit}` : null].filter(Boolean).join(' · ')))))));

function clientForm(cl, onSaved) {
  const isNew = !cl;
  const c = cl ? { ...cl } : { id: S.uid('cl'), deleted: false, nameJa: '', nameEn: '', honorific: '御中', addressJa: '', addressEn: '', contact: '', emails: '', lang: 'ja', addTax: true, withhold: false, lane: 'camera', unit: 'day', rate: 0, needsOriginals: false };
  const f = {
    nameEn: inp({ value: c.nameEn, placeholder: 'Bianco Bianco Co., Ltd.' }), nameJa: inp({ value: c.nameJa, placeholder: '株式会社 Bianco Bianco' }),
    honorific: sel([['御中', '御中 (company)'], ['様', '様 (person)']], c.honorific), contact: inp({ value: c.contact, placeholder: 'Person you deal with' }),
    emails: inp({ value: c.emails, type: 'email', multiple: true, placeholder: 'a@b.com, c@d.com' }),
    addressJa: h('textarea', { rows: 3 }, c.addressJa || ''), addressEn: h('textarea', { rows: 3 }, c.addressEn || ''),
    lang: sel([['ja', '日本語'], ['en', 'English']], c.lang), lane: sel(Object.entries(C.LANES).map(([k, l]) => [k, `${l.icon} ${l.en}`]), c.lane),
    unit: sel([['day', 'per day'], ['hour', 'per hour'], ['item', 'per item']], c.unit), rate: inp({ type: 'number', inputmode: 'numeric', value: c.rate || '' }),
  };
  const tax = toggle('Add 10% consumption tax', c.addTax, 'They\'ve agreed to pay the extra 10%');
  const wh = toggle('They withhold 10.21%', c.withhold, 'They pay you less and send it to the tax office');
  const orig = toggle('Needs paper original receipts', c.needsOriginals, 'Otherwise scans/PDFs are sent');
  openSheet(isNew ? 'New client' : 'Edit client', h('div', { class: 'form' },
    field('Name (English)', f.nameEn), field('Name (Japanese)', f.nameJa, 'Companies: write 株式会社 / 合同会社'),
    h('div', { class: 'grid2' }, field('Ending', f.honorific), field('Contact', f.contact)),
    field('Email(s)', f.emails), field('Address (Japanese)', f.addressJa), field('Address (English)', f.addressEn),
    h('div', { class: 'grid2' }, field('Invoice language', f.lang), field('Usual work', f.lane)),
    h('div', { class: 'grid2' }, field('Usual rate ¥', f.rate), field('Rate type', f.unit)),
    tax.el, wh.el, orig.el), [
    !isNew ? h('button', { class: 'btn ghost bad', onclick: () => { if (S.live('jobs').some((j) => j.clientId === c.id)) return toast('This client has jobs. Keep them for your records', 'bad'); if (confirmBox('Delete client?')) { S.remove('clients', c.id); closeSheet(); render(); } } }, 'Delete') : null,
    h('button', { class: 'btn', onclick: () => {
      const out = { ...c, nameEn: f.nameEn.value.trim(), nameJa: f.nameJa.value.trim(), honorific: f.honorific.value, contact: f.contact.value.trim(), emails: f.emails.value.trim(), addressJa: f.addressJa.value.trim(), addressEn: f.addressEn.value.trim(), lang: f.lang.value, lane: f.lane.value, unit: f.unit.value, rate: Number(f.rate.value) || 0, addTax: tax.box.checked, withhold: wh.box.checked, needsOriginals: orig.box.checked };
      if (!out.nameEn && !out.nameJa) return toast('Add a name', 'bad');
      S.upsert('clients', out); closeSheet();
      if (onSaved) onSaved(out); else render();
    } }, 'Save')]);
}

routes.profile = () => {
  const p = data.profile; const b = p.bank || {};
  const f = {
    nameEn: inp({ value: p.nameEn }), signatureJa: inp({ value: p.signatureJa }), signatureEn: inp({ value: p.signatureEn }),
    addressJa: h('textarea', { rows: 3 }, p.addressJa), addressEn: h('textarea', { rows: 3 }, p.addressEn),
    phone: inp({ value: p.phone, type: 'tel' }), email: inp({ value: p.email, type: 'email' }),
    bname: inp({ value: b.name }), bnameEn: inp({ value: b.nameEn }), branch: inp({ value: b.branch }), type: inp({ value: b.type }), number: inp({ value: b.number }), holder: inp({ value: b.holder }),
  };
  return h('div', { class: 'stack' }, backLink(), h('h1', {}, 'My details'),
    h('p', { class: 'small muted' }, 'Printed on every invoice. Client details never go here.'),
    h('div', { class: 'card form' }, field('Name on invoices', f.nameEn), h('div', { class: 'grid2' }, field('Email sign-off (JP)', f.signatureJa), field('Email sign-off (EN)', f.signatureEn)),
      field('Address (Japanese)', f.addressJa), field('Address (English)', f.addressEn), h('div', { class: 'grid2' }, field('Phone', f.phone), field('Email', f.email))),
    h('h3', {}, 'Bank'),
    h('div', { class: 'card form' }, h('div', { class: 'grid2' }, field('Bank (JP)', f.bname), field('Bank (EN)', f.bnameEn)), h('div', { class: 'grid3' }, field('店番 Branch', f.branch), field('種目 Type', f.type), field('口座番号', f.number)),
      field('口座名義 (katakana, exactly as on the card)', f.holder)),
    h('button', { class: 'btn', onclick: () => {
      S.setProfile({ nameEn: f.nameEn.value.trim(), signatureJa: f.signatureJa.value.trim(), signatureEn: f.signatureEn.value.trim(), addressJa: f.addressJa.value.trim(), addressEn: f.addressEn.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), bank: { name: f.bname.value.trim(), nameEn: f.bnameEn.value.trim(), branch: f.branch.value.trim(), type: f.type.value.trim(), number: f.number.value.trim(), holder: f.holder.value.trim() } });
      toast('Saved');
    } }, 'Save details'));
};

routes.settings = () => {
  const s = data.settings;
  const rate = inp({ type: 'number', step: '1', value: Math.round((s.setAsideRate ?? 0.15) * 100) });
  const sal = inp({ type: 'number', value: s.salaryMonthly || '' });
  const auto = toggle('Read receipt photos automatically', s.autoReadReceipts !== false, 'Fills in amount, date, shop and category. Runs on this device: photos aren\'t sent anywhere.');
  return h('div', { class: 'stack' }, backLink(), h('h1', {}, 'Tax settings'),
    h('div', { class: 'card form' },
      field('Set-aside rate %', rate, '15% fits a ~¥300k/month salary (5% income tax band + 10% resident tax). Use 20% if your salary goes above ~¥5M/year.'),
      field('Capsule salary per month ¥', sal, 'Only used for the explanation. Update from your 源泉徴収票.'),
      auto.el,
      h('button', { class: 'btn', onclick: () => { S.setSettings({ setAsideRate: (Number(rate.value) || 15) / 100, salaryMonthly: Number(sal.value) || 0, autoReadReceipts: auto.box.checked }); toast('Saved'); } }, 'Save')),
    h('p', { class: 'small muted' }, '⚠️ This app gives estimates, not tax advice. Have the tax office (or a 税理士) sanity-check your first return.'));
};

routes.drive = () => {
  const cid = inp({ value: D.getClientId(), placeholder: 'xxxxxxxx.apps.googleusercontent.com' });
  const last = data.drive.lastSync ? new Date(data.drive.lastSync).toLocaleString() : 'never';
  const C_ = 'https://console.cloud.google.com';
  const set = !!D.getClientId();
  const guide = h('div', { class: 'card guide' },
    h('h3', {}, 'Setup guide · one time, about 10 min'),
    p_('Do this on your computer. It\'s free: skip any "free trial" or billing offers Google shows you.'),
    step(1, 'Open Google Cloud', p_('Sign in with the Google account whose Drive you want to use.'), linkBtn(C_, 'Google Cloud')),
    step(2, 'Create a project', p_('Name it ', h('b', {}, 'Freelance Ledger'), ' → Create. When it\'s ready, check it\'s selected in the project picker at the very top of the page.'), linkBtn(`${C_}/projectcreate`, 'New project')),
    step(3, 'Turn on the Drive API', p_('Click ', h('b', {}, 'Enable'), '.'), linkBtn(`${C_}/apis/library/drive.googleapis.com`, 'Drive API')),
    step(4, 'Set up the sign-in screen', p_('Click ', h('b', {}, 'Get started'), '. App name: Freelance Ledger. Support email: your Gmail → Next. Audience: ', h('b', {}, 'External'), ' → Next. Contact email: your Gmail → Next. Tick agree → ', h('b', {}, 'Create'), '.'), linkBtn(`${C_}/auth/overview`, 'Sign-in screen')),
    step(5, 'Add yourself as a tester', p_('Under ', h('b', {}, 'Test users'), ' click ', h('b', {}, 'Add users'), ', type your Gmail, Save. Without this Google blocks you.'), linkBtn(`${C_}/auth/audience`, 'Audience')),
    step(6, 'Create the Client ID', p_('Application type: ', h('b', {}, 'Web application'), '. Name: Ledger web. Under ', h('b', {}, 'Authorised JavaScript origins'), ' click Add URI and paste exactly this (no slash at the end):'), codeLine(location.origin), p_('Leave "redirect URIs" empty. Click ', h('b', {}, 'Create'), '.'), linkBtn(`${C_}/auth/clients/create`, 'Create client')),
    step(7, 'Paste the Client ID at the top of this page', p_('Google shows it in a popup. It ends in ', h('code', {}, '.apps.googleusercontent.com'), '. Scroll up to the ', h('b', {}, 'Google Client ID'), ' box at the top of this page, paste it and tap Save. Lost the popup? Open Clients and click the name to see it again.'), linkBtn(`${C_}/auth/clients`, 'Clients')),
    step(8, 'Connect', p_('Tap ', h('b', {}, 'Connect & sync'), '. Google warns "Google hasn\'t verified this app". That\'s normal for your own app: tap ', h('b', {}, 'Continue'), ', tick the Drive boxes, Continue.')),
    step(9, 'Share it with your other devices', p_('Tap ', h('b', {}, 'Use on all my devices'), ' (needs App updates set up). After that, any new phone or computer just opens the link and taps ', h('b', {}, 'Connect Google Drive'), '. No pasting. (The Client ID isn\'t secret, it only identifies your app to Google.)')),
    h('h4', {}, 'If something goes wrong'),
    trouble('"Error 400: origin_mismatch" or "redirect_uri_mismatch"', `Step 6 doesn't match. The origin must be exactly ${location.origin}. Fix it in Clients, wait 5 minutes, try again.`),
    trouble('"Access blocked" or "403: access_denied"', 'You\'re not on the tester list. Do step 5 with the exact Google account you\'re signing in with.'),
    trouble('Nothing happens when I tap Connect', 'Your browser blocked the popup. Allow popups for this site. On iPhone, open the app from Safari or the home-screen icon, not from inside another app.'),
    trouble('It asks me to sign in again', 'Normal. Google sign-ins last about an hour. Tap Sync and it reconnects.'));

  return h('div', { class: 'stack' }, backLink(), h('h1', {}, 'Google Drive'),
    h('p', { class: 'small' }, 'Your data saves on this device and syncs to your Google Drive, so your phone and computer stay in step. Invoices and receipts also go into a ', h('b', {}, 'Freelance Ledger'), ' folder in your Drive.'),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', {}, D.isConnected() ? '✅ Connected' : data.drive.lastSync ? '🟡 Set up, sign in to sync' : '⚪ Not set up yet'), h('span', { class: 'small muted' }, `Last sync: ${last}`)),
      D.state.message && D.state.status === 'error' ? h('p', { class: 'notice bad' }, D.state.message) : null,
      h('div', { class: 'form' },
        D.isShared() ? null : field('Google Client ID', cid),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn ghost', onclick: () => { if (!/\.apps\.googleusercontent\.com$/.test(cid.value.trim())) return toast('That doesn\'t look like a Client ID (should end in .apps.googleusercontent.com)', 'bad'); D.setClientId(cid.value); D.preload(); toast('Client ID saved'); render(); } }, 'Save'),
          set && !D.isShared() ? h('button', { class: 'btn ghost', onclick: async (e) => {
            if (!G.hasToken()) { toast('Set up App updates first (it uses the same GitHub key), or use Copy ID', 'bad'); return; }
            e.target.disabled = true;
            try {
              const body = new TextEncoder().encode(JSON.stringify({ googleClientId: D.getClientId() }, null, 1) + '\n');
              await G.publish([{ path: 'config.json', data: body }], 'Share Google Client ID with all devices', () => {});
              D.setSharedClientId(D.getClientId()); toast('Done. New devices will just need to tap Connect (live in about a minute)'); render();
            } catch (err) { e.target.disabled = false; toast(err.message, 'bad'); }
          } }, 'Use on all my devices') : null,
          set && !D.isShared() ? copyBtn(D.getClientId(), 'Copy ID') : null,
          set && D.isShared() ? chip('Shared with all devices ✓', 'paid') : null,
          h('button', { class: 'btn', disabled: !set || null, onclick: syncTap }, D.isConnected() ? 'Sync now' : 'Connect & sync'),
          D.isConnected() ? h('button', { class: 'btn ghost', onclick: () => { D.disconnect(); render(); } }, 'Disconnect') : null,
          h('button', { class: 'btn ghost bad', onclick: signOutDevice }, 'Sign out of this device'),
          data.drive.lastSync ? h('a', { class: 'btn ghost', href: 'https://drive.google.com/drive/search?q=Freelance%20Ledger', target: '_blank', rel: 'noopener' }, 'Open Drive ↗') : null))),
    h('details', {}, h('summary', {}, 'Advanced: Google setup details'), D.isShared() ? p_('Sign-in is built into the app. Nothing to paste on any device.') : null, D.isShared() ? field('Google Client ID (override)', cid) : null, guide));
};

routes.email = () => {
  const done = localStorage.getItem('fl_mail_done') === '1';
  const markDone = () => { localStorage.setItem('fl_mail_done', '1'); render(); };
  const test = async () => {
    try {
      const tmp = { ...data,
        clients: [{ id: 'test', nameJa: 'テスト送信', nameEn: 'Test send', honorific: '様', emails: data.profile.email, lang: 'ja' }],
        jobs: [{ id: 'tj', clientId: 'test', lane: 'camera', date: C.today(), qty: 1, unit: 'day', rate: 10000, description: 'TEST (not a real invoice)' }], receipts: [], invoices: [] };
      const inv = { id: 'ti', number: 'TEST', clientId: 'test', lang: 'ja', issueDate: C.today(), dueDate: C.endOfFollowingMonth(C.today()), project: 'Email test', jobIds: ['tj'], receiptIds: [], addTax: false, withhold: false, status: 'draft', payments: [] };
      const pdf = await invoicePdf(inv, tmp);
      const mail = { to: data.profile.email, subject: 'Freelance Ledger email test', body: 'If this arrived with a PDF attached, email is set up.' };
      if (!canShareFiles([pdf])) { downloadFile(pdf); toast('This browser can\'t share files. Test PDF downloaded instead'); return; }
      navigator.clipboard?.writeText(mail.to).catch(() => {});
      await shareFiles([pdf], mail);
      toast('Your address is copied. Paste it into To and send');
      markDone();
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); }
  };
  return h('div', { class: 'stack' }, backLink(), h('h1', {}, 'Email setup'),
    h('div', { class: 'card' },
      h('p', {}, h('b', {}, 'There\'s nothing to link.'), ' The app makes the invoice PDF + receipts and hands them to your ', h('b', {}, 'Outlook app'), ', which is signed in to ', data.profile.email || 'your Hotmail', '. You check it and press send in Outlook.'),
      done ? h('p', { class: 'notice' }, '✓ Email is set up on this device.') : null),
    h('div', { class: 'card guide' },
      h('h3', {}, '🍎 iPhone Mail app'),
      step(1, 'Add your Hotmail to Mail (one time)', p_('iPhone ', h('b', {}, 'Settings → Apps → Mail → Mail Accounts → Add Account → Outlook.com'), ', sign in with ', h('b', {}, data.profile.email || 'your Hotmail'), '. (Older iOS: Settings → Mail → Accounts.)')),
      step(2, 'Send an invoice', p_('Invoice → ', h('b', {}, '✉️ Email invoice'), ' → ', h('b', {}, 'Share to Mail / Outlook'), ' → tap ', h('b', {}, 'Mail'), '. The PDF + receipts are attached and the message is written. Paste the client\'s address into To (it\'s already copied). If the subject is blank, go back and tap Copy next to Subject.')),
      step(3, 'Send from the right address', p_('In Mail, tap the ', h('b', {}, 'From'), ' line and pick your Hotmail if you have more than one account.')),
      h('h3', {}, '📱 Outlook app (alternative)'),
      step(1, 'Install Outlook', p_('Free from Microsoft.'), h('div', { class: 'row gap wrap' }, linkBtn('https://apps.apple.com/app/microsoft-outlook/id951937596', 'App Store'), linkBtn('https://play.google.com/store/apps/details?id=com.microsoft.office.outlook', 'Google Play'))),
      step(2, 'Sign in with your Hotmail', p_('Open Outlook → Add account → ', h('b', {}, data.profile.email || 'your Hotmail'), '. Send yourself a normal email to check it works.')),
      step(3, 'Send a test from this app', p_('Tap below and choose ', h('b', {}, 'Outlook'), ' in the share menu. Your own address is copied: tap To, paste, send.'), h('button', { class: 'btn small', onclick: test }, 'Send test to myself')),
      step(4, 'Outlook not in the share menu?', p_('iPhone: scroll the row of app icons to the end → ', h('b', {}, 'More'), ' → Edit → add Outlook. Android: it\'s in the list. Search "Outlook".')),
      step(5, 'For real invoices', p_('Invoice → ', h('b', {}, '✉️ Email invoice'), ' → ', h('b', {}, 'Share to Mail / Outlook'), '. PDF, receipts and the message text are filled in. Paste the client\'s address (already copied). If the subject is blank, go back and tap Copy next to Subject. Send, then tap ', h('b', {}, 'Mark sent'), ' in the app.'))),
    h('div', { class: 'card guide' },
      h('h3', {}, '💻 On your computer'),
      step(1, 'Get the files', p_('Invoice → ✉️ Email invoice → ', h('b', {}, 'Download files'), '. The PDF + receipts land in Downloads.')),
      step(2, 'Write the email in Outlook', p_('Open Outlook, start a new email, and use the Copy buttons in the app for To, Subject and the text. Drag the downloaded files in. Send.'), linkBtn('https://outlook.live.com/mail/0/deeplink/compose', 'New Outlook email')),
      p_('In Safari on a Mac, "Share to Outlook" may appear too. Use it if it does.')),
    done ? null : h('button', { class: 'btn ghost', onclick: markDone }, 'I\'ve done this'));
};

routes.updates = () => {
  const cfg = G.getConfig();
  const fOwner = inp({ value: cfg.owner, placeholder: 'Rokehan' });
  const fRepo = inp({ value: cfg.repo, placeholder: 'freelance-ledger' });
  const fToken = inp({ type: 'password', value: cfg.token, placeholder: 'github_pat_…', autocomplete: 'off' });
  const status = h('div');
  const prog = h('div');
  const saveTest = async () => {
    G.setConfig({ owner: fOwner.value, repo: fRepo.value, token: fToken.value });
    fill(status, h('p', { class: 'small muted' }, 'Checking…'));
    try { const name = await G.test(); toast(`Connected to ${name}`); render(); }
    catch (e) { fill(status, h('p', { class: 'notice bad' }, e.message)); }
  };
  const onFiles = async (files) => {
    busy = true;
    fill(prog, h('p', { class: 'small muted' }, `Reading ${files.length === 1 ? files[0].name : files.length + ' files'}…`));
    try {
      const pack = await G.prepare(files, data.profile);
      fill(prog, h('div', { class: 'card flat' },
        h('b', {}, pack.version ? `Update to v${pack.version}` : 'Update (no version number inside)'),
        h('p', { class: 'small muted' }, `${pack.files.length} files: ${pack.files.map((f) => f.path).join(', ')}`),
        pack.skipped.length ? h('p', { class: 'small muted' }, `Ignored: ${pack.skipped.join(', ')}`) : null,
        pack.version === VERSION ? h('p', { class: 'notice warn' }, 'You already have this version. Installing again is harmless.') : null,
        h('button', { class: 'btn', onclick: async (e) => {
          e.target.disabled = true;
          const line = h('p', { class: 'small' });
          fill(prog, h('div', { class: 'card flat' }, line));
          const say = (t) => { line.textContent = t; };
          try {
            await G.publish(pack.files, `Update to v${pack.version || 'new'} (from the app)`, say);
            if (pack.version) localStorage.setItem('fl_updating_to', pack.version);
            const live = await G.waitForLive(pack.version, say);
            say(live ? 'Published! Reloading…' : 'Published. GitHub is slow today: reload in a few minutes.');
            if (live) setTimeout(G.reloadFresh, 800);
          } catch (err) { busy = false; fill(prog, h('p', { class: 'notice bad' }, err.message)); }
        } }, 'Install update'),
        h('button', { class: 'btn ghost', onclick: () => { busy = false; fill(prog); } }, 'Cancel')));
    } catch (e) { busy = false; fill(prog, h('p', { class: 'notice bad' }, e.message)); }
  };
  const has = G.hasToken();
  const guide = h('div', { class: 'card guide' },
    h('h3', {}, 'One-time setup · about 3 min'),
    p_('The app needs a key that lets it change your freelance-ledger repo, and nothing else. Do this on the device you\'ll update from (your computer is easiest).'),
    step(1, 'Make a GitHub key', p_('Open the link (sign in to GitHub). Token name: ', h('b', {}, 'Freelance Ledger updater'), '. Expiration: pick the longest option.'), linkBtn('https://github.com/settings/personal-access-tokens/new', 'New GitHub key')),
    step(2, 'Only this repo', p_('Repository access → ', h('b', {}, 'Only select repositories'), ' → choose ', h('b', {}, cfg.repo || 'freelance-ledger'), '.')),
    step(3, 'Give it permission', p_('Permissions → Repository permissions → ', h('b', {}, 'Contents'), ' → ', h('b', {}, 'Read and write'), '. Leave everything else alone.')),
    step(4, 'Create and copy it', p_('Click ', h('b', {}, 'Generate token'), ', then copy it (starts with ', h('code', {}, 'github_pat_'), '). GitHub only shows it once.')),
    step(5, 'Paste it below', p_('Paste it in the GitHub key box, then tap ', h('b', {}, 'Save & test'), '.')));

  return h('div', { class: 'stack' }, backLink(), h('h1', {}, 'App updates'),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', {}, `Installed: v${VERSION}`), has ? chip('Updates ready', 'ok') : chip('Not set up', 'warn')),
      h('p', { class: 'small' }, 'When I send you a new version (a .zip file), download it, then choose it here. The app publishes it to your site and reloads. Your other devices update on their own the next time they open. Your data isn\'t touched.')),
    has ? null : guide,
    h('div', { class: 'card' }, h('h3', {}, 'Install an update'),
      has ? [filePicker('📦 Choose update .zip', { multiple: true, onFiles }),
        h('p', { class: 'small muted' }, 'Safari unzipped it into a folder? Open the folder and select all the files inside instead.'), prog]
        : h('p', { class: 'small muted' }, 'Do the setup above first.')),
    h('details', { open: !has || null }, h('summary', {}, 'GitHub connection'),
      h('div', { class: 'card form' },
        h('div', { class: 'grid2' }, field('Owner', fOwner), field('Repo', fRepo)),
        field('GitHub key', fToken, 'Kept on this device only.'),
        h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', onclick: saveTest }, 'Save & test'),
          has ? h('button', { class: 'btn ghost bad', onclick: () => { G.forgetToken(); render(); } }, 'Remove key') : null),
        status)),
    has ? h('details', {}, h('summary', {}, 'Show the setup guide again'), guide) : null);
};

/** Saves PDFs of sent invoices to Drive (new ones, and ones edited since their last PDF). */
let pdfRunning = false;
async function backupPdfs(onStep = () => {}) {
  if (pdfRunning || !D.isConnected()) return 0;
  pdfRunning = true;
  let n = 0;
  try {
    const todo = S.live('invoices').filter((i) => i.status !== 'draft' && (!i.driveId || i.pdfFor !== i.updatedAt));
    for (const inv of todo) {
      onStep(`Saving invoice #${inv.number} (${++n} of ${todo.length})…`);
      await D.saveInvoicePdf(inv, await invoicePdf(inv, data));
      inv.pdfFor = inv.updatedAt;
      S.saveQuiet();
    }
    if (n) { data.dirty = true; await D.sync(); }
  } finally { pdfRunning = false; }
  return n;
}

function backupStatus() {
  const rcs = S.live('receipts').filter((r) => r.hasFile);
  const invs = S.live('invoices').filter((i) => i.status !== 'draft');
  return {
    lastSync: data.drive.lastSync, inDrive: !!data.drive.dataFileId, dirty: !!data.dirty,
    rcTotal: rcs.length, rcDone: rcs.filter((r) => r.driveId).length, rcWaiting: rcs.filter((r) => !r.driveId),
    invTotal: invs.length, invDone: invs.filter((i) => i.driveId && i.pdfFor === i.updatedAt).length,
    invWaiting: invs.filter((i) => !i.driveId || i.pdfFor !== i.updatedAt),
  };
}

routes.data = () => {
  const b = backupStatus();
  const setUp = !!D.getClientId();
  const line = h('p', { class: 'small muted' });
  const allGood = b.inDrive && !b.dirty && !b.rcWaiting.length && !b.invWaiting.length;
  const statRow = (label, done, total, ok) => h('div', { class: 'stat' },
    h('span', { class: `tick ${ok ? 'on' : ''}` }, ok ? '✓' : '!'), h('span', { class: 'grow' }, label), h('b', {}, total == null ? done : `${done} / ${total}`));
  const backupNow = async (e) => {
    e.target.disabled = true;
    try {
      if (!D.isConnected()) await D.connect();
      line.textContent = 'Syncing your data…';
      await D.sync();
      const n = await backupPdfs((t) => { line.textContent = t; });
      toast(n ? `Backed up ✓ (${n} invoice PDF${n === 1 ? '' : 's'} saved)` : 'Backed up ✓');
      render();
    } catch (err) { e.target.disabled = false; line.textContent = ''; toast(err.message, 'bad'); }
  };

  return h('div', { class: 'stack' }, backLink(), pageHead('Backup', 'バックアップ'),
    !setUp ? h('div', { class: 'notice warn' }, 'Google Drive isn\'t set up on this device yet, so nothing is backed up. ', h('a', { href: '#drive' }, 'Set it up →')) : null,
    h('div', { class: `card backup ${allGood ? 'good' : ''}` },
      h('div', { class: 'row between' },
        h('div', {}, h('div', { class: 'kpi-value' }, allGood ? 'ALL SAFE' : 'NEEDS BACKUP'), h('div', { class: 'kpi-sub' }, `Last synced ${ago(b.lastSync)}`)),
        h('button', { class: 'btn', disabled: !setUp || null, onclick: backupNow }, icon('sync'), 'Back up now')),
      line,
      h('div', { class: 'stats' },
        statRow('Your data (clients, jobs, invoices, settings)', b.inDrive && !b.dirty ? 'In Drive' : b.inDrive ? 'Changes waiting' : 'Not yet', null, b.inDrive && !b.dirty),
        statRow('Invoice PDFs', b.invDone, b.invTotal, !b.invWaiting.length),
        statRow('Receipt photos', b.rcDone, b.rcTotal, !b.rcWaiting.length)),
      b.rcWaiting.length ? h('p', { class: 'small muted' }, `Photos waiting: ${b.rcWaiting.slice(0, 6).map((r) => `${C.fmtDateSlash(r.date)} ${r.vendor || r.category}`).join(', ')}${b.rcWaiting.length > 6 ? '…' : ''}. They upload from the device they were taken on, so open the app there and sync.`) : null,
      h('p', { class: 'small muted' }, 'Drafts aren\'t saved as PDFs until you send them.')),

    h('div', { class: 'card' },
      h('h3', {}, 'Where everything lives in your Google Drive'),
      h('pre', { class: 'tree' }, 'My Drive\n└─ Freelance Ledger\n   ├─ Invoices\n   │  └─ 2026\n   │     └─ 26101_BiancoBianco_PorterAirDuck.pdf\n   └─ Receipts\n      └─ 2026\n         └─ 2026-10-13_Taxi_9400.jpg\n\n+ a hidden app file with all your data (only this app can read it)'),
      h('div', { class: 'row gap wrap' },
        h('a', { class: 'btn ghost', href: 'https://drive.google.com/drive/search?q=Freelance%20Ledger', target: '_blank', rel: 'noopener' }, 'Open in Google Drive ↗')),
      h('p', { class: 'small muted' }, 'The app can only see files it created. It can\'t read anything else in your Drive.')),

    h('div', { class: 'card' }, h('h3', {}, 'Extra safety copy'),
      h('p', { class: 'small' }, 'Download a full copy of your data as a file (not the photos). Keep one somewhere safe now and then.'),
      h('button', { class: 'btn ghost', onclick: () => downloadFile(new File([JSON.stringify(S.exportable(), null, 1)], `freelance-ledger-backup-${C.today()}.json`, { type: 'application/json' })) }, 'Download backup file'),
      h('h4', {}, 'Restore / load starter file'),
      filePicker('📂 Choose backup or starter file (.json)', { onFiles: async (f) => {
        try { S.importBackup(JSON.parse(await f[0].text())); toast('Loaded ✓'); } catch (err) { toast(err.message.includes('JSON') ? 'That file isn\'t a backup' : err.message, 'bad'); }
      } })));
};

routes.help = () => h('div', { class: 'stack' }, backLink(), h('h1', {}, 'Plain-English glossary'),
  GLOSSARY.map(([w, r, d]) => h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', { class: 'ja' }, w), h('span', { class: 'small muted' }, r)), h('p', {}, d))),
  h('p', { class: 'small muted' }, '⚠️ Guidance, not tax advice.'));

// ---------- boot ----------
if (D.getClientId()) D.preload();
if (localStorage.getItem('fl_updating_to') === VERSION) { localStorage.removeItem('fl_updating_to'); setTimeout(() => toast(`Updated to v${VERSION} ✓`), 600); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
/** Opens the camera straight away, then the receipt form with the photo in it. */
function snapReceipt(preset = {}, onSaved = null, onCancel = null) {
  const i = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'vh' });
  document.body.append(i);
  i.addEventListener('change', () => { const f = i.files?.[0]; i.remove(); if (f) receiptForm(null, preset, onSaved, f, { onCancel }); });
  i.click();
  setTimeout(() => i.remove(), 120000);
}

// ---------- sign-in screen (new device / no data yet) ----------
let gateMsg = '';
function gateView() {
  const hasId = !!D.getClientId();
  const enter = () => { localStorage.setItem('fl_welcomed', '1'); gateMsg = ''; render(); };
  const signIn = async (e) => {
    e.currentTarget.disabled = true;
    gateMsg = 'Signing in…'; fill(msg, gateMsg);
    try {
      await D.connect(); fill(msg, 'Getting your data…'); await D.sync();
      if (data.clients.length || data.jobs.length) { toast('Signed in. All your data is here ✓'); enter(); backupPdfs().catch(() => {}); }
      else { gateMsg = 'Signed in, but this Google account has no Ledger data yet. First device? Load your starter file below.'; render(); }
    } catch (err) { gateMsg = err.message; render(); }
  };
  const msg = h('p', { class: 'small gate-msg' }, gateMsg);
  const cid = inp({ placeholder: 'xxxx.apps.googleusercontent.com' });
  return h('div', { class: 'gate' }, h('div', { class: 'gate-card' },
    h('span', { class: 'logo big' }, '¥'),
    h('h1', {}, 'FREELANCE LEDGER'), h('div', { class: 'ja-sub' }, 'フリーランス台帳'),
    hasId ? [
      h('button', { class: 'btn google', onclick: signIn }, h('span', { class: 'g' }, 'G'), 'Sign in with Google'),
      h('p', { class: 'small muted' }, 'Your invoices and receipts load from your own Google Drive, on any device.'),
    ] : [
      h('p', { class: 'small' }, 'Google sign-in isn\'t set up for this app yet. Paste your Google Client ID (one time), or set it up first.'),
      h('div', { class: 'row gap' }, cid, h('button', { class: 'btn', onclick: () => {
        if (!/\.apps\.googleusercontent\.com$/.test(cid.value.trim())) return toast('That doesn\'t look like a Client ID', 'bad');
        D.setClientId(cid.value); D.preload(); render();
      } }, 'Save')),
      h('button', { class: 'btn ghost small', onclick: () => { enter(); go('drive'); } }, 'Open the setup guide'),
    ],
    msg,
    h('div', { class: 'gate-alt' },
      h('details', {}, h('summary', {}, 'First device? Load your starter file'),
        filePicker('📂 Choose starter file (.json)', { fallback: false, onFiles: async (f) => {
          try { S.importBackup(JSON.parse(await f[0].text())); toast('All loaded ✓'); enter(); } catch (err) { toast(err.message.includes('JSON') ? 'That file isn\'t a starter file' : err.message, 'bad'); }
        } })),
      h('button', { class: 'linkish', onclick: enter }, 'Continue without signing in'))));
}

async function signOutDevice() {
  if (data.dirty && D.getClientId() && !confirmBox('This device has changes that aren\'t in Google Drive yet. Sign out and delete them anyway?')) return;
  if (!confirmBox('Sign out and remove this device\'s copy? Everything stays safe in your Google Drive. You can sign in again any time.')) return;
  D.disconnect();
  await S.clearLocal();
  localStorage.removeItem('fl_welcomed');
  location.hash = '';
  location.reload();
}

// Sync again when you come back to the app (e.g. after using it on your phone).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (D.isConnected()) D.sync().then(() => { if (!sheetEl && !busy) render(); }).catch(() => {});
  else if (!sheetEl && !busy) render();
});
// Google sign-ins last ~1 hour: show the sync bar again when it runs out.
let wasOn = false;
setInterval(() => { const on = D.isConnected(); if (wasOn && !on) document.querySelectorAll('.syncbar-slot').forEach((p) => p.replaceWith(syncBar())); wasOn = on; }, 30000);

// Shared settings published to the site (just the Google Client ID, which isn't secret).
fetch(`config.json?t=${Date.now()}`, { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((cfg) => {
    if (cfg?.googleClientId) { D.setSharedClientId(cfg.googleClientId); D.preload(); }
    configLoaded = true;
    if (!sheetEl) render();
  });
render();
