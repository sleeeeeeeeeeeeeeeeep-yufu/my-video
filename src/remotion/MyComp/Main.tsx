import {
  AbsoluteFill,
  Sequence,
  staticFile,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  Audio,
} from "remotion";
import { loadDefaultJapaneseParser } from "budoux";
import { z } from "zod";
import React from 'react';
import { CompositionProps } from "../../../types/constants";

const parser = loadDefaultJapaneseParser();

/**
 * カット後の秒数から、元動画の秒数へ逆算する
 * @param afterTime カット後の秒数
 * @param cuts カット区間データ [{start: number, end: number}]
 * @returns 元動画の秒数
 */
function afterToOriginal(afterTime: number, cuts: any[]): number {
  const originalTimeBase = afterTime;
  let calculatedTime = afterTime;

  // カットリストをソート
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);

  for (const cut of sortedCuts) {
    if (calculatedTime >= cut.start) {
      calculatedTime += (cut.end - cut.start);
    } else {
      break;
    }
  }

  // ここが重要：入力と出力をセットで出す
  console.log(`[SYNC-CHECK] In: ${originalTimeBase} -> Out: ${calculatedTime}`);
  
  return calculatedTime;
}

export const Main = (props: z.infer<typeof CompositionProps>) => {
  const { fixedTitle, videoSrc, theme, audio } = props;
  const { segments, cuts = [] } = props as any;
  const frame = useCurrentFrame();

  const vSrc = (videoSrc && videoSrc.trim() !== "") ? videoSrc : "test.mp4";
  
  // 現在のフレームに該当するセグメントを取得（フレーム単位で比較）
  const activeSegment = (segments || []).find((s: any) => frame >= s.start && frame < s.end);
  const zoom = activeSegment?.zoom ?? 1.0;
  
  // translate用のパーセンテージ計算 (e.g. 0.1 -> 10%)
  const translateX = (activeSegment?.zoomX || 0) * 100;
  const translateY = (activeSegment?.zoomY || 0) * 100;

  // 現在のフレームがカット区間に含まれているか判定（フレーム単位で比較）
  const isInCut = (cuts || []).some(
    (cut: any) => frame >= cut.start && frame < cut.end
  );

  // カット境界 30ms フェード（FADE_FRAMES = ceil(fps * 0.03)）
  const fps = (props as any).meta?.fps ?? 30;
  const FADE_FRAMES = Math.ceil(fps * 0.03);
  let fadeFactor = 1;
  for (const cut of (cuts || [])) {
    // カット開始直前: フェードアウト
    if (frame >= cut.start - FADE_FRAMES && frame < cut.start) {
      fadeFactor = Math.min(fadeFactor, (cut.start - frame) / FADE_FRAMES);
    }
    // カット終了直後: フェードイン
    if (frame >= cut.end && frame < cut.end + FADE_FRAMES) {
      fadeFactor = Math.min(fadeFactor, (frame - cut.end) / FADE_FRAMES);
    }
  }
  fadeFactor = Math.max(0, Math.min(1, fadeFactor));

  return (
    <AbsoluteFill className="bg-black" style={{ fontFamily: theme.fontFamily }}>
      {/* BGM 再生 */}
      {audio.bgm && (
        <Audio src={staticFile(`audio/${audio.bgm}.mp3`)} volume={audio.bgmVolume * fadeFactor} loop />
      )}

      <AbsoluteFill style={{
        transform: `scale(${zoom}) translate(${translateX}%, ${translateY}%)`,
        transition: 'transform 0.1s linear'
      }}>
        {vSrc && (
          <>
            {isInCut && (
              <AbsoluteFill style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 5 }} />
            )}
            <OffthreadVideo
              src={vSrc.startsWith('http') ? vSrc : staticFile(vSrc)}
              className="object-cover w-full h-full"
              volume={fadeFactor}
              crossOrigin="anonymous"
            />
          </>
        )}
      </AbsoluteFill>

      {/* 上部固定タイトル */}
      {fixedTitle && fixedTitle.trim() !== "" && (
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            backgroundColor: theme.titleBgColor,
            color: theme.titleTextColor,
            fontSize: `${theme.titleFontSize}px`,
            fontWeight: 'bold',
            textAlign: 'center',
            padding: '40px 20px',
            whiteSpace: 'normal', // pre-wrapから変更（wbrを効かせるため）
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            zIndex: 10,
            boxShadow: '0px 4px 10px rgba(0,0,0,0.1)',
            lineHeight: '1.3'
          }}
        >
          {fixedTitle.replace(/\\n/g, '\n').split('\n').map((line: string, i: number) => (
            <React.Fragment key={i}>
              {parser.parse(line).map((phrase, j) => (
                <React.Fragment key={j}>
                  {phrase}
                  <wbr />
                </React.Fragment>
              ))}
              <br />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* セグメントごとの処理（テキストと効果音） */}
      {(() => {
        if (segments && segments.length > 0) {
          const sample = segments[0].start;
          console.log("--- FINAL UNIT CHECK ---");
          console.log("Total Cuts:", cuts?.length);
          console.log("Sample Value:", sample);
          console.log("Type:", typeof sample);
          console.log("Is Integer?:", Number.isInteger(sample));
        }
        return null;
      })()}
      {segments && segments.length > 0 && segments.map((segment: any, i: number) => {
        const isCenter = segment.position === "center";
        
        let textColor = theme.mainTextColor;
        let sColor = theme.strokeColor;
        if (segment.color === "green") {
          textColor = "#63BFA0";
        } else if (segment.color === "red") {
          textColor = "#FF4444";
        }

        const fontSize = segment.highlight ? theme.captionFontSize * 1.2 : theme.captionFontSize;
        const strokeWidth = segment.highlight ? theme.strokeWidth * 1.5 : theme.strokeWidth;

        const startFrame = afterToOriginal(segment.start, cuts);
        const endFrame = afterToOriginal(segment.end, cuts);
        
        const durationFrames = Math.max(1, endFrame - startFrame);

        return (
          <Sequence 
            key={segment.id || i} 
            from={startFrame} 
            durationInFrames={durationFrames}
          >
            {/* SE再生（none以外の場合） */}
            {segment.se && segment.se !== "none" && (
              <Audio src={staticFile(`se/${segment.se}.mp3`)} />
            )}

            <AbsoluteFill style={{
              justifyContent: isCenter ? 'center' : 'flex-end',
              alignItems: 'center',
              paddingBottom: isCenter ? '0' : '250px',
              zIndex: 20
            }}>
              <SegmentText 
                segment={segment} 
                localFrame={frame - startFrame}
                fontSize={fontSize} 
                textColor={textColor} 
                strokeColor={sColor} 
                strokeWidth={strokeWidth} 
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {(() => {
        if (segments && segments.length > 0) {
          console.log("LAST SEGMENT END FRAME:", afterToOriginal(segments[segments.length - 1].end, cuts));
        }
        console.log("--- DEBUG END ---");
        return null;
      })()}
    </AbsoluteFill>
  );
};

// セグメント単位のテキストコンポーネント（アニメーション制御用）
const SegmentText: React.FC<{
  segment: any, 
  localFrame: number,
  fontSize: number, 
  textColor: string, 
  strokeColor: string, 
  strokeWidth: number
}> = ({ segment, localFrame, fontSize, textColor, strokeColor, strokeWidth }) => {
  let scale = 1;
  const originalText = (segment.text || "").replace(/\n/g, "");
  
  // 絵文字を末尾から分離（BudouXの脱落防止と改行ズレ対策）
  const emojiMatch = originalText.match(/([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27FF])+$/);
  const emoji = emojiMatch ? emojiMatch[0] : "";
  const textWithoutEmoji = emojiMatch ? originalText.slice(0, -emoji.length) : originalText;

  const phrases = parser.parse(textWithoutEmoji);
  const totalLength = textWithoutEmoji.length;
  
  // 分割点を全体の文字数の半分に最も近い文節の区切りにする（絵文字を除いたテキストベース）
  const mid = totalLength / 2;
  let splitIndex = 0;
  let cumulative = 0;
  let minDiff = totalLength;

  for (let i = 0; i < phrases.length; i++) {
    cumulative += phrases[i].length;
    const diff = Math.abs(cumulative - mid);
    if (diff <= minDiff) {
      minDiff = diff;
      splitIndex = i + 1;
    } else {
      break;
    }
  }

  const line1Base = phrases.slice(0, splitIndex).join("");
  const line2Base = phrases.slice(splitIndex).join("");

  // 絵文字を2行目（または1行目）の末尾に結合
  const line1Full = line2Base.length === 0 ? line1Base + emoji : line1Base;
  const line2Full = line2Base.length > 0 ? line2Base + emoji : "";

  let charsToShow = originalText.length;
  if (segment.animation === "pop") {
    scale = interpolate(localFrame, [0, 8], [1.2, 1], {
      extrapolateRight: "clamp",
      extrapolateLeft: "clamp",
    });
  } else if (segment.animation === "reveal") {
    charsToShow = Math.max(1, Math.floor(localFrame / 2));
  }

  const displayLine1 = line1Full.slice(0, charsToShow);
  const displayLine2 = line2Full.slice(0, Math.max(0, charsToShow - line1Full.length));

  return (
    <div style={({
      fontSize: `${fontSize}px`,
      color: textColor,
      fontWeight: 'bold',
      textAlign: 'center',
      WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
      paintOrder: 'stroke fill',
      textShadow: '0px 4px 15px rgba(0,0,0,0.5)',
      transform: `scale(${scale})`,
      wordBreak: 'keep-all',
      overflowWrap: 'anywhere',
      lineHeight: '1.4',
      margin: 0,
      padding: '0 40px'
    }) as React.CSSProperties}>
      <div style={{ display: 'block' }}>
        {parser.parse(displayLine1).map((phrase, i) => (
          <React.Fragment key={i}>
            {phrase}
            <wbr />
          </React.Fragment>
        ))}
      </div>
      {line2Full.length > 0 && (
        <div style={{ display: 'block' }}>
          {parser.parse(displayLine2).map((phrase, i) => (
            <React.Fragment key={i}>
              {phrase}
              <wbr />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
