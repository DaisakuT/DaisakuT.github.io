// keywords.txt の上から1つキーワードを取り、
// data/posts.json の中から関連する「自分の実体験」を拾い集めて、
// それを織り込んだ記事を1本書き出します。
//
// 使い方: GEMINI_API_KEY=xxxx node scripts/generate.mjs

import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
const POSTS_FILE = process.env.POSTS_FILE || "data/posts.json";
const KEYWORDS_FILE = process.env.KEYWORDS_FILE || "keywords.txt";
const STATE_FILE = process.env.STATE_FILE || "data/state.json";
const CONTENT_DIR = process.env.CONTENT_DIR || "src/content/blog";
const MAX_REFS = Number(process.env.MAX_REFS || 14); // 1記事に渡す体験メモの上限
const MIN_REFS = Number(process.env.MIN_REFS || 3); // これ未満なら書かずに次のキーワードへ
const SITE_AUTHOR = process.env.SITE_AUTHOR || "鹿児島在住のブログ運営者";

if (!API_KEY) {
  console.error("GEMINI_API_KEY が設定されていません。リポジトリの Settings → Secrets から登録してください。");
  process.exit(1);
}

const read = (f, fallback) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : fallback);
const posts = JSON.parse(read(POSTS_FILE, "[]"));
const state = JSON.parse(read(STATE_FILE, '{"done":[],"skipped":[]}'));

if (!posts.length) {
  console.log("投稿データが空です。data/raw/ にSNSのエクスポート（JSON）を置いてください。");
  process.exit(0);
}

// --- キーワードを読む -------------------------------------------------------
const keywords = read(KEYWORDS_FILE, "")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((line) => {
    const [keyword, category = "", related = ""] = line.split("|").map((s) => s.trim());
    return {
      keyword,
      category,
      terms: [...new Set([...keyword.split(/\s+/), ...related.split(",")].map((t) => t.trim()).filter(Boolean))],
    };
  });

const doneKeywords = new Set([...state.done, ...state.skipped].map((d) => d.keyword));

// --- 関連する体験を探す -----------------------------------------------------
function findExperiences(entry) {
  return posts
    .map((p) => {
      let score = 0;
      for (const term of entry.terms) {
        if (term.length < 2) continue;
        const hits = p.text.split(term).length - 1;
        if (hits) score += Math.min(hits, 3) * (term.length >= 3 ? 2 : 1);
      }
      // 短すぎる投稿より、ある程度書き込まれた投稿を優先
      if (p.text.length > 120) score += 1;
      return { ...p, score };
    })
    .filter((p) => p.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_REFS)
    .sort((a, b) => (a.date < b.date ? -1 : 1)); // 時系列に並べ直す
}

let target = null;
let refs = [];
for (const entry of keywords) {
  if (doneKeywords.has(entry.keyword)) continue;
  const found = findExperiences(entry);
  if (found.length < MIN_REFS) {
    console.log(`スキップ: 「${entry.keyword}」に紐づく体験が ${found.length} 件しかありません`);
    state.skipped.push({ keyword: entry.keyword, reason: "体験不足", found: found.length });
    continue;
  }
  target = entry;
  refs = found;
  break;
}

if (!target) {
  console.log("書けるキーワードが残っていません。keywords.txt に追加してください。");
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), "utf8");
  process.exit(0);
}

console.log(`キーワード: ${target.keyword}`);
console.log(`参照する自分の投稿: ${refs.length} 件`);

// --- 使うモデルの候補を並べる ------------------------------------------------
// 混雑（503）に備えて、第1候補がだめなら次のモデルへ自動で切り替えます。
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

async function pickModels() {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL, ...FALLBACK_MODELS];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const { models = [] } = await res.json();
    const all = models
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => n.includes("flash") && !/(image|tts|embedding|live|audio|preview|exp)/.test(n));

    const ver = (s) => parseFloat((s.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const heavy = all.filter((n) => !n.includes("lite")).sort((a, b) => ver(b) - ver(a));
    const lite = all.filter((n) => n.includes("lite")).sort((a, b) => ver(b) - ver(a));

    // 通常版を新しい順 → それでもだめなら軽量版（混雑しにくい）
    const ordered = [...heavy, ...lite];
    if (ordered.length) return ordered.slice(0, 4);
  } catch {
    /* noop */
  }
  return FALLBACK_MODELS;
}

// --- プロンプト -------------------------------------------------------------
const experienceBlock = refs
  .map((r) => `- [${r.date} / ${r.platform}] ${r.text.replace(/\n/g, " ")}`)
  .join("\n");

const prompt = `あなたは、${SITE_AUTHOR}本人として記事を書きます。以下の「実体験メモ」は、この人が実際にSNSに投稿した記録です。

# 今回書く記事
メインキーワード: ${target.keyword}
カテゴリ: ${target.category}

# 実体験メモ（この人が実際に体験したこと）
${experienceBlock}

# 絶対に守ること
1. 実体験メモの内容を、記事の中に最低3箇所、具体的に織り込むこと。「実際に行ったときは〜」「私の場合は〜」のように、体験として書く。
2. 実体験メモに書かれていない固有名詞・店名・施設名・数値を、体験として書いてはいけない。捏造は厳禁。一般論として書く場合は「一般的には」と明示する。
3. URLや外部リンクを一切書かないこと。
4. 健康効果・医学的効果を断定しない（「必ず痩せる」「不眠が治る」などは禁止）。「日本一」「絶対」などの根拠のない最上級表現も使わない。
5. 絵文字は使わない。文体は「です・ます」。誠実、簡潔、誇張しない。数字は半角。

# 構成
- リード文: 結論ファーストで3〜5文。検索した人が知りたい答えを最初に出す。
- H2見出しを4〜6個。必要ならH3。各H2の直下は結論から書き、その後に理由・詳細。
- 比較・手順・選び方は表や箇条書きを使う。
- 「よくある質問」セクションを3〜5問。
- 最後に短いまとめ。
- 全体で2,500〜3,500字程度。水増ししない。

# 出力形式
次のキーのJSONのみを返すこと。前後に説明文やコードブロックの記号を付けない。
{
  "title": "SEOタイトル。32文字前後。キーワードを前方に置く",
  "description": "メタディスクリプション。120文字前後。結論と読む理由",
  "slug": "英小文字とハイフンのみのURLスラッグ",
  "body_markdown": "# は使わず、## から始まる記事本文のMarkdown"
}`;

// --- 生成 -------------------------------------------------------------------
const WAIT_UNIT = Number(process.env.WAIT_UNIT || 15000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sawBusy = false;
let lastError = null;

async function callModel(model, promptText = prompt, mode = "json") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 8192,
            ...(mode === "json" ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
    } catch (e) {
      sawBusy = true;
      lastError = `接続エラー: ${e.message}`;
      console.log(`  ${model}: 接続できません。${(WAIT_UNIT * attempt) / 1000}秒待ちます (${attempt}/3)`);
      await sleep(WAIT_UNIT * attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      sawBusy = true;
      lastError = `HTTP ${res.status}`;
      console.log(`  ${model}: ${res.status}（混雑）。${(WAIT_UNIT * attempt) / 1000}秒待ちます (${attempt}/3)`);
      await sleep(WAIT_UNIT * attempt);
      continue;
    }

    if (!res.ok) {
      lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      console.log(`  ${model}: 使えません（${lastError}）`);
      return null;
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) {
      lastError = "空の応答";
      console.log(`  ${model}: 空の応答が返りました`);
      return null;
    }
    if (mode === "text") return text;
    try {
      return JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
    } catch (e) {
      lastError = `応答をJSONとして読めませんでした: ${e.message}`;
      console.log(`  ${model}: 応答の形式が不正でした`);
      return null;
    }
  }
  console.log(`  ${model}: 混雑が続くため、次のモデルに切り替えます`);
  return null;
}

const models = await pickModels();
console.log(`モデル候補: ${models.join(" → ")}`);

let article = null;
let usedModel = null;
for (const m of models) {
  console.log(`${m} で書いてみます...`);
  article = await callModel(m);
  if (article) {
    usedModel = m;
    break;
  }
}

if (!article) {
  if (sawBusy) {
    console.log(`\nどのモデルも混雑していて書けませんでした（${lastError}）。`);
    console.log("Google側の一時的な混雑です。次回の実行で自動的に再挑戦します。");
    process.exit(0);
  }
  console.error(`\n記事を生成できませんでした: ${lastError}`);
  process.exit(1);
}

console.log(`書けました（使用モデル: ${usedModel}）`);

// --- 保存先のファイル名を先に決める -----------------------------------------
let slugBase = String(article.slug || target.keyword)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);
if (!slugBase) slugBase = `post-${Date.now()}`;

fs.mkdirSync(CONTENT_DIR, { recursive: true });
let outFile = path.join(CONTENT_DIR, `${slugBase}.md`);
let n = 2;
while (fs.existsSync(outFile)) {
  slugBase = `${slugBase}-${n++}`;
  outFile = path.join(CONTENT_DIR, `${slugBase}.md`);
}

// --- アイキャッチの図解（SVG）を作る -----------------------------------------
// 画像生成APIは使わず、同じ無料のテキストAIに図形データを書かせます。
// 実在の場所を写真らしく描かせないこと、配色をサイトに揃えることを条件にしています。
const HERO_DIR = process.env.HERO_DIR || "public/hero";

const heroPrompt = `次の記事の内容を表す、抽象的な図解をSVGで1つ作ってください。

記事タイトル: ${article.title}
記事の要約: ${article.description}
テーマ: ${target.keyword}

# 必ず守ること
- 出力は width/height を持たない <svg viewBox="0 0 1200 500"> から始め </svg> で終わること
- 使ってよい色はこの5つだけ: #F2F4F3(背景) #14495B(主役) #D9A227(強調) #CDD5D6(補助) #10171C(文字)
- 記事の構造（段階・比較・因果など）が一目で伝わる幾何学的な図にすること
- 写真のような描写、人物の顔、実在の店舗や施設の再現はしないこと
- グラデーション、影、透明度の多用はしないこと
- 文字を入れる場合は日本語で合計12文字以内、font-family="sans-serif" を指定すること
- script, image, foreignObject, 外部URLの参照は一切使わないこと

# 出力形式
SVGコードだけを返すこと。説明文もコードブロックの記号もJSONも付けないこと。`;

function sanitizeSvg(raw) {
  if (typeof raw !== "string") return null;
  let svg = raw.trim().replace(/^```(?:svg|xml|html)?|```$/g, "").trim();
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start === -1 || end === -1) return null;
  svg = svg.slice(start, end + 6);

  // 危険・不要な要素を落とす
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(image|foreignObject)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(image|foreignObject)\b[^>]*\/>/gi, "")
    .replace(/\son\w+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s(xlink:href|href)\s*=\s*(["'])\s*https?:[\s\S]*?\2/gi, "");

  if (!/viewBox\s*=/.test(svg)) return null;
  if (svg.length > 80000) return null;
  return svg;
}

// ここで何が起きても記事は必ず保存されるよう、全体をtry/catchで囲みます
let heroPath = null;
try {
  for (const m of [usedModel, ...models.filter((x) => x !== usedModel)]) {
    const raw = await callModel(m, heroPrompt, "text");
    const svg = raw && sanitizeSvg(raw);
    if (svg) {
      fs.mkdirSync(HERO_DIR, { recursive: true });
      const file = path.join(HERO_DIR, `${slugBase}.svg`);
      fs.writeFileSync(file, svg, "utf8");
      heroPath = `/hero/${slugBase}.svg`;
      console.log(`アイキャッチを作りました: ${file}`);
      break;
    }
    console.log("  図解がうまく作れませんでした。次のモデルで試します");
  }
} catch (e) {
  console.log(`アイキャッチの生成でエラーが出ました: ${e.message}`);
}
if (!heroPath) console.log("アイキャッチなしで進めます（記事は問題なく公開されます）");

// --- 後処理と保存 -----------------------------------------------------------
let body = String(article.body_markdown || "")
  .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // 外部リンクが混ざったら文字だけ残す
  .replace(/https?:\/\/\S+/g, "")
  .trim();

const esc = (s) => String(s).replace(/'/g, "''").replace(/\n/g, " ").trim();
const today = new Date().toISOString().slice(0, 10);
const frontmatter = `---
title: '${esc(article.title)}'
description: '${esc(article.description)}'
pubDate: '${today}'
sourceCount: ${refs.length}
sourceFrom: '${refs[0].date}'
sourceTo: '${refs.at(-1).date}'${heroPath ? `\nheroImage: '${heroPath}'` : ""}
---

`;

fs.writeFileSync(outFile, frontmatter + body + "\n", "utf8");

state.done.push({ keyword: target.keyword, slug: slugBase, date: today, refs: refs.length });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), "utf8");

console.log(`\n記事を書き出しました: ${outFile}`);
console.log(`タイトル: ${article.title}`);
console.log(`文字数: 約${body.length}字`);
