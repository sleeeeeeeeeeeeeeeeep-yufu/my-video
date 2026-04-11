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
    const basePhrases = rawPhrases
      .map((p: string) => p.trim())
      .filter((p: string) => {
        if (p.length === 0) return false;
        if (p.includes("インスタキャプション")) return false;
        if (/^[ー\-─\s]+$/.test(p)) return false;
        return true;
      });

    // --- 【10文字分割ロジック】 ---
    const optimizedPhrases: string[] = [];
    basePhrases.forEach((p: string) => {
      if (p.length <= 10) {
        optimizedPhrases.push(p);
      } else {
        const subParts = p.split(/([。、！？…]+)/g).filter(Boolean);
        const joinedSubParts: string[] = [];
        for (let i = 0; i < subParts.length; i += 2) {
          joinedSubParts.push(subParts[i] + (subParts[i + 1] || ""));
        }

        joinedSubParts.forEach((sub: string) => {
          if (sub.length <= 10) {
            optimizedPhrases.push(sub);
          } else {
            for (let i = 0; i < sub.length; i += 10) {
              optimizedPhrases.push(sub.slice(i, i + 10));
            }
          }
        });
      }
    });

    const oldSegments = currentEpisodeState?.segments || [];
    if (oldSegments.length === 0) {
      return NextResponse.json({ error: "既存の字幕データがありません。先に動画を解析してください。" }, { status: 400 });
    }

    const minStart = Math.min(...oldSegments.map((s: any) => s.start));
    const maxEnd = Math.max(...oldSegments.map((s: any) => s.end));
    const totalTime = Math.max(maxEnd - minStart, 1);
    const totalLength = optimizedPhrases.reduce((sum: number, p: string) => sum + p.length, 0);

    let currentStart = minStart;
    const newSegments = optimizedPhrases.map((phrase: string, idx: number) => {
      const duration = totalLength === 0 ? (totalTime / optimizedPhrases.length) : (phrase.length / totalLength) * totalTime;
      const end = currentStart + duration;

      let type = "normal";
      let animation = "pop";
      let se: string | undefined = undefined;

      if (idx === 0) {
        type = "hook"; animation = "pop"; se = "pikon";
      } else if (idx === optimizedPhrases.length - 1) {
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

    console.log(`--- Rule-based Script Optimized [Phrases: ${optimizedPhrases.length}] ---`);
    return NextResponse.json({
      reply: `台本を ${optimizedPhrases.length} 個のフレーズに最適に分割し、タイミングを割り当てました！`,
      segments: newSegments,
      theme: null
    });
  }

  // --- GPT 処理モード (モードB / モードC) ---
  
  // ペイロード軽量化
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

  let systemPrompt = "";

  if (target === "metadata") {
    // 【テーマ変更モード】 (モードB)
    const baseEpisode = {
      theme: currentEpisodeState?.theme,
      fixedTitle: currentEpisodeState?.fixedTitle
    };
    systemPrompt = `あなたは動画のテーマ編集アシスタントです。
指示に基づき、動画の設定（theme）を修正してください。

【現在の設定】
${JSON.stringify(baseEpisode)}

【ルール】
1. テロップの色、フォントなどを指示に従って変更してください。
2. 返答は必ず以下の形式にする（JSON部分はコードブロックなし・プレーンテキストで）：
REPLY:（変更内容の要約を1文で）
JSON:（修正後の theme オブジェクトのみを出力。例: {"mainTextColor": "#FF0000"}）

3. JSON以外の説明文・コードブロックは一切含めない。`;
  } else {
    // 【通常チャットモード】 (モードC)
    const baseEpisode = { segments: simplifySegments(currentEpisodeState?.segments || [], false) };
    systemPrompt = `あなたは動画の字幕編集アシスタントです。
指示に基づき、字幕データ（segments）を修正してください。

【現在の字幕データ】
${JSON.stringify(baseEpisode.segments)}

【ルール】
1. 既存の id, start, end は動画のタイミングに基づくため、基本的に変更しないでください。
2. テキスト（text）や効果（animation, color, se）を指示に従って編集してください。
3. 返答は必ず以下の形式にする（JSON部分はコードブロックなし・プレーンテキストで）：
REPLY:（要約）
JSON:（編集後の segments 配列全体を出力。例: [ {"id":1, ...}, {"id":2, ...} ]）

4. JSON以外の説明文・省略・コードブロックは厳禁です。`;
  }

  console.log(`--- Chat API Logic [Target: ${target}] ---`);
  console.log("Prompt Length:", systemPrompt.length);

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
        temperature: 0.7,
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
    console.log(raw.slice(0, 500) + (raw.length > 500 ? "..." : ""));

    const replyMatch = raw.match(/REPLY:([\s\S]*?)JSON:/);
    const jsonMatch = raw.match(/JSON:([\s\S]*)/);

    const reply = replyMatch ? replyMatch[1].trim() : "承知しました。";
    let parsedJson: any = null;

    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim().replace(/```json\n?|\n?```/g, "");
      try {
        parsedJson = JSON.parse(jsonStr);
      } catch (e) {
        console.error("JSON parsing failed:", e);
      }
    }

    if (target === "metadata") {
      return NextResponse.json({
        reply,
        segments: null,
        theme: parsedJson || null
      });
    } else {
      let segments = null;
      if (parsedJson) {
        segments = Array.isArray(parsedJson) ? parsedJson : (parsedJson.segments || null);
      }
      return NextResponse.json({
        reply,
        segments,
        theme: null
      });
    }
  } catch (error) {
    console.error("Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
