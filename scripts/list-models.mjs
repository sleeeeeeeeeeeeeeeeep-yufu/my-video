import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    // Note: genAI.listModels() is not a function in the standard genAI client.
    // You usually just try them or use the REST API.
    // However, some versions have it. Let's try to find which models work.
    
    const modelsToTry = [
      "gemini-1.5-flash",
      "gemini-2.0-flash-exp",
      "gemini-1.5-pro",
      "gemini-2.0-pro-exp",
      "gemini-2.5-flash-preview-04-17"
    ];
    
    for (const m of modelsToTry) {
        try {
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("Hi");
            console.log(`Model ${m} WORKS: ${result.response.text().slice(0, 20)}`);
        } catch (e) {
            console.log(`Model ${m} FAILED: ${e.message}`);
        }
    }
  } catch (error) {
    console.error("List error:", error.message);
  }
}

listModels();
