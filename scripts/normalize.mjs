// data/raw/ に置いた X / Instagram / Facebook のエクスポートを読み込み、
// data/posts.json という1つのファイルにまとめます。
//
// 使い方: node scripts/normalize.mjs
// 3媒体のZIPを展開したフォルダを、まるごと data/raw/ に入れておけばOKです。
// フォルダ構成は気にしなくて大丈夫です（中を再帰的に探します）。

import fs from "node:fs";
import path from "node:path";

const RAW_DIR = process.env.RAW_DIR || "data/raw";
const OUT_FILE = process.env.POSTS_FILE || "data/posts.json";
const MIN_LENGTH = Number(process.env.MIN_LENGTH || 25); // これより短い投稿は素材にしない

// ---------------------------------------------------------------------------
// Meta（Instagram / Facebook）のJSONエクスポートは日本語が文字化けした状態で
// 出力されます（UTF-8をLatin-1として書き出している）。ここで元に戻します。
// ---------------------------------------------------------------------------
function fixMojibake(str) {
  if (typeof str !== "string" || !str) return str;
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(str)) return str; // 化けていなければ触らない
  try {
    const fixed = Buffer.from(str, "latin1").toString("utf8");
    // 変換後に日本語が現れたら成功とみなす
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(fixed)) return fixed;
  } catch {
    /* noop */
  }
  return str;
}

function cleanText(str) {
  if (typeof str !== "string") return "";
  return fixMojibake(str)
    .replace(/https?:\/\/\S+/g, "") // URLは素材として不要
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(json|js)$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

// X のアーカイブは `window.YTD.tweets.part0 = [...]` という形式のJSファイル
function parseFile(file) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".js")) {
    const eq = text.indexOf("=");
    if (eq === -1) return null;
    try {
      return JSON.parse(text.slice(eq + 1));
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toISO(value) {
  if (typeof value === "number") {
    // Metaのエクスポートは秒単位のUNIX時刻
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

const posts = [];
const seen = new Set();

function push(platform, date, text, id) {
  const body = cleanText(text);
  if (!date || body.length < MIN_LENGTH) return;
  if (/^(RT @|@)/.test(body)) return; // リツイート・リプライは除外
  const key = id || `${platform}:${date}:${body.slice(0, 40)}`;
  if (seen.has(key)) return;
  seen.add(key);
  posts.push({ id: key, platform, date, text: body });
}

// --- 各媒体の形を判定して取り込む -------------------------------------------
function ingest(data, file) {
  if (!Array.isArray(data)) {
    // Facebookは {"your_posts_...": [...]} の形で来ることがある
    if (data && typeof data === "object") {
      for (const v of Object.values(data)) if (Array.isArray(v)) ingest(v, file);
    }
    return;
  }

  for (const item of data) {
    if (!item || typeof item !== "object") continue;

    // --- X（ツイート）---
    const tweet = item.tweet || (item.full_text || item.text ? item : null);
    if (tweet && (tweet.full_text || tweet.text) && tweet.created_at) {
      push("X", toISO(tweet.created_at), tweet.full_text || tweet.text, `x:${tweet.id_str || ""}`);
      continue;
    }

    // --- Facebook（投稿）---
    if (Array.isArray(item.data) && item.timestamp !== undefined) {
      const body = item.data.map((d) => d?.post).filter(Boolean).join("\n");
      push("Facebook", toISO(item.timestamp), body || item.title || "", null);
      continue;
    }

    // --- Instagram（投稿・リール）---
    if (item.media || item.creation_timestamp !== undefined) {
      const ts =
        item.creation_timestamp ??
        (Array.isArray(item.media) ? item.media[0]?.creation_timestamp : undefined);
      const caption =
        item.title ||
        (Array.isArray(item.media) ? item.media.map((m) => m?.title).filter(Boolean).join("\n") : "");
      push("Instagram", toISO(ts), caption, null);
      continue;
    }
  }
}

// --- 実行 -------------------------------------------------------------------
if (!fs.existsSync(RAW_DIR)) {
  console.log(`${RAW_DIR} がまだありません。SNSのエクスポートを置いてから、もう一度実行してください。`);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, "[]", "utf8");
  process.exit(0);
}

const files = walk(RAW_DIR);
console.log(`${files.length} 個のファイルを検査します...`);

for (const f of files) {
  const data = parseFile(f);
  if (data) ingest(data, f);
}

posts.sort((a, b) => (a.date < b.date ? 1 : -1)); // 新しい順

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 1), "utf8");

const byPlatform = posts.reduce((acc, p) => {
  acc[p.platform] = (acc[p.platform] || 0) + 1;
  return acc;
}, {});

console.log(`\n記事の素材として使える投稿: ${posts.length} 件`);
for (const [k, v] of Object.entries(byPlatform)) console.log(`  ${k}: ${v} 件`);
if (posts.length) console.log(`  期間: ${posts.at(-1).date} 〜 ${posts[0].date}`);
console.log(`\n→ ${OUT_FILE} に保存しました。`);
