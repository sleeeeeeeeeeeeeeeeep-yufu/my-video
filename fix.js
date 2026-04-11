const fs = require('fs');
const filePath = 'c:\\\\Users\\\\yufu\\\\my-video\\\\src\\\\app\\\\page.tsx';
let code = fs.readFileSync(filePath, 'utf8');

const startStr = "  const handleDragLeave  const sendChatMessage = async";
const endStr = "   };";

const startIdx = code.indexOf(startStr);
if (startIdx === -1) {
  console.error("Start string not found");
  process.exit(1);
}

const endIdx = code.indexOf(endStr, startIdx);
if (endIdx === -1) {
  console.error("End string not found");
  process.exit(1);
}
// Include the end string in the replacement
const replaceEnd = endIdx + endStr.length;

const replacement = `  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      handleFileChange(file);
    }
  };

  const sendChatMessage = async (messageContent: string, options?: { isPartial?: boolean }) => {
    if (!messageContent.trim()) return;
    const { isPartial } = options || {};
    
    const userMessage: Message = { role: "user", content: messageContent };
    setMessages((prev) => [...prev, userMessage]);
    setIsChatLoading(true);

    try {
      // 意図の簡易判定
      let target: "metadata" | "segments" | "all" = "segments";
      if (!isPartial) {
        const msg = messageContent.toLowerCase();
        // デザイン・設定系のキーワード
        const isTheme = /色|カラー|color|赤|青|緑|白|黒|フォント|サイズ|大きく|小さく|太字|縁取り|タイトル|背景|テーマ|雰囲気/.test(msg);
        // 内容・編集系のキーワード
        const isSegments = /台本|作成|文字|修正|タイミング|追加|削除|消して|と言って|喋り/.test(msg);
        
        if (isTheme && !isSegments) target = "metadata";
        else target = "segments";
      }

      console.log(\`Chat Mode: \${target}, isPartial: \${isPartial}\`);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: [...messages, userMessage],
          currentEpisodeState: inputEpisode,
          isPartial: isPartial === true,
          target
        }),
      });
      const data = await res.json();
      
      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: \`APIエラー: \${data.error}\` },
        ]);
        return;
      }

      const { reply, segments, theme } = data;
      
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply || "対応が完了しました。" },
      ]);
      
      if (segments) {
        setInputEpisode((prev: any) => ({ ...prev, segments }));
      }
      if (theme) {
        setInputEpisode((prev: any) => ({ ...prev, theme: { ...prev.theme, ...theme } }));
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
  };`;

const newCode = code.substring(0, startIdx) + replacement + code.substring(replaceEnd);
fs.writeFileSync(filePath, newCode, 'utf8');
console.log("Fixed!");
