import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API key found in .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function checkModels() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello?");
        console.log("Success with gemini-1.5-flash:");
        console.log(result.response.text());
        
        try {
            const model25 = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
            const result25 = await model25.generateContent("Hello?");
            console.log("Success with gemini-2.5-flash-preview-04-17:");
            console.log(result25.response.text());
        } catch (e) {
            console.error("Failed with gemini-2.5-flash-preview-04-17:", e.message);
        }
    } catch (error) {
        console.error("General error:", error.message);
    }
}

checkModels();
