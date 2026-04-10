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
        return (data.segments || []).map((seg: any) => ({
          start: seg.start + offset,
          end: seg.end + offset,
          text: seg.text.trim(),
        }));
      })
    );
    console.timeEnd("WhisperTranscription");

    // Merge all segments
    const allSegments = transcriptions.flat();
    console.log(`Merged ${allSegments.length} segments.`);

    // 2. Rule-based Enrichment (INSTANT replacement for GPT)
    // GPT-4o-mini was taking 49s, so we use rules for basic categorization.
    // Users can refine these via chat instructions later.
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
        // Simple periodic emphasis for visual variety
        type = "emphasis";
        se = "chan";
      }

      return {
        id: idx + 1,
        type,
        start: Math.round(seg.start * FPS),
        end: Math.round(seg.end * FPS),
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
        },
        segments: finalSegments,
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
