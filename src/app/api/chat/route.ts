import { NextRequest, NextResponse } from "next/server";
import currentEpisode from "../../../episode.json";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const systemPrompt = `
あなたはショート動画の編集AIアシスタントです。
ユーザーの指示を受けて、以下のepisode.jsonを編集して返してください。

【現在のepisode.json】
${JSON.stringify(currentEpisode, null, 2)}

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
`;

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

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";

  const replyMatch = raw.match(/REPLY:([\s\S]*?)JSON:/);
  const jsonMatch = raw.match(/JSON:([\s\S]*)/);

  const reply = replyMatch ? replyMatch[1].trim() : "承知しました。";
  let episodeJson = null;

  if (jsonMatch) {
    try {
      episodeJson = JSON.parse(jsonMatch[1].trim());
    } catch {
      episodeJson = null;
    }
  }

  return NextResponse.json({ reply, episodeJson });
}
