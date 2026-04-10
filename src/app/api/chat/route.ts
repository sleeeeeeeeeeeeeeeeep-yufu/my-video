import { NextRequest, NextResponse } from "next/server";
import currentEpisode from "../../../episode.json";

export async function POST(req: NextRequest) {
  const { messages, currentEpisodeState, isPartial } = await req.json();

  // ペイロード軽量化: AIには必要最低限の情報だけを渡す
  // isPartial が true の場合は台本作成モードとして、segments のみに絞り込む
  const baseEpisode = currentEpisodeState ? (isPartial ? {
    segments: currentEpisodeState.segments || [],
    meta: {
      title: currentEpisodeState.meta?.title || "",
    }
  } : {
    ...currentEpisodeState,
    videoSrc: undefined, // 巨大なURL等は不要
    meta: {
      ...currentEpisodeState.meta,
      fps: currentEpisodeState.meta?.fps || 30,
      durationInFrames: currentEpisodeState.meta?.durationInFrames || 1200,
    }
  }) : currentEpisode;

  const systemPrompt = isPartial ? `
あなたはショート動画の字幕編集アシスタントです。
指示された台本テキストを元に、現在の字幕（segments）を校正・生成してください。

【現在のsegments】
${JSON.stringify(baseEpisode.segments, null, 2)}

【ルール】
1. ユーザーから送られた「台本」に基づき、文字を正確な漢字や言い回しに修正してください。
2. もし既存のsegmentsにタイミング情報がある場合は、その構造を壊さずテキストだけをきれいに当てはめてください。
3. すべてのセグメントを一貫して修正してください。一部だけ修正して残りを省略することは絶対に禁止します。
4. 返答は必ず以下の形式にする：

REPLY:（修正内容の要約を1文で）
JSON:（修正後の segments 配列のみを出力。オブジェクトで囲まず [ ... ] の形式で出力すること）

5. JSON以外の説明文・コードブロックは一切含めない。
` : `
あなたはショート動画の編集AIアシスタントです。
ユーザーの指示を受けて、以下のepisode.jsonを編集して返してください。

【現在のepisode.json】
${JSON.stringify(baseEpisode, null, 2)}

【ルール】
1. ユーザーの指示に従ってepisode.jsonを編集する。
2. 指示が複数の箇所（例：すべてのテロップの色、すべてのアニメーションなど）に及ぶ場合は、必ずすべての対象項目を漏れなく一括で更新してください。「中略」や「一部修正」は絶対に禁止します。
3. 変更した箇所だけでなく、必ずepisode.json全体をJSONとして返す。
4. 常に最新のepisode.jsonデータを出力に含めてください。JSONがない返答は許可されません。
5. 返答は必ず以下の形式にする：

REPLY:（ユーザーへの返答を日本語で1〜2文で書く）
JSON:（編集したepisode.json全体をここに書く）

6. JSON以外の説明文・マークダウン・コードブロックは一切含めない。
7. segmentsのtypeは hook / normal / emphasis / fact / relief / conclusion のいずれかにする。
8. animationは pop / reveal / instant のいずれかにする。
9. seは dodon / quiz_correct / chan / pikon のいずれか、不要なら省略する。
10. もしユーザーから「台本」が与えられた場合、タイミング構造を維持しつつテキストを台本通りに修正してください。
11. セグメント間に時間の重複がないように注意してください。
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
