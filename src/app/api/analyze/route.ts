import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import currentEpisode from "../../../episode.json";

const FPS = 30;

// 環境変数チェック
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing in environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * Geminiの解析結果をepisode.jsonのセグメント形式に変換する
 */
const convertToSegments = (analysisResult: any) => {
  const { speech, fillers } = analysisResult;
  if (!speech) return [];

  const segments: any[] = [];
  let currentId = 1;

  speech.forEach((s: any) => {
    let startSec = s.start;
    let endSec = s.end;
    let text = s.text;

    // フィラーが含まれているかチェックして、含まれていれば区間を調整するか分割する
    // 今回はシンプルに、フィラーと重なる発話区間をトリミング、またはフィラーを除外してマッピング
    const overlappingFillers = (fillers || []).filter(
      (f: any) => f.timestamp >= startSec && f.timestamp <= endSec
    );

    if (overlappingFillers.length === 0) {
      // 重なりがない場合はそのまま追加
      segments.push({
        id: currentId++,
        type: s.type || "normal",
        start: Math.round(startSec * FPS),
        end: Math.round(endSec * FPS),
        text: text,
        animation: s.animation || "pop",
        position: "bottom",
        zoom: 1.0,
        se: s.se || "none",
      });
    } else {
      // フィラーとの重なりがある場合: フィラーを境目としてセグメントを分割する
      let lastStart = startSec;
      overlappingFillers.sort((a: any, b: any) => a.timestamp - b.timestamp);

      overlappingFillers.forEach((f: any) => {
        if (f.timestamp - lastStart > 0.5) { // 0.5秒以上の間隔があればセグメント化
          segments.push({
            id: currentId++,
            type: s.type || "normal",
            start: Math.round(lastStart * FPS),
            end: Math.round((f.timestamp - 0.1) * FPS), // フィラーの直前まで
            text: text, // 文脈判断が難しいため同じテキストを入れる（AIに分割を任せるのが理想）
            animation: "pop",
            position: "bottom",
            zoom: 1.0,
            se: "none",
          });
        }
        lastStart = f.timestamp + 0.3; // フィラーの0.3秒後から再開
      });

      if (endSec - lastStart > 0.5) {
        segments.push({
          id: currentId++,
          type: s.type || "normal",
          start: Math.round(lastStart * FPS),
          end: Math.round(endSec * FPS),
          text: text,
          animation: "pop",
          position: "bottom",
          zoom: 1.0,
          se: "none",
        });
      }
    }
  });

  return segments;
};

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
    }

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `analyze-${crypto.randomUUID()}.mp4`);
    
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video from URL: ${videoUrl}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFilePath, new Uint8Array(arrayBuffer));

    try {
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: "video/mp4",
        displayName: "Analysis Video",
      });

      const name = uploadResponse.file.name;
      let file = await fileManager.getFile(name);
      while (file.state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        file = await fileManager.getFile(name);
      }

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const prompt = `
以下の動画を解析し、ショート動画の編集データ（segments）を生成してください。
返答は必ず純粋なJSON形式のみで行ってください。

解析・生成ルール：
1. 発話内容を書き起こし、3〜5秒程度の意味のある区切りのリスト（speech）にしてください。
2. speechごとに、動画の役割（hook / normal / emphasis / fact / relief / conclusion）を「type」として割り当ててください。
3. 無音区間 (silences) とフィラー (fillers: 「えー」「あのー」等) の正確な開始・終了秒数を特定してください。
4. textプロパティには、フィラーを除去した「きれいな日本語のテロップ用テキスト」を入れてください。
5. セグメントに合うアニメーション (animation: pop / reveal / instant) も提案してください。

期待するJSON構造：
{
  "silences": [{ "start": 秒, "end": 秒 }],
  "speech": [
    { "start": 秒, "end": 秒, "text": "テロップ内容", "type": "hook", "animation": "pop", "se": "pikon" }
  ],
  "fillers": [{ "timestamp": 秒, "text": "えー" }]
}
`;

      const result = await model.generateContent([
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri,
          },
        },
        { text: prompt },
      ]);

      const rawResponse = result.response.text();
      let analysisResult;
      try {
        const cleanedJson = rawResponse.replace(/```json\n?|\n?```/g, "").trim();
        analysisResult = JSON.parse(cleanedJson);
      } catch (e) {
        throw new Error("Gemini returned invalid JSON for analysis.");
      }

      // 解析結果をもとにセグメントを生成
      const newSegments = convertToSegments(analysisResult);

      // episode.json のベース構造を作成（動画URLを反映）
      const updatedEpisode = {
        ...currentEpisode,
        videoSrc: videoUrl,
        segments: newSegments,
        meta: {
          ...currentEpisode.meta,
          title: analysisResult.speech?.[0]?.text || currentEpisode.meta.title,
        }
      };

      await fileManager.deleteFile(name);

      return NextResponse.json({
        analysis: analysisResult,
        episodeJson: updatedEpisode
      });

    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
