const fs = require("fs");
const path = require("path");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.0-flash-exp-image-generation";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "generated";

const outputDirAbsPath = path.resolve(process.cwd(), OUTPUT_DIR);
if (!fs.existsSync(outputDirAbsPath)) {
  fs.mkdirSync(outputDirAbsPath, { recursive: true });
}

app.use("/generated", express.static(outputDirAbsPath));

app.get("/download/:filename", (req, res) => {
  const filePath = path.join(outputDirAbsPath, req.params.filename);
  if (!filePath.startsWith(outputDirAbsPath) || !fs.existsSync(filePath)) {
    return res.status(404).json({
      error: {
        message: "File not found",
        type: "invalid_request_error"
      }
    });
  }
  return res.download(filePath);
});

function extractPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m && m.role === "user");

  if (!lastUserMessage) return "";

  const content = lastUserMessage.content;
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const textParts = content
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean);
    return textParts.join("\n");
  }

  return "";
}

function inferExtension(mimeType) {
  if (!mimeType) return "png";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function generateImageFromGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const message =
      data?.error?.message ||
      `Gemini request failed with status ${response.status}`;
    throw new Error(message);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error("Gemini did not return image data");
  }

  return {
    base64Data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png"
  };
}

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model, messages } = req.body || {};
    const prompt = extractPrompt(messages);

    if (!prompt) {
      return res.status(400).json({
        error: {
          message: "Invalid request: unable to extract user prompt from messages",
          type: "invalid_request_error"
        }
      });
    }

    const image = await generateImageFromGemini(prompt);
    const extension = inferExtension(image.mimeType);
    const fileName = `${uuidv4()}.${extension}`;
    const filePath = path.join(outputDirAbsPath, fileName);

    fs.writeFileSync(filePath, Buffer.from(image.base64Data, "base64"));

    const url = `${BASE_URL}/download/${fileName}`;
    const created = Math.floor(Date.now() / 1000);

    return res.json({
      id: `chatcmpl-${uuidv4()}`,
      object: "chat.completion",
      created,
      model: model || "gpt-4o-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: url
          }
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: {
        message: error.message || "Unexpected server error",
        type: "server_error"
      }
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`GenImage proxy listening on http://localhost:${PORT}`);
});
