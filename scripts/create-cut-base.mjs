/**
 * create-cut-base.mjs
 *
 * ローカル検証用: tmp/timeline.json + 元動画 → tmp/cut_base.mp4
 *
 * 使い方:
 *   node scripts/create-cut-base.mjs <元動画パス>
 *   node scripts/create-cut-base.mjs public/test.mp4
 *
 * 前提:
 *   - tmp/timeline.json が存在する（analyze APIレスポンスから手動保存）
 *   - timeline の単位は 30fps フレーム
 *   - ffmpeg がPATHに存在する
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, createWriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const TMP = join(ROOT, "tmp");
const TIMELINE_PATH = join(TMP, "timeline.json");
const CONCAT_LIST = join(TMP, "concat_list.txt");
const OUTPUT = join(TMP, "cut_base.mp4");
const FPS = 30;

// --- 引数チェック ---
const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: node scripts/create-cut-base.mjs <input_video_path>");
  process.exit(1);
}

// --- http(s) URL の場合は tmp/input.mp4 にダウンロード ---
async function resolveInputVideo(arg) {
  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    mkdirSync(TMP, { recursive: true });
    const dest = join(TMP, "input.mp4");
    console.log(`[download] ${arg} → ${dest}`);
    await new Promise((res, rej) => {
      const getter = arg.startsWith("https://") ? httpsGet : httpGet;
      const file = createWriteStream(dest);
      getter(arg, (response) => {
        if (response.statusCode !== 200) {
          rej(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => { file.close(); res(); });
        file.on("error", rej);
      }).on("error", rej);
    });
    console.log(`[download] Done: ${dest}`);
    return dest;
  }
  // ローカルパス: 既存処理のまま
  const local = resolve(ROOT, arg);
  if (!existsSync(local)) {
    console.error(`Input video not found: ${local}`);
    process.exit(1);
  }
  return local;
}

const INPUT_VIDEO = await resolveInputVideo(inputArg);

if (!existsSync(TIMELINE_PATH)) {
  console.error(`timeline.json not found: ${TIMELINE_PATH}`);
  process.exit(1);
}

// --- timeline 読み込み ---
const timeline = JSON.parse(readFileSync(TIMELINE_PATH, "utf8"));
if (!Array.isArray(timeline) || timeline.length === 0) {
  console.error("timeline.json is empty or invalid.");
  process.exit(1);
}
console.log(`Timeline loaded: ${timeline.length} segments`);

// --- tmp/ 準備: 既存 seg_*.mp4 を削除 ---
mkdirSync(TMP, { recursive: true });
const existingSegs = timeline.map((_, i) => join(TMP, `seg_${i}.mp4`));
existingSegs.forEach((f) => {
  if (existsSync(f)) {
    rmSync(f);
    console.log(`Removed: ${f}`);
  }
});
if (existsSync(CONCAT_LIST)) rmSync(CONCAT_LIST);
if (existsSync(OUTPUT)) rmSync(OUTPUT);

// --- 各区間を再エンコード抽出 ---
const segPaths = [];
timeline.forEach((item, i) => {
  const ss = item.originalStart / FPS;
  const t  = item.duration / FPS;
  const out = join(TMP, `seg_${i}.mp4`);

  console.log(`[${i + 1}/${timeline.length}] ss=${ss.toFixed(3)}s  duration=${t.toFixed(3)}s → seg_${i}.mp4`);

  const cmd = [
    "ffmpeg",
    "-y",
    `-ss ${ss}`,
    `-i "${INPUT_VIDEO}"`,
    `-t ${t}`,
    "-vf scale=1080:1920:flags=lanczos",
    "-c:v libx264 -preset veryfast -crf 18",
    "-c:a aac -b:a 192k",
    "-movflags +faststart",
    `"${out}"`,
  ].join(" ");

  execSync(cmd, { stdio: "inherit" });
  segPaths.push(out);
});

// --- concat_list.txt 作成 (ASCII/UTF-8互換) ---
const listContent = segPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
writeFileSync(CONCAT_LIST, listContent, { encoding: "utf8" });
console.log(`\nconcat_list.txt written (${segPaths.length} entries)`);

// --- concat → cut_base.mp4 ---
console.log("\nConcatenating segments...");
const concatCmd = [
  "ffmpeg",
  "-y",
  "-f concat",
  "-safe 0",
  `-i "${CONCAT_LIST}"`,
  "-c copy",
  `"${OUTPUT}"`,
].join(" ");

execSync(concatCmd, { stdio: "inherit" });

console.log(`\nDone: ${OUTPUT}`);
