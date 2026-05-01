import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FPS = 30;
const ANALYZE_DEBUG = process.env.ANALYZE_DEBUG === "true";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const chunks: File[] = [];
    
    // Collect all audio chunks
    for (const [key, value] of Array.from(formData.entries())) {
      if (key.startsWith("audio_") && value instanceof File) {
        chunks.push(value);
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json({ error: "no audio chunks provided" }, { status: 400 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing" }, { status: 500 });
    }

    console.log("--- Analysis Starting ---");
    console.time("WhisperTranscription");
    
    // 1. Parallel Whisper Transcription
    const transcriptions = await Promise.all(
      chunks.map(async (chunk, index) => {
        const startTime = Date.now();
        console.log(`[Chunk ${index}] Whisper API Start`);
        
        const whisperFormData = new FormData();
        whisperFormData.append("file", chunk, `chunk_${index}.wav`);
        whisperFormData.append("model", "whisper-1");
        whisperFormData.append("response_format", "verbose_json");
        whisperFormData.append("timestamp_granularities[]", "segment");
        whisperFormData.append("timestamp_granularities[]", "word");

        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: whisperFormData,
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Whisper API error (chunk ${index}): ${err}`);
        }

        const data = await res.json();
        console.log(`[Chunk ${index}] Whisper API End: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        
        const offset = index * 30;
        const segments = data.segments || [];
        
        const processedSegments: any[] = [];
        segments.forEach((seg: any) => {
          const text = seg.text.trim();
          if (text.length > 15) {
            // 句読点で分割（。、！？…）
            const parts = text.split(/([。、！？…]+)/g).filter(Boolean);
            const joinedParts: string[] = [];
            for (let i = 0; i < parts.length; i += 2) {
              const phrase = parts[i] + (parts[i + 1] || "");
              if (phrase) joinedParts.push(phrase);
            }

            if (joinedParts.length > 1) {
              const totalChars = joinedParts.reduce((sum, p) => sum + p.length, 0);
              const totalDuration = seg.end - seg.start;
              let currentStart = seg.start;

              joinedParts.forEach((part) => {
                const partDuration = (part.length / totalChars) * totalDuration;
                processedSegments.push({
                  start: currentStart + offset,
                  end: currentStart + partDuration + offset,
                  text: part.trim(),
                });
                currentStart += partDuration;
              });
              return;
            }
          }
          
        // 分割不要または分割ポイントがない場合
          processedSegments.push({
            start: seg.start + offset,
            end: seg.end + offset,
            text: text,
          });
        });

        const words = data.words || [];
        const processedWords = words.map((w: any) => ({
          start: w.start + offset,
          end: w.end + offset,
          word: w.word
        }));

        return { segments: processedSegments, words: processedWords };
      })
    );
    console.timeEnd("WhisperTranscription");

    // Merge all segments and words
    const allSegments = transcriptions.flatMap((t: any) => t.segments);
    const allWords = transcriptions.flatMap((t: any) => t.words);
    console.log(`Merged ${allSegments.length} segments and ${allWords.length} words.`);

    // takes_packed: 全 processedSegments をマージした allSegments（秒単位）から生成
    // 形式: [開始秒-終了秒] テキスト
    // 用途:
    //   - chat/route.ts の systemPrompt へコンテキストとして渡す
    //   - APIレスポンスに追加して UI側で利用する
    //   - LLM への台本解析・字幕修正指示のベースとして使用する
    const takesPacked = allSegments
      .map((seg: any) => `[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text}`)
      .join("\n");

    // 2. 言葉のギャップからcuts配列を作成 (Gap >= 0.5s)
    const cuts: any[] = [];
    for (let i = 0; i < allWords.length - 1; i++) {
        const gap = allWords[i + 1].start - allWords[i].end;
        if (gap >= 0.9) {
            cuts.push({
                start: Math.round(allWords[i].end * FPS),
                end: Math.round(allWords[i + 1].start * FPS)
            });
        }
    }

    // 4. keeps配列を生成
    const keeps: any[] = [];
    let currentPos = 0;
    const lastFrame = Math.max(
       ...allSegments.map((s: any) => Math.round(s.end * FPS) + 3),
       cuts.length > 0 ? cuts[cuts.length - 1].end : 0
    );

    cuts.forEach(cut => {
       if (cut.start > currentPos) {
           keeps.push({ start: currentPos, end: cut.start });
       }
       currentPos = cut.end;
    });
    if (currentPos < lastFrame) {
       keeps.push({ start: currentPos, end: lastFrame });
    }

    // 5. newStartで時間を詰める
    let cursor = 0;
    const timeline = keeps.map(k => {
       const duration = k.end - k.start;
       const seg = { originalStart: k.start, originalEnd: k.end, newStart: cursor, duration };
       cursor += duration;
       return seg;
    });

    console.log(`Cuts detected: ${cuts.length}`, JSON.stringify(cuts.slice(0, 3)));
    console.log(`Timeline segments: ${timeline.length}`, JSON.stringify(timeline.slice(0, 3)));

    // --- DEBUG ONLY: tmp/debug-timeline-readable.json ---
    try {
      const readableTimeline = timeline.map((t: any, i: number) => {
        const startSec = t.originalStart / FPS;
        const endSec   = t.originalEnd   / FPS;
        const wordsInRange = allWords.filter((w: any) => w.start >= startSec - 0.1 && w.end <= endSec + 0.1);
        const textPreview  = wordsInRange.map((w: any) => w.word).join(" ").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
        const prevCut = cuts[i - 1] ?? null;
        const nextCut = cuts[i]     ?? null;
        const beforeGapSec = prevCut ? +((prevCut.end - prevCut.start) / FPS).toFixed(3) : null;
        const afterGapSec  = nextCut ? +((nextCut.end - nextCut.start) / FPS).toFixed(3) : null;
        return {
          index: i,
          originalStart: t.originalStart,
          originalEnd:   t.originalEnd,
          newStart:      t.newStart,
          duration:      t.duration,
          originalStartSec: +startSec.toFixed(3),
          originalEndSec:   +endSec.toFixed(3),
          textPreview,
          beforeGapSec,
          afterGapSec,
        };
      });
      const debugTmpDir2 = resolve(process.cwd(), "tmp");
      mkdirSync(debugTmpDir2, { recursive: true });
      writeFileSync(
        resolve(debugTmpDir2, "debug-timeline-readable.json"),
        JSON.stringify(readableTimeline, null, 2),
        { encoding: "utf8" }
      );
      const txtLines = readableTimeline.map((r: any) =>
        `${r.index}: [${r.originalStartSec}-${r.originalEndSec}] gap前=${r.beforeGapSec} gap後=${r.afterGapSec} | ${r.textPreview}`
      );
      writeFileSync(
        resolve(debugTmpDir2, "debug-timeline-readable.txt"),
        txtLines.join("\n"),
        { encoding: "utf8" }
      );
    } catch (dbgErr) {
      console.error("[DEBUG] debug-timeline-readable write error:", (dbgErr as Error).message);
    }
    // --- END DEBUG ---

    // --- DEBUG ONLY: tmp/debug-vad-with-words.txt ---
    try {
      const vadPath = resolve(process.cwd(), "tmp/vad-output.json");
      if (existsSync(vadPath)) {
        const vadData = JSON.parse(readFileSync(vadPath, "utf8"));
        const vadLines = (vadData.intervals || []).map((iv: any, i: number) => {
          const wordsInRange = allWords.filter((w: any) => w.start >= iv.startSec - 0.05 && w.end <= iv.endSec + 0.05);
          const text = wordsInRange.map((w: any) => w.word).join(" ").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
          return `${i}: [${iv.startSec}-${iv.endSec}] frames ${iv.startFrame}-${iv.endFrame} | ${text}`;
        });
        writeFileSync(resolve(process.cwd(), "tmp/debug-vad-with-words.txt"), vadLines.join("\n"), { encoding: "utf8" });
      }
    } catch (vadDbgErr) {
      console.error("[DEBUG] debug-vad-with-words error:", (vadDbgErr as Error).message);
    }
    // --- END DEBUG ---

    // --- DEBUG ONLY: tmp/debug-sentence-vad-aligned.txt ---
    try {
      const vadPath2 = resolve(process.cwd(), "tmp/vad-output.json");
      const vadIntervals: any[] = existsSync(vadPath2)
        ? JSON.parse(readFileSync(vadPath2, "utf8")).intervals || []
        : [];

      const alignedLines = allSegments.map((seg: any, i: number) => {
        const origStart = seg.start;
        const origEnd   = seg.end;
        const text = (seg.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 80);

        // この文候補と重なるVAD区間を探す（重なり = VAD.start < seg.end && VAD.end > seg.start）
        const overlapping = vadIntervals.filter((iv: any) => iv.startSec < origEnd && iv.endSec > origStart);

        let corrStart = origStart;
        let corrEnd   = origEnd;
        if (overlapping.length > 0) {
          corrStart = overlapping[0].startSec;
          corrEnd   = overlapping[overlapping.length - 1].endSec;
        }

        return `${i}: [${origStart.toFixed(2)}-${origEnd.toFixed(2)}] -> [${corrStart.toFixed(2)}-${corrEnd.toFixed(2)}] | ${text}`;
      });

      writeFileSync(resolve(process.cwd(), "tmp/debug-sentence-vad-aligned.txt"), alignedLines.join("\n"), { encoding: "utf8" });
    } catch (svaErr) {
      console.error("[DEBUG] debug-sentence-vad-aligned error:", (svaErr as Error).message);
    }
    // --- END DEBUG ---

    // --- DEBUG ONLY: tmp/debug-sentence-candidates.txt ---
    try {
      const sentenceLines = allSegments.map((seg: any, i: number) => {
        const text = (seg.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
        return `${i}: [${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${text}`;
      });
      const scTmpDir = resolve(process.cwd(), "tmp");
      mkdirSync(scTmpDir, { recursive: true });
      writeFileSync(resolve(scTmpDir, "debug-sentence-candidates.txt"), sentenceLines.join("\n"), { encoding: "utf8" });
    } catch (scErr) {
      console.error("[DEBUG] debug-sentence-candidates write error:", (scErr as Error).message);
    }
    // --- END DEBUG ---

    // --- DEBUG ONLY: sentence-level LLM dry-run → tmp/debug-sentence-llm-decisions.* ---
    if (ANALYZE_DEBUG) try {
      const sentenceCandidates = allSegments.map((seg: any, i: number) => ({
        index: i,
        startSec: +seg.start.toFixed(3),
        endSec:   +seg.end.toFixed(3),
        text: (seg.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120),
      }));

      const sentenceLlmPrompt = `以下はショート動画の発話候補リストです（文単位）。
各文について「keep / drop / merge_next / merge_previous」を判定してください。

判定基準：
- 言い間違い・言い直し前・未完成発話 → drop
- 直後に完成版がある途中発話 → drop
- 重複発話は完成している方だけ keep、前半は drop
- 単体では未完成だが次と合わせて必要 → merge_next
- 単体では未完成だが前と合わせて必要 → merge_previous
- 話の流れに必要 → keep
- ショート動画として不要な脱線 → drop

候補リスト：
${JSON.stringify(sentenceCandidates, null, 2)}

返答は以下の形式のJSONのみ。説明不要：
[{"index":0,"decision":"keep","reason":"..."},...]`;

      const sllmRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: sentenceLlmPrompt }], temperature: 0 }),
      });

      if (sllmRes.ok) {
        const sllmData = await sllmRes.json();
        const sllmRaw = sllmData.choices?.[0]?.message?.content || "";
        const sllmCleaned = sllmRaw.replace(/```json\n?|\n?```/g, "").trim();
        let sllmDecisionsRaw: any[] = [];
        try { sllmDecisionsRaw = JSON.parse(sllmCleaned); } catch { sllmDecisionsRaw = []; }

        const sllmDecisionsClean = sllmDecisionsRaw.map((d: any) => ({ index: d.index, decision: d.decision }));
        const sllmTmpDir = resolve(process.cwd(), "tmp");
        mkdirSync(sllmTmpDir, { recursive: true });
        writeFileSync(
          resolve(sllmTmpDir, "debug-sentence-llm-decisions.json"),
          JSON.stringify({ generatedAt: new Date().toISOString(), decisions: sllmDecisionsClean }, null, 2),
          { encoding: "utf8" }
        );
        const sanitize2 = (s: string) => (s || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
        const sllmTxtLines = sllmDecisionsRaw.map((d: any) => {
          const cand = sentenceCandidates.find((c: any) => c.index === d.index);
          return `${d.index} [${d.decision}] ${sanitize2(d.reason || "")} | ${cand?.text || ""}`;
        });
        writeFileSync(resolve(sllmTmpDir, "debug-sentence-llm-decisions.txt"), sllmTxtLines.join("\n"), { encoding: "utf8" });
        console.log("[DEBUG] sentence LLM decisions saved.");
      } else {
        console.error("[DEBUG] sentence LLM dry-run API error:", sllmRes.status);
      }
    } catch (sllmErr) {
      console.error("[DEBUG] sentence LLM dry-run error:", (sllmErr as Error).message);
    }
    // --- END DEBUG sentence LLM ---


    // --- DEBUG ONLY: LLM dry-run cut decisions → tmp/debug-llm-cut-decisions.json ---
    if (ANALYZE_DEBUG) try {
      const candidates = timeline.map((t: any, i: number) => {
        const startSec = t.originalStart / FPS;
        const endSec   = t.originalEnd   / FPS;
        const wordsInRange = allWords.filter((w: any) => w.start >= startSec - 0.1 && w.end <= endSec + 0.1);
        const textPreview  = wordsInRange.map((w: any) => w.word).join(" ").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
        return { index: i, originalStart: t.originalStart, originalEnd: t.originalEnd, newStart: t.newStart, duration: t.duration, startSec: +startSec.toFixed(3), endSec: +endSec.toFixed(3), textPreview };
      });

      const llmPrompt = `以下は動画の発話区間の候補リストです。
各区間について「keep / drop / merge_previous」を判定してください。

判定基準：
- 言い間違い・言い直し前・未完成発話 → drop
- 直後に完成版がある途中発話 → drop
- 同じ意味の重複は後半だけ keep、前半は drop
- 話として自然に必要な区間 → keep
- 前後をつなげた方が自然な場合 → merge_previous

候補リスト（JSON）：
${JSON.stringify(candidates, null, 2)}

返答は必ず以下の形式のJSONのみ。説明不要：
[{"index":0,"decision":"keep","reason":"..."},...]`;

      const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: llmPrompt }],
          temperature: 0,
        }),
      });

      if (llmRes.ok) {
        const llmData = await llmRes.json();
        const raw = llmData.choices?.[0]?.message?.content || "";
        const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
        let decisionsRaw: any[] = [];
        try { decisionsRaw = JSON.parse(cleaned); } catch { decisionsRaw = []; }
        const decisionsClean = decisionsRaw.map((d: any) => ({ index: d.index, decision: d.decision }));
        const candidatesClean = candidates.map((c: any) => ({ index: c.index, originalStart: c.originalStart, originalEnd: c.originalEnd, startSec: c.startSec, endSec: c.endSec }));
        const debugTmpDir3 = resolve(process.cwd(), "tmp");
        mkdirSync(debugTmpDir3, { recursive: true });
        writeFileSync(
          resolve(debugTmpDir3, "debug-llm-cut-decisions.json"),
          JSON.stringify({ generatedAt: new Date().toISOString(), candidates: candidatesClean, decisions: decisionsClean }, null, 2),
          { encoding: "utf8" }
        );
        const sanitize = (s: string) => (s || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 120);
        const txtLines2 = decisionsRaw.map((d: any) => `${d.index} [${d.decision}] ${sanitize(d.reason || "")}`);
        writeFileSync(resolve(debugTmpDir3, "debug-llm-cut-decisions.txt"), txtLines2.join("\n"), { encoding: "utf8" });
        console.log("[DEBUG] LLM cut decisions saved.");
      } else {
        console.error("[DEBUG] LLM dry-run API error:", llmRes.status);
      }
    } catch (llmDbgErr) {
      console.error("[DEBUG] LLM dry-run error:", (llmDbgErr as Error).message);
    }
    // --- END DEBUG LLM ---

    // --- DEBUG ONLY: tmp/debug-cut-proposal.* ---
    if (ANALYZE_DEBUG) try {
      const cpTmp = resolve(process.cwd(), "tmp");
      mkdirSync(cpTmp, { recursive: true });

      // sentence-level LLM decisions を読み込む（なければ全件keep扱い）
      const sllmDecPath = resolve(cpTmp, "debug-sentence-llm-decisions.json");
      let sllmDecisions: Record<number, string> = {};
      if (existsSync(sllmDecPath)) {
        const sllmRaw = JSON.parse(readFileSync(sllmDecPath, "utf8"));
        for (const d of (sllmRaw.decisions || [])) {
          sllmDecisions[d.index] = d.decision;
        }
      }

      // VAD intervals 読み込み（なければ空）
      const cpVadPath = resolve(cpTmp, "vad-output.json");
      const cpVadIntervals: any[] = existsSync(cpVadPath)
        ? JSON.parse(readFileSync(cpVadPath, "utf8")).intervals || []
        : [];

      // keep / merge_* のみ対象（drop 除外）
      type ProposalSeg = { index: number; sourceIndexes: number[]; startSec: number; endSec: number; text: string };
      const kept: ProposalSeg[] = [];
      let mergeBuffer: ProposalSeg | null = null;

      for (let i = 0; i < allSegments.length; i++) {
        const seg = allSegments[i];
        const dec = sllmDecisions[i] ?? "keep";
        if (dec === "drop") { mergeBuffer = null; continue; }

        const text = (seg.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 80);

        // allWords から word境界で start/end を決定
        const wordsInSeg = allWords.filter((w: any) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05);
        let rawStart = wordsInSeg.length > 0 ? wordsInSeg[0].start : seg.start;
        let rawEnd   = wordsInSeg.length > 0 ? wordsInSeg[wordsInSeg.length - 1].end : seg.end;

        // VAD安全補正（±0.2秒以内のみ）
        const overlappingVad = cpVadIntervals.filter((iv: any) => iv.startSec < rawEnd + 0.05 && iv.endSec > rawStart - 0.05);
        if (overlappingVad.length > 0) {
          const vadStart = overlappingVad[0].startSec;
          const vadEnd   = overlappingVad[overlappingVad.length - 1].endSec;
          if (Math.abs(vadStart - rawStart) <= 0.2) rawStart = vadStart;
          if (Math.abs(vadEnd   - rawEnd)   <= 0.2) rawEnd   = vadEnd;
        }

        // padding
        const paddedStart = Math.max(0, rawStart - 0.15);
        const paddedEnd   = rawEnd + 0.20;

        if (dec === "merge_previous" && kept.length > 0) {
          kept[kept.length - 1].endSec = paddedEnd;
          kept[kept.length - 1].text += " " + text;
          kept[kept.length - 1].sourceIndexes.push(i);
          mergeBuffer = null;
          continue;
        }
        if (dec === "merge_next") {
          mergeBuffer = { index: i, sourceIndexes: [i], startSec: paddedStart, endSec: paddedEnd, text };
          continue;
        }

        // merge_next のバッファがある場合は結合
        if (mergeBuffer) {
          kept.push({ index: mergeBuffer.index, sourceIndexes: [...mergeBuffer.sourceIndexes, i], startSec: mergeBuffer.startSec, endSec: paddedEnd, text: mergeBuffer.text + " " + text });
          mergeBuffer = null;
        } else {
          kept.push({ index: i, sourceIndexes: [i], startSec: paddedStart, endSec: paddedEnd, text });
        }
      }
      // 残ったmergeBuffer（merge_nextが末端の場合）
      if (mergeBuffer) kept.push(mergeBuffer);

      // 1.5秒未満の区間を前後とmerge
      const merged: ProposalSeg[] = [];
      for (let i = 0; i < kept.length; i++) {
        const seg = kept[i];
        const dur = seg.endSec - seg.startSec;
        if (dur < 1.5 && merged.length > 0) {
          merged[merged.length - 1].endSec = seg.endSec;
          merged[merged.length - 1].text += " " + seg.text;
          merged[merged.length - 1].sourceIndexes.push(...seg.sourceIndexes);
        } else {
          merged.push({ ...seg });
        }
      }

      // padding重複のmerge（隣接区間が重なる場合だけ結合）
      const deduped: ProposalSeg[] = [];
      for (const seg of merged) {
        if (deduped.length > 0 && seg.startSec <= deduped[deduped.length - 1].endSec) {
          const prev = deduped[deduped.length - 1];
          prev.endSec = Math.max(prev.endSec, seg.endSec);
          if (prev.text.includes(seg.text)) { /* seg is subset of prev, keep prev */ }
          else if (seg.text.includes(prev.text)) { prev.text = seg.text; }
          else { prev.text = prev.text + " " + seg.text; }
          prev.sourceIndexes.push(...seg.sourceIndexes);
        } else {
          deduped.push({ ...seg });
        }
      }

      // newStart を0秒から再計算
      type ProposalOut = ProposalSeg & { durationSec: number; newStartSec: number; startFrame: number; endFrame: number; newStartFrame: number; durationFrame: number; sourceIndexes: number[] };
      let cursor2 = 0;
      const proposal: ProposalOut[] = deduped.map(s => {
        const dur = s.endSec - s.startSec;
        const out: ProposalOut = {
          index: s.index,
          sourceIndexes: s.sourceIndexes,
          startSec: +s.startSec.toFixed(3),
          endSec:   +s.endSec.toFixed(3),
          durationSec: +dur.toFixed(3),
          newStartSec: +cursor2.toFixed(3),
          startFrame:    Math.round(s.startSec * FPS),
          endFrame:      Math.round(s.endSec   * FPS),
          newStartFrame: Math.round(cursor2 * FPS),
          durationFrame: Math.round(dur * FPS),
          text: s.text,
        };
        cursor2 += dur;
        return out;
      });

      writeFileSync(
        resolve(cpTmp, "debug-cut-proposal.json"),
        JSON.stringify({ generatedAt: new Date().toISOString(), count: proposal.length, totalSec: +cursor2.toFixed(3), proposal: proposal.map(p => ({ index: p.index, sourceIndexes: p.sourceIndexes, startSec: p.startSec, endSec: p.endSec, durationSec: p.durationSec, newStartSec: p.newStartSec, startFrame: p.startFrame, endFrame: p.endFrame, newStartFrame: p.newStartFrame, durationFrame: p.durationFrame, text: p.text })) }, null, 2),
        { encoding: "utf8" }
      );
      const cpTxtLines = proposal.map(p =>
        `${p.index}: [${p.startSec}-${p.endSec}s] dur=${p.durationSec}s newStart=${p.newStartSec}s | ${p.text}`
      );
      writeFileSync(resolve(cpTmp, "debug-cut-proposal.txt"), cpTxtLines.join("\n"), { encoding: "utf8" });
      console.log(`[DEBUG] cut-proposal: ${proposal.length} segments, total=${cursor2.toFixed(1)}s`);

      // --- evaluator dry-run ---
      try {
        const evalInput = proposal.map(p => ({ index: p.index, startSec: p.startSec, endSec: p.endSec, durationSec: p.durationSec, text: p.text }));
        const evalPrompt = `以下はショート動画のカット候補リストです。
各区間について「keep / drop / shorten」を判定してください。

判定基準：
- 話の流れに必要な区間 → keep
- 冗長・脱線・不要な繰り返し → drop
- 内容は必要だが尺が長すぎる → shorten

候補リスト：
${JSON.stringify(evalInput, null, 2)}

返答は以下の形式のJSONのみ。説明不要：
[{"index":0,"decision":"keep","reason":"..."},...]`;

        const evalRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: evalPrompt }], temperature: 0 }),
        });

        if (evalRes.ok) {
          const evalData = await evalRes.json();
          const evalRaw = evalData.choices?.[0]?.message?.content || "";
          const evalCleaned = evalRaw.replace(/```json\n?|\n?```/g, "").trim();
          let evalDecisionsRaw: any[] = [];
          try { evalDecisionsRaw = JSON.parse(evalCleaned); } catch { evalDecisionsRaw = []; }

          // sourceIndexes を proposal から付与
          const sourceMap = new Map(proposal.map(p => [p.index, p.sourceIndexes]));
          const evalDecisions: any[] = evalDecisionsRaw.map((d: any) => ({
            index: d.index,
            sourceIndexes: sourceMap.get(d.index) ?? [],
            decision: d.decision,
            reason: d.reason,
          }));

          // shorten対象にのみ shortenSuggestion を追加
          for (const d of evalDecisions) {
            if (d.decision !== "shorten") continue;
            try {
              const srcIdxList: number[] = d.sourceIndexes || [];
              const wordsInRange: any[] = [];
              for (const si of srcIdxList) {
                const seg = allSegments[si];
                if (!seg) continue;
                const w = allWords.filter((w: any) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05);
                wordsInRange.push(...w);
              }
              const proposalEntry = proposal.find((p: any) => p.index === d.index);
              const rangeStart = proposalEntry?.startSec ?? (wordsInRange[0]?.start ?? 0);
              const rangeEnd   = proposalEntry?.endSec   ?? (wordsInRange[wordsInRange.length - 1]?.end ?? 0);

              const indexedWords = wordsInRange.map((w: any, li: number) => ({
                localWordIndex: li,
                start: +w.start.toFixed(3),
                end:   +w.end.toFixed(3),
                word:  w.word,
              }));

              const shortenPrompt = `以下は動画の1区間の単語リストです（localWordIndex付き）。
この区間（${rangeStart}秒〜${rangeEnd}秒）の中で、ショート動画として必要な連続した部分だけ残すとしたら、残す範囲の開始と終了の localWordIndex を答えてください。必ず連続した1区間のみ。

単語リスト：
${JSON.stringify(indexedWords, null, 2)}

返答は以下の形式のJSONのみ。説明不要：
{"type":"trim_span","keepStartWordIndex":0,"keepEndWordIndex":6}`;

              const shortenRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: shortenPrompt }], temperature: 0 }),
              });
              if (shortenRes.ok) {
                const shortenData = await shortenRes.json();
                const shortenRaw = (shortenData.choices?.[0]?.message?.content || "").replace(/```json\n?|\n?```/g, "").trim();
                let parsed: any = null;
                try { parsed = JSON.parse(shortenRaw); } catch { parsed = null; }
                if (parsed && parsed.keepStartWordIndex != null && parsed.keepEndWordIndex != null) {
                  const maxIdx = indexedWords.length - 1;
                  let ks = Math.max(0, Math.min(Math.round(Number(parsed.keepStartWordIndex)), maxIdx));
                  let ke = Math.max(0, Math.min(Math.round(Number(parsed.keepEndWordIndex)),   maxIdx));
                  if (ks > ke) { const tmp = ks; ks = ke; ke = tmp; }
                  const keepWords = indexedWords.filter(w => w.localWordIndex >= ks && w.localWordIndex <= ke);
                  const dropWords = indexedWords.filter(w => w.localWordIndex < ks || w.localWordIndex > ke);
                  d.shortenSuggestion = {
                    type: "trim_span",
                    keepStartWordIndex: ks,
                    keepEndWordIndex: ke,
                    keepText: keepWords.map((w: any) => w.word).join(""),
                    dropText: dropWords.map((w: any) => w.word).join(""),
                    suggestedStartSec: keepWords[0]?.start ?? rangeStart,
                    suggestedEndSec:   keepWords[keepWords.length - 1]?.end ?? rangeEnd,
                  };
                }
              }
            } catch (shortenErr) {
              console.error("[DEBUG] shortenSuggestion error:", (shortenErr as Error).message);
            }
          }

          writeFileSync(
            resolve(cpTmp, "debug-cut-proposal-eval.json"),
            JSON.stringify({ generatedAt: new Date().toISOString(), count: proposal.length, totalSec: +cursor2.toFixed(3), evalDecisions }, null, 2),
            { encoding: "utf8" }
          );
          const sanitizeR = (s: string) => (s || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 100);
          const evalTxtLines = evalDecisions.map((d: any) => {
            let line = `${d.index}: ${d.decision} | sourceIndexes=${(d.sourceIndexes || []).join(",")} | reason: ${sanitizeR(d.reason)}`;
            if (d.shortenSuggestion) {
              const ss = d.shortenSuggestion;
              line += ` | shorten: [${ss.suggestedStartSec}-${ss.suggestedEndSec}s] keep="${sanitizeR(ss.keepText)}"`;
            }
            return line;
          });
          writeFileSync(resolve(cpTmp, "debug-cut-proposal-eval.txt"), evalTxtLines.join("\n"), { encoding: "utf8" });
          console.log("[DEBUG] cut-proposal-eval saved.");

          // --- refined proposal dry-run ---
          try {
            const evalMap = new Map(evalDecisions.map((d: any) => [d.index, d]));
            type RefinedSeg = {
              index: number; sourceIndexes: number[]; decisionApplied: string;
              originalStartSec?: number; originalEndSec?: number;
              startSec: number; endSec: number; durationSec: number; newStartSec: number;
              startFrame: number; endFrame: number; newStartFrame: number; durationFrame: number;
              text: string;
            };

            // 1. apply decisions
            const applied: RefinedSeg[] = [];
            for (const p of proposal) {
              const ev = evalMap.get(p.index);
              const dec = ev?.decision ?? "keep";
              if (dec === "drop") continue;

              let startSec = p.startSec;
              let endSec   = p.endSec;
              let text     = p.text;
              let decisionApplied = "keep";
              let originalStartSec: number | undefined;
              let originalEndSec: number | undefined;

              if (dec === "shorten" && ev?.shortenSuggestion) {
                const ss = ev.shortenSuggestion;
                const newDur = (ss.suggestedEndSec ?? endSec) - (ss.suggestedStartSec ?? startSec);
                if (newDur >= 1.5) {
                  originalStartSec = startSec;
                  originalEndSec   = endSec;
                  startSec = ss.suggestedStartSec ?? startSec;
                  endSec   = ss.suggestedEndSec   ?? endSec;
                  text     = ss.keepText || text;
                  decisionApplied  = "shorten";
                } else {
                  decisionApplied = "keep_short_invalid";
                }
              }

              applied.push({
                index: p.index, sourceIndexes: p.sourceIndexes, decisionApplied,
                ...(originalStartSec != null ? { originalStartSec, originalEndSec } : {}),
                startSec, endSec, durationSec: endSec - startSec,
                newStartSec: 0, startFrame: Math.round(startSec * FPS), endFrame: Math.round(endSec * FPS),
                newStartFrame: 0, durationFrame: Math.round((endSec - startSec) * FPS), text,
              });
            }

            // 2. overlap merge
            const rDeduped: RefinedSeg[] = [];
            for (const seg of applied) {
              if (rDeduped.length > 0 && seg.startSec <= rDeduped[rDeduped.length - 1].endSec) {
                const prev = rDeduped[rDeduped.length - 1];
                prev.endSec = Math.max(prev.endSec, seg.endSec);
                prev.text += " " + seg.text;
                prev.sourceIndexes.push(...seg.sourceIndexes);
                prev.durationSec  = prev.endSec - prev.startSec;
                prev.endFrame     = Math.round(prev.endSec * FPS);
                prev.durationFrame = Math.round(prev.durationSec * FPS);
              } else {
                rDeduped.push({ ...seg });
              }
            }

            // 3. newStart再計算
            let rCursor = 0;
            let rFrameCursor = 0;
            for (const seg of rDeduped) {
              seg.newStartSec   = +rCursor.toFixed(3);
              seg.durationSec   = +(seg.endSec - seg.startSec).toFixed(3);
              seg.durationFrame = Math.round(seg.durationSec * FPS);
              seg.newStartFrame = rFrameCursor;
              seg.startSec      = +seg.startSec.toFixed(3);
              seg.endSec        = +seg.endSec.toFixed(3);
              rCursor      += seg.durationSec;
              rFrameCursor += seg.durationFrame;
            }

            writeFileSync(
              resolve(cpTmp, "debug-cut-proposal-refined.json"),
              JSON.stringify({ generatedAt: new Date().toISOString(), count: rDeduped.length, totalSec: +rCursor.toFixed(3), proposal: rDeduped }, null, 2),
              { encoding: "utf8" }
            );
            const rTxtLines = rDeduped.map(p =>
              `${p.index}[${p.decisionApplied}]: [${p.startSec}-${p.endSec}s] dur=${p.durationSec}s newStart=${p.newStartSec}s | ${(p.text || "").replace(/[\r\n\t]+/g, " ").slice(0, 80)}`
            );
            writeFileSync(resolve(cpTmp, "debug-cut-proposal-refined.txt"), rTxtLines.join("\n"), { encoding: "utf8" });
            console.log(`[DEBUG] cut-proposal-refined: ${rDeduped.length} segments, total=${rCursor.toFixed(1)}s`);

            // --- refined timeline dry-run ---
            const refinedTimeline = rDeduped.map(p => ({
              index: p.index,
              sourceIndexes: p.sourceIndexes,
              decisionApplied: p.decisionApplied,
              originalStart: p.startFrame,
              originalEnd:   p.endFrame,
              newStart:      p.newStartFrame,
              duration:      p.durationFrame,
              originalStartSec: p.startSec,
              originalEndSec:   p.endSec,
              newStartSec:      p.newStartSec,
              durationSec:      p.durationSec,
              text: (p.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 80),
            }));
            const lastRt = refinedTimeline[refinedTimeline.length - 1];
            const refinedDurationInFrames = lastRt ? lastRt.newStart + lastRt.duration : 0;
            writeFileSync(
              resolve(cpTmp, "debug-refined-timeline.json"),
              JSON.stringify({ generatedAt: new Date().toISOString(), count: refinedTimeline.length, durationInFrames: refinedDurationInFrames, timeline: refinedTimeline }, null, 2),
              { encoding: "utf8" }
            );
            const rtTxtLines = refinedTimeline.map(t =>
              `${t.index}[${t.decisionApplied}]: ${t.originalStart}-${t.originalEnd} -> ${t.newStart} dur=${t.duration} | ${t.text}`
            );
            writeFileSync(resolve(cpTmp, "debug-refined-timeline.txt"), rtTxtLines.join("\n"), { encoding: "utf8" });
            console.log(`[DEBUG] refined-timeline: ${refinedTimeline.length} entries, durationInFrames=${refinedDurationInFrames}`);
            // --- end refined timeline dry-run ---

            // --- dry-run: refined-finalsegments ---
            try {
              const rtToAfterFrameStart = (x: number): number => {
                const found = refinedTimeline.find(t => x >= t.originalStart && x < t.originalEnd);
                if (found) return found.newStart + (x - found.originalStart);
                if (x < refinedTimeline[0].originalStart) return 0;
                if (x >= refinedTimeline[refinedTimeline.length - 1].originalEnd) return refinedDurationInFrames;
                const next = refinedTimeline.find(t => t.originalStart > x);
                return next ? next.newStart : refinedDurationInFrames;
              };
              const rtToAfterFrameEnd = (x: number): number => {
                const found = refinedTimeline.find(t => x >= t.originalStart && x < t.originalEnd);
                if (found) return found.newStart + (x - found.originalStart);
                if (x < refinedTimeline[0].originalStart) return 0;
                if (x >= refinedTimeline[refinedTimeline.length - 1].originalEnd) return refinedDurationInFrames;
                let prev = refinedTimeline[0];
                for (const t of refinedTimeline) {
                  if (t.originalEnd <= x) prev = t;
                  else break;
                }
                return prev.newStart + prev.duration;
              };

              const rtKept: any[] = [];
              const rtDropped: any[] = [];
              for (let idx = 0; idx < allSegments.length; idx++) {
                const seg = allSegments[idx];
                const frameStart = Math.max(0, Math.round(seg.start * FPS) - 2);
                const frameEnd   = Math.round(seg.end * FPS) + 3;
                const afterStart = rtToAfterFrameStart(frameStart);
                const afterEnd   = rtToAfterFrameEnd(frameEnd);
                const text = (seg.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 80);
                if (afterEnd <= afterStart) {
                  rtDropped.push({ id: idx + 1, text, originalStart: frameStart, originalEnd: frameEnd, reason: "afterEnd <= afterStart" });
                } else {
                  rtKept.push({ id: idx + 1, text, originalStart: frameStart, originalEnd: frameEnd, refinedStart: afterStart, refinedEnd: afterEnd, duration: afterEnd - afterStart, dropped: false });
                }
              }

              let invalidDurationCount = 0;
              let gapOrOverlapCount = 0;
              for (let i = 0; i < refinedTimeline.length; i++) {
                if (refinedTimeline[i].duration <= 0) invalidDurationCount++;
                if (i > 0 && refinedTimeline[i].newStart < refinedTimeline[i - 1].newStart + refinedTimeline[i - 1].duration) gapOrOverlapCount++;
              }

              writeFileSync(
                resolve(cpTmp, "debug-refined-finalsegments.json"),
                JSON.stringify({
                  generatedAt: new Date().toISOString(),
                  count: rtKept.length,
                  droppedCount: rtDropped.length,
                  invalidDurationCount,
                  gapOrOverlapCount,
                  refinedTimelineDurationInFrames: refinedDurationInFrames,
                  segments: rtKept,
                  dropped: rtDropped,
                }, null, 2),
                { encoding: "utf8" }
              );
              const allRtLines = [
                ...rtKept.map(s => `${s.id}: ${s.originalStart}-${s.originalEnd} -> ${s.refinedStart}-${s.refinedEnd} dur=${s.duration} dropped=false | ${s.text}`),
                ...rtDropped.map(s => `${s.id}: ${s.originalStart}-${s.originalEnd} -> DROPPED | ${s.text}`),
              ].sort((a, b) => parseInt(a) - parseInt(b));
              writeFileSync(resolve(cpTmp, "debug-refined-finalsegments.txt"), allRtLines.join("\n"), { encoding: "utf8" });
              console.log(`[DEBUG] refined-finalsegments: ${rtKept.length} kept, ${rtDropped.length} dropped`);

              // --- dry-run: refined-finalsegments-v2 (direct from refinedTimeline) ---
              try {
                const lastIdx = refinedTimeline.length - 1;
                let v2Cursor = 0;
                const v2Segments: any[] = refinedTimeline.map((entry: any, idx: number) => {
                  const isFirst = idx === 0;
                  const isLast  = idx === lastIdx;
                  const isEmph  = !isFirst && !isLast && idx % 10 === 0;
                  const type      = isFirst ? "hook" : isLast ? "conclusion" : isEmph ? "emphasis" : "normal";
                  const animation = isFirst ? "pop" : isLast ? "reveal" : "pop";
                  const se        = isFirst ? "pikon" : isEmph ? "chan" : undefined;
                  const start = v2Cursor;
                  const end   = v2Cursor + entry.duration;
                  v2Cursor = end;
                  return {
                    id: idx + 1,
                    sourceIndex: entry.index,
                    sourceIndexes: entry.sourceIndexes,
                    type,
                    start,
                    end,
                    text: (entry.text || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").slice(0, 80),
                    animation,
                    position: "bottom",
                    zoom: 1.0,
                    ...(se !== undefined ? { se } : {}),
                  };
                });

                let v2EmptyTextCount = 0;
                let v2InvalidDurationCount = 0;
                let v2OverlapCount = 0;
                for (let i = 0; i < v2Segments.length; i++) {
                  const s = v2Segments[i];
                  if (!s.text || s.text.trim() === "") v2EmptyTextCount++;
                  if (s.end - s.start <= 0) v2InvalidDurationCount++;
                  if (i > 0 && s.start < v2Segments[i - 1].end) v2OverlapCount++;
                }
                const v2LastEnd = v2Cursor;

                writeFileSync(
                  resolve(cpTmp, "debug-refined-finalsegments-v2.json"),
                  JSON.stringify({
                    generatedAt: new Date().toISOString(),
                    count: v2Segments.length,
                    droppedCount: 0,
                    emptyTextCount: v2EmptyTextCount,
                    invalidDurationCount: v2InvalidDurationCount,
                    overlapCount: v2OverlapCount,
                    lastEnd: v2LastEnd,
                    refinedTimelineDurationInFrames: refinedDurationInFrames,
                    lastEndMatchesDuration: v2LastEnd === refinedDurationInFrames,
                    segments: v2Segments,
                  }, null, 2),
                  { encoding: "utf8" }
                );
                const v2TxtLines = v2Segments.map((s: any) =>
                  `${s.id}: ${s.start}-${s.end} dur=${s.end - s.start} type=${s.type} | ${s.text}`
                );
                writeFileSync(resolve(cpTmp, "debug-refined-finalsegments-v2.txt"), v2TxtLines.join("\n"), { encoding: "utf8" });
                console.log(`[DEBUG] refined-finalsegments-v2: ${v2Segments.length} segments, lastEndMatchesDuration=${v2LastEnd === refinedDurationInFrames}`);

                // --- diff: old dropped vs v2 ---
                const diffLines: string[] = [
                  `=== refined-finalsegments diff ===`,
                  `旧方式 kept=${rtKept.length} dropped=${rtDropped.length}`,
                  `v2方式 count=${v2Segments.length} dropped=0`,
                  ``,
                  `--- 旧方式でDROPされた字幕 ---`,
                  ...rtDropped.map((d: any) => `  DROP id=${d.id}: "${d.text}" (originalStart=${d.originalStart}-${d.originalEnd})`),
                  ``,
                  `--- v2の全segment ---`,
                  ...v2Segments.map((s: any) => `  id=${s.id} [${s.type}] start=${s.start}-${s.end} src=${s.sourceIndex} | "${s.text}"`),
                ];
                writeFileSync(resolve(cpTmp, "debug-refined-finalsegments-diff.txt"), diffLines.join("\n"), { encoding: "utf8" });
                console.log(`[DEBUG] refined-finalsegments-diff written`);
              } catch (v2Err) {
                console.error("[DEBUG] refined-finalsegments-v2 error:", (v2Err as Error).message);
              }
              // --- end dry-run: refined-finalsegments-v2 ---

            } catch (rtFsErr) {
              console.error("[DEBUG] refined-finalsegments error:", (rtFsErr as Error).message);
            }
            // --- end dry-run: refined-finalsegments ---

          } catch (refinedErr) {
            console.error("[DEBUG] cut-proposal-refined error:", (refinedErr as Error).message);
          }
          // --- end refined proposal dry-run ---

        } else {
          console.error("[DEBUG] cut-proposal-eval API error:", evalRes.status);
        }
      } catch (evalErr) {
        console.error("[DEBUG] cut-proposal-eval error:", (evalErr as Error).message);
      }
      // --- end evaluator dry-run ---

    } catch (cpErr) {
      console.error("[DEBUG] debug-cut-proposal error:", (cpErr as Error).message);
    }
    // --- END DEBUG cut-proposal ---

    const totalFramesAfterCut = timeline.length > 0
      ? timeline[timeline.length - 1].newStart + timeline[timeline.length - 1].duration
      : lastFrame;

    console.log(`totalFramesAfterCut: ${totalFramesAfterCut}, original: ${lastFrame}`);

    // 2. Rule-based Enrichment (INSTANT replacement for GPT)
    const finalSegments = allSegments.map((seg: any, idx: number) => {
      let type = "normal";
      let animation = "pop";
      let se: string | undefined = undefined;

      if (idx === 0) {
        type = "hook";
        animation = "pop";
        se = "pikon";
      } else if (idx === allSegments.length - 1) {
        type = "conclusion";
        animation = "reveal";
      } else if (idx % 10 === 0) {
        type = "emphasis";
        se = "chan";
      }

      // 1フレーム精度(30fps)での整数化 + Padding（前2フレーム、後3フレーム）
      const frameStart = Math.max(0, Math.round(seg.start * FPS) - 2);
      const frameEnd = Math.round(seg.end * FPS) + 3;

      // 元動画フレーム → カット後フレームへ変換（start用/end用で挙動分離）
      if (timeline.length === 0) return null;
      const totalAfter = timeline[timeline.length - 1].newStart + timeline[timeline.length - 1].duration;

      const toAfterFrameStart = (x: number): number => {
        const found = timeline.find(t => x >= t.originalStart && x < t.originalEnd);
        if (found) return found.newStart + (x - found.originalStart);
        // gap内またはtimeline先頭より前 → 直後のkeep区間先頭にスナップ
        if (x < timeline[0].originalStart) return 0;
        // timeline末端超過 → 末端値
        if (x >= timeline[timeline.length - 1].originalEnd) return totalAfter;
        // gap内 → 直後のkeep区間のnewStartにスナップ
        const next = timeline.find(t => t.originalStart > x);
        return next ? next.newStart : totalAfter;
      };

      const toAfterFrameEnd = (x: number): number => {
        const found = timeline.find(t => x >= t.originalStart && x < t.originalEnd);
        if (found) return found.newStart + (x - found.originalStart);
        // gap内またはtimeline先頭より前 → 直前のkeep区間末端にスナップ
        if (x < timeline[0].originalStart) return 0;
        // timeline末端超過 → 末端値
        if (x >= timeline[timeline.length - 1].originalEnd) return totalAfter;
        // gap内 → 直前のkeep区間のnewStart + durationにスナップ
        let prev = timeline[0];
        for (const t of timeline) {
          if (t.originalEnd <= x) prev = t;
          else break;
        }
        return prev.newStart + prev.duration;
      };

      const afterStart = toAfterFrameStart(frameStart);
      const afterEnd   = toAfterFrameEnd(frameEnd);

      // 完全にカット区間内のsegmentは除外
      if (afterEnd <= afterStart) return null;

      return {
        id: idx + 1,
        type,
        start: afterStart,
        end: afterEnd,
        text: seg.text,
        animation,
        position: "bottom",
        zoom: 1.0,
        se,
      };
    }).filter(Boolean).map((s: any, i: number) => ({ ...s, id: i + 1 }));

    console.timeEnd("WhisperTranscription");
    console.log("Analysis Completed (Rule-based).");

    // --- DEBUG ONLY: tmp/debug-analyze-output.json に出力 ---
    try {
      const debugTmpDir = resolve(process.cwd(), "tmp");
      mkdirSync(debugTmpDir, { recursive: true });
      const lastTl = timeline[timeline.length - 1];
      writeFileSync(
        resolve(debugTmpDir, "debug-analyze-output.json"),
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          durationInFrames: totalFramesAfterCut,
          timelineLastNewStartPlusDuration: lastTl ? lastTl.newStart + lastTl.duration : null,
          segments_top20: finalSegments.slice(0, 20).map((s: any) => ({ id: s.id, start: s.start, end: s.end })),
          timeline_top20: timeline.slice(0, 20).map((t: any) => ({ originalStart: t.originalStart, originalEnd: t.originalEnd, newStart: t.newStart, duration: t.duration })),
        }, null, 2),
        { encoding: "utf8" }
      );
    } catch (dbgErr) {
      console.error("[DEBUG] Failed to write debug-analyze-output.json:", (dbgErr as Error).message);
    }
    // --- END DEBUG ---

    return NextResponse.json({
      status: "COMPLETED",
      episodeJson: {
        meta: {
          title: finalSegments[0]?.text || "New Episode",
          fps: FPS,
          durationInFrames: totalFramesAfterCut,
          resolution: { width: 1080, height: 1920 }, // フォーマット固定
        },
        segments: finalSegments,
        cuts,
        timeline,
      },
      takesPacked,
    });

  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
