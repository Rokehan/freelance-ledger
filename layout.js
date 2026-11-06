// Builds an A4 invoice as a list of drawing ops (units: mm, font size: pt).
// Pure: the browser draws the ops on a canvas, tests can draw them anywhere.
import { invoiceTotals, jobLine, fmtDate, fmtDateSlash, fmtDates, datesOf, num, lineDays, lineAmount } from './calc.js';

const L = 18, R = 192;               // page margins (A4 = 210 x 297)
const INK = '#1d1d1f', MUTED = '#6b6b70', RULE = '#b8b8bd', FILL = '#ececef', ACCENT = '#1f6f78';

const T = {
  ja: {
    title: '請 求 書', no: '請求書番号', issued: '発行日', due: 'お支払期限',
    intro: '下記のとおりご請求申し上げます。', amount: 'ご請求金額', project: '件名', position: 'ポジション',
    item: '品目', qty: '数量', unit: '単価', total: '金額',
    sub: '小計', tax: '消費税 (10%)', wh: '源泉徴収税 (10.21%)', fees: '報酬合計',
    reimb: '立替金', reimbSub: '立替金 小計', grand: 'ご請求金額 合計',
    bank: '振込先', bankName: '銀行名', branch: '店番', type: '預金種目', acct: '口座番号', holder: '口座名義',
    fee: '※ 振込手数料はご負担くださいますようお願いいたします。',
    tel: 'TEL', mail: 'MAIL',
  },
  en: {
    title: 'INVOICE', no: 'Invoice No.', issued: 'Issue date', due: 'Due date',
    intro: 'Please find the details of this invoice below.', amount: 'Amount due', project: 'Project', position: 'Position',
    item: 'Description', qty: 'Qty', unit: 'Unit price', total: 'Amount',
    sub: 'Subtotal', tax: 'Consumption tax (10%)', wh: 'Withholding tax (10.21%)', fees: 'Fees total',
    reimb: 'Reimbursed expenses', reimbSub: 'Expenses subtotal', grand: 'Total due',
    bank: 'Bank details', bankName: 'Bank', branch: 'Branch', type: 'Account type', acct: 'Account no.', holder: 'Account holder',
    fee: 'Bank transfer fees to be covered by the client.',
    tel: 'Tel', mail: 'Email',
  },
};

export function invoiceOps(inv, data) {
  const lang = inv.lang === 'en' ? 'en' : 'ja';
  const t = T[lang];
  const p = data.profile;
  const c = data.clients.find((x) => x.id === inv.clientId) || {};
  const tot = invoiceTotals(inv, data);
  const ops = [];
  const text = (x, y, s, size = 9, o = {}) => s != null && s !== '' && ops.push({ op: 'text', x, y, text: String(s), size, ...o });
  const line = (x1, y1, x2, y2, w = 0.25, color = RULE) => ops.push({ op: 'line', x1, y1, x2, y2, w, color });
  const rect = (x, y, w, h, o = {}) => ops.push({ op: 'rect', x, y, w, h, ...o });
  const money = (n) => (lang === 'ja' ? '' : '¥') + num(n);

  // ---- header ----
  text(L, 27, t.title, lang === 'ja' ? 22 : 24, { bold: true, color: INK });
  line(L, 32, R, 32, 1.2, ACCENT);

  // meta (top right)
  const metaY = 40;
  [[t.no, inv.number], [t.issued, fmtDate(inv.issueDate, lang)], [t.due, fmtDate(inv.dueDate, lang)]].forEach(([k, v], i) => {
    text(150, metaY + i * 5.2, k, 8.5, { color: MUTED, align: 'right' });
    text(R, metaY + i * 5.2, v, 9, { align: 'right', bold: i === 0 });
  });

  // ---- bill to ----
  const clientName = lang === 'ja' ? (c.nameJa || c.nameEn) : (c.nameEn || c.nameJa);
  const hon = lang === 'ja' ? (c.honorific || '御中') : '';
  text(L, 45, clientName || '', 13, { bold: true, maxW: 85 });
  if (hon) text(110, 45, hon, 12, { align: 'right' });
  line(L, 47.5, 112, 47.5, 0.4, INK);
  let y = 52.5;
  const cAddr = (lang === 'ja' ? (c.addressJa || c.addressEn) : (c.addressEn || c.addressJa)) || '';
  for (const ln of cAddr.split('\n').filter(Boolean).slice(0, 3)) { text(L, y, ln, 8, { color: MUTED, maxW: 94 }); y += 4.2; }
  if (c.contact) { text(L, y, (lang === 'ja' ? 'ご担当：' : 'Attn: ') + c.contact + (lang === 'ja' ? ' 様' : ''), 8, { color: MUTED }); y += 4.2; }

  // ---- from (right) ----
  let fy = 62;
  text(122, fy, p.nameEn, 9, { bold: true, maxW: 70 }); fy += 4.6;
  const pAddr = (lang === 'ja' ? p.addressJa : p.addressEn) || '';
  for (const ln of pAddr.split('\n').filter(Boolean).slice(0, 4)) { text(122, fy, ln, 8, { maxW: 70 }); fy += 4.2; }
  text(122, fy, `${t.tel}: ${p.phone}`, 8); fy += 4.2;
  text(122, fy, `${t.mail}: ${p.email}`, 8); fy += 4.2;

  // ---- amount due box ----
  const ay = Math.max(y + 5, 70);
  text(L, ay, t.intro, 8.5, { color: MUTED });
  rect(L, ay + 4, 30, 10, { fill: FILL, stroke: RULE, lw: 0.3 });
  text(L + 15, ay + 10.6, t.amount, 9.5, { align: 'center', bold: true });
  text(L + 36, ay + 12, `¥${num(tot.total)} -`, 18, { bold: true });
  line(L, ay + 14.5, 112, ay + 14.5, 0.5, INK);

  let py = ay + 22;
  if (inv.project) { text(L, py, `${t.project}：${inv.project}`, 9, { maxW: 100 }); py += 5; }
  if (inv.position) { text(L, py, `${t.position}：${inv.position}`, 9, { maxW: 100 }); py += 5; }
  if (inv.clientReference) { text(L, py, `${lang === 'ja' ? '案件番号' : 'Client reference'}：${inv.clientReference}`, 9, { maxW: 100 }); py += 5; }

  // ---- size the tables to fit ----
  const lines = [...tot.jobs].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((j) => jobLine(j, lang)).concat((tot.lines || []).map((l) => {
    const days = lineDays(l); const q = Number(l.qty) || 0; const disc = Number(l.discount) || 0;
    const qtyText = days > 1 || l.v >= 2 && l.days != null
      ? (lang === 'ja' ? `${q} × ${days}日` : `${q} × ${days} ${days === 1 ? 'day' : 'days'}`)
      : String(q);
    const discText = disc ? (lang === 'ja' ? `（${disc}%割引）` : ` (${disc}% off)`) : '';
    return { text: `${l.description || ''}${discText}${datesOf(l).length ? '  ' + fmtDates(datesOf(l)) : ''}`, qty: qtyText, rate: Number(l.rate) || 0, amount: lineAmount(l) };
  })); 
  const rLines = [...tot.receipts].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r) => ({ text: `${r.vendor || r.category || ''}${r.date ? '  ' + fmtDateSlash(r.date) : ''}`, amount: Math.round(r.amount) }));
  const sumRows = 1 + (inv.addTax ? 1 : 0) + (inv.withhold ? 1 : 0) + ((inv.addTax || inv.withhold) ? 1 : 0);
  const rows = lines.length + 1 + sumRows + (rLines.length ? rLines.length + 2 : 0) + 1;
  const top = Math.max(py + 3, ay + 30);
  const avail = 238 - top - (rLines.length ? 6 : 0);
  const rh = Math.max(4.6, Math.min(7, avail / rows));
  const fs = rh < 5.6 ? 7.6 : 8.5;

  const C = [L, 112, 132, 162, R]; // column edges
  const header = (yy, label) => {
    rect(L, yy, R - L, rh, { fill: FILL });
    [label, t.qty, t.unit, t.total].forEach((h, i) => text((C[i] + C[i + 1]) / 2, yy + rh * 0.68, h, fs, { align: 'center', bold: true }));
    line(L, yy, R, yy, 0.3, RULE); line(L, yy + rh, R, yy + rh, 0.3, RULE);
  };
  const row = (yy, cells) => {
    text(C[0] + 1.5, yy + rh * 0.68, cells[0], fs, { maxW: C[1] - C[0] - 3 });
    if (cells[1] != null) text((C[1] + C[2]) / 2, yy + rh * 0.68, cells[1], fs, { align: 'center' });
    if (cells[2] != null) text(C[3] - 1.5, yy + rh * 0.68, cells[2], fs, { align: 'right' });
    text(C[4] - 1.5, yy + rh * 0.68, cells[3], fs, { align: 'right' });
    line(L, yy + rh, R, yy + rh, 0.15, '#d6d6da');
  };
  const sumRow = (yy, label, value, o = {}) => {
    if (o.fill) rect(C[1], yy, R - C[1], rh, { fill: o.fill });
    text(C[1] + 1.5, yy + rh * 0.68, label, fs, { bold: !!o.bold });
    text(C[4] - 1.5, yy + rh * 0.68, value, fs, { align: 'right', bold: !!o.bold });
    line(C[1], yy + rh, R, yy + rh, 0.2, RULE);
  };

  let ty = top;
  header(ty, t.item); ty += rh;
  if (!lines.length) { row(ty, ['—', null, null, '']); ty += rh; }
  for (const l of lines) { row(ty, [l.text, l.qty, money(l.rate), money(l.amount)]); ty += rh; }
  sumRow(ty, t.sub, money(tot.fees)); ty += rh;
  if (inv.addTax) { sumRow(ty, t.tax, money(tot.tax)); ty += rh; }
  if (inv.withhold) { sumRow(ty, t.wh, '-' + money(tot.wh)); ty += rh; }
  if (inv.addTax || inv.withhold) { sumRow(ty, t.fees, money(tot.feeTotal), { bold: true }); ty += rh; }

  if (rLines.length) {
    ty += 5;
    header(ty, t.reimb); ty += rh;
    for (const l of rLines) { row(ty, [l.text, '1', money(l.amount), money(l.amount)]); ty += rh; }
    sumRow(ty, t.reimbSub, money(tot.reimb)); ty += rh;
  }
  ty += 2;
  rect(C[1], ty, R - C[1], rh + 1.5, { fill: ACCENT });
  text(C[1] + 1.5, ty + (rh + 1.5) * 0.68, t.grand, fs + 0.5, { bold: true, color: '#ffffff' });
  text(C[4] - 1.5, ty + (rh + 1.5) * 0.68, `¥${num(tot.total)}`, fs + 1, { bold: true, color: '#ffffff', align: 'right' });

  // ---- bank details ----
  let by = Math.max(ty + rh + 12, 244);
  line(L, by - 5, R, by - 5, 0.3, RULE);
  text(L, by, t.bank, 9.5, { bold: true }); by += 5;
  const b = p.bank || {};
  const bankRows = lang === 'ja'
    ? [[t.bankName, b.name], [t.branch, b.branch], [t.type, b.type], [t.acct, b.number], [t.holder, b.holder]]
    : [[t.bankName, `${b.nameEn || ''} (${b.name || ''})`], [t.branch, b.branch], [t.type, `Ordinary (${b.type || '普通'})`], [t.acct, b.number], [t.holder, b.holder]];
  bankRows.forEach(([k, v]) => { text(L, by, k, 8.5, { color: MUTED }); text(L + 27, by, v, 8.5); by += 4.5; });
  text(L, by + 2.5, t.fee, 8, { color: MUTED });
  if (inv.note) text(L, by + 7.5, inv.note, 8, { color: MUTED, maxW: R - L });

  return ops;
}
