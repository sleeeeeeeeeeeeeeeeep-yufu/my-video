import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { messages, currentEpisodeState, isPartial, target = "all", takesPacked = "" } = await req.json();

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

    // 1. 句読点（。！？）および読点（、）で分割しつつ、記号そのものは除去するロジック
    const allParts = cleanedScript.split(/([。！？、\n\s]+)/).filter(Boolean);
    
    const bufferPhrases: string[] = [];
    let currentBuffer = "";

    for (let i = 0; i < allParts.length; i++) {
        const part = allParts[i];
        
        // 記号（。！？、\n\s）の場合：分割のトリガーとしてのみ使用し、テキストには含めない
        if (/^[。！？、\n\s]+$/.test(part)) {
            const isFullStop = /[。！？\n]/.test(part);
            const isComma = part.includes("、");
            
            // 句読点（。！？）の場合は、現在のバッファが4文字以上なら分割を確定
            if (isFullStop && currentBuffer.length >= 4) {
                bufferPhrases.push(currentBuffer);
                currentBuffer = "";
            } 
            // 読点（、）の場合は、15文字以上たまっていれば分割（短すぎる分割を防ぐ）
            else if (isComma && currentBuffer.length >= 15) {
                bufferPhrases.push(currentBuffer);
                currentBuffer = "";
            }
            continue;
        }

        // 通常のテキストの場合
        // 20文字を超える場合は現在のバッファを一旦出す
        if (currentBuffer.length + part.length > 20 && currentBuffer.length > 0) {
            bufferPhrases.push(currentBuffer);
            currentBuffer = "";
        }
        
        currentBuffer += part;
        
        // 1つのテキストパート自体が20文字を超えている場合の強制分割
        while (currentBuffer.length > 20) {
            bufferPhrases.push(currentBuffer.slice(0, 20));
            currentBuffer = currentBuffer.slice(20);
        }
    }
    
    if (currentBuffer) {
        // 最後の余ったテキストが4文字未満で、かつ前と結合しても20文字以内なら結合
        if (currentBuffer.length < 4 && bufferPhrases.length > 0 && 
           (bufferPhrases[bufferPhrases.length - 1].length + currentBuffer.length <= 20)) {
            bufferPhrases[bufferPhrases.length - 1] += currentBuffer;
        } else {
            bufferPhrases.push(currentBuffer);
        }
    }

    // 無効なフレーズや特定の除外ワードを除外
    const finalPhrases = bufferPhrases.filter(p => {
        const trimmed = p.trim();
        if (!trimmed) return false;
        if (trimmed.includes("インスタキャプション")) return false;
        if (/^[ー\-─\s]+$/.test(trimmed)) return false;
        return true;
    });

    const oldSegments = currentEpisodeState?.segments || [];
    if (oldSegments.length === 0) {
      return NextResponse.json({ error: "既存の字幕データがありません。先に動画を解析してください。" }, { status: 400 });
    }

    const minStart = Math.min(...oldSegments.map((s: any) => s.start));
    const maxEnd = Math.max(...oldSegments.map((s: any) => s.end));
    const totalTime = Math.max(maxEnd - minStart, 1);
    const totalLength = finalPhrases.reduce((sum: number, p: string) => sum + p.length, 0);

    let currentStart = minStart;
    const newSegments = finalPhrases.map((phrase: string, idx: number) => {
      const duration = totalLength === 0 ? (totalTime / finalPhrases.length) : (phrase.length / totalLength) * totalTime;
      const end = currentStart + duration;

      let type = "normal";
      let animation = "pop";
      let se: string | undefined = undefined;

      if (idx === 0) {
        type = "hook"; animation = "pop"; se = "pikon";
      } else if (idx === finalPhrases.length - 1) {
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

    console.log(`--- Rule-based Script Optimized [Phrases: ${finalPhrases.length}] ---`);
    return NextResponse.json({
      reply: `台本を ${finalPhrases.length} 個のフレーズに分割し、タイミングを割り当てました！`,
      segments: newSegments,
      theme: null,
      cuts: currentEpisodeState?.cuts,
      timeline: currentEpisodeState?.timeline
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

【元音声テキスト（参考・秒単位タイミング）】
${takesPacked || "（なし）"}

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
        theme: parsedJson || null,
        cuts: currentEpisodeState?.cuts,
        timeline: currentEpisodeState?.timeline
      });
    } else {
      // --- Self-eval ステップ（モードCのみ・最大1回再生成）---
      let finalParsedJson = parsedJson;

      if (target !== "metadata" && Array.isArray(parsedJson)) {
        const evaluatorPrompt = `あなたは字幕データの品質検査AIです。
以下の segments JSON を検査し、結果を指定形式で返してください。

【検査対象 segments】
${JSON.stringify(parsedJson)}

【検査項目】
1. 全セグメントに id / start / end / text が存在するか
2. text が空文字・null・undefined でないか
3. start < end になっているか（start >= end は不正）
4. id が 1 からの連番になっているか

【返答形式】
問題なし の場合:
EVAL: OK

問題あり の場合:
EVAL: NG
REASON: （問題の概要を1文・日本語で。例: id=3 の text が空文字です）

※ JSON・コードブロック・説明文は一切含めないこと`;

        try {
          const evalResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: evaluatorPrompt }],
              temperature: 0,
            }),
          });

          const evalData = await evalResponse.json();
          const evalRaw = evalData.choices?.[0]?.message?.content || "";
          console.log("--- Self-eval Result ---");
          console.log(evalRaw);

          const isNG = evalRaw.includes("EVAL: NG");
          const reasonMatch = evalRaw.match(/REASON:\s*(.+)/);
          const evalReason = reasonMatch ? reasonMatch[1].trim() : "不明なエラー";

          if (isNG) {
            console.log(`Self-eval NG: ${evalReason} → 再生成開始`);

            const retryMessages = [
              { role: "system", content: systemPrompt },
              ...messages,
              { role: "assistant", content: raw },
              {
                role: "user",
                content: `前回の出力に問題がありました。再度正しい segments JSON を出力してください。\n問題: ${evalReason}`
              }
            ];

            const retryResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: retryMessages,
                temperature: 0.7,
              }),
            });

            const retryData = await retryResponse.json();
            const retryRaw = retryData.choices?.[0]?.message?.content || "";
            const retryJsonMatch = retryRaw.match(/JSON:([\s\S]*)/);

            if (retryJsonMatch) {
              try {
                const retryStr = retryJsonMatch[1].trim().replace(/```json\n?|\n?```/g, "");
                finalParsedJson = JSON.parse(retryStr);
                console.log("Self-eval retry succeeded.");
              } catch (e) {
                console.error("Retry JSON parse failed. Using first parsedJson:", e);
                // 上書き失敗時は1回目の parsedJson をそのまま使用
              }
            }
          } else {
            console.log("Self-eval OK.");
          }
        } catch (e) {
          console.error("Self-eval error (skipped):", e);
          // eval 自体が失敗した場合は1回目の parsedJson をそのまま使用
        }
      }

      let segments = null;
      if (finalParsedJson) {
        segments = Array.isArray(finalParsedJson) ? finalParsedJson : (finalParsedJson.segments || null);
      }
      return NextResponse.json({
        reply,
        segments,
        theme: null,
        cuts: currentEpisodeState?.cuts,
        timeline: currentEpisodeState?.timeline
      });
    }
  } catch (error) {
    console.error("Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
