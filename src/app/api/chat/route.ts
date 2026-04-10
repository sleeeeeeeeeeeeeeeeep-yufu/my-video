import { NextRequest, NextResponse } from "next/server";
import currentEpisode from "../../../episode.json";

export async function POST(req: NextRequest) {
  const { messages, currentEpisodeState } = await req.json();

  // ペイロード軽量化: AIには必要最低限の情報だけを渡す
  const baseEpisode = currentEpisodeState ? {
    ...currentEpisodeState,
    videoSrc: undefined, // 巨大なURL等は不要
    meta: {
      ...currentEpisodeState.meta,
      fps: currentEpisodeState.meta?.fps || 30,
      durationInFrames: currentEpisodeState.meta?.durationInFrames || 1200,
    }
  } : currentEpisode;

  const systemPrompt = `
あなたはショート動画の編集AIアシスタントです。
ユーザーの指示を受けて、以下のepisode.jsonを編集して返してください。

【現在のepisode.json】
${JSON.stringify(baseEpisode, null, 2)}

【ルール】
1. ユーザーの指示に従ってepisode.jsonを編集する
2. 変更した箇所だけでなく、必ずepisode.json全体をJSONとして返す
3. 返答は必ず以下の形式にする：

REPLY:（ユーザーへの返答を日本語で1〜2文で書く）
JSON:（編集したepisode.json全体をここに書く）

4. JSON以外の説明文・マークダウン・コードブロックは一切含めない
5. segmentsのtypeは hook / normal / emphasis / fact / relief / conclusion のいずれかにする
6. animationは pop / reveal / instant のいずれかにする
7. seは dodon / quiz_correct / chan / pikon のいずれか、不要なら省略する
8. もしユーザーから「台本」が与えられた場合、以下のルールを厳守すること：
   - すでに解析済みの細かい segments (開始・終了タイミングがあるもの) が存在する場合は、そのタイミング構造を極力維持し、テキストだけを台本の正確な字句に修正・統合してください。むやみに統合してタイミングを破壊しないでください。
   - もしまだセグメントがほとんど無い（または初期状態）の場合は、台本から自然な区切り（1セグメントあたり3〜5秒）を推定し、新しく segments を生成してください。
`;

  console.log("--- Chat API Request ---");
  console.log("Messages count:", messages.length);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", errorText);
      return NextResponse.json({ error: "OpenAI API returned an error" }, { status: 500 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";

    console.log("--- AI Raw Content Start ---");
    console.log(raw);
    console.log("--- AI Raw Content End ---");

    const replyMatch = raw.match(/REPLY:([\s\S]*?)JSON:/);
    const jsonMatch = raw.match(/JSON:([\s\S]*)/);

    const reply = replyMatch ? replyMatch[1].trim() : "承知しました。";
    let episodeJson = null;

    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim().replace(/```json\n?|\n?```/g, "");
      try {
        episodeJson = JSON.parse(jsonStr);
        console.log("JSON parsing successful");
      } catch (e) {
        console.error("JSON parsing failed:", e);
        console.error("Target string was:", jsonStr);
      }
    } else {
      console.warn("No JSON match found in AI response");
    }

    return NextResponse.json({ reply, episodeJson });
  } catch (error) {
    console.error("Chat API Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
