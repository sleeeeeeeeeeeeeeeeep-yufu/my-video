import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { NextRequest, NextResponse } from "next/server";
import currentEpisode from "../../../../episode.json";

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

    const overlappingFillers = (fillers || []).filter(
      (f: any) => f.timestamp >= startSec && f.timestamp <= endSec
    );

    if (overlappingFillers.length === 0) {
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
      let lastStart = startSec;
      overlappingFillers.sort((a: any, b: any) => a.timestamp - b.timestamp);

      overlappingFillers.forEach((f: any) => {
        if (f.timestamp - lastStart > 0.5) {
          segments.push({
            id: currentId++,
            type: s.type || "normal",
            start: Math.round(lastStart * FPS),
            end: Math.round((f.timestamp - 0.1) * FPS),
            text: text,
            animation: "pop",
            position: "bottom",
            zoom: 1.0,
            se: "none",
          });
        }
        lastStart = f.timestamp + 0.3;
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
    const { jobId, videoUrl } = await req.json();

    if (!jobId || !videoUrl) {
      return NextResponse.json({ error: "jobId and videoUrl are required" }, { status: 400 });
    }

    // 1. Gemini File のステータスを確認
    const file = await fileManager.getFile(jobId);

    if (file.state === FileState.PROCESSING) {
      // 処理中ならクライアントに伝える
      return NextResponse.json({ status: "PROCESSING" });
    }

    if (file.state === FileState.FAILED) {
      // 失敗した場合はクリーンアップしてエラーを返す
      await fileManager.deleteFile(jobId).catch(() => {});
      return NextResponse.json({ status: "FAILED", error: "Gemini video processing failed." });
    }

    // 2. ACTIVE になったらモデルに解析させる
    if (file.state === FileState.ACTIVE) {
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

      // セグメントへ変換
      const newSegments = convertToSegments(analysisResult);

      const updatedEpisode = {
        ...currentEpisode,
        videoSrc: videoUrl,
        segments: newSegments,
        meta: {
          ...currentEpisode.meta,
          title: analysisResult.speech?.[0]?.text || currentEpisode.meta.title,
        }
      };

      // 3. 処理完了後、Gemini 上のファイルを削除してクリーンアップ
      await fileManager.deleteFile(jobId).catch((err) => console.error("Failed to delete file:", err));

      return NextResponse.json({
        status: "COMPLETED",
        analysis: analysisResult,
        episodeJson: updatedEpisode
      });
    }

    return NextResponse.json({ status: "UNKNOWN" });

  } catch (error) {
    console.error("Analysis status error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
