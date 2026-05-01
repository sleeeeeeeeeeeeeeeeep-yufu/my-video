import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export async function POST(req: NextRequest) {
  try {
    const { episodeJson } = await req.json();

    if (!episodeJson || typeof episodeJson !== "object") {
      return NextResponse.json({ error: "episodeJson is required" }, { status: 400 });
    }

    const filePath = resolve(process.cwd(), "src/episode.json");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(episodeJson, null, 2), { encoding: "utf8" });

    console.log(`[save-episode] Saved to ${filePath}`);
    return NextResponse.json({ ok: true, path: "src/episode.json" });
  } catch (error) {
    console.error("[save-episode] Error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
