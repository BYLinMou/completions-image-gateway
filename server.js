const fs = require("fs");
const path = require("path");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.0-flash-exp-image-generation";
const GEMINI_ENDPOINT = process.env.GEMINI_ENDPOINT || "";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "generated";

const REQUIRE_API_KEY = parseBoolean(process.env.REQUIRE_API_KEY, true);
const API_KEY = process.env.API_KEY || "";

const ENABLE_STYLE_REFERENCE = parseBoolean(
  process.env.ENABLE_STYLE_REFERENCE,
  false
);
const STYLE_REFERENCE_SOURCE = process.env.STYLE_REFERENCE_SOURCE || "";
const STYLE_REFERENCE_MIME_TYPE = process.env.STYLE_REFERENCE_MIME_TYPE || "";
const APPEND_STYLE_NOTICE = parseBoolean(process.env.APPEND_STYLE_NOTICE, true);
const STYLE_REFERENCE_CACHE_DIR =
  process.env.STYLE_REFERENCE_CACHE_DIR || "style-reference-cache";
const STYLE_REFERENCE_REFRESH = parseBoolean(
  process.env.STYLE_REFERENCE_REFRESH,
  false
);
const STYLE_REFERENCE_TIMEOUT_MS = parsePositiveInt(
  process.env.STYLE_REFERENCE_TIMEOUT_MS,
  15000
);
const STYLE_NOTICE =
  process.env.STYLE_NOTICE ||
  "The reference image is STYLE-ONLY. Use it only for overall visual style (palette, lighting, brushwork, composition, mood). It is NOT a person/identity reference. Do not copy face, identity, body, age, gender, or character-specific traits.";

const outputDirAbsPath = path.resolve(process.cwd(), OUTPUT_DIR);
const styleReferenceCacheAbsPath = path.resolve(process.cwd(), STYLE_REFERENCE_CACHE_DIR);
if (!fs.existsSync(outputDirAbsPath)) {
  fs.mkdirSync(outputDirAbsPath, { recursive: true });
}
if (!fs.existsSync(styleReferenceCacheAbsPath)) {
  fs.mkdirSync(styleReferenceCacheAbsPath, { recursive: true });
}

const styleReferenceCacheFilePath = path.join(
  styleReferenceCacheAbsPath,
  "style-reference.bin"
);
const styleReferenceCacheMetaPath = path.join(
  styleReferenceCacheAbsPath,
  "style-reference-meta.json"
);
let styleReferenceDownloadPromise = null;

if (REQUIRE_API_KEY && !API_KEY) {
  throw new Error("REQUIRE_API_KEY is true but API_KEY is empty. Set API_KEY in .env");
}

app.use("/generated", express.static(outputDirAbsPath));

app.get("/download/:filename", (req, res) => {
  const filePath = path.resolve(outputDirAbsPath, req.params.filename);
  if (
    !filePath.startsWith(`${outputDirAbsPath}${path.sep}`) ||
    !fs.existsSync(filePath)
  ) {
    return res.status(404).json({
      error: {
        message: "File not found",
        type: "invalid_request_error"
      }
    });
  }
  return res.download(filePath);
});

app.use("/v1", requireApiKey);

function parseBoolean(value, defaultValue = false) {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInt(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function extractBearerToken(authHeader) {
  if (typeof authHeader !== "string") return "";
  const [scheme, token] = authHeader.trim().split(/\s+/, 2);
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token;
}

function requireApiKey(req, res, next) {
  if (!REQUIRE_API_KEY) {
    return next();
  }

  const bearerToken = extractBearerToken(req.headers.authorization);
  const xApiKey =
    typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "";
  const providedKey = bearerToken || xApiKey;

  if (providedKey !== API_KEY) {
    return res.status(401).json({
      error: {
        message:
          "Unauthorized: invalid API key. Use Authorization: Bearer YOUR_API_KEY or x-api-key.",
        type: "invalid_request_error",
        code: "invalid_api_key"
      }
    });
  }

  return next();
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

function normalizeMimeType(value) {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function buildPromptForGemini(userPrompt) {
  if (!APPEND_STYLE_NOTICE) return userPrompt;
  return `${userPrompt}\n\n${STYLE_NOTICE}`;
}

function buildGeminiEndpoint() {
  if (GEMINI_ENDPOINT) {
    const hadApiKeyPlaceholder = GEMINI_ENDPOINT.includes("{api_key}");
    let endpoint = GEMINI_ENDPOINT
      .replace(/\{model\}/g, encodeURIComponent(GEMINI_MODEL))
      .replace(/\{api_key\}/g, encodeURIComponent(GEMINI_API_KEY));

    if (!hadApiKeyPlaceholder && !/[?&]key=/.test(endpoint)) {
      const separator = endpoint.includes("?") ? "&" : "?";
      endpoint = `${endpoint}${separator}key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`;
    }
    return endpoint;
  }

  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
}

async function resolveStyleReferenceFromUrl(sourceUrl) {
  const hasCache =
    fs.existsSync(styleReferenceCacheFilePath) &&
    fs.existsSync(styleReferenceCacheMetaPath);

  if (!STYLE_REFERENCE_REFRESH && hasCache) {
    try {
      const meta = JSON.parse(fs.readFileSync(styleReferenceCacheMetaPath, "utf8"));
      if (meta && meta.sourceUrl === sourceUrl) {
        return {
          filePath: styleReferenceCacheFilePath,
          mimeType: normalizeMimeType(meta.mimeType)
        };
      }
    } catch (_error) {
      // Ignore broken cache metadata and re-download.
    }
  }

  if (styleReferenceDownloadPromise) {
    return styleReferenceDownloadPromise;
  }

  styleReferenceDownloadPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, STYLE_REFERENCE_TIMEOUT_MS);

    try {
      const response = await fetch(sourceUrl, {
        method: "GET",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          `Failed to download style reference URL, status ${response.status}`
        );
      }

      const mimeType = normalizeMimeType(response.headers.get("content-type"));
      const arrayBuffer = await response.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      if (!fileBuffer.length) {
        throw new Error("Downloaded style reference image is empty");
      }

      fs.writeFileSync(styleReferenceCacheFilePath, fileBuffer);
      fs.writeFileSync(
        styleReferenceCacheMetaPath,
        JSON.stringify(
          {
            sourceUrl,
            mimeType,
            updatedAt: new Date().toISOString()
          },
          null,
          2
        )
      );

      return {
        filePath: styleReferenceCacheFilePath,
        mimeType
      };
    } finally {
      clearTimeout(timeout);
      styleReferenceDownloadPromise = null;
    }
  })();

  return styleReferenceDownloadPromise;
}

async function loadStyleReferenceInlineData() {
  if (!ENABLE_STYLE_REFERENCE) return null;
  if (!STYLE_REFERENCE_SOURCE) {
    throw new Error(
      "ENABLE_STYLE_REFERENCE is true but STYLE_REFERENCE_SOURCE is empty"
    );
  }

  let sourceFilePath = "";
  let sourceMimeType = "";

  if (isHttpUrl(STYLE_REFERENCE_SOURCE)) {
    const downloaded = await resolveStyleReferenceFromUrl(STYLE_REFERENCE_SOURCE);
    sourceFilePath = downloaded.filePath;
    sourceMimeType = downloaded.mimeType;
  } else {
    sourceFilePath = path.resolve(process.cwd(), STYLE_REFERENCE_SOURCE);
    sourceMimeType = inferMimeTypeFromFilePath(sourceFilePath);
  }

  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Style reference image not found: ${sourceFilePath}`);
  }

  const fileBuffer = fs.readFileSync(sourceFilePath);
  const mimeType =
    normalizeMimeType(STYLE_REFERENCE_MIME_TYPE) || sourceMimeType || "";

  if (mimeType === "application/octet-stream") {
    throw new Error(
      "Unable to infer style image mime type. Set STYLE_REFERENCE_MIME_TYPE in .env"
    );
  }
  if (!mimeType) {
    throw new Error(
      "Missing style image mime type. Set STYLE_REFERENCE_MIME_TYPE in .env"
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

  const endpoint = buildGeminiEndpoint();

  const styleReferencePart = await loadStyleReferenceInlineData();
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
