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

export function jobFee(job) { return Math.round((Number(job.qty) || 0) * (Number(job.rate) || 0)); }

const alive = (x) => x && !x.deleted;

/** Full breakdown for one invoice. */
export function invoiceTotals(inv, data) {
  const jobs = (inv.jobIds || []).map((id) => data.jobs.find((j) => j.id === id)).filter(alive);
  const receipts = (inv.receiptIds || []).map((id) => data.receipts.find((r) => r.id === id)).filter(alive);
  const lines = (inv.lines || []).filter((l) => l && !l.deleted);
  const lineTotal = lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0)), 0);
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

/** Everything earned in one month (by work date), grouped by invoice. month = 1-12 */
export function monthDetail(data, year, month) {
  const jobs = data.jobs.filter((j) => alive(j) && yearOf(j.date) === year && monthOf(j.date) === month).sort((a, b) => a.date.localeCompare(b.date));
  const invs = new Map(); const direct = []; const open = []; let total = 0;
  for (const j of jobs) {
    const r = jobIncome(j, data);
    total += r.income;
    if (r.inv) {
      const e = invs.get(r.inv.id) || { inv: r.inv, amount: 0, jobs: [] };
      e.amount += r.income; e.jobs.push(j); invs.set(r.inv.id, e);
    } else if (j.direct) direct.push({ job: j, amount: r.income });
    else open.push({ job: j, amount: r.income });
  }
  return { total, invoices: [...invs.values()], direct, open, count: jobs.length };
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

  for (const job of data.jobs.filter(alive)) {
    if (yearOf(job.date) !== year) continue;
    const r = jobIncome(job, data);
    if (!r.inv && !job.direct) uninvoiced += r.fee;
    income += r.income; taxCharged += r.tax; withheld += r.wh;
    lanes[job.lane] = (lanes[job.lane] || 0) + r.income;
    months[monthOf(job.date) - 1] += r.income;
  }

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
  const date = fmtDateSlash(job.date);
  const label = job.dateLabel || date;
  const u = UNITS[job.unit] || UNITS.day;
  const q = Number(job.qty) || 0;
  const qty = lang === 'ja' ? `${q}${u.ja}` : `${q} ${q === 1 ? u.en : u.enPl}`;
  return { text: label ? `${desc}${desc ? '  ' : ''}${label}` : desc, qty, rate: Number(job.rate) || 0, amount: jobFee(job) };
}
