import { NextRequest, NextResponse } from "next/server";

const FPS = 30;
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

    // 2. 言葉のギャップからcuts配列を作成 (Gap >= 0.5s)
    const cuts: any[] = [];
    for (let i = 0; i < allWords.length - 1; i++) {
        const gap = allWords[i + 1].start - allWords[i].end;
        if (gap >= 0.5) {
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

      return {
        id: idx + 1,
        type,
        start: frameStart,
        end: frameEnd,
        text: seg.text,
        animation,
        position: "bottom",
        zoom: 1.0,
        se,
      };
    });

    console.timeEnd("WhisperTranscription");
    console.log("Analysis Completed (Rule-based).");

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
    });

  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
