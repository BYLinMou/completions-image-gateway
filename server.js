const fs = require("fs");
const path = require("path");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const UPSTREAM_GEMINI_MODEL =
  process.env.UPSTREAM_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-2.0-flash-exp-image-generation";
const UPSTREAM_GEMINI_URL = process.env.UPSTREAM_GEMINI_URL || "";
const UPSTREAM_GEMINI_BASE_URL = (
  process.env.UPSTREAM_GEMINI_BASE_URL ||
  "https://generativelanguage.googleapis.com"
).replace(/\/+$/, "");
const UPSTREAM_GEMINI_API_VERSION =
  process.env.UPSTREAM_GEMINI_API_VERSION || "v1beta";
const UPSTREAM_GEMINI_API_KEY =
  process.env.UPSTREAM_GEMINI_API_KEY || GEMINI_API_KEY;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "generated";

const REQUIRE_SERVICE_API_KEY = parseBoolean(
  process.env.REQUIRE_SERVICE_API_KEY,
  true
);
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || "";

const ENABLE_STYLE_REFERENCE = parseBoolean(
  process.env.ENABLE_STYLE_REFERENCE,
  false
);
const STYLE_REFERENCE_IMAGE_PATH = process.env.STYLE_REFERENCE_IMAGE_PATH || "";
const STYLE_REFERENCE_MIME_TYPE = process.env.STYLE_REFERENCE_MIME_TYPE || "";
const APPEND_STYLE_REFERENCE_NOTICE = parseBoolean(
  process.env.APPEND_STYLE_REFERENCE_NOTICE,
  true
);
const STYLE_REFERENCE_IMAGE_URL = process.env.STYLE_REFERENCE_IMAGE_URL || "";
const STYLE_REFERENCE_CACHE_DIR =
  process.env.STYLE_REFERENCE_CACHE_DIR || "style-reference-cache";
const STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST = parseBoolean(
  process.env.STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST,
  false
);
const STYLE_REFERENCE_DOWNLOAD_TIMEOUT_MS = parsePositiveInt(
  process.env.STYLE_REFERENCE_DOWNLOAD_TIMEOUT_MS,
  15000
);
const STYLE_REFERENCE_NOTICE =
  process.env.STYLE_REFERENCE_NOTICE ||
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

if (REQUIRE_SERVICE_API_KEY && !SERVICE_API_KEY) {
  throw new Error(
    "REQUIRE_SERVICE_API_KEY is true but SERVICE_API_KEY is empty. Set SERVICE_API_KEY in .env"
  );
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
  if (!REQUIRE_SERVICE_API_KEY) {
    return next();
  }

  const bearerToken = extractBearerToken(req.headers.authorization);
  const xApiKey =
    typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "";
  const providedKey = bearerToken || xApiKey;

  if (providedKey !== SERVICE_API_KEY) {
    return res.status(401).json({
      error: {
        message:
          "Unauthorized: invalid API key. Use Authorization: Bearer YOUR_SERVICE_API_KEY or x-api-key.",
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

function buildPromptForGemini(userPrompt) {
  if (!APPEND_STYLE_REFERENCE_NOTICE) return userPrompt;
  return `${userPrompt}\n\n${STYLE_REFERENCE_NOTICE}`;
}

function buildGeminiEndpoint() {
  if (UPSTREAM_GEMINI_URL) {
    const hadApiKeyPlaceholder = UPSTREAM_GEMINI_URL.includes("{api_key}");
    let endpoint = UPSTREAM_GEMINI_URL
      .replace(/\{model\}/g, encodeURIComponent(UPSTREAM_GEMINI_MODEL))
      .replace(/\{api_version\}/g, encodeURIComponent(UPSTREAM_GEMINI_API_VERSION))
      .replace(/\{api_key\}/g, encodeURIComponent(UPSTREAM_GEMINI_API_KEY));

    if (!hadApiKeyPlaceholder && !/[?&]key=/.test(endpoint)) {
      const separator = endpoint.includes("?") ? "&" : "?";
      endpoint = `${endpoint}${separator}key=${encodeURIComponent(
        UPSTREAM_GEMINI_API_KEY
      )}`;
    }
    return endpoint;
  }

  return `${UPSTREAM_GEMINI_BASE_URL}/${UPSTREAM_GEMINI_API_VERSION}/models/${encodeURIComponent(
    UPSTREAM_GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(UPSTREAM_GEMINI_API_KEY)}`;
}

async function resolveStyleReferenceFromUrl() {
  const hasCache =
    fs.existsSync(styleReferenceCacheFilePath) &&
    fs.existsSync(styleReferenceCacheMetaPath);

  if (!STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST && hasCache) {
    try {
      const meta = JSON.parse(fs.readFileSync(styleReferenceCacheMetaPath, "utf8"));
      if (meta && meta.sourceUrl === STYLE_REFERENCE_IMAGE_URL) {
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
    }, STYLE_REFERENCE_DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(STYLE_REFERENCE_IMAGE_URL, {
        method: "GET",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          `Failed to download STYLE_REFERENCE_IMAGE_URL, status ${response.status}`
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
            sourceUrl: STYLE_REFERENCE_IMAGE_URL,
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
  if (!STYLE_REFERENCE_IMAGE_URL && !STYLE_REFERENCE_IMAGE_PATH) {
    throw new Error(
      "ENABLE_STYLE_REFERENCE is true but neither STYLE_REFERENCE_IMAGE_URL nor STYLE_REFERENCE_IMAGE_PATH is set"
    );
  }

  let sourceFilePath = "";
  let sourceMimeType = "";

  if (STYLE_REFERENCE_IMAGE_URL) {
    const downloaded = await resolveStyleReferenceFromUrl();
    sourceFilePath = downloaded.filePath;
    sourceMimeType = downloaded.mimeType;
  } else {
    sourceFilePath = path.resolve(process.cwd(), STYLE_REFERENCE_IMAGE_PATH);
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
  if (!UPSTREAM_GEMINI_API_KEY) {
    throw new Error(
      "Missing UPSTREAM_GEMINI_API_KEY in .env (or set GEMINI_API_KEY for backward compatibility)"
    );
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
