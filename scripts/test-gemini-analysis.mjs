import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import os from "os";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is missing in .env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

async function runTest() {
  const videoUrl = "https://5rd0krh0qvfcp2cw.public.blob.vercel-storage.com/%E7%94%BB%E9%9D%A2%E9%8C%B2%E7%94%BB%202026-04-09%20000236.mp4";
  const tempFilePath = path.join(os.tmpdir(), "test-video.mp4");

  try {
    console.log("Downloading test video...");
    const response = await fetch(videoUrl);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

    console.log("Uploading to Gemini File API...");
    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
      mimeType: "video/mp4",
      displayName: "Test Video",
    });

    const name = uploadResponse.file.name;
    let file = await fileManager.getFile(name);
    while (file.state === FileState.PROCESSING) {
      process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      file = await fileManager.getFile(name);
    }
    console.log("\nProcessing complete.");

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const prompt = "Analyze this video for silences, speech intervals, and filler words. Return JSON only.";

    console.log("Running analysis...");
    const result = await model.generateContent([
      {
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        },
      },
      { text: prompt },
    ]);

    console.log("Result:");
    console.log(result.response.text());

    console.log("Cleaning up Gemini File...");
    await fileManager.deleteFile(name);

  } catch (error) {
    console.error("Error during test:", error);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

runTest();
