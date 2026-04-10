import { GoogleAIFileManager } from "@google/generative-ai/server";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// 環境変数チェック
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing in environment variables.");
}

const fileManager = new GoogleAIFileManager(apiKey);

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
    }

    const tempDir = os.tmpdir();
    // use timestamp to avoid collision entirely
    const tempFilePath = path.join(tempDir, `analyze-${Date.now()}-${crypto.randomUUID()}.mp4`);
    
    // 1. S3等から動画を一時ファイルとしてダウンロード
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video from URL: ${videoUrl}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFilePath, new Uint8Array(arrayBuffer));

    try {
      // 2. Gemini File API へアップロード
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: "video/mp4",
        displayName: "Analysis Video",
      });

      const jobId = uploadResponse.file.name;

      // 3. アップロード完了したら即座にIDを返す
      return NextResponse.json({ jobId });

    } finally {
      // ローカルの一時ファイルを削除
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

  } catch (error) {
    console.error("Analysis start error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
