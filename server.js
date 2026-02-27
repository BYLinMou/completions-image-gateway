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
const LOG_LEVEL = normalizeLogLevel(process.env.LOG_LEVEL || "info");
const LOG_REQUEST_BODY = parseBoolean(process.env.LOG_REQUEST_BODY, false);

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

app.use((req, res, next) => {
  const requestId = uuidv4().slice(0, 8);
  const startAt = Date.now();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  logInfo("HTTP request started", {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });

  if (LOG_REQUEST_BODY && req.body && Object.keys(req.body).length > 0) {
    logDebug("HTTP request body", {
      request_id: requestId,
      body: summarizeBody(req.body)
    });
  }

  res.on("finish", () => {
    logInfo("HTTP request finished", {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: Date.now() - startAt
    });
  });

  return next();
});

app.use("/generated", express.static(outputDirAbsPath));

app.get("/download/:filename", (req, res) => {
  const filePath = path.resolve(outputDirAbsPath, req.params.filename);
  if (
    !filePath.startsWith(`${outputDirAbsPath}${path.sep}`) ||
    !fs.existsSync(filePath)
  ) {
    logWarn("Download file not found", {
      request_id: req.requestId,
      file_path: filePath
    });
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

function normalizeLogLevel(value) {
  const normalized = String(value || "info").trim().toLowerCase();
  if (["error", "warn", "info", "debug"].includes(normalized)) {
    return normalized;
  }
  return "info";
}

function shouldLog(level) {
  const weight = { error: 0, warn: 1, info: 2, debug: 3 };
  return weight[level] <= weight[LOG_LEVEL];
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ message: "failed_to_serialize_log_payload" });
  }
}

function log(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  const line = safeJson(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function logDebug(message, meta = {}) {
  log("debug", message, meta);
}

function logInfo(message, meta = {}) {
  log("info", message, meta);
}

function logWarn(message, meta = {}) {
  log("warn", message, meta);
}

function logError(message, meta = {}) {
  log("error", message, meta);
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return body;
  const summary = {
    keys: Object.keys(body)
  };
  if (typeof body.model === "string") {
    summary.model = body.model;
  }
  if (Array.isArray(body.messages)) {
    summary.messages_count = body.messages.length;
    summary.messages = body.messages.map((m, idx) => ({
      index: idx,
      role: m?.role,
      content_type: Array.isArray(m?.content) ? "array" : typeof m?.content
    }));
  }
  return summary;
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
    logWarn("API key authentication failed", {
      request_id: req.requestId,
      has_bearer: Boolean(bearerToken),
      has_x_api_key: Boolean(xApiKey)
    });
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

function maskApiKeyInUrl(url) {
  if (typeof url !== "string") return "";
  return url.replace(/([?&]key=)[^&]+/i, "$1***");
}

function toSnippet(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

async function resolveStyleReferenceFromUrl(sourceUrl) {
  const hasCache =
    fs.existsSync(styleReferenceCacheFilePath) &&
    fs.existsSync(styleReferenceCacheMetaPath);

  if (!STYLE_REFERENCE_REFRESH && hasCache) {
    try {
      const meta = JSON.parse(fs.readFileSync(styleReferenceCacheMetaPath, "utf8"));
      if (meta && meta.sourceUrl === sourceUrl) {
        logDebug("Style reference cache hit", {
          source_url: sourceUrl,
          cache_file: styleReferenceCacheFilePath
        });
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
    logDebug("Style reference download in progress, awaiting existing promise", {
      source_url: sourceUrl
    });
    return styleReferenceDownloadPromise;
  }

  styleReferenceDownloadPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, STYLE_REFERENCE_TIMEOUT_MS);

    try {
      logInfo("Downloading style reference image", {
        source_url: sourceUrl,
        timeout_ms: STYLE_REFERENCE_TIMEOUT_MS
      });
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

      logInfo("Style reference image cached", {
        source_url: sourceUrl,
        cache_file: styleReferenceCacheFilePath,
        size_bytes: fileBuffer.length,
        mime_type: mimeType || "unknown"
      });

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
    logDebug("Using URL style reference source", {
      source: STYLE_REFERENCE_SOURCE
    });
    const downloaded = await resolveStyleReferenceFromUrl(STYLE_REFERENCE_SOURCE);
    sourceFilePath = downloaded.filePath;
    sourceMimeType = downloaded.mimeType;
  } else {
    logDebug("Using local style reference source", {
      source: STYLE_REFERENCE_SOURCE
    });
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
  logInfo("Calling Gemini upstream", {
    endpoint: maskApiKeyInUrl(endpoint),
    model: GEMINI_MODEL
  });

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

  logInfo("Gemini upstream responded", {
    status_code: response.status,
    content_type: response.headers.get("content-type") || ""
  });

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const rawBody = await response.text();

  let data = null;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(rawBody);
    } catch (_error) {
      throw new Error(
        `Upstream returned invalid JSON. status=${response.status} content_type=${contentType} body=${toSnippet(
          rawBody
        )}`
      );
    }
  } else {
    try {
      data = JSON.parse(rawBody);
    } catch (_error) {
      throw new Error(
        `Upstream returned non-JSON response. status=${response.status} content_type=${contentType || "unknown"} body=${toSnippet(
          rawBody
        )}`
      );
    }
  }

  if (!response.ok) {
    const message = data?.error?.message
      ? `Gemini request failed. status=${response.status} message=${data.error.message}`
      : `Gemini request failed. status=${response.status} body=${toSnippet(rawBody)}`;
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
      logWarn("Prompt extraction failed", {
        request_id: req.requestId
      });
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
    logInfo("Generated image saved", {
      request_id: req.requestId,
      file_path: filePath,
      mime_type: image.mimeType
    });

    const url = `${BASE_URL}/download/${fileName}`;
    const markdownImage = `![generated image](${url})`;
    const dualImageContent = `${markdownImage}\n\n${url}`;
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
            content: dualImageContent
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
    logError("Chat completion request failed", {
      request_id: req.requestId,
      error_message: error?.message || "unknown_error",
      stack: error?.stack || ""
    });
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
  logInfo("GenImage proxy started", {
    port: PORT,
    base_url: BASE_URL,
    log_level: LOG_LEVEL,
    require_api_key: REQUIRE_API_KEY,
    style_reference_enabled: ENABLE_STYLE_REFERENCE
  });
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.stack || reason.message : String(reason)
  });
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", {
    error_message: error?.message || "unknown_error",
    stack: error?.stack || ""
  });
});
