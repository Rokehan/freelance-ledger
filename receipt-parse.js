// Turns OCR text from a receipt (Japanese or English) into { amount, date, vendor, category }.
// Pure functions, no DOM. Every field is a best guess: the app highlights them for you to check,
// and offers the other amounts/dates it found as one-tap alternatives.

const FW = '０１２３４５６７８９';
export function normalize(t) {
  return String(t || '')
    .replace(/[０-９]/g, (c) => String(FW.indexOf(c)))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[￥¥]/g, '¥').replace(/\\(?=\s*\d)/g, '¥')
    .replace(/[，､]/g, ',').replace(/[．。](?=\d)/g, '.').replace(/：/g, ':').replace(/／/g, '/')
    .replace(/[ 　\t]+/g, ' ');
}

// ---------- amounts ----------
// Lines whose numbers are never the total (card slip IDs, change, tax breakdowns, phone numbers…)
const SKIP_LINE = /(お?預\s*り|釣|CHANGE|Change|CASH|小\s*計|対\s*象|内\s*税|内消費|消費税|税\s*率|ポイント|point|TEL|電\s*話|登録番号|事業者|承\s*認|会員|伝\s*票|端\s*末|AID|APL|番\s*号|No\s*\.|レジ|責\s*No|取引|カード|有効期限|会計番号|商品数|点数|個)/i;
const STRONG = /(合\s*計|お\s*会\s*計|総\s*計|TOTAL|Total|領収金額|お買上\s*計?|ご請求)/;
const MEDIUM = /(お?支\s*払|金\s*額|料\s*金|運\s*賃|AMOUNT|Amount|税\s*込|クレジット|ご利用額)/;

const toNum = (s) => Number(String(s).replace(/[,\s]/g, ''));
/** Money-looking tokens only: ¥1,572 / 1,572円 / 1,572 / short plain numbers. Long plain numbers are IDs. */
function amountsIn(line) {
  const out = [];
  const re = /(¥\s*)?(\d{1,3}(?:,\d{3})+|\d{2,7})(\s*円)?/g;
  for (const m of line.matchAll(re)) {
    const [, yen, n, en] = m;
    const marked = !!(yen || en || n.includes(','));
    if (!marked && n.length > 5) continue; // 764737 = approval number, not money
    const v = toNum(n);
    if (v >= 10 && v < 1000000) out.push({ v, marked });
  }
  return out;
}

export function findAmounts(lines) {
  const score = new Map();
  const bump = (v, s) => score.set(v, (score.get(v) || 0) + s);
  lines.forEach((ln, i) => {
    const clean = ln.replace(/\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ');
    if (SKIP_LINE.test(clean) && !STRONG.test(clean)) return;
    const strong = STRONG.test(clean), medium = MEDIUM.test(clean);
    let nums = amountsIn(clean);
    if (!nums.length && (strong || medium) && lines[i + 1] && !SKIP_LINE.test(lines[i + 1])) nums = amountsIn(lines[i + 1]);
    for (const { v, marked } of nums) {
      let s = marked ? 1 : 0;
      if (strong) s += 6; else if (medium) s += 3;
      bump(v, s);
    }
  });
  // the same amount showing up several times (合計, card slip 金額, お支払) is a strong sign
  const counts = new Map();
  lines.forEach((ln) => { if (!SKIP_LINE.test(ln)) for (const { v, marked } of amountsIn(ln)) if (marked) counts.set(v, (counts.get(v) || 0) + 1); });
  for (const [v, c] of counts) if (c > 1) bump(v, (c - 1) * 2);
  for (const [v] of score) if (v > 300000) score.set(v, score.get(v) - 5); // receipts are rarely this big
  return [...score].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([v, s]) => ({ v, s }));
}

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
function valid(y, m, d, today) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(y, m - 1, d);
  if (t.getMonth() !== m - 1) return null;
  const now = today ? new Date(today) : new Date();
  const diff = (t - now) / 86400000;
  if (diff > 2 || diff < -800) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function findDates(text, today) {
  // OCR often splits digits ("1 0月"), so also look at a copy with spaces between digits removed
  const variants = [text, text.replace(/(\d)\s+(?=\d)/g, '$1')];
  const year = new Date(today || Date.now()).getFullYear();
  const tries = [
    [/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, (m) => [m[1], m[2], m[3]]],
    [/(?:令和|R)\s*(\d{1,2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})/g, (m) => [2018 + Number(m[1]), m[2], m[3]]],
    [/(20\d{2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})/g, (m) => [m[1], m[2], m[3]]],
    [/(?<!\d)(\d{2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?!\d)/g, (m) => [2000 + Number(m[1]), m[2], m[3]]],
    [/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, (m) => [year, m[1], m[2]]],
  ];
  const score = new Map();
  for (const t of variants) for (const [re, pick] of tries) for (const m of t.matchAll(re)) {
    const v = valid(...pick(m).map(Number), today);
    if (v) score.set(v, (score.get(v) || 0) + 1);
  }
  // most often seen first, then most recent
  return [...score].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).map(([d]) => d);
}

// ---------- shop + category ----------
// [pattern (tolerant of OCR mistakes), shop name, category]
const SHOPS = [
  [/(セブン|イレブン|7\s*-?\s*ELEVEN|SEVEN\s*-?\s*ELEVEN|ELEVEN|7&i)/i, 'セブン-イレブン', 'Food'],
  [/(ファミリーマート|ファミマ|Family\s*Mart)/i, 'ファミリーマート', 'Food'],
  [/(ローソン|LAWSON)/i, 'ローソン', 'Food'],
  [/(ミニストップ|MINISTOP)/i, 'ミニストップ', 'Food'],
  [/(デイリーヤマザキ|NewDays|ニューデイズ)/i, 'コンビニ', 'Food'],
  [/(スターバックス|STARBUCKS)/i, 'スターバックス', 'Food'],
  [/(ドトール|DOUTOR)/i, 'ドトール', 'Food'],
  [/(タリーズ|TULLY)/i, 'タリーズ', 'Food'],
  [/(マクドナルド|McDonald)/i, 'マクドナルド', 'Food'],
  [/(吉野家|松屋|すき家|日高屋|ガスト|サイゼリヤ|モスバーガー)/, null, 'Food'],
  [/(ヨドバシ|Yodobashi)/i, 'ヨドバシカメラ', 'Consumables (tape, batteries)'],
  [/(ビックカメラ|BIC\s*CAMERA)/i, 'ビックカメラ', 'Consumables (tape, batteries)'],
  [/(ダイソー|DAISO)/i, 'ダイソー', 'Consumables (tape, batteries)'],
  [/(ENEOS|エネオス|出光|コスモ石油|昭和シェル|apollo)/i, null, 'Parking / fuel'],
  [/(タイムズ|Times|三井のリパーク|リパーク|駐車)/i, null, 'Parking / fuel'],
  [/(日本交通|東京無線|国際自動車|km\s*タクシー|タクシー|TAXI|S\.RIDE|DiDi)/i, null, 'Taxi'],
  [/(JR東日本|JR東海|JR西日本|Suica|PASMO|ICOCA|乗車券|東京メトロ)/i, null, 'Train / bus'],
];
const CATS = [
  ['Taxi', /(タクシー|TAXI|Taxi|迎車|運賃|乗務員|車番)/],
  ['Train / bus', /(JR|鉄道|乗車券|きっぷ|切符|Suica|PASMO|ICOCA|駅|バス|運輸)/],
  ['Parking / fuel', /(駐車|パーキング|コインパ|ガソリン|給油|レギュラー|軽油)/],
  ['Food', /(飲食|食堂|レストラン|カフェ|CAFE|Cafe|珈琲|コーヒー|ラーメン|弁当|寿司|そば|うどん|居酒屋|定食|ランチ|飲料|おにぎり|パン|サンド|お茶|ドリンク|ケータリング|軽減税率|8%)/],
  ['Consumables (tape, batteries)', /(テープ|電池|乾電池|バッテリー|ハンズ|ホームセンター|カインズ|コーナン|ロフト|文具|ガムテ|養生)/],
  ['Gear / tools', /(機材|レンズ|ケーブル|SDカード|SSD|工具|三脚|フィルター|マップカメラ)/],
  ['Phone / internet', /(携帯|通信|docomo|ドコモ|ソフトバンク|SoftBank|楽天モバイル|Wi-?Fi)/i],
];

function looksLikeWords(s) {
  if (/[©®@<>{}\[\]|\\]/.test(s)) return false;
  const cjk = (s.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) || []).length;
  if (cjk >= 2) return cjk >= s.replace(/\s/g, '').length * 0.5;
  // Latin: real words, mostly letters, not random mixed case
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z&'.-]{3,}$/.test(w));
  return words.length >= 1 && words.join('').length >= s.replace(/\s/g, '').length * 0.7 && !/[a-z][A-Z]/.test(s);
}

export function findVendor(text, lines) {
  for (const [re, name] of SHOPS) { const m = text.match(re); if (m) return name || m[1]; }
  const SKIP = /(領\s*収|レシート|RECEIPT|Receipt|様|但し|お預|合計|小計|TEL|電話|〒|登録番号|事業者|\d{4}[年/.-]|^[\d\s,.:¥円*#-]+$)/;
  for (const ln of lines.slice(0, 8)) {
    const s = ln.replace(/[*＊"'_~=]+/g, '').trim();
    if (s.length < 2 || s.length > 28 || SKIP.test(s)) continue;
    if (looksLikeWords(s)) return s;
  }
  return '';
}

export function guessCategory(text) {
  for (const [re, , cat] of SHOPS) if (re.test(text)) return cat;
  for (const [c, re] of CATS) if (re.test(text)) return c;
  return '';
}

// ---------- line items ----------
const ITEM_CATS = [
  ['Consumables (tape, batteries)', /(電池|乾電池|バッテリー|テープ|ガムテ|養生|マスキング|ビニール|ゴミ袋|軍手|手袋|マジック|ペン|マーカー|ボールペン|ノート|付箋|ハサミ|カッター|結束|タイ|ティッシュ|ウェット|除菌|マスク|カイロ|カッパ|雨具|傘|絆創膏|クリップ|輪ゴム|BATTERY|Battery|TAPE|Tape)/],
  ['Gear / tools', /(SDカード|SD\b|SSD|USB|ケーブル|充電器|モバイルバッテリー|レンズ|フィルター|三脚|工具|ドライバー|六角|アダプタ|変換)/i],
  ['Taxi', /(運賃|迎車|タクシー)/],
  ['Parking / fuel', /(駐車|レギュラー|ハイオク|軽油|ガソリン)/],
  ['Food', /(おにぎり|むすび|弁当|サンド|パン|ロール|スティック|サラダ|ラーメン|麺|そば|うどん|パスタ|寿司|チキン|から揚|唐揚|からあげ|肉|焼|魚|鮭|ツナ|明太|梅|昆布|卵|玉子|たまご|チーズ|ヨーグルト|菓子|チョコ|グミ|ガム|飴|アイス|コーヒー|珈琲|カフェ|ラテ|茶|水|ウォーター|ジュース|コーラ|ソーダ|飲料|ドリンク|牛乳|ミルク|ビール|酒|スープ|味噌|カップ|フランク|ホット|プリン|ゼリー|バナナ|フルーツ|野菜|ポテト|ナゲット|バーガー|定食|丼|カレー|餃子|ピザ|ケーキ|ドーナツ|Latte|latte|Coffee|coffee|Tea|tea|Water|water|Sandwich|Scone|scone|Cake|Muffin|Juice|Burger|Fries)/],
];
const STOP = /(小\s*計|合\s*計|お\s*会\s*計|総\s*計|TOTAL|Total|Subtotal|SUBTOTAL)/;
const NOT_ITEM = /(TEL|電\s*話|登録番号|事業者|レジ|責\s*No|No\s*\.|領\s*収|レシート|RECEIPT|様|\d{4}\s*[年/.-]|\d{1,2}:\d{2}|店$|〒|Date|DATE|担当)/;

/** Lines like "おにぎり 鮭 ¥160" or "※お茶 500ml 140" above the subtotal. */
export function extractItems(lines) {
  const items = [];
  for (const ln of lines) {
    if (STOP.test(ln)) break;
    if (NOT_ITEM.test(ln)) continue;
    const m = ln.match(/^(.*?[\p{L}].*?)\s*(-)?\s*¥?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(円)?\s*([※*軽]?)\s*$/u);
    if (!m) continue;
    let [, name, minus, num, , mark] = m;
    const reduced = /[※*軽◎]/.test(name) || !!mark;
    name = name.replace(/^[※*軽◆●◎・\s]+/, '').replace(/[@×xX]\s*\d+.*$/, '').trim();
    const letters = (name.match(/[\p{L}]/gu) || []).length;
    if (letters < 2 || name.length > 40) continue;
    let amount = toNum(num);
    if (minus || /(値引|割引|クーポン|DISCOUNT)/i.test(name)) amount = -Math.abs(amount);
    if (Math.abs(amount) < 1 || Math.abs(amount) > 200000) continue;
    items.push({ name, amount, reduced });
  }
  return items;
}

export function itemCategory(it, fallback) {
  for (const [c, re] of ITEM_CATS) if (re.test(it.name)) return c;
  if (it.reduced) return 'Food'; // 8% reduced-rate mark = food & drink in Japan
  return fallback || 'Other';
}

/** Spend per category, scaled to the receipt total (item prices are often before tax). */
export function breakdown(items, total, fallback) {
  const by = new Map();
  const raw = items.reduce((a, it) => a + it.amount, 0);
  // prices before tax? add 8% to food (reduced rate) and 10% to everything else
  const preTax = total && raw > 0 && total / raw > 1.04 && total / raw < 1.12;
  for (const it of items) {
    const c = (it.category = it.category || itemCategory(it, fallback));
    const v = preTax ? it.amount * (it.reduced || c === 'Food' ? 1.08 : 1.1) : it.amount;
    by.set(c, (by.get(c) || 0) + v);
  }
  const sum = [...by.values()].reduce((a, b) => a + b, 0);
  const k = total && sum > 0 && total / sum > 0.8 && total / sum < 1.35 ? total / sum : 1;
  let parts = [...by].filter(([, v]) => v > 0).map(([category, v]) => ({ category, amount: Math.round(v * k) }));
  if (total && k !== 1 && parts.length) { // make the parts add up exactly
    const diff = total - parts.reduce((a, p) => a + p.amount, 0);
    parts.sort((a, b) => b.amount - a.amount)[0].amount += diff;
  }
  return parts.sort((a, b) => b.amount - a.amount);
}

export function parseReceipt(raw, today) {
  const text = normalize(raw);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amounts = findAmounts(lines);
  const dates = findDates(text, today);
  const best = amounts[0];
  const amount = best && best.s >= 1 ? best.v : null;
  const shopCat = guessCategory(text);
  const items = extractItems(lines);
  const parts = items.length ? breakdown(items, amount, shopCat) : [];
  return {
    items, parts,
    amount,
    amountSure: !!best && best.s >= 7,
    amountOptions: amounts.filter((a) => a.s >= 1).slice(0, 6).map((a) => a.v),
    date: dates[0] || null,
    dateOptions: dates.slice(0, 4),
    vendor: findVendor(text, lines),
    category: parts[0]?.category || shopCat,
  };
}

// ---------- finding the receipt in the photo ----------
/**
 * rgba: Uint8ClampedArray of a small copy of the photo (w × h).
 * Returns the receipt's box as fractions {x, y, w, h}, or null if it fills the photo already.
 * Receipt paper = bright, low colour. We take the biggest bright band in each direction.
 */
export function paperBox(rgba, w, h) {
  const rows = new Float32Array(h), cols = new Float32Array(w);
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 150 && mx - mn < 50) { rows[y]++; cols[x]++; total++; }
  }
  if (total < w * h * 0.03) return null;
  const band = (arr, n) => {
    const mx = Math.max(...arr); const th = mx * 0.25;
    let best = [0, 0], s = -1;
    for (let i = 0; i < n; i++) {
      if (arr[i] >= th) { if (s < 0) s = i; if (i - s > best[1] - best[0]) best = [s, i]; }
      else if (s >= 0 && !(arr[i + 1] >= th || arr[i + 2] >= th)) s = -1; // allow 1-2px gaps
    }
    return best;
  };
  const [y0, y1] = band(rows, h), [x0, x1] = band(cols, w);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw * bh > w * h * 0.85 || bw < w * 0.08 || bh < h * 0.15) return null;
  const mx = bw * 0.04, my = bh * 0.02;
  const X0 = Math.max(0, x0 - mx), Y0 = Math.max(0, y0 - my), X1 = Math.min(w, x1 + 1 + mx), Y1 = Math.min(h, y1 + 1 + my);
  return { x: X0 / w, y: Y0 / h, w: (X1 - X0) / w, h: (Y1 - Y0) / h };
}
