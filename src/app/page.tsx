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
import { extractAudioFromVideo } from "../lib/audioUtils";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => reject(new Error("Failed to load video metadata"));
    video.src = window.URL.createObjectURL(file);
  });
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
  const [isScriptLoading, setIsScriptLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptInputRef = useRef<HTMLInputElement>(null);

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
    setVideoFile(file); // Store file for analysis
    try {
      // 動画の実際の長さを取得して反映
      const durationSeconds = await getVideoDuration(file);
      const fps = episode.meta?.fps || 30;
      const computedDurationFrames = Math.max(1, Math.round(durationSeconds * fps));

      setInputEpisode((prev: any) => ({
        ...prev,
        meta: {
          ...prev.meta,
          durationInFrames: computedDurationFrames
        }
      }));

      setIsUploading(true);
      setUploadProgress(0);

      // 1. Get Presigned URL from our API
      const res = await fetch("/api/get-signed-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "video/mp4",
        }),
      });

      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error("Non-JSON response from server:", responseText);
        throw new Error(`Server returned non-JSON response (Status: ${res.status}). Payload: ${responseText.slice(0, 100)}...`);
      }

      if (!res.ok) throw new Error(data.error || "Unknown server error");

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

  const sendChatMessage = async (messageContent: string, options?: { isPartial?: boolean }) => {
    if (!messageContent.trim()) return;
    const { isPartial } = options || {};
    
    const userMessage: Message = { role: "user", content: messageContent };
    setMessages((prev) => [...prev, userMessage]);
    setIsChatLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: [...messages, userMessage],
          currentEpisodeState: inputEpisode,
          isPartial
        }),
      });
      const data = await res.json();
      
      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `APIエラー: ${data.error}` },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
      
      if (data.episodeJson) {
        // パーシャルアップデート（配列のみ）かフルアップデート（オブジェクト）かを判別してマージ
        const isArray = Array.isArray(data.episodeJson);
        const newSegments = isArray ? data.episodeJson : data.episodeJson.segments;

        if (newSegments) {
          setInputEpisode((prev: any) => ({
            ...prev,
            ...(isArray ? {} : data.episodeJson), // オブジェクトなら全体をマージ（theme等含む）
            segments: newSegments, // 字幕リストを差し替え
          }));
          
          // タイトルが含まれていれば反映
          const newTitle = isArray ? null : data.episodeJson.meta?.title;
          if (newTitle) {
            setText(newTitle);
          }
        } else if (!isArray) {
          // segmentsが含まれないオブジェクト（テーマ変更のみ等）の場合
          setInputEpisode((prev: any) => ({
            ...prev,
            ...data.episodeJson
          }));
        }
      } else {
        // AIがJSONを返さなかった場合
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "（※データの更新は行われませんでした。もう一度詳しく指示してみてください）" },
        ]);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "エラーが発生しました。" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleChatSend = () => {
    sendChatMessage(chatInput);
    setChatInput("");
  };

  const handleScriptUploadClick = () => {
    scriptInputRef.current?.click();
  };

  const handleScriptFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsScriptLoading(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `台本「${file.name}」を読み込んでいます...テキストに基づいて構成を行います。` },
    ]);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        if (text) {
          const prompt = `以下の台本テキストを元に、字幕セグメントを構成・校正してください。\n\n【台本】\n${text}`;
          await sendChatMessage(prompt, { isPartial: true });
        }
      } catch (error) {
        console.error("Script process error:", error);
        alert("台本の処理中にエラーが発生しました。");
      } finally {
        setIsScriptLoading(false);
        if (scriptInputRef.current) {
           scriptInputRef.current.value = "";
        }
      }
    };
    reader.onerror = () => {
      alert("ファイルの読み込みに失敗しました。");
      setIsScriptLoading(false);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    if (!videoSrc || !videoFile) return;
    setIsAnalyzing(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "音声データを抽出中..." },
    ]);
    
    try {
      // 1. クライアント側で音声を抽出 (Web Audio API)
      const audioBlob = await extractAudioFromVideo(videoFile);
      
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "音声の解析を開始しました。これには数分かかる場合があります..." },
      ]);

      // 2. 音声データを送信してジョブを開始
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.wav");

      const startRes = await fetch("/api/analyze", {
        method: "POST",
        body: formData, // FormData として音声ファイルを送信
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error);
      
      const jobId = startData.jobId;

      // 3. 完了するまで数秒おきにステータスをポーリングする
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const statusRes = await fetch("/api/analyze/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, videoUrl: videoSrc }),
        });
        
        const statusData = await statusRes.json();
        
        if (statusData.status === "COMPLETED") {
          if (statusData.episodeJson) {
            setInputEpisode((prev: any) => ({
              ...statusData.episodeJson,
              meta: {
                ...statusData.episodeJson.meta,
                // 解析APIの固定値で上書きされないようにクライアントの長さを保持
                durationInFrames: prev.meta?.durationInFrames || statusData.episodeJson.meta?.durationInFrames
              }
            }));
            if (statusData.episodeJson.meta?.title) {
              setText(statusData.episodeJson.meta.title);
            }
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "解析が完了しました！無音区間の調整と字幕の生成が完了しました。" },
            ]);
          }
          break;
        } else if (statusData.status === "FAILED") {
          throw new Error(statusData.error || "Geminiでの解析に失敗しました。");
        }
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
            durationInFrames={inputProps.meta?.durationInFrames || 1200}
            fps={inputProps.meta?.fps || 30}
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
              type="file"
              accept=".txt,.md"
              className="hidden"
              ref={scriptInputRef}
              onChange={handleScriptFileChange}
            />
            <button
              onClick={handleScriptUploadClick}
              disabled={isChatLoading || isScriptLoading}
              className="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed flex-shrink-0"
              title="台本(.txt, .md)をアップロードして字幕を自動生成"
            >
              📄 台本
            </button>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isChatLoading && !isScriptLoading && handleChatSend()}
              placeholder="例：テロップを大きくして"
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              onClick={handleChatSend}
              disabled={isChatLoading || isScriptLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-blue-200 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {isChatLoading ? "送信中..." : "送信"}
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
