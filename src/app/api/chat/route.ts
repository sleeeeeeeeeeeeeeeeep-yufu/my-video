import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { messages, currentEpisodeState, isPartial, target = "all" } = await req.json();

  if (isPartial) {
    // ---- 【ルールベース台本割り当てモード (GPT不要, 即時実行)】 ----
    const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
    const scriptMatch = lastUserMessage?.content?.match(/【台本】\n([\s\S]+)/);
    const scriptText = scriptMatch ? scriptMatch[1].trim() : "";

    if (!scriptText) {
      return NextResponse.json({ error: "台本テキストが見つかりませんでした。" }, { status: 400 });
    }

    // 不要な記号（マークダウン記号、バックスラッシュ等）を除去。絵文字は維持
    const cleanedScript = scriptText.replace(/[*#_~`\\]/g, "");

    // 改行、句読点、感嘆符などでテキストを分割
    const rawPhrases = cleanedScript.replace(/([。！？\n]+)/g, "$1|").split('|');
    const phrases = rawPhrases
      .map((p: string) => p.trim())
      .filter((p: string) => {
        if (p.length === 0) return false;
        // 先頭または全体が「インスタキャプション」を含む場合は除外
        if (p.includes("インスタキャプション")) return false;
        // 棒線やハイフンだけのフレーズを除外
        if (/^[ー\-─\s]+$/.test(p)) return false;
        return true;
      });

    const oldSegments = currentEpisodeState?.segments || [];
    if (oldSegments.length === 0) {
      return NextResponse.json({ error: "既存の字幕データがありません。先に動画を解析してください。" }, { status: 400 });
    }

    // 全体の開始・終了時間を取得
    const minStart = Math.min(...oldSegments.map((s: any) => s.start));
    const maxEnd = Math.max(...oldSegments.map((s: any) => s.end));
    const totalTime = Math.max(maxEnd - minStart, 1);
    const totalLength = phrases.reduce((sum: number, p: string) => sum + p.length, 0);

    let currentStart = minStart;
    const newSegments = phrases.map((phrase: string, idx: number) => {
      // 文字数に応じて時間を比例配分
      const duration = totalLength === 0 ? (totalTime / phrases.length) : (phrase.length / totalLength) * totalTime;
      const end = currentStart + duration;

      let type = "normal";
      let animation = "pop";
      let se: string | undefined = undefined;

      if (idx === 0) {
        type = "hook"; animation = "pop"; se = "pikon";
      } else if (idx === phrases.length - 1) {
        type = "conclusion"; animation = "reveal";
      } else if (idx % 10 === 0) {
        type = "emphasis"; se = "chan";
      }

      const seg = {
        id: idx + 1,
        type,
        start: Math.round(currentStart),
        end: Math.round(end),
        text: phrase,
        animation,
        position: "bottom",
        zoom: 1.0,
        se
      };
      currentStart = end;
      return seg;
    });

    console.log(`--- Rule-based Script Processed [Phrases: ${phrases.length}] ---`);
    return NextResponse.json({
      reply: `台本を ${phrases.length} 個のフレーズに分割し、タイミングを割り当てました！`,
      episodeJson: newSegments
    });
  }

  // ペイロード軽量化: AIには必要最低限の情報だけを渡す
  const simplifySegments = (sw: any[], minimal: boolean = false) => (sw || []).map(s => {
    if (minimal) {
      return { id: s.id, start: s.start, end: s.end };
    }
    return {
      id: s.id,
      type: s.type,
      start: s.start,
      end: s.end,
      text: s.text,
      animation: s.animation,
      color: s.color,
      se: s.se
    };
  });

  let baseEpisode: any = {};
  let systemPrompt = "";

  if (target === "segments" || isPartial) {
    // 【字幕修正・台本流し込みモード】
    baseEpisode = { segments: simplifySegments(currentEpisodeState?.segments || [], !!isPartial) };
    systemPrompt = `あなたは動画の字幕編集アシスタントです。
指示された「台本」のテキストを、提供された「既存のタイミング枠」のすべてのIDに対し、順番通りに配分してください。

【既存のタイミング枠】
${JSON.stringify(baseEpisode.segments)}

【重要ルール】
1. 既存の id, start, end は一文字も変更しないでください。
2. 入力された「既存のタイミング枠」に含まれる **すべての ID (例: 1番から最後のリクエスト分まで)** について、必ずテキストを割り当てて返してください。
    - **途中で中断したり、一部だけ返したりすることは絶対に禁止します。**
3. 返答は必ず以下の形式にする：
REPLY:（要約）
JSON:（修正後の 【全件揃った】 segments 配列のみを出力。例: [ {"id":1, ...}, {"id":2, ...}, ... ]）

4. JSON以外の説明文・コードブロックは一切含めない。`;
  } else if (target === "metadata") {
    // 【テーマ・設定変更モード】
    baseEpisode = {
      theme: currentEpisodeState?.theme,
      meta: currentEpisodeState?.meta,
      fixedTitle: currentEpisodeState?.fixedTitle
    };
    systemPrompt = `あなたは動画のテーマ編集アシスタントです。
指示に基づき、動画全体の設定（theme, meta, title）を修正してください。

【現在の設定】
${JSON.stringify(baseEpisode)}

【ルール】
1. テロップの色(color)、フォント、タイトルの内容などを指示に従って変更してください。
2. 返答は必ず以下の形式にする：
REPLY:（変更内容の要約を1文で）
JSON:（修正後のオブジェクトのみを出力。変更したキーのみを含めても良い。例: {"theme": {"color": "red"}} ）

3. JSON以外の説明文・コードブロックは一切含めない。`;
  } else {
    // 【全体編集モード】
    baseEpisode = {
      ...currentEpisodeState,
      segments: simplifySegments(currentEpisodeState?.segments || [], false),
      videoSrc: undefined
    };
    systemPrompt = `あなたは動画の総合編集アシスタントです。
episode.json 全体を必要に応じて編集してください。

【現在のデータ】
${JSON.stringify(baseEpisode)}

【ルール】
1. 字幕とテーマの両方を指示通りに一括修正してください。
2. 返答は必ず以下の形式にする：
REPLY:（変更箇所の要約）
JSON:（編集後の episode.json オブジェクト全体を出力）

3. JSON以外の説明文・省略は厳禁です。`;
  }

  console.log(`--- Chat API Logic [Target: ${target}] ---`);
  console.log("Prompt Length:", systemPrompt.length);

  try {
    const isScriptMode = isPartial || target === "segments";
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
        temperature: isScriptMode ? 0 : 0.7,
        max_tokens: isScriptMode ? 2000 : undefined,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("!!! OpenAI API Error !!!");
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Body: ${errorText}`);
      return NextResponse.json({ error: "OpenAI API returned an error", details: errorText }, { status: response.status });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";

    console.log("--- AI Raw Content Response ---");
    // 省略して出力（デバッグ用）
    console.log(raw.slice(0, 500) + (raw.length > 500 ? "..." : ""));

    const replyMatch = raw.match(/REPLY:([\s\S]*?)JSON:/);
    const jsonMatch = raw.match(/JSON:([\s\S]*)/);

    const reply = replyMatch ? replyMatch[1].trim() : "承知しました。";
    let episodeJson = null;

    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim().replace(/```json\n?|\n?```/g, "");
      try {
        episodeJson = JSON.parse(jsonStr);
      } catch (e) {
        console.error("JSON parsing failed:", e);
      }
    }

    return NextResponse.json({ reply, episodeJson });
  } catch (error) {
    console.error("Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
