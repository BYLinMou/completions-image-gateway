# GenImage Proxy

OpenAI Chat Completions style in, Gemini `generateContent` upstream, downloadable image URL out.

## Config

Use `.env.example` as template:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

## Simplified Environment Variables

```env
PORT=3000
BASE_URL=https://your-app.zeabur.app
OUTPUT_DIR=/data/generated

REQUIRE_API_KEY=true
API_KEY=CHANGE_ME_TO_A_STRONG_KEY

GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.0-flash-exp-image-generation
GEMINI_ENDPOINT=

ENABLE_STYLE_REFERENCE=true
STYLE_REFERENCE_SOURCE=https://example.com/style-reference.png
STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache
STYLE_REFERENCE_REFRESH=false
STYLE_REFERENCE_TIMEOUT_MS=15000
STYLE_REFERENCE_MIME_TYPE=

APPEND_STYLE_NOTICE=true
STYLE_NOTICE=The reference image is STYLE-ONLY and NOT a person/identity reference. Use it only for palette, lighting, brushwork, composition, and mood. Do not copy face, identity, body, age, gender, or character-specific traits.

LOG_LEVEL=info
LOG_REQUEST_BODY=false
```

Notes:

- `GEMINI_ENDPOINT` is optional. If set, it has highest priority.
- `GEMINI_ENDPOINT` placeholders: `{model}` and `{api_key}`.
- If `GEMINI_ENDPOINT` has no `key=` and no `{api_key}`, service appends `?key=...` automatically.
- `STYLE_REFERENCE_SOURCE` is one variable only:
  - URL: `https://...`
  - Local path: `assets/style-reference.png`
- `LOG_LEVEL`: `error | warn | info | debug`
- `LOG_REQUEST_BODY=true` 会输出请求体摘要（不是完整大包）

## Zeabur

1. Import repo and create Node service.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add env vars above.
5. Add persistent volume mount path: `/data`
6. Use:
   - `OUTPUT_DIR=/data/generated`
   - `STYLE_REFERENCE_CACHE_DIR=/data/style-reference-cache`

## API Auth

If `REQUIRE_API_KEY=true`, include either:

- `Authorization: Bearer <API_KEY>`
- `x-api-key: <API_KEY>`

## Request Example

```bash
curl -X POST "https://your-app.zeabur.app/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer CHANGE_ME_TO_A_STRONG_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "A cinematic portrait of a cyberpunk cat in neon rain"}
    ]
  }'
```
