import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { exec } from "node:child_process";

export async function POST(req: NextRequest) {
  try {
    const { timeline, videoPath } = await req.json();

    if (!Array.isArray(timeline)) {
      return NextResponse.json({ error: "timeline must be an array" }, { status: 400 });
    }

    const tmpDir = resolve(process.cwd(), "tmp");
    mkdirSync(tmpDir, { recursive: true });

    const filePath = resolve(tmpDir, "timeline.json");
    writeFileSync(filePath, JSON.stringify(timeline, null, 2), { encoding: "utf8" });

    console.log(`[save-timeline] Saved ${timeline.length} items to ${filePath}`);

    // timeline保存後、cut_base.mp4 を生成して public/ へコピー
    const inputVideo = videoPath || "public/test.mp4";
    const scriptPath = resolve(process.cwd(), "scripts/create-cut-base.mjs");
    const cmd = `node "${scriptPath}" "${inputVideo}"`;

    console.log(`[save-timeline] Launching: ${cmd}`);

    const cutBaseUrl: string | null = await new Promise((resolveP) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error("[save-timeline] create-cut-base error:", err.message);
          resolveP(null);
        } else {
          console.log("[save-timeline] create-cut-base stdout:", stdout.slice(0, 300));
          if (stderr) console.error("[save-timeline] create-cut-base stderr:", stderr.slice(0, 300));
          try {
            const timestamp = Date.now();
            const fileName = `cut_base_${timestamp}.mp4`;
            const src = resolve(process.cwd(), "tmp/cut_base.mp4");
            const dest = resolve(process.cwd(), `public/${fileName}`);
            copyFileSync(src, dest);
            console.log(`[save-timeline] Copied to ${dest}`);
            resolveP(`/${fileName}`);
          } catch (copyErr) {
            console.error("[save-timeline] copy error:", (copyErr as Error).message);
            resolveP(null);
          }
        }
      });
    });

    return NextResponse.json({ ok: true, cutBaseUrl });
  } catch (error) {
    console.error("[save-timeline] Error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
