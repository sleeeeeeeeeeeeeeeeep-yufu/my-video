"use client";

import { Player } from "@remotion/player";
import type { NextPage } from "next";
import { useMemo, useState, useRef } from "react";
import { z } from "zod";
import { CompositionProps, defaultMyCompProps } from "../../types/constants";
import { RenderControls } from "../components/RenderControls";
import { Spacing } from "../components/Spacing";
import { Tips } from "../components/Tips";
import { Main } from "../remotion/MyComp/Main";
// @ts-ignore
import episode from "../episode.json";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const Home: NextPage = () => {
  const [inputEpisode, setInputEpisode] = useState<any>(episode);
  const [text, setText] = useState<string>(
    episode.meta?.title || defaultMyCompProps.meta.title,
  );
  const [videoSrc, setVideoSrc] = useState<string>(episode.videoSrc || "");
  const [originalFileName, setOriginalFileName] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputProps: z.infer<typeof CompositionProps> = useMemo(() => {
    return {
      ...inputEpisode,
      videoSrc: videoSrc,
      meta: {
        ...inputEpisode.meta,
        title: text,
      },
    };
  }, [inputEpisode, text, videoSrc]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIsUploading(true);
      setUploadProgress(0);

      // 1. Get Presigned URL from our API
      const res = await fetch("/api/upload-s3", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "video/mp4",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // 2. Upload directly to S3 using XMLHttpRequest for progress tracking
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentage = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percentage);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response);
          } else {
            console.error("Upload failed with status:", xhr.status, xhr.responseText);
            reject(new Error(`S3 upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          console.error("XHR error during upload");
          reject(new Error("Network error during S3 upload. S3 CORS may be misconfigured."));
        };

        xhr.open("PUT", data.presignedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.send(file);
      });

      // 3. Complete
      setUploadProgress(100);
      setVideoSrc(data.url);
      setOriginalFileName(file.name.replace(/\.[^/.]+$/, "") + ".mp4");
      alert("アップロード完了しました！");
    } catch (error) {
      console.error(error);
      alert("アップロードに失敗しました: " + (error as Error).message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim()) return;
    const userMessage: Message = { role: "user", content: chatInput };
    setMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsChatLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
      if (data.episodeJson) {
        setInputEpisode(data.episodeJson);
        if (data.episodeJson.meta?.title) {
          setText(data.episodeJson.meta.title);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "エラーが発生しました。" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!videoSrc) return;
    setIsAnalyzing(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "動画を解析しています。これには数分かかる場合があります..." },
    ]);
    
    try {
      // 1. ジョブを開始して ID を受け取る
      const startRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: videoSrc }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error);
      
      const jobId = startData.jobId;

      // 2. 完了するまで数秒おきにステータスをポーリングする
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3秒待機

        const statusRes = await fetch("/api/analyze/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, videoUrl: videoSrc }),
        });
        
        const statusData = await statusRes.json();
        
        if (statusData.status === "COMPLETED") {
          if (statusData.episodeJson) {
            setInputEpisode(statusData.episodeJson);
            if (statusData.episodeJson.meta?.title) {
              setText(statusData.episodeJson.meta.title);
            }
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "解析が完了しました！無音区間の調整と字幕の生成を行いました。" },
            ]);
          }
          break; // ポーリング終了
        } else if (statusData.status === "FAILED") {
          throw new Error(statusData.error || "Geminiでの動画処理に失敗しました。");
        }
        // status が PROCESSING の場合は何もしない（次のループへ）
      }

    } catch (error) {
      alert("解析中にエラーが発生しました: " + (error as Error).message);
    } finally {
      setIsAnalyzing(false);
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
            style={{ width: "100%" }}
            controls
            loop
          />
        </div>

        {/* Upload Section */}
        <div className="bg-white p-6 rounded-geist shadow-sm border border-gray-100 mb-8">
          <h3 className="text-lg font-bold mb-4 text-gray-800">
            動画素材をアップロード
          </h3>
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
            className={`w-full py-3 px-6 rounded-lg font-medium transition-all ${
              isUploading
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-md shadow-blue-200"
            }`}
          >
            {isUploading
              ? `アップロード中 (${uploadProgress}%)`
              : "MP4ファイルを選択"}
          </button>
          {isUploading && (
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-3">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          {videoSrc && (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className={`w-full mt-4 py-3 px-6 rounded-lg font-medium transition-all ${
                isAnalyzing
                  ? "bg-purple-100 text-purple-400 cursor-not-allowed"
                  : "bg-purple-600 text-white hover:bg-purple-700 active:scale-95 shadow-md shadow-purple-200"
              }`}
            >
              {isAnalyzing ? "AI解析中..." : "AIで動画を解析して構成を作る"}
            </button>
          )}
        </div>

        {/* Chat Section */}
        <div className="bg-white p-6 rounded-geist shadow-sm border border-gray-100 mb-8">
          <h3 className="text-lg font-bold mb-4 text-gray-800">AIに指示する</h3>
          <div className="flex flex-col gap-3 mb-4 max-h-80 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-sm text-gray-400">
                「テロップを大きくして」「背景を暗くして」など、日本語で指示してください。
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`px-4 py-2 rounded-2xl text-sm max-w-xs ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="px-4 py-2 rounded-2xl text-sm bg-gray-100 text-gray-400">
                  考え中...
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
              placeholder="例：テロップを大きくして"
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              onClick={handleChatSend}
              disabled={isChatLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              送信
            </button>
          </div>
        </div>

        <RenderControls
          text={text}
          setText={setText}
          inputProps={inputProps}
          originalFileName={originalFileName}
        />
        <Spacing />
        <Spacing />
        <Tips />
      </div>
    </div>
  );
};

export default Home;
