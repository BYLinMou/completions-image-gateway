# GenImage Proxy

这个服务对外提供 OpenAI Chat Completions 风格接口，对上游使用 Gemini `generateContent` 格式生成图片，并返回可直接下载的图片 URL。

## 功能

- `POST /v1/chat/completions`：接收 OpenAI Chat 风格请求。
- 上游请求固定走 Gemini 格式（`models/{model}:generateContent`）。
- 生成结果落盘到本地目录，再返回下载链接。
- 支持服务 API Key 鉴权。
- 支持全局风格参考图：
  - 本地路径模式（`STYLE_REFERENCE_IMAGE_PATH`）。
  - URL 下载缓存模式（`STYLE_REFERENCE_IMAGE_URL`，自动下载到本地缓存后使用）。
- 可在 prompt 尾部自动追加说明：风格参考图仅用于视觉风格，不是人物形象参考。

## 本地启动

```bash
npm install
npm start
```

服务端口由 `.env` 的 `PORT` 控制，默认 `3000`。

## Zeabur 部署步骤

1. 把仓库导入 Zeabur，创建一个 Node.js Service。  
2. Build Command: `npm install`。  
3. Start Command: `npm start`。  
4. 在 Zeabur 的 Environment Variables 填入下面变量。  
5. 在 Zeabur 给这个服务挂载一个 Volume（建议挂到 `/data`）。  
6. 把 `OUTPUT_DIR` 和 `STYLE_REFERENCE_CACHE_DIR` 指向挂载路径下的目录（见下方示例）。  
7. 部署后，把 `BASE_URL` 设置为你的 Zeabur 公开域名（例如 `https://your-app.zeabur.app`），这样返回的下载 URL 才是公网可访问的。

## Zeabur 推荐挂载

- Mount Path: `/data`
- 建议变量：
  - `OUTPUT_DIR=/data/generated`
  - `STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache`

这样容器重启后，已生成图片和已下载的风格参考图缓存不会丢失。

## Environment Variables

最小必填：

```env
UPSTREAM_GEMINI_API_KEY=YOUR_UPSTREAM_GEMINI_API_KEY
SERVICE_API_KEY=CHANGE_ME_TO_A_STRONG_KEY
BASE_URL=https://your-app.zeabur.app
```

完整示例：

```env
# Service
PORT=3000
BASE_URL=https://your-app.zeabur.app
OUTPUT_DIR=/data/generated

# Downstream auth (client -> this service)
REQUIRE_SERVICE_API_KEY=true
SERVICE_API_KEY=CHANGE_ME_TO_A_STRONG_KEY

# Upstream Gemini
UPSTREAM_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
UPSTREAM_GEMINI_API_VERSION=v1beta
UPSTREAM_GEMINI_API_KEY=YOUR_UPSTREAM_GEMINI_API_KEY
UPSTREAM_GEMINI_MODEL=gemini-2.0-flash-exp-image-generation

# Optional: custom full upstream URL (highest priority)
# Placeholders supported: {model} {api_version} {api_key}
# Example:
# UPSTREAM_GEMINI_URL=https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}
UPSTREAM_GEMINI_URL=

# Style reference
ENABLE_STYLE_REFERENCE=true

# URL mode (priority higher than local path mode)
STYLE_REFERENCE_IMAGE_URL=https://example.com/style-reference.png

# Local path mode (used when STYLE_REFERENCE_IMAGE_URL is empty)
STYLE_REFERENCE_IMAGE_PATH=assets/style-reference.png

# Cache for downloaded style reference URL
STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache
STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST=false
STYLE_REFERENCE_DOWNLOAD_TIMEOUT_MS=15000

# Optional override; if empty, service infers mime type
STYLE_REFERENCE_MIME_TYPE=

# Append style-only notice to prompt tail
APPEND_STYLE_REFERENCE_NOTICE=true
STYLE_REFERENCE_NOTICE=The reference image is STYLE-ONLY and NOT a person/identity reference. Use it only for palette, lighting, brushwork, composition, and mood. Do not copy face, identity, body, age, gender, or character-specific traits.

# Backward compatibility only (optional)
GEMINI_API_KEY=
GEMINI_MODEL=
```

## 风格参考图 URL 模式说明

当 `ENABLE_STYLE_REFERENCE=true` 且 `STYLE_REFERENCE_IMAGE_URL` 不为空时：

1. 服务会从该 URL 下载参考图。  
2. 下载后写入 `STYLE_REFERENCE_CACHE_DIR`。  
3. 后续请求默认复用缓存（`STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST=false`）。  
4. 如果你希望每次请求都重新拉取最新参考图，设置 `STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST=true`。  

优先级：

- `STYLE_REFERENCE_IMAGE_URL`（高）
- `STYLE_REFERENCE_IMAGE_PATH`（低）

## 上游格式（Gemini）

服务对上游请求使用 Gemini `generateContent`：

- 默认模板：  
  `UPSTREAM_GEMINI_BASE_URL/UPSTREAM_GEMINI_API_VERSION/models/{UPSTREAM_GEMINI_MODEL}:generateContent?key=UPSTREAM_GEMINI_API_KEY`
- 如果配置了 `UPSTREAM_GEMINI_URL`，则优先使用该 URL。

## 鉴权

默认 `REQUIRE_SERVICE_API_KEY=true`，请求 `/v1/*` 需带 API Key：

- `Authorization: Bearer <SERVICE_API_KEY>`
- 或 `x-api-key: <SERVICE_API_KEY>`

## 调用示例

```bash
curl -X POST "https://your-app.zeabur.app/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer CHANGE_ME_TO_A_STRONG_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You generate images."},
      {"role": "user", "content": "A cinematic portrait of a cyberpunk cat in neon rain"}
    ]
  }'
```

返回里 `choices[0].message.content` 是下载地址，例如：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "https://your-app.zeabur.app/download/xxxx.png"
      }
    }
  ]
}
```

## 路由

- `POST /v1/chat/completions`
- `GET /download/:filename`
- `GET /generated/:filename`
- `GET /health`
