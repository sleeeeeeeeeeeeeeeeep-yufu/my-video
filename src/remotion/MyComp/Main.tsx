import {
  AbsoluteFill,
  Sequence,
  staticFile,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  Audio,
} from "remotion";
import { z } from "zod";
import React from 'react';
import { CompositionProps } from "../../../types/constants";

export const Main = (props: z.infer<typeof CompositionProps>) => {
  const { fixedTitle, videoSrc, segments, theme, audio } = props;
  const frame = useCurrentFrame();

  const vSrc = (videoSrc && videoSrc.trim() !== "") ? videoSrc : "test.mp4";
  
  // 現在のフレームに該当するセグメントを取得
  const activeSegment = segments.find((s: any) => frame >= s.start && frame < s.end);
  const zoom = activeSegment?.zoom ?? 1.0;
  
  // translate用のパーセンテージ計算 (e.g. 0.1 -> 10%)
  const translateX = (activeSegment?.zoomX || 0) * 100;
  const translateY = (activeSegment?.zoomY || 0) * 100;

  return (
    <AbsoluteFill className="bg-black" style={{ fontFamily: theme.fontFamily }}>
      {/* BGM 再生 */}
      {audio.bgm && (
        <Audio src={staticFile(`audio/${audio.bgm}.mp3`)} volume={audio.bgmVolume} loop />
      )}

      {/* 背景動画（セグメントに応じて疑似マルチカメラのズーム/パン適用） */}
      <AbsoluteFill style={{
        transform: `scale(${zoom}) translate(${translateX}%, ${translateY}%)`,
        transition: 'transform 0.1s linear'
      }}>
        {vSrc && (
          <OffthreadVideo 
            src={vSrc.startsWith('http') ? vSrc : staticFile(vSrc)} 
            className="object-cover w-full h-full" 
          />
        )}
      </AbsoluteFill>

      {/* 上部固定タイトル */}
      {fixedTitle && (
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
            whiteSpace: 'pre-wrap',
            zIndex: 10,
            boxShadow: '0px 4px 10px rgba(0,0,0,0.1)'
          }}
        >
          {fixedTitle.replace(/\\n/g, '\n').split('\n').map((line: string, i: number) => (
            <React.Fragment key={i}>
              {line}
              <br />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* セグメントごとの処理（テキストと効果音） */}
      {segments.map((segment: any) => {
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

        return (
          <Sequence key={segment.id} from={segment.start} durationInFrames={Math.max(1, segment.end - segment.start)}>
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
                localFrame={frame - segment.start}
                fontSize={fontSize} 
                textColor={textColor} 
                strokeColor={sColor} 
                strokeWidth={strokeWidth} 
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
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
  let text = segment.text || "";

  if (segment.animation === "pop") {
    // 最初の8フレームで1.2倍から1.0倍へポップイン
    scale = interpolate(localFrame, [0, 8], [1.2, 1], {
      extrapolateRight: "clamp",
      extrapolateLeft: "clamp",
    });
  } else if (segment.animation === "reveal") {
    // 2フレームごとに1文字出現（カラオケ風）
    const charsToShow = Math.max(1, Math.floor(localFrame / 2));
    text = text.slice(0, charsToShow);
  }

  return (
    <p style={({
      fontSize: `${fontSize}px`,
      color: textColor,
      fontWeight: 'bold',
      textAlign: 'center',
      WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
      paintOrder: 'stroke fill',
      textShadow: '0px 4px 15px rgba(0,0,0,0.5)',
      transform: `scale(${scale})`,
      whiteSpace: 'pre-wrap',
      lineHeight: '1.4',
      margin: 0,
      padding: '0 40px'
    }) as React.CSSProperties}>
      {text}
    </p>
  );
};
