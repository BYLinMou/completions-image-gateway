# GenImage Proxy

OpenAI Chat Completions style in, Gemini `generateContent` upstream, downloadable image URL out.

## Features

- `POST /v1/chat/completions` with OpenAI chat format
- Upstream request format is Gemini `models/{model}:generateContent`
- API key auth for `/v1/*`
- Save generated images locally and return `/download/:filename`
- Global style-reference image support
  - local file path mode
  - URL download + local cache mode
- Optional prompt tail notice that clearly says style-only reference (not identity/person reference)

## Config Files

- Commit `.env.example`
- Keep `.env` local only (already ignored by `.gitignore`)

Create local config:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Local Run

```bash
npm install
npm start
```

Port is controlled by `PORT` in `.env` (default `3000`).

## Zeabur Deploy

1. Import this repo into Zeabur and create a Node.js service.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Add environment variables from the section below.
5. Add a persistent Volume mount at `/data`.
6. Set:
   - `OUTPUT_DIR=/data/generated`
   - `STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache`
7. Set `BASE_URL` to your Zeabur public domain, for example `https://your-app.zeabur.app`.

## Environment Variables

Minimum required:

```env
UPSTREAM_GEMINI_API_KEY=YOUR_UPSTREAM_GEMINI_API_KEY
SERVICE_API_KEY=CHANGE_ME_TO_A_STRONG_KEY
BASE_URL=https://your-app.zeabur.app
```

Full example:

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

# Optional custom full upstream URL (highest priority)
# Supported placeholders: {model} {api_version} {api_key}
# If no key in URL and no {api_key}, service appends ?key=... automatically.
UPSTREAM_GEMINI_URL=

# Style reference
ENABLE_STYLE_REFERENCE=true

# URL mode (higher priority than local path mode)
STYLE_REFERENCE_IMAGE_URL=https://example.com/style-reference.png

# Local path mode (used when STYLE_REFERENCE_IMAGE_URL is empty)
STYLE_REFERENCE_IMAGE_PATH=assets/style-reference.png

# Cache for downloaded style-reference URL
STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache
STYLE_REFERENCE_REFRESH_ON_EACH_REQUEST=false
STYLE_REFERENCE_DOWNLOAD_TIMEOUT_MS=15000

# Optional override; if empty, service infers mime type
STYLE_REFERENCE_MIME_TYPE=

# Prompt tail notice (style-only, not identity/person reference)
APPEND_STYLE_REFERENCE_NOTICE=true
STYLE_REFERENCE_NOTICE=The reference image is STYLE-ONLY and NOT a person/identity reference. Use it only for palette, lighting, brushwork, composition, and mood. Do not copy face, identity, body, age, gender, or character-specific traits.

# Backward compatibility only (optional)
GEMINI_API_KEY=
GEMINI_MODEL=
```

## API Auth

If `REQUIRE_SERVICE_API_KEY=true`, `/v1/*` must include:

- `Authorization: Bearer <SERVICE_API_KEY>`
- or `x-api-key: <SERVICE_API_KEY>`

## Example Request

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

`choices[0].message.content` is a direct download URL:

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

## Routes

- `POST /v1/chat/completions`
- `GET /download/:filename`
- `GET /generated/:filename`
- `GET /health`
