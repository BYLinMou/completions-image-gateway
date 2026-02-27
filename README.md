# GenImage Proxy

把 OpenAI Chat Completions 风格请求转成 Gemini 图片生成请求，并返回可直接下载的图片 URL。

## 安装

```bash
npm install
```

## 配置 `.env`

必填：

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

风格参考图（全局）相关配置：

```env
# 是否把全局风格参考图传给 Gemini
ENABLE_STYLE_REFERENCE=false

# 全局风格参考图路径（相对项目根目录或绝对路径）
STYLE_REFERENCE_IMAGE_PATH=assets/style-reference.png

# 可选；不填则按后缀推断（png/jpg/jpeg/webp）
STYLE_REFERENCE_MIME_TYPE=

# 是否把“仅风格参考，不是人物形象参考”说明追加到 prompt 末尾
APPEND_STYLE_REFERENCE_NOTICE=true

# 追加到 prompt 尾部的文本，可自定义
STYLE_REFERENCE_NOTICE=以下参考图仅用于整体视觉风格参考（例如配色、光影、笔触、构图与氛围），不是人物形象参考图，不用于复制人物身份、五官、体型、年龄、性别或具体角色特征。
```

说明：
- `ENABLE_STYLE_REFERENCE=true` 时，服务会读取 `STYLE_REFERENCE_IMAGE_PATH`，作为 Gemini 输入中的风格参考图。
- `APPEND_STYLE_REFERENCE_NOTICE=true` 时，会把 `STYLE_REFERENCE_NOTICE` 追加到用户 prompt 尾部。
- 默认文案已经明确“这是风格参考图，不是人物形象参考图”。

## 启动

```bash
npm start
```

默认端口：`3000`

## 调用（OpenAI Chat 格式）

```bash
curl -X POST "http://localhost:3000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You generate images."},
      {"role": "user", "content": "A cinematic portrait of a cyberpunk cat in neon rain"}
    ]
  }'
```

返回中 `choices[0].message.content` 即下载地址：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "http://localhost:3000/download/xxxx.png"
      }
    }
  ]
}
```

## 路由

- `POST /v1/chat/completions`: OpenAI Chat 风格入参
- `GET /download/:filename`: 直接下载图片
- `GET /generated/:filename`: 静态访问图片
- `GET /health`: 健康检查
