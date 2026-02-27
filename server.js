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
const ENABLE_STYLE_REFERENCE = parseBoolean(process.env.ENABLE_STYLE_REFERENCE, false);
const STYLE_REFERENCE_IMAGE_PATH = process.env.STYLE_REFERENCE_IMAGE_PATH || "";
const STYLE_REFERENCE_MIME_TYPE = process.env.STYLE_REFERENCE_MIME_TYPE || "";
const APPEND_STYLE_REFERENCE_NOTICE = parseBoolean(
  process.env.APPEND_STYLE_REFERENCE_NOTICE,
  true
);
const STYLE_REFERENCE_NOTICE =
  process.env.STYLE_REFERENCE_NOTICE ||
  "以下参考图仅用于整体视觉风格参考（例如配色、光影、笔触、构图与氛围），不是人物形象参考图，不用于复制人物身份、五官、体型、年龄、性别或具体角色特征。";

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

function parseBoolean(value, defaultValue = false) {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

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

function inferMimeTypeFromFilePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function buildPromptForGemini(userPrompt) {
  if (!APPEND_STYLE_REFERENCE_NOTICE) return userPrompt;
  return `${userPrompt}\n\n${STYLE_REFERENCE_NOTICE}`;
}

function loadStyleReferenceInlineData() {
  if (!ENABLE_STYLE_REFERENCE) return null;
  if (!STYLE_REFERENCE_IMAGE_PATH) {
    throw new Error(
      "ENABLE_STYLE_REFERENCE is true but STYLE_REFERENCE_IMAGE_PATH is empty"
    );
  }

  const styleImageAbsPath = path.resolve(process.cwd(), STYLE_REFERENCE_IMAGE_PATH);
  if (!fs.existsSync(styleImageAbsPath)) {
    throw new Error(`Style reference image not found: ${styleImageAbsPath}`);
  }

  const fileBuffer = fs.readFileSync(styleImageAbsPath);
  const mimeType =
    STYLE_REFERENCE_MIME_TYPE || inferMimeTypeFromFilePath(styleImageAbsPath);
  if (mimeType === "application/octet-stream") {
    throw new Error(
      "Unable to infer style image mime type. Set STYLE_REFERENCE_MIME_TYPE in .env"
    );
  }

  return {
    inlineData: {
      mimeType,
      data: fileBuffer.toString("base64")
    }
  };
}

async function generateImageFromGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const styleReferencePart = loadStyleReferenceInlineData();
  const requestParts = [{ text: prompt }];
  if (styleReferencePart) {
    requestParts.push(styleReferencePart);
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: requestParts
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

    const finalPrompt = buildPromptForGemini(prompt);
    const image = await generateImageFromGemini(finalPrompt);
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
