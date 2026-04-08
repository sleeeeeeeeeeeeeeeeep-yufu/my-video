"use client";

import { Player } from "@remotion/player";
import type { NextPage } from "next";
import { useMemo, useState, useRef } from "react";
import { z } from "zod";
import { upload } from "@vercel/blob/client";
import { CompositionProps, defaultMyCompProps } from "../../types/constants";
import { RenderControls } from "../components/RenderControls";
import { Spacing } from "../components/Spacing";
import { Tips } from "../components/Tips";
import { Main } from "../remotion/MyComp/Main";
// @ts-ignore
import episode from "../episode.json";

const Home: NextPage = () => {
  const [text, setText] = useState<string>(episode.meta?.title || defaultMyCompProps.meta.title);
  const [videoSrc, setVideoSrc] = useState<string>(episode.videoSrc || "");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputProps: z.infer<typeof CompositionProps> = useMemo(() => {
    return {
      ...(episode as any),
      videoSrc: videoSrc,
      meta: {
        ...episode.meta,
        title: text,
      }
    };
  }, [text, videoSrc]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // 1. Vercel Blob へアップロード
      const newBlob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        onUploadProgress: (progressEvent) => {
          setUploadProgress(Math.round(progressEvent.percentage));
        },
      });

      const uploadedUrl = newBlob.url;
      setVideoSrc(uploadedUrl);

      // 2. ローカルの episode.json を更新
      const response = await fetch('/api/episode/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoSrc: uploadedUrl }),
      });

      if (!response.ok) {
        throw new Error('Failed to update episode.json');
      }

      alert('動画のアップロードと設定の更新が完了しました！');
    } catch (error) {
      console.error('Upload failed:', error);
      alert('アップロードに失敗しました: ' + (error as Error).message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div>
      <div className="max-w-screen-md m-auto mb-5 px-4">
        <div className="overflow-hidden rounded-geist shadow-[0_0_200px_rgba(0,0,0,0.15)] mb-10 mt-16">
          <Player
            component={Main}
            inputProps={inputProps}
            durationInFrames={episode.meta?.durationInFrames || 1200}
            fps={episode.meta?.fps || 30}
            compositionHeight={episode.meta?.resolution?.height || 1920}
            compositionWidth={episode.meta?.resolution?.width || 1080}
            style={{
              width: "100%",
            }}
            controls
            autoPlay
            loop
          />
        </div>

        {/* Upload Section */}
        <div className="bg-white p-6 rounded-geist shadow-sm border border-gray-100 mb-8">
          <h3 className="text-lg font-bold mb-4 text-gray-800">動画素材をアップロード</h3>
          <div className="flex flex-col gap-4">
            <input
              type="file"
              accept="video/mp4"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className={`py-3 px-6 rounded-lg font-medium transition-all ${
                isUploading 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-md shadow-blue-200'
              }`}
            >
              {isUploading ? `アップロード中 (${uploadProgress}%)` : 'MP4ファイルを選択'}
            </button>
            {isUploading && (
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all duration-300" 
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            <p className="text-xs text-gray-500">
              ※ アップロードされたファイルは Vercel Blob に保存され、episode.json の videoSrc が自動更新されます。
            </p>
          </div>
        </div>

        <RenderControls
          text={text}
          setText={setText}
          inputProps={inputProps}
        ></RenderControls>
        <Spacing></Spacing>
        <Spacing></Spacing>
        <Tips></Tips>
      </div>
    </div>
  );
};

export default Home;
