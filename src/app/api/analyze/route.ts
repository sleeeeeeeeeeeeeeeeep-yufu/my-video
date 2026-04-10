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
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `analyze-${Date.now()}-${crypto.randomUUID()}.wav`);
    
    // 1. ArrayBuffer として読み込み、一時ファイルに保存
    const arrayBuffer = await audioFile.arrayBuffer();
    fs.writeFileSync(tempFilePath, new Uint8Array(arrayBuffer));

    try {
      // 2. Gemini File API へアップロード (audio/wav)
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: "audio/wav",
        displayName: "Analysis Audio",
      });

      const jobId = uploadResponse.file.name;

      // 3. ジョブIDを返す
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
