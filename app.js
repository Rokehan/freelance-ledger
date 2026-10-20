import * as C from './calc.js';
import * as S from './store.js';
import * as D from './drive.js';
import { invoicePdf, invoicePreviewUrl } from './render.js';
import { emailFor, canShareFiles, shareFiles, downloadFile, mailtoLink } from './email.js';
import * as G from './github.js';

const VERSION = '1.1.0';
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
function openSheet(title, body, actions = []) {
  closeSheet();
  sheetEl = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === sheetEl) closeSheet(); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon', onclick: closeSheet, 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'sheet-body' }, body),
      actions.length ? h('div', { class: 'sheet-actions' }, actions) : null));
  document.body.append(sheetEl);
  document.body.classList.add('noscroll');
}
function closeSheet() { sheetEl?.remove(); sheetEl = null; document.body.classList.remove('noscroll'); }

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
function render() {
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  current = name;
  const view = (routes[name] || routes.home)(arg);
  fill($app, header(), h('main', {}, view), tabs());
}
S.onChange(() => { if (!sheetEl) render(); scheduleSync(); });
D.onDrive(() => { const p = document.querySelector('.sync-pill'); if (p) p.replaceWith(syncPill()); });

function header() {
  return h('header', { class: 'top' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }, '¥'), 'Freelance Ledger'), syncPill());
}
function syncPill() {
  const st = D.state.status;
  const label = !D.getClientId() ? 'Drive off' : st === 'syncing' ? 'Syncing…' : st === 'ok' ? (data.dirty ? 'Sync' : 'Synced') : st === 'error' ? 'Sync error' : 'Sync';
  return h('button', { class: `sync-pill ${st} ${data.dirty ? 'dirty' : ''}`, onclick: syncTap }, label);
}
async function syncTap() {
  if (!D.getClientId()) { go('drive'); return; }
  try {
    if (!D.isConnected()) await D.connect();
    await D.sync(); render(); toast('Synced with Google Drive');
  } catch (e) { toast(e.message, 'bad'); }
}
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  if (!D.isConnected()) return;
  syncTimer = setTimeout(() => D.sync().then(() => { if (!sheetEl) render(); }).catch(() => {}), 4000);
}

function tabs() {
  const t = [['home', '📊', 'Money'], ['jobs', '🎬', 'Jobs'], ['invoices', '🧾', 'Invoices'], ['receipts', '📸', 'Receipts'], ['more', '⚙️', 'More']];
  const active = { invoice: 'invoices', clients: 'more', client: 'more', profile: 'more', settings: 'more', drive: 'more', help: 'more', data: 'more', email: 'more', updates: 'more' }[current] || current;
  return h('nav', { class: 'tabs' }, t.map(([k, i, l]) => h('a', { href: `#${k}`, class: active === k ? 'on' : '' }, h('span', { class: 'ti' }, i), h('span', {}, l))));
}

// =====================================================================
// HOME: finance tracker
// =====================================================================
let homeYear = C.yearOf(C.today());
routes.home = () => {
  const s = C.yearSummary(data, homeYear);
  const years = [...new Set([C.yearOf(C.today()), ...data.jobs.filter((j) => !j.deleted).map((j) => C.yearOf(j.date))])].sort((a, b) => b - a);
  const pct = Math.min(100, Math.round((s.net / C.FILING_LINE) * 100));
  const maxM = Math.max(1, ...s.months);
  const laneTotal = Math.max(1, s.income);

  return h('div', { class: 'stack' },
    h('div', { class: 'row between' }, h('h1', {}, `${homeYear} side income`),
      sel(years.map((y) => [y, y]), homeYear, { class: 'year', onchange: (e) => { homeYear = Number(e.target.value); render(); } })),

    setupCard(),

    h('div', { class: 'card hero' },
      h('div', { class: 'big' }, money(s.net)),
      h('div', { class: 'muted' }, 'earned after expenses (counted by the day you worked)'),
      h('div', { class: 'lanes' }, Object.entries(C.LANES).map(([k, l]) => h('div', { class: 'lane' },
        h('div', { class: 'lane-bar' }, h('i', { class: `l-${k}`, style: `width:${Math.round(((s.lanes[k] || 0) / laneTotal) * 100)}%` })),
        h('div', { class: 'row between small' }, h('span', {}, `${l.icon} ${l.en}`), h('b', {}, money(s.lanes[k] || 0)))))),
      s.expenses ? h('div', { class: 'small muted' }, `Income ${money(s.income)} − your own expenses ${money(s.expenses)}`) : null,
      s.uninvoiced ? h('a', { class: 'notice', href: '#jobs' }, `${money(s.uninvoiced)} of work not invoiced yet → invoice it`) : null),

    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', {}, 'Tax return line ', help('確定申告')), s.overFilingLine ? chip('Return needed', 'warn') : chip('Under the line', 'ok')),
      h('div', { class: 'meter' }, h('i', { class: s.overFilingLine ? 'over' : '', style: `width:${pct}%` })),
      h('p', { class: 'small' }, s.overFilingLine
        ? `You're ${money(-s.filingGap)} over ¥200,000, so file a tax return for ${homeYear} by 15 March ${homeYear + 1}.`
        : `${money(s.filingGap)} to go before you need to file a tax return. Resident tax still needs a simple declaration either way.`)),

    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', {}, 'Put aside for tax'), h('span', { class: 'big2' }, money(s.setAside))),
      h('p', { class: 'small muted' }, `${Math.round(s.rate * 100)}% of ${money(s.net)} = ${money(s.taxEstimate)}`, s.withheld ? `, minus ${money(s.withheld)} clients already withheld for you` : '', '.'),
      h('div', { class: 'row gap' },
        field('Saved so far', inp({ type: 'number', inputmode: 'numeric', value: s.saved || '', placeholder: '0', onchange: (e) => { const sa = { ...(data.settings.savedAside || {}) }; sa[homeYear] = Number(e.target.value) || 0; S.setSettings({ savedAside: sa }); } })),
        h('div', { class: 'tile' }, h('span', { class: 'small muted' }, 'Still to save'), h('b', {}, money(s.stillToSave)))),
      h('details', {}, h('summary', {}, 'How is this worked out?'),
        h('p', { class: 'small' }, `Side income is added on top of your Capsule salary (about ${money(data.settings.salaryMonthly || 0)}/month), which puts it in the 5% income tax band. 5% × 1.021 + 10% resident tax ≈ 15%. Income tax is paid when you file (by 15 March). Resident tax bills start in June. ⚠️ Estimate: assumes no bonus or dependents. Check against your 源泉徴収票.`))),

    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', {}, 'Owed to you'), h('span', { class: 'big2' }, money(s.owed))),
      s.overdueCount ? h('a', { class: 'notice bad', href: '#invoices' }, `${s.overdueCount} overdue (${money(s.overdue)}) → send a reminder`) : h('p', { class: 'small muted' }, 'Nothing overdue.')),

    monthChart(s, maxM),

    h('div', { class: 'card small' },
      h('h3', {}, 'Key dates'),
      h('ul', { class: 'plain' },
        h('li', {}, h('b', {}, 'End of each month: '), 'invoice last month\'s work'),
        h('li', {}, h('b', {}, `Dec ${homeYear} / Jan ${homeYear + 1}: `), 'get your 源泉徴収票 from Capsule ', help('源泉徴収票')),
        h('li', {}, h('b', {}, `16 Feb – 15 Mar ${homeYear + 1}: `), 'tax return window ', help('確定申告')),
        h('li', {}, h('b', {}, `June ${homeYear + 1}: `), 'resident tax bills arrive ', help('住民税')))),
  );
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
function setupCard() {
  const st = setupState();
  const done = st.filter((x) => x[1]).length;
  if (done === st.length || localStorage.getItem('fl_setup_hide') === '1') return null;
  return h('div', { class: 'card setup' },
    h('div', { class: 'row between' }, h('h3', {}, `Finish setting up · ${done} of ${st.length}`),
      h('button', { class: 'icon', onclick: () => { localStorage.setItem('fl_setup_hide', '1'); render(); }, 'aria-label': 'Hide' }, '✕')),
    h('div', { class: 'list' }, st.map(([label, ok, href]) => h('a', { class: `item ${ok ? 'done' : ''}`, href },
      h('span', { class: 'tick' }, ok ? '✓' : ''), h('span', { class: 'grow' }, label), ok ? null : '›'))));
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
    h('div', { class: 'row between' }, h('h1', {}, 'Jobs'), h('button', { class: 'btn', onclick: () => jobForm() }, '+ Log work')),
    h('div', { class: 'seg' }, [['all', 'All'], ['open', 'Not invoiced']].map(([k, l]) => h('button', { class: jobFilter === k ? 'on' : '', onclick: () => { jobFilter = k; render(); } }, l))),
    selJobs.length ? h('div', { class: 'card selbar' },
      h('span', {}, `${selJobs.length} selected · ${money(selJobs.reduce((s, j) => s + C.jobFee(j), 0))}`),
      h('button', { class: 'btn', onclick: () => {
        const cl = new Set(selJobs.map((j) => j.clientId));
        if (cl.size > 1) return toast('Pick jobs for one client at a time', 'bad');
        invoiceForm(null, { clientId: selJobs[0].clientId, jobIds: selJobs.map((j) => j.id) });
      } }, 'Create invoice'),
      h('button', { class: 'btn ghost', onclick: () => { selected.clear(); render(); } }, 'Clear')) : null,
    !jobs.length ? h('p', { class: 'empty' }, jobFilter === 'open' ? 'All work is invoiced. Nice.' : 'No jobs yet. Tap "Log work" after each shoot or teaching day.') : null,
    Object.entries(groups).map(([ym, list]) => h('section', {},
      h('h4', { class: 'month' }, `${C.fmtDateEn(ym + '-01').split(' ').slice(1).join(' ')} · ${money(list.reduce((s, j) => s + C.jobFee(j), 0))}`),
      h('div', { class: 'list' }, list.map((j) => {
        const st = status(j);
        const canSel = !st;
        return h('div', { class: 'item' },
          canSel ? h('input', { type: 'checkbox', class: 'pick', checked: selected.has(j.id), onchange: (e) => { e.target.checked ? selected.add(j.id) : selected.delete(j.id); render(); } }) : h('span', { class: 'pick-sp' }),
          h('div', { class: 'grow', onclick: () => jobForm(j) },
            h('div', { class: 'row between' }, h('b', {}, `${C.LANES[j.lane]?.icon || ''} ${j.description || j.position || j.project || 'Work'}`), h('b', {}, money(C.jobFee(j)))),
            h('div', { class: 'row between small muted' }, h('span', {}, `${C.fmtDateSlash(j.date)} · ${clientName(j.clientId)}${j.project ? ' · ' + j.project : ''}`),
              st === 'direct' ? chip('Paid directly', 'ok') : st ? chip(`#${st.number}`, C.invoiceStatus(st, data)) : chip('Not invoiced', 'warn'))));
      })))));
};

function newClientInline(onDone) { clientForm(null, (c) => onDone(c)); }

function jobForm(job, preset = {}) {
  const isNew = !job;
  const j = job ? { ...job } : { id: S.uid('jb'), deleted: false, clientId: '', lane: 'camera', date: C.today(), qty: 1, unit: 'day', rate: 0, project: '', position: '', description: '', direct: false, notes: '', ...preset };
  const fClient = sel(clientOptions(), j.clientId);
  const fLane = sel(Object.entries(C.LANES).map(([k, l]) => [k, `${l.icon} ${l.en}`]), j.lane);
  const fDate = inp({ type: 'date', value: j.date });
  const fQty = inp({ type: 'number', step: '0.5', inputmode: 'decimal', value: j.qty });
  const fUnit = sel([['day', 'days'], ['hour', 'hours'], ['item', 'item(s)']], j.unit);
  const fRate = inp({ type: 'number', inputmode: 'numeric', value: j.rate });
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
  const collect = () => ({ ...j, clientId: fClient.value === '__new' ? '' : fClient.value, lane: fLane.value, date: fDate.value, qty: Number(fQty.value) || 0, unit: fUnit.value, rate: Number(fRate.value) || 0, project: fProj.value.trim(), position: fPos.value.trim(), description: fDesc.value.trim() || fPos.value.trim(), direct: fDirect.box.checked, notes: fNotes.value });
  const inv = job ? C.invoiceForJob(job.id, data) : null;

  openSheet(isNew ? 'Log work' : 'Edit job', h('div', { class: 'form' },
    inv ? h('p', { class: 'notice' }, `On invoice #${inv.number}. Changes update that invoice.`) : null,
    field('Client', fClient), h('div', { class: 'grid2' }, field('Type', fLane), field('Date worked', fDate)),
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
      if (!c.date) return toast('Add the date you worked', 'bad');
      S.upsert('jobs', c); closeSheet(); render(); toast(isNew ? 'Work logged' : 'Saved');
    } }, 'Save'),
  ]);
}

// =====================================================================
// INVOICES
// =====================================================================
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', overdue: 'Overdue', partial: 'Part paid', paid: 'Paid' };
routes.invoices = () => {
  const list = S.live('invoices').sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || String(b.number).localeCompare(String(a.number)));
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' }, h('h1', {}, 'Invoices'), h('button', { class: 'btn', onclick: () => invoiceForm() }, '+ New invoice')),
    !list.length ? h('p', { class: 'empty' }, 'No invoices yet. Log some work first, then create an invoice from it.') : null,
    h('div', { class: 'list' }, list.map((inv) => {
      const t = C.invoiceTotals(inv, data); const st = C.invoiceStatus(inv, data);
      return h('a', { class: 'item', href: `#invoice/${inv.id}` }, h('div', { class: 'grow' },
        h('div', { class: 'row between' }, h('b', {}, `#${inv.number} · ${clientName(inv.clientId)}`), h('b', {}, money(t.total))),
        h('div', { class: 'row between small muted' }, h('span', {}, `${C.fmtDateSlash(inv.issueDate)}${inv.project ? ' · ' + inv.project : ''}`),
          h('span', {}, inv.legacy ? chip('History', '') : null, ' ', chip(STATUS_LABEL[st], st)))));
    })));
};

function invoiceForm(inv, preset = {}) {
  const isNew = !inv;
  const base = inv ? { ...inv } : { id: S.uid('iv'), deleted: false, legacy: false, number: '', clientId: '', lang: 'ja', issueDate: C.today(), dueDate: C.endOfFollowingMonth(C.today()), project: '', position: '', jobIds: [], receiptIds: [], addTax: true, withhold: false, status: 'draft', payments: [], note: '', ...preset };
  let st = { ...base, jobIds: [...base.jobIds], receiptIds: [...base.receiptIds] };
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
    const tax = toggle('Add 10% consumption tax', st.addTax); tax.box.onchange = () => { st.addTax = tax.box.checked; draw(); };
    const wh = toggle('Client withholds 10.21%', st.withhold); wh.box.onchange = () => { st.withhold = wh.box.checked; draw(); };
    const fIssue = inp({ type: 'date', value: st.issueDate, onchange: (e) => { st.issueDate = e.target.value; st.dueDate = C.endOfFollowingMonth(e.target.value); draw(); } });
    const fDue = inp({ type: 'date', value: st.dueDate, onchange: (e) => { st.dueDate = e.target.value; } });

    fill(body, 
      !isNew && base.status !== 'draft' ? h('p', { class: 'notice warn' }, 'This invoice was already sent. Only change it if you\'re re-sending it.') : null,
      field('Client', fClient),
      st.clientId ? [
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
          h('span', { class: 'grow' }, `${C.fmtDateSlash(j.date)} · ${j.description || j.position}`), h('b', {}, money(C.jobFee(j)))))) : h('p', { class: 'small muted' }, 'No uninvoiced work for this client. Log it in Jobs first (or invoice expenses only).'),
        h('h4', {}, 'Expenses to be paid back ', help('立替金')),
        openRc.length ? h('div', { class: 'checks' }, openRc.map((r) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: st.receiptIds.includes(r.id), onchange: (e) => { st.receiptIds = e.target.checked ? [...st.receiptIds, r.id] : st.receiptIds.filter((x) => x !== r.id); draw(); } }),
          h('span', { class: 'grow' }, `${C.fmtDateSlash(r.date)} · ${r.vendor || r.category}`, r.hasFile ? ' 📎' : ''), h('b', {}, money(r.amount))))) : h('p', { class: 'small muted' }, 'No reimbursable receipts for this client.'),
        h('div', { class: 'grid2' }, field('Project (件名)', inp({ value: st.project, oninput: (e) => { st.project = e.target.value; } })), field('Position', inp({ value: st.position, oninput: (e) => { st.position = e.target.value; } }))),
        h('div', { class: 'grid2' }, field('Language', sel([['ja', '日本語'], ['en', 'English']], st.lang, { onchange: (e) => { st.lang = e.target.value; } })), field('Invoice no.', inp({ value: st.number || '(auto)', disabled: true }))),
        h('div', { class: 'grid2' }, field('Issue date', fIssue), field('Due date', fDue, 'End of next month')),
        tax.el, h('div', { class: 'help-row' }, help('消費税')), wh.el, h('div', { class: 'help-row' }, help('源泉')),
        field('Note on invoice (optional)', inp({ value: st.note, oninput: (e) => { st.note = e.target.value; } })),
        h('div', { class: 'totals' },
          trow('Fees', t.fees), st.addTax ? trow('+ 10% tax', t.tax) : null, st.withhold ? trow('− Withholding', -t.wh) : null,
          t.reimb ? trow('+ Expenses', t.reimb) : null, trow('Total', t.total, true)),
      ] : h('p', { class: 'small muted' }, 'Pick who this invoice is for.'));
  };
  draw();
  openSheet(isNew ? 'New invoice' : `Edit #${base.number}`, body, [
    h('button', { class: 'btn', onclick: () => {
      if (!st.clientId) return toast('Pick a client', 'bad');
      if (!st.jobIds.length && !st.receiptIds.length) return toast('Add some work or expenses', 'bad');
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
      if (D.isConnected()) D.saveInvoicePdf(inv, pdf).then(() => S.touch(inv)).catch(() => {});
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
            try { if (mail.to) navigator.clipboard?.writeText(mail.to).catch(() => {}); await shareFiles(files, mail); if (mail.to) toast('Client address is copied. Paste it into To'); afterSend(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); }
          } }, 'Share to Outlook') : null,
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
      (st === 'overdue' || st === 'sent' || st === 'partial') ? h('button', { class: 'btn ghost', onclick: () => prepare('reminder') }, 'Reminder email') : null,
      h('button', { class: 'btn ghost', onclick: async () => { try { downloadFile(await invoicePdf(inv, data)); } catch (e) { toast(e.message, 'bad'); } } }, 'Download PDF'),
      D.isConnected() ? h('button', { class: 'btn ghost', onclick: async () => { try { await D.saveInvoicePdf(inv, await invoicePdf(inv, data)); S.upsert('invoices', inv); toast('Saved to Drive'); } catch (e) { toast(e.message, 'bad'); } } }, 'Save to Drive') : null),
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
    h('div', { class: 'row between' }, h('h1', {}, 'Receipts'), h('button', { class: 'btn', onclick: () => receiptForm() }, '+ Add receipt')),
    h('p', { class: 'small muted' }, h('b', {}, 'Paid back'), ' = the client pays you back (goes on the invoice as 立替金). ', h('b', {}, 'My cost'), ' = you paid it yourself (lowers your tax).'),
    !list.length ? h('p', { class: 'empty' }, 'No receipts yet. Snap one after every taxi.') : null,
    h('div', { class: 'list' }, list.map((r) => {
      const inv = C.invoiceForReceipt(r.id, data);
      const th = h('div', { class: 'thumb' }, r.hasFile ? (r.mime === 'application/pdf' ? 'PDF' : '') : '—');
      if (r.hasFile && r.mime !== 'application/pdf') loadThumb(r, th);
      return h('div', { class: 'item', onclick: () => receiptForm(r) }, th, h('div', { class: 'grow' },
        h('div', { class: 'row between' }, h('b', {}, r.vendor || r.category), h('b', {}, money(r.amount))),
        h('div', { class: 'row between small muted' }, h('span', {}, `${C.fmtDateSlash(r.date)}${r.jobId ? ' · ' + (S.byId('jobs', r.jobId)?.project || clientName(S.byId('jobs', r.jobId)?.clientId)) : ''}`),
          r.type === 'own' ? chip('My cost', '') : inv ? chip(`#${inv.number}`, C.invoiceStatus(inv, data)) : chip('Not invoiced', 'warn'))));
    })));
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

function receiptForm(rc, preset = {}) {
  const isNew = !rc;
  const r = rc ? { ...rc } : { id: S.uid('rc'), deleted: false, date: C.today(), amount: '', vendor: '', category: 'Taxi', type: 'reimb', jobId: '', clientId: '', notes: '', hasFile: false, ...preset };
  let newFile = null;
  const fFile = h('input', { type: 'file', accept: 'image/*,application/pdf' });
  const prev = h('div', { class: 'rprev' }, r.hasFile ? 'File attached' : 'No photo yet');
  if (r.hasFile) S.getFile(r.id).then((b) => { if (b && b.type.startsWith('image/')) fill(prev, h('img', { src: URL.createObjectURL(b) })); else if (b) fill(prev, h('a', { href: URL.createObjectURL(b), target: '_blank' }, 'Open PDF')); else if (r.driveId) prev.textContent = 'Saved on Google Drive'; });
  fFile.onchange = async () => {
    const f = fFile.files[0]; if (!f) return;
    newFile = await compressImage(f);
    newFile.__name = f.name;
    fill(prev, newFile.type.startsWith('image/') ? h('img', { src: URL.createObjectURL(newFile) }) : h('span', {}, f.name));
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

  openSheet(isNew ? 'Add receipt' : 'Edit receipt', h('div', { class: 'form' },
    inv ? h('p', { class: 'notice' }, `On invoice #${inv.number}.`) : null,
    h('label', { class: 'filebtn' }, '📸 Take photo / choose file', fFile), prev,
    h('div', { class: 'grid2' }, field('Date', fDate), field('Amount ¥', fAmt)),
    h('div', { class: 'grid2' }, field('Shop / what', fVendor), field('Category', fCat)),
    field('Who pays?', fType), field('Job', fJob, 'Linking a job adds it to that job\'s invoice automatically'),
    field('Client (if no job)', fClient), field('Notes', fNotes)), [
    !isNew ? h('button', { class: 'btn ghost bad', onclick: async () => { if (inv) return toast('Remove it from the invoice first', 'bad'); if (confirmBox('Delete this receipt?')) { await S.deleteFile(r.id); S.remove('receipts', r.id); closeSheet(); render(); } } }, 'Delete') : null,
    h('button', { class: 'btn', onclick: async () => {
      const amount = Number(fAmt.value) || 0;
      if (!amount) return toast('Enter the amount', 'bad');
      const out = { ...r, date: fDate.value, amount, vendor: fVendor.value.trim(), category: fCat.value, type: fType.value, jobId: fJob.value || null, clientId: fJob.value ? (S.byId('jobs', fJob.value)?.clientId || '') : fClient.value, notes: fNotes.value };
      if (newFile) {
        await S.putFile(r.id, newFile);
        const ext = newFile.type === 'application/pdf' ? 'pdf' : 'jpg';
        out.hasFile = true; out.mime = newFile.type; out.driveId = null; thumbs.delete(r.id);
        out.fileName = `${out.date}_${(out.vendor || out.category).replace(/[^A-Za-z0-9]+/g, '') || 'receipt'}_${Math.round(amount)}.${ext}`;
      }
      // auto-add to the job's invoice if it's still a draft
      if (isNew && out.type === 'reimb' && out.jobId) {
        const ji = C.invoiceForJob(out.jobId, data);
        if (ji && ji.status === 'draft' && !ji.receiptIds.includes(out.id)) { ji.receiptIds.push(out.id); S.upsert('invoices', ji); }
      }
      S.upsert('receipts', out); closeSheet(); render(); toast('Receipt saved');
    } }, 'Save'),
  ]);
}

// =====================================================================
// MORE: clients, profile, settings, drive, data, help
// =====================================================================
routes.more = () => h('div', { class: 'stack' },
  h('h1', {}, 'More'),
  h('div', { class: 'list' },
    [['clients', '👥', 'Clients', 'Who withholds, who gets 10% tax, rates'],
      ['profile', '🪪', 'My details', 'Name, address, bank (on every invoice)'],
      ['settings', '🧮', 'Tax settings', 'Set-aside rate, salary'],
      ['drive', '☁️', 'Google Drive', D.isConnected() ? 'Connected' : (data.drive.lastSync ? 'Set up · tap Sync to sign in' : 'Not set up · guide inside')],
      ['email', '✉️', 'Email setup', localStorage.getItem('fl_mail_done') === '1' ? 'Set up' : 'How sending invoices works'],
      ['updates', '⬆️', 'App updates', G.hasToken() ? `v${VERSION} · install updates here` : `v${VERSION} · set up in-app updates`],
      ['data', '💾', 'Backup & restore', 'Download a backup, load your starter file'],
      ['help', '📖', 'Plain-English glossary', 'What all the Japanese tax words mean'],
    ].map(([k, i, t, s]) => h('a', { class: 'item', href: `#${k}` }, h('span', { class: 'ti' }, i), h('div', { class: 'grow' }, h('b', {}, t), h('div', { class: 'small muted' }, s)), '›'))),
  h('p', { class: 'small muted center' }, `Freelance Ledger v${VERSION}`));

routes.clients = () => h('div', { class: 'stack' },
  h('a', { href: '#more', class: 'back' }, '‹ More'),
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
  return h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'My details'),
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
  return h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'Tax settings'),
    h('div', { class: 'card form' },
      field('Set-aside rate %', rate, '15% fits a ~¥300k/month salary (5% income tax band + 10% resident tax). Use 20% if your salary goes above ~¥5M/year.'),
      field('Capsule salary per month ¥', sal, 'Only used for the explanation. Update from your 源泉徴収票.'),
      h('button', { class: 'btn', onclick: () => { S.setSettings({ setAsideRate: (Number(rate.value) || 15) / 100, salaryMonthly: Number(sal.value) || 0 }); toast('Saved'); } }, 'Save')),
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
    step(7, 'Paste the Client ID below', p_('Google shows it in a popup. It ends in ', h('code', {}, '.apps.googleusercontent.com'), '. Paste it in the box below and tap Save. Lost the popup? Open Clients and click the name to see it again.'), linkBtn(`${C_}/auth/clients`, 'Clients')),
    step(8, 'Connect', p_('Tap ', h('b', {}, 'Connect & sync'), '. Google warns "Google hasn\'t verified this app". That\'s normal for your own app: tap ', h('b', {}, 'Continue'), ', tick the Drive boxes, Continue.')),
    step(9, 'Then on your phone', p_('Open the app on your phone → More → Google Drive. Paste the ', h('b', {}, 'same'), ' Client ID (use the copy button below, send it to yourself), then Connect & sync. Everything comes across.')),
    h('h4', {}, 'If something goes wrong'),
    trouble('"Error 400: origin_mismatch" or "redirect_uri_mismatch"', `Step 6 doesn't match. The origin must be exactly ${location.origin}. Fix it in Clients, wait 5 minutes, try again.`),
    trouble('"Access blocked" or "403: access_denied"', 'You\'re not on the tester list. Do step 5 with the exact Google account you\'re signing in with.'),
    trouble('Nothing happens when I tap Connect', 'Your browser blocked the popup. Allow popups for this site. On iPhone, open the app from Safari or the home-screen icon, not from inside another app.'),
    trouble('It asks me to sign in again', 'Normal. Google sign-ins last about an hour. Tap Sync and it reconnects.'));

  return h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'Google Drive'),
    h('p', { class: 'small' }, 'Your data saves on this device and syncs to your Google Drive, so your phone and computer stay in step. Invoices and receipts also go into a ', h('b', {}, 'Freelance Ledger'), ' folder in your Drive.'),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', {}, D.isConnected() ? '✅ Connected' : data.drive.lastSync ? '🟡 Set up, sign in to sync' : '⚪ Not set up yet'), h('span', { class: 'small muted' }, `Last sync: ${last}`)),
      D.state.message && D.state.status === 'error' ? h('p', { class: 'notice bad' }, D.state.message) : null,
      h('div', { class: 'form' },
        field('Google Client ID', cid),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn ghost', onclick: () => { if (!/\.apps\.googleusercontent\.com$/.test(cid.value.trim())) return toast('That doesn\'t look like a Client ID (should end in .apps.googleusercontent.com)', 'bad'); D.setClientId(cid.value); D.preload(); toast('Client ID saved'); render(); } }, 'Save'),
          set ? copyBtn(D.getClientId(), 'Copy ID for phone') : null,
          h('button', { class: 'btn', disabled: !set || null, onclick: syncTap }, D.isConnected() ? 'Sync now' : 'Connect & sync'),
          D.isConnected() ? h('button', { class: 'btn ghost', onclick: () => { D.disconnect(); render(); } }, 'Disconnect') : null,
          data.drive.lastSync ? h('a', { class: 'btn ghost', href: 'https://drive.google.com/drive/search?q=Freelance%20Ledger', target: '_blank', rel: 'noopener' }, 'Open Drive ↗') : null))),
    data.drive.lastSync ? h('details', {}, h('summary', {}, 'Show the setup guide again'), guide) : guide);
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
  return h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'Email setup'),
    h('div', { class: 'card' },
      h('p', {}, h('b', {}, 'There\'s nothing to link.'), ' The app makes the invoice PDF + receipts and hands them to your ', h('b', {}, 'Outlook app'), ', which is signed in to ', data.profile.email || 'your Hotmail', '. You check it and press send in Outlook.'),
      done ? h('p', { class: 'notice' }, '✓ Email is set up on this device.') : null),
    h('div', { class: 'card guide' },
      h('h3', {}, '📱 On your phone (best)'),
      step(1, 'Install Outlook', p_('Free from Microsoft.'), h('div', { class: 'row gap wrap' }, linkBtn('https://apps.apple.com/app/microsoft-outlook/id951937596', 'App Store'), linkBtn('https://play.google.com/store/apps/details?id=com.microsoft.office.outlook', 'Google Play'))),
      step(2, 'Sign in with your Hotmail', p_('Open Outlook → Add account → ', h('b', {}, data.profile.email || 'your Hotmail'), '. Send yourself a normal email to check it works.')),
      step(3, 'Send a test from this app', p_('Tap below and choose ', h('b', {}, 'Outlook'), ' in the share menu. Your own address is copied: tap To, paste, send.'), h('button', { class: 'btn small', onclick: test }, 'Send test to myself')),
      step(4, 'Outlook not in the share menu?', p_('iPhone: scroll the row of app icons to the end → ', h('b', {}, 'More'), ' → Edit → add Outlook. Android: it\'s in the list. Search "Outlook".')),
      step(5, 'For real invoices', p_('Invoice → ', h('b', {}, '✉️ Email invoice'), ' → ', h('b', {}, 'Share to Outlook'), '. PDF, receipts and the message text are filled in. Paste the client\'s address (already copied). If the subject is blank, go back and tap Copy next to Subject. Send, then tap ', h('b', {}, 'Mark sent'), ' in the app.'))),
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
    try { const name = await G.test(); fill(status, h('p', { class: 'notice' }, `✓ Connected to ${name}. You can install updates now.`)); }
    catch (e) { fill(status, h('p', { class: 'notice bad' }, e.message)); }
  };
  const fZip = h('input', { type: 'file', accept: '.zip,application/zip,.html,.js,.css,.json,.png,.webmanifest,.md', multiple: true });
  fZip.onchange = async () => {
    if (!fZip.files.length) return;
    fill(prog, h('p', { class: 'small muted' }, 'Reading the update…'));
    try {
      const pack = await G.prepare([...fZip.files], data.profile);
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
          } catch (err) { fill(prog, h('p', { class: 'notice bad' }, err.message)); }
        } }, 'Install update')));
    } catch (e) { fill(prog, h('p', { class: 'notice bad' }, e.message)); }
    fZip.value = '';
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

  return h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'App updates'),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', {}, `Installed: v${VERSION}`), has ? chip('Updates ready', 'ok') : chip('Not set up', 'warn')),
      h('p', { class: 'small' }, 'When I send you a new version (a .zip file), download it, then choose it here. The app publishes it to your site and reloads. Your other devices update on their own the next time they open. Your data isn\'t touched.')),
    has ? null : guide,
    h('div', { class: 'card' }, h('h3', {}, 'Install an update'),
      has ? [h('label', { class: 'filebtn' }, '📦 Choose update .zip', fZip),
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

routes.data = () => h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'Backup & restore'),
  h('div', { class: 'card' }, h('h3', {}, 'Backup file'),
    h('p', { class: 'small' }, 'A full copy of your data (not receipt photos). Drive sync already does this. This is an extra safety net. Restoring merges the file into what\'s here, so it\'s also how you load your starter file.'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn ghost', onclick: () => downloadFile(new File([JSON.stringify(S.exportable(), null, 1)], `freelance-ledger-backup-${C.today()}.json`, { type: 'application/json' })) }, 'Download backup'),
      h('label', { class: 'btn ghost filebtn-inline' }, 'Restore from backup', h('input', { type: 'file', accept: 'application/json,.json', onchange: async (e) => {
        try { S.importBackup(JSON.parse(await e.target.files[0].text())); toast('Backup restored'); } catch (err) { toast(err.message, 'bad'); }
      } })))));

routes.help = () => h('div', { class: 'stack' }, h('a', { href: '#more', class: 'back' }, '‹ More'), h('h1', {}, 'Plain-English glossary'),
  GLOSSARY.map(([w, r, d]) => h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', { class: 'ja' }, w), h('span', { class: 'small muted' }, r)), h('p', {}, d))),
  h('p', { class: 'small muted' }, '⚠️ Guidance, not tax advice.'));

// ---------- boot ----------
if (D.getClientId()) D.preload();
if (localStorage.getItem('fl_updating_to') === VERSION) { localStorage.removeItem('fl_updating_to'); setTimeout(() => toast(`Updated to v${VERSION} ✓`), 600); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
if (!data.clients.length && !data.jobs.length && !localStorage.getItem('fl_welcomed')) {
  setTimeout(() => openSheet('Welcome 👋', h('div', {},
    h('p', {}, 'Load your starter file to get your details, clients and 2026 invoices in one go.'),
    h('p', { class: 'small muted' }, 'On a second device, just connect Google Drive instead (More → Google Drive).'),
    h('label', { class: 'filebtn' }, '📂 Choose starter file (.json)', h('input', { type: 'file', accept: 'application/json,.json', onchange: async (e) => {
      try { S.importBackup(JSON.parse(await e.target.files[0].text())); localStorage.setItem('fl_welcomed', '1'); closeSheet(); render(); toast('All loaded'); } catch (err) { toast(err.message, 'bad'); }
    } }))), [
    h('button', { class: 'btn ghost', onclick: () => { localStorage.setItem('fl_welcomed', '1'); closeSheet(); } }, 'Skip'),
  ]), 300);
}
render();
