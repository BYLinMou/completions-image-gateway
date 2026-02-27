# GenImage Proxy

把 OpenAI Chat Completions 风格请求，转发成 Gemini 图片生成请求，并返回可直接下载的图片 URL。

## 1) 安装

```bash
npm install
```

## 2) 配置 `.env`

项目根目录已提供 `.env`，你只需要改这个值：

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

## 3) 启动服务

```bash
npm start
```

默认端口：`3000`

## 4) 调用接口（OpenAI Chat 格式）

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

示例响应（`choices[0].message.content` 就是下载地址）：

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
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

## 路由

- `POST /v1/chat/completions`：OpenAI Chat 风格入参
- `GET /download/:filename`：直接下载生成图片（响应头为 attachment）
- `GET /generated/:filename`：静态访问生成图片
- `GET /health`：健康检查
