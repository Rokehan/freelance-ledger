// Pure money + date logic. No DOM. Safe to unit test in Node.

export const LANES = {
  camera:   { en: 'Camera',   ja: '撮影',   icon: '🎥' },
  teaching: { en: 'Teaching', ja: '保育',   icon: '🧸' },
  gear:     { en: 'Gear',     ja: '機材',   icon: '🔧' },
};

export const UNITS = {
  day:  { en: 'day',  enPl: 'days',  ja: '日' },
  hour: { en: 'h',    enPl: 'h',     ja: '時間' },
  item: { en: 'item', enPl: 'items', ja: '式' },
};

export const TAX_RATE = 0.10;          // consumption tax added to fees
export const WH_RATE = 0.1021;         // withholding up to ¥1,000,000
export const WH_RATE_HIGH = 0.2042;    // withholding on the part above ¥1,000,000
export const FILING_LINE = 200000;     // side income after expenses

// ---------- dates (all stored as 'YYYY-MM-DD' strings, local time) ----------
const pad = (n) => String(n).padStart(2, '0');
export function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function today() { return ymd(new Date()); }
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function yearOf(s) { return Number(String(s).slice(0, 4)); }
export function monthOf(s) { return Number(String(s).slice(5, 7)); }

/** End of the month after the issue date (default payment terms). */
export function endOfFollowingMonth(issue) {
  const d = parseYmd(issue);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 2, 0));
}

export function fmtDateJa(s) { if (!s) return ''; const d = parseYmd(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; }
export function fmtDateSlash(s) { return s ? s.replaceAll('-', '/') : ''; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDateEn(s) { if (!s) return ''; const d = parseYmd(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; }
// ---------- multiple work dates ----------
export function dayDiff(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
/** All days from a to b inclusive (max 92). */
export function expandRange(a, b) {
  if (!a) return [];
  if (!b || b < a) return [a];
  const out = []; const d = parseYmd(a); const end = parseYmd(b);
  while (d <= end && out.length < 92) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}
/** The work dates of a job or invoice line, sorted, no repeats. */
export function datesOf(x) {
  const d = x && Array.isArray(x.dates) && x.dates.length ? x.dates : [x && x.date].filter(Boolean);
  return [...new Set(d)].sort();
}
export const isConsecutive = (ds) => ds.every((d, i) => i === 0 || dayDiff(ds[i - 1], d) === 1);
/** 2026/10/13–15 · 2026/10/30–11/02 · 2026/10/13, 10/15, 10/20 */
export function fmtDates(ds) {
  if (!ds || !ds.length) return '';
  if (ds.length === 1) return fmtDateSlash(ds[0]);
  const [y1, m1] = ds[0].split('-');
  const sameYear = ds.every((d) => d.startsWith(y1));
  const md = (d) => { const [, m, dd] = d.split('-'); return `${m}/${dd}`; };
  if (isConsecutive(ds)) {
    const last = ds[ds.length - 1]; const [y2, m2, d2] = last.split('-');
    if (y2 !== y1) return `${fmtDateSlash(ds[0])}–${fmtDateSlash(last)}`;
    return `${fmtDateSlash(ds[0])}–${m2 === m1 ? d2 : md(last)}`;
  }
  return sameYear ? `${fmtDateSlash(ds[0])}, ${ds.slice(1).map(md).join(', ')}` : ds.map(fmtDateSlash).join(', ');
}
export function fmtDate(s, lang) { return lang === 'ja' ? fmtDateJa(s) : fmtDateEn(s); }

// ---------- money ----------
export function yen(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-¥' : '¥') + Math.abs(v).toLocaleString('en-US');
}
export function num(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

export function withholding(fees) {
  const f = Math.max(0, Math.floor(fees));
  if (f <= 1000000) return Math.floor(f * WH_RATE);
  return Math.floor(1000000 * WH_RATE + (f - 1000000) * WH_RATE_HIGH);
}

/** Days charged on an invoice line: your own number, or every day in the dates you picked. Old lines (before v1.7) = 1. */
export function lineDays(l) {
  if (!l) return 0;
  if (!(l.v >= 2)) return 1;
  if (l.days != null && l.days !== '') return Math.max(0, Number(l.days) || 0);
  return Math.max(1, datesOf(l).length);
}
/** qty × rate × days, minus the discount %. */
export function lineAmount(l) {
  const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0) * lineDays(l);
  const disc = Math.min(100, Math.max(0, Number(l.discount) || 0));
  return Math.round(gross * (1 - disc / 100));
}

export function jobFee(job) { return Math.round((Number(job.qty) || 0) * (Number(job.rate) || 0)); }

const alive = (x) => x && !x.deleted;

/** Full breakdown for one invoice. */
export function invoiceTotals(inv, data) {
  const jobs = (inv.jobIds || []).map((id) => data.jobs.find((j) => j.id === id)).filter(alive);
  const receipts = (inv.receiptIds || []).map((id) => data.receipts.find((r) => r.id === id)).filter(alive);
  const lines = (inv.lines || []).filter((l) => l && !l.deleted);
  const lineTotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const fees = jobs.reduce((s, j) => s + jobFee(j), 0) + lineTotal;
  const tax = inv.addTax ? Math.floor(fees * TAX_RATE) : 0;
  const wh = inv.withhold ? withholding(fees) : 0;
  const reimb = receipts.reduce((s, r) => s + Math.round(Number(r.amount) || 0), 0);
  const feeTotal = fees + tax - wh;
  const total = feeTotal + reimb;
  const paid = (inv.payments || []).reduce((s, p) => s + Math.round(Number(p.amount) || 0), 0);
  return { jobs, receipts, lines, fees, tax, wh, reimb, feeTotal, total, paid, owed: Math.max(0, total - paid) };
}

/** draft | sent | overdue | partial | paid */
export function invoiceStatus(inv, data, now = today()) {
  if (inv.status === 'draft') return 'draft';
  const t = invoiceTotals(inv, data);
  if (t.paid >= t.total && t.total > 0) return 'paid';
  if (inv.status === 'paid') return 'paid';
  if (t.paid > 0) return 'partial';
  if (inv.dueDate && now > inv.dueDate) return 'overdue';
  return 'sent';
}

/** Next number for the issue year: YY + 101, 102… Legacy numbers are ignored. */
export function nextInvoiceNumber(data, issueDate) {
  const yy = String(yearOf(issueDate)).slice(2);
  const re = new RegExp(`^${yy}(\\d{3})$`);
  let max = 100;
  for (const inv of data.invoices) {
    if (!alive(inv) || inv.legacy) continue;
    const m = String(inv.number).match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (max >= 999) throw new Error('Out of invoice numbers for this year');
  return `${yy}${max + 1}`;
}

/** Find which invoice (if any) a job belongs to. */
export function invoiceForJob(jobId, data) {
  return data.invoices.find((i) => alive(i) && (i.jobIds || []).includes(jobId)) || null;
}
export function invoiceForReceipt(rId, data) {
  return data.invoices.find((i) => alive(i) && (i.receiptIds || []).includes(rId)) || null;
}

/** Income from one job: its fee plus its share of any 10% tax on its invoice. */
export function jobIncome(job, data) {
  const fee = jobFee(job);
  const inv = invoiceForJob(job.id, data);
  if (!inv) return { fee, tax: 0, wh: 0, income: fee, inv: null };
  const t = invoiceTotals(inv, data);
  const share = t.fees ? fee / t.fees : 0;
  const tax = Math.round(t.tax * share), wh = Math.round(t.wh * share);
  return { fee, tax, wh, income: fee + tax, inv };
}

/**
 * Every bit of income, split per work date (a 3-day job = 3 entries of a third each).
 * Includes jobs and custom invoice lines. Counted by the day you worked.
 */
export function incomeEntries(data) {
  const out = [];
  const push = (dates, fee, tax, wh, base) => {
    const ds = dates.length ? dates : [];
    const n = ds.length || 1;
    for (const d of ds) out.push({ ...base, date: d, fee: fee / n, tax: tax / n, wh: wh / n, income: (fee + tax) / n });
  };
  for (const job of data.jobs.filter(alive)) {
    const r = jobIncome(job, data);
    push(datesOf(job), r.fee, r.tax, r.wh, { kind: 'job', item: job, inv: r.inv, lane: job.lane || 'camera', direct: !!job.direct });
  }
  for (const inv of data.invoices.filter(alive)) {
    const lines = (inv.lines || []).filter((l) => l && !l.deleted);
    if (!lines.length) continue;
    const t = invoiceTotals(inv, data);
    const client = data.clients.find((c) => c.id === inv.clientId);
    for (const l of lines) {
      const fee = lineAmount(l);
      const share = t.fees ? fee / t.fees : 0;
      const ds = datesOf(l);
      push(ds.length ? ds : [inv.issueDate].filter(Boolean), fee, t.tax * share, t.wh * share, { kind: 'line', item: l, inv, lane: l.lane || client?.lane || 'camera', direct: false });
    }
  }
  return out;
}

/** Everything earned in one month (by work date), grouped by invoice. month = 1-12 */
export function monthDetail(data, year, month) {
  const es = incomeEntries(data).filter((e) => yearOf(e.date) === year && monthOf(e.date) === month);
  const invs = new Map(); const direct = new Map(); const open = new Map(); let total = 0; const items = new Set();
  for (const e of es) {
    total += e.income; items.add(e.item);
    if (e.inv) {
      const g = invs.get(e.inv.id) || { inv: e.inv, amount: 0, jobs: [] };
      g.amount += e.income; if (!g.jobs.includes(e.item)) g.jobs.push(e.item); invs.set(e.inv.id, g);
    } else {
      const m = e.direct ? direct : open;
      const g = m.get(e.item.id) || { job: e.item, amount: 0 };
      g.amount += e.income; m.set(e.item.id, g);
    }
  }
  return { total, invoices: [...invs.values()], direct: [...direct.values()], open: [...open.values()], count: items.size };
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Year summary. Income is counted by WORK date.
 * Consumption tax you charge counts as income (you're not registered, so you keep it).
 * Withholding is spread across the invoice's jobs in proportion to their fees.
 */
export function yearSummary(data, year, settings = data.settings || {}) {
  const rate = Number(settings.setAsideRate ?? 0.15);
  const lanes = { camera: 0, teaching: 0, gear: 0 };
  const months = Array(12).fill(0);
  let income = 0, withheld = 0, taxCharged = 0, uninvoiced = 0;

  for (const e of incomeEntries(data)) {
    if (yearOf(e.date) !== year) continue;
    if (!e.inv && !e.direct) uninvoiced += e.fee;
    income += e.income; taxCharged += e.tax; withheld += e.wh;
    lanes[e.lane] = (lanes[e.lane] || 0) + e.income;
    months[monthOf(e.date) - 1] += e.income;
  }
  income = Math.round(income); taxCharged = Math.round(taxCharged); withheld = Math.round(withheld); uninvoiced = Math.round(uninvoiced);

  let expenses = 0;
  for (const r of data.receipts.filter(alive)) {
    if (r.type !== 'own' || yearOf(r.date) !== year) continue;
    expenses += Math.round(Number(r.amount) || 0);
  }

  const net = Math.max(0, income - expenses);
  const taxEstimate = Math.round(net * rate);
  const setAside = Math.max(0, taxEstimate - withheld);
  const saved = Number((settings.savedAside || {})[year] || 0);

  let owed = 0, overdue = 0, overdueCount = 0;
  for (const inv of data.invoices.filter(alive)) {
    const st = invoiceStatus(inv, data);
    if (st === 'draft' || st === 'paid') continue;
    const t = invoiceTotals(inv, data);
    owed += t.owed;
    if (st === 'overdue') { overdue += t.owed; overdueCount++; }
  }

  return {
    year, rate, lanes, months, income, taxCharged, expenses, net, withheld,
    taxEstimate, setAside, saved, stillToSave: Math.max(0, setAside - saved),
    overFilingLine: net > FILING_LINE, filingGap: FILING_LINE - net,
    uninvoiced, owed, overdue, overdueCount,
  };
}

/** Line text for a job on an invoice. */
export function jobLine(job, lang) {
  const desc = job.description || job.position || '';
  const label = job.dateLabel || fmtDates(datesOf(job));
  const u = UNITS[job.unit] || UNITS.day;
  const q = Number(job.qty) || 0;
  const qty = lang === 'ja' ? `${q}${u.ja}` : `${q} ${q === 1 ? u.en : u.enPl}`;
  return { text: label ? `${desc}${desc ? '  ' : ''}${label}` : desc, qty, rate: Number(job.rate) || 0, amount: jobFee(job) };
}
