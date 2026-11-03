// Turns OCR text from a receipt (Japanese or English) into { amount, date, vendor, category }.
// Pure function, no DOM. Every field is a best guess: the app shows them for you to check.

const FW = '０１２３４５６７８９';
export function normalize(t) {
  return String(t || '')
    .replace(/[０-９]/g, (c) => String(FW.indexOf(c)))
    .replace(/[￥¥]/g, '¥').replace(/\\(?=\s*\d)/g, '¥')
    .replace(/[，､]/g, ',').replace(/[．。](?=\d)/g, '.').replace(/：/g, ':').replace(/／/g, '/').replace(/－|ー(?=\d)/g, '-')
    .replace(/[ 　\t]+/g, ' ');
}

const toNum = (s) => Number(String(s).replace(/[,\s]/g, ''));
// numbers like 1,200 / 1200 / ¥1,200 / 1,200円 (OCR sometimes adds spaces inside)
const MONEY = /¥?\s*(\d{1,3}(?:[,\s]\d{3})+|\d{2,7})\s*(?:円|-)?/g;

const TOTAL_WORDS = /(合\s*計|お\s*会\s*計|総\s*計|ご?請\s*求|お?支\s*払|領収金額|お買上|TOTAL|Total|AMOUNT|料\s*金|運\s*賃|税込)/;
const NOT_TOTAL = /(お?預\s*り|釣|CHANGE|Change|CASH|現金\s*預|小\s*計|対象|内\s*税|消費税|税\s*率|ポイント|point|TEL|電話|登録番号|No\.|伝票)/i;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const v = toNum(m[1]);
    if (v >= 10 && v < 10000000) out.push(v);
  }
  return out;
}

export function findAmount(lines) {
  let best = null;
  lines.forEach((ln, i) => {
    if (!TOTAL_WORDS.test(ln) || NOT_TOTAL.test(ln.replace(TOTAL_WORDS, ''))) return;
    // number on the same line, or on the next line (some receipts wrap)
    let nums = amountsIn(ln.replace(/\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/g, ''));
    if (!nums.length && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) nums = amountsIn(lines[i + 1]);
    if (!nums.length) return;
    const v = Math.max(...nums);
    const strong = /(合\s*計|お\s*会\s*計|総\s*計|TOTAL|Total|領収金額)/.test(ln) ? 2 : 1;
    if (!best || strong > best.strong || (strong === best.strong && i > best.i)) best = { v, strong, i };
  });
  if (best) return { value: best.v, sure: best.strong === 2 };
  // fallback: biggest yen-looking amount that isn't change/cash given
  const all = lines.filter((l) => !NOT_TOTAL.test(l) && /¥|円/.test(l)).flatMap(amountsIn);
  return all.length ? { value: Math.max(...all), sure: false } : null;
}

const pad = (n) => String(n).padStart(2, '0');
function valid(y, m, d, today) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(y, m - 1, d);
  if (t.getMonth() !== m - 1) return null;
  const now = today ? new Date(today) : new Date();
  const diff = (t - now) / 86400000;
  if (diff > 7 || diff < -800) return null; // receipts are recent
  return s;
}
export function findDate(text, today) {
  const t = text;
  const tries = [
    [/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/, (m) => [m[1], m[2], m[3]]],
    [/(?:令和|R)\s*(\d{1,2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})/, (m) => [2018 + Number(m[1]), m[2], m[3]]],
    [/(20\d{2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})/, (m) => [m[1], m[2], m[3]]],
    [/(?<!\d)(\d{2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?!\d)/, (m) => [2000 + Number(m[1]), m[2], m[3]]],
    [/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/, (m) => [new Date(today || Date.now()).getFullYear(), m[1], m[2]]],
  ];
  for (const [re, pick] of tries) {
    const g = new RegExp(re.source, 'g');
    for (const m of t.matchAll(g)) {
      const [y, mo, d] = pick(m).map(Number);
      const v = valid(y, mo, d, today);
      if (v) return v;
    }
  }
  return null;
}

const CATS = [
  ['Taxi', /(タクシー|TAXI|Taxi|交通株式会社|迎車|運賃|日本交通|国際自動車|kmタクシー|GO\b|S\.RIDE|DiDi)/],
  ['Train / bus', /(JR|鉄道|乗車券|きっぷ|切符|Suica|PASMO|ICOCA|駅|バス|運輸|東京メトロ|小田急|京王|東急電鉄)/],
  ['Parking / fuel', /(駐車|パーキング|P\s*料金|コインパ|ガソリン|給油|ENEOS|出光|コスモ石油|昭和シェル|レギュラー|軽油)/],
  ['Food', /(飲食|食堂|レストラン|カフェ|CAFE|Cafe|珈琲|コーヒー|ラーメン|弁当|寿司|そば|うどん|居酒屋|定食|ランチ|セブン|ファミリーマート|ローソン|ミニストップ|デイリー|スターバックス|STARBUCKS|ドトール|タリーズ|マクドナルド|モスバーガー|吉野家|松屋|すき家|日高屋|ガスト|サイゼリヤ|コンビニ|飲料|おにぎり|パン|ケータリング)/],
  ['Consumables (tape, batteries)', /(テープ|電池|乾電池|バッテリー|ヨドバシ|ビックカメラ|ダイソー|セリア|ハンズ|ホームセンター|カインズ|コーナン|ロフト|文具|ガムテ|養生)/],
  ['Gear / tools', /(カメラ|機材|レンズ|ケーブル|SDカード|SSD|工具|三脚|フィルター|マップカメラ|フジヤカメラ)/],
  ['Phone / internet', /(携帯|通信|docomo|ドコモ|au\b|ソフトバンク|SoftBank|楽天モバイル|Wi-?Fi)/i],
];
const KNOWN = /(セブン-?イレブン|ファミリーマート|ローソン|スターバックス|ドトール|タリーズ|マクドナルド|吉野家|松屋|すき家|ヨドバシカメラ|ビックカメラ|ダイソー|ENEOS|日本交通|東京無線|JR東日本)/;

export function findVendor(lines) {
  const known = lines.join(' ').match(KNOWN);
  if (known) return known[1];
  const SKIP = /(領\s*収|レシート|RECEIPT|Receipt|様|但し|お預|合計|小計|TEL|電話|〒|登録番号|\d{4}[年/.-]|^\W*$|^[\d\s,.:¥円*#-]+$)/;
  for (const ln of lines.slice(0, 8)) {
    const s = ln.replace(/[*＊"'|_~=]+/g, '').trim();
    if (s.length < 2 || s.length > 28 || SKIP.test(s)) continue;
    if ((s.match(/[\p{L}]/gu) || []).length < Math.max(2, s.length * 0.5)) continue; // mostly letters/kana
    return s;
  }
  return '';
}

export function guessCategory(text) {
  for (const [c, re] of CATS) if (re.test(text)) return c;
  return '';
}

export function parseReceipt(raw, today) {
  const text = normalize(raw);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amt = findAmount(lines);
  return {
    amount: amt?.value || null,
    amountSure: !!amt?.sure,
    date: findDate(text, today),
    vendor: findVendor(lines),
    category: guessCategory(text),
  };
}
