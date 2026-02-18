# API Documentation - OpenAI Gateway

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [AI Chat & Embeddings](#ai-chat--embeddings)
4. [Models](#models)
5. [Configuration & Admin](#configuration--admin)
6. [Sessions](#sessions)
7. [Authentication (OAuth & Device Flow)](#authentication-oauth--device-flow)
8. [System & Monitoring](#system--monitoring)
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)

---

## Overview

The OpenAI Gateway API provides a drop-in replacement for OpenAI's API while routing requests to free AI models from OpenRouter, Google Gemini, and OpenCode.

**Base URL**: `http://localhost:8787`

**API Version**: 1.0.0

**Authentication**: Optional (rate limiting applied per API key)

---

## Authentication

### Token-Based Authentication

Some endpoints require authentication via JWT token. Include token in one of two ways:

```bash
# Option 1: Cookie
curl -H "Cookie: auth_token=<jwt_token>" http://localhost:8787/admin

# Option 2: Authorization Header
curl -H "Authorization: Bearer <jwt_token>" http://localhost:8787/admin
```

### Rate Limiting

**Applied to**: All endpoints

**Algorithm**: Token bucket (configurable)

**Default Limits**:
- Window: 60 seconds
- Max requests: 100 per window
- Per API key

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1645123456
```

**Exceeding Limit** → HTTP 429 response:
```json
{
  "error": {
    "message": "Rate limit exceeded. Too many requests.",
    "type": "rate_limit_exceeded",
    "code": "rate_limit_exceeded"
  }
}
```

---

## AI Chat & Embeddings

### POST /v1/chat/completions

Generate chat responses using AI models. Supports streaming.

**URL**: `POST /v1/chat/completions`

**Authentication**: Optional

**Request Headers**:
```
Content-Type: application/json
Authorization: Bearer <api-key> (optional)
```

**Request Body** (OpenAI compatible):
```json
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant"
    },
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 500,
  "top_p": 0.9,
  "stream": false
}
```

**Request Parameters**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | string | Yes | - | Model name (auto-mapped to provider's model) |
| `messages` | array | Yes | - | Chat message history with `role` and `content` |
| `temperature` | number | No | 0.7 | Randomness: 0 (deterministic) to 2 (creative) |
| `max_tokens` | number | No | - | Max tokens in response (1-4096) |
| `top_p` | number | No | 1 | Nucleus sampling (0-1) |
| `frequency_penalty` | number | No | 0 | Penalize repeated tokens (-2 to 2) |
| `presence_penalty` | number | No | 0 | Penalize new tokens (-2 to 2) |
| `stream` | boolean | No | false | Enable Server-Sent Events streaming |

**Response** (Non-streaming, HTTP 200):
```json
{
  "id": "chatcmpl-xyz",
  "object": "chat.completion",
  "created": 1645123456,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you for asking!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 10,
    "total_tokens": 25
  },
  "sessionId": "session-1645123456-abc123"
}
```

**Response** (Streaming, HTTP 200):
```
Content-Type: text/event-stream

data: {"id":"...","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: [DONE]
```

**Supported Models**:
- `gpt-3.5-turbo` → DeepSeek R1
- `gpt-4` → DeepSeek R1
- `gpt-4o` → Qwen3 235B
- `gpt-4o-mini` → Qwen3 Next 80B
- `gpt-5` → Qwen3 235B
- `gpt-5-turbo` → Qwen3 Next 80B
- `gpt-4-vision` → Qwen3 VL 235B
- `gpt-4-code` → Qwen3 Coder
- `gemini-3-flash` → Gemini 3 Flash
- `gemini-3-pro` → Gemini 3 Pro
- `gemini-2.0-flash` → Gemini 2.0 Flash
- `gemini-1.5-flash` → Gemini 1.5 Flash
- `gemini-1.5-pro` → Gemini 1.5 Pro

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `invalid_request` | 400 | Malformed request or validation error |
| `configuration_error` | 503 | Provider not configured |
| `rate_limit_exceeded` | 429 | Rate limit hit |
| `provider_error` | 502-503 | Provider unavailable |
| `timeout_error` | 504 | Provider timeout |

**Example - cURL**:
```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 100
  }'
```

**Example - Python (OpenAI SDK)**:
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="any-key"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

**Example - Node.js Streaming**:
```javascript
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Count to 3" }],
  stream: true,
});

for await (const chunk of response) {
  console.log(chunk.choices[0].delta.content || "");
}
```

---

### POST /v1/embeddings

Generate text embeddings for semantic search and clustering.

**URL**: `POST /v1/embeddings`

**Authentication**: Optional

**Request Body**:
```json
{
  "model": "text-embedding-ada-002",
  "input": "The quick brown fox jumps over the lazy dog"
}
```

**Request Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Embedding model (`text-embedding-ada-002`) |
| `input` | string\|array | Yes | Text or list of texts to embed |

**Response** (HTTP 200):
```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.123, -0.456, 0.789, ...]
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 15,
    "total_tokens": 15
  }
}
```

**Error Responses**: Same as `/v1/chat/completions`

**Example - cURL**:
```bash
curl -X POST http://localhost:8787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-ada-002",
    "input": ["Hello world", "Goodbye world"]
  }'
```

---

## Models

### GET /v1/models

List all available models.

**URL**: `GET /v1/models`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-3.5-turbo",
      "object": "model",
      "created": 1645123456,
      "owned_by": "openai-internal"
    },
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1645123456,
      "owned_by": "openai-internal"
    }
  ]
}
```

**Example - cURL**:
```bash
curl http://localhost:8787/v1/models
```

---

### GET /v1/models-by-provider

List models grouped by provider with priority information.

**URL**: `GET /v1/models-by-provider`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "openrouter": {
    "name": "OpenRouter",
    "models": [
      {
        "id": "opencode/minimax-m2.1-free:free",
        "name": "MiniMax M2.1",
        "priority": "high"
      },
      {
        "id": "github-copilot/claude-haiku-4.5:free",
        "name": "Claude Haiku 4.5",
        "priority": "high"
      }
    ]
  },
  "gemini": {
    "name": "Google Gemini",
    "models": [
      {
        "id": "gemini-3-flash",
        "name": "Gemini 3 Flash",
        "priority": "high"
      }
    ]
  }
}
```

**Example - cURL**:
```bash
curl http://localhost:8787/v1/models-by-provider
```

---

## Configuration & Admin

### GET /config

Get current gateway configuration.

**URL**: `GET /config`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "modelMapping": {
    "gpt-3.5-turbo": "deepseek/deepseek-r1-0528:free",
    "gpt-4": "deepseek/deepseek-r1-0528:free"
  },
  "providers": {
    "openrouter": {
      "configured": true,
      "keyCount": 1
    },
    "gemini": {
      "configured": true,
      "keyCount": 1
    }
  },
  "settings": {
    "port": 8787,
    "maxRetries": 3,
    "retryDelay": 1000,
    "cacheTTL": 3600000
  },
  "stats": {
    "cacheSize": 42,
    "uptime": 3600.5
  }
}
```

---

### GET /config/providers

Get details about all configured providers.

**URL**: `GET /config/providers`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "providers": {
    "openrouter": {
      "name": "OpenRouter",
      "configured": true,
      "keyCount": 1,
      "endpoint": "https://openrouter.ai/api/v1"
    },
    "gemini": {
      "name": "Google Gemini",
      "configured": true,
      "keyCount": 1,
      "endpoint": "Direct Google API"
    },
    "custom": [
      {
        "name": "custom-provider",
        "displayName": "My Custom Provider",
        "endpoint": "https://api.example.com",
        "configured": true,
        "keyCount": 2,
        "modelPrefix": "custom"
      }
    ]
  }
}
```

---

### POST /config/models

Update model mapping (admin required).

**URL**: `POST /config/models`

**Authentication**: Required (JWT token, admin user)

**Request Body**:
```json
{
  "openaiModel": "gpt-4",
  "targetModel": "qwen/qwen3-235b-a22b:free",
  "provider": "openrouter"
}
```

**Request Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `openaiModel` | string | Yes | OpenAI model name to map from |
| `targetModel` | string | Yes | Target model ID |
| `provider` | string | No | Provider: `openrouter`, `gemini`, or custom name |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Model mapping updated: gpt-4 -> qwen/qwen3-235b-a22b:free",
  "modelMapping": { ... }
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `missing_fields` | 400 | Missing `openaiModel` or `targetModel` |
| `unauthorized` | 401 | Missing authentication token |
| `forbidden` | 403 | Non-admin user |

---

### POST /config/clear-cache

Clear all cached responses (admin required).

**URL**: `POST /config/clear-cache`

**Authentication**: Required (JWT token, admin user)

**Request Body**: Empty JSON object `{}`

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Cache cleared. Removed 42 entries."
}
```

---

### POST /config/providers

Add or remove API keys for providers (admin required).

**URL**: `POST /config/providers`

**Authentication**: Required (JWT token, admin user)

**Request Body** (Add key):
```json
{
  "provider": "openrouter",
  "apiKey": "sk-or-v1-abc123..."
}
```

**Request Body** (Remove key):
```json
{
  "provider": "openrouter",
  "apiKey": "sk-or-v1-abc123...",
  "action": "remove"
}
```

**Request Parameters**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | string | Yes | - | Provider: `openrouter` or `gemini` |
| `apiKey` | string | Yes | - | API key |
| `action` | string | No | add | `add` or `remove` |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "API key added to openrouter",
  "keyCount": 2
}
```

---

### POST /config/providers/custom

Add custom provider (admin required).

**URL**: `POST /config/providers/custom`

**Authentication**: Required (JWT token, admin user)

**Request Body**:
```json
{
  "name": "my-provider",
  "displayName": "My Custom API",
  "endpoint": "https://api.example.com/v1",
  "apiKeys": ["key1", "key2"],
  "apiKeyHeader": "Authorization",
  "modelPrefix": "my"
}
```

**Request Parameters**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | - | Provider name (lowercase, alphanumeric, hyphens) |
| `displayName` | string | No | `name` | Human-readable name |
| `endpoint` | string | Yes | - | API endpoint URL |
| `apiKeys` | array\|string | No | [] | API keys for authentication |
| `apiKeyHeader` | string | No | Authorization | HTTP header for API key |
| `modelPrefix` | string | No | `name` | Prefix for model IDs |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Custom provider 'my-provider' added successfully",
  "provider": { ... }
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `invalid_name` | 400 | Name contains invalid characters |
| `reserved_name` | 400 | Name conflicts with built-in provider |
| `missing_fields` | 400 | Missing required fields |

---

### DELETE /config/providers/custom/:name

Remove custom provider.

**URL**: `DELETE /config/providers/custom/:name`

**Authentication**: Not required (but should be)

**URL Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Custom provider name |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Custom provider 'my-provider' removed successfully"
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `not_found` | 404 | Provider not found |

---

### POST /config/fallbacks

Configure fallback models (admin required).

**URL**: `POST /config/fallbacks`

**Authentication**: Required (JWT token, admin user)

**Request Body** (Set fallback):
```json
{
  "primaryModel": "gpt-4",
  "fallbackModel": "gpt-3.5-turbo"
}
```

**Request Body** (Remove fallback):
```json
{
  "primaryModel": "gpt-4",
  "fallbackModel": "gpt-3.5-turbo",
  "action": "remove"
}
```

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Fallback mapping updated: gpt-4 -> gpt-3.5-turbo"
}
```

---

### GET /admin

Admin control panel (requires authentication and admin role).

**URL**: `GET /admin`

**Authentication**: Required (JWT token, admin user)

**Response**: HTML admin interface with UI for managing:
- Provider configuration
- Model mappings
- Cache management
- Metrics & monitoring

**Example - cURL**:
```bash
curl -H "Authorization: Bearer <jwt_token>" http://localhost:8787/admin
```

---

## Sessions

### GET /session/status

Get session statistics and list of all sessions.

**URL**: `GET /session/status`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "stats": {
    "totalSessions": 5,
    "activeSessions": 3,
    "closedSessions": 2,
    "totalMessages": 127
  },
  "sessions": [
    {
      "id": "session-1645123456-abc123",
      "created": 1645123456000,
      "lastActivity": 1645123789000,
      "status": "active",
      "messagesCount": 12
    }
  ]
}
```

---

### GET /session/:sessionId

Get details about a specific session.

**URL**: `GET /session/:sessionId`

**Authentication**: Not required

**URL Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Session ID |

**Response** (HTTP 200):
```json
{
  "session": {
    "id": "session-1645123456-abc123",
    "created": 1645123456000,
    "lastActivity": 1645123789000,
    "status": "active"
  },
  "messages": [
    {
      "role": "user",
      "content": "What is machine learning?",
      "timestamp": 1645123456000
    },
    {
      "role": "assistant",
      "content": "Machine learning is...",
      "timestamp": 1645123457000
    }
  ]
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `not_found` | 404 | Session not found |

---

### DELETE /session/:sessionId

Delete a session and clear its history.

**URL**: `DELETE /session/:sessionId`

**Authentication**: Not required

**URL Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Session ID |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Session session-1645123456-abc123 deleted"
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `not_found` | 404 | Session not found |

---

## Authentication (OAuth & Device Flow)

### GET /login

Redirect to GitHub OAuth authorization.

**URL**: `GET /login`

**Authentication**: Not required

**Response**: HTTP 302 redirect to GitHub OAuth authorization page

**Example - Browser**:
```
http://localhost:8787/login
```

---

### GET /auth/github/callback

GitHub OAuth callback endpoint (called by GitHub after user authorization).

**URL**: `GET /auth/github/callback`

**Authentication**: Not required

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `code` | string | Authorization code from GitHub |
| `state` | string | State parameter |

**Response**: HTTP 302 redirect with JWT token in URL:
```
http://localhost:3000/?auth_token=<jwt>&user=<username>
```

Sets secure cookie: `auth_token=<jwt>`

---

### GET /auth/me

Get current authenticated user.

**URL**: `GET /auth/me`

**Authentication**: Required (JWT token)

**Response** (HTTP 200):
```json
{
  "user": {
    "id": "github_123456789",
    "login": "octocat",
    "email": "octocat@github.com",
    "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
    "name": "The Octocat",
    "isAdmin": false,
    "createdAt": "2025-02-18T12:00:00Z"
  }
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `unauthorized` | 401 | Missing or invalid token |

---

### POST /auth/logout

Logout current user.

**URL**: `POST /auth/logout`

**Authentication**: Not required

**Request Body**: Empty JSON object `{}`

**Response** (HTTP 200):
```json
{
  "message": "Logged out successfully"
}
```

Clears `auth_token` cookie.

---

### POST /auth/device/request

Request device code for CLI authentication (Device Flow).

**URL**: `POST /auth/device/request`

**Authentication**: Not required

**Request Body**:
```json
{
  "scope": "read:user user:email"
}
```

**Request Parameters**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `scope` | string | No | `read:user user:email` | GitHub OAuth scopes |

**Response** (HTTP 200):
```json
{
  "device_code": "ABC123DEF456...",
  "user_code": "WXYZ-ABCD",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900,
  "interval": 5,
  "message": "Please visit https://github.com/login/device and enter code: WXYZ-ABCD"
}
```

**Response Parameters**:

| Field | Type | Description |
|-------|------|-------------|
| `device_code` | string | Used for polling (keep secret) |
| `user_code` | string | Display to user (4 alphanumeric pairs) |
| `verification_uri` | string | User visits this URL |
| `expires_in` | number | Seconds until expiry (default: 900) |
| `interval` | number | Minimum seconds between polls (default: 5) |

**Example - cURL**:
```bash
curl -X POST http://localhost:8787/auth/device/request \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### POST /auth/device/poll

Poll for access token after user authorizes (Device Flow).

**URL**: `POST /auth/device/poll`

**Authentication**: Not required

**Request Body**:
```json
{
  "device_code": "ABC123DEF456...",
  "user_code": "WXYZ-ABCD"
}
```

**Request Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_code` | string | Yes | From `/auth/device/request` |
| `user_code` | string | No | For logging/debugging |

**Response** (HTTP 200 - Authorized):
```json
{
  "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "github_123456789",
    "login": "octocat",
    "email": "octocat@github.com",
    "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
    "name": "The Octocat"
  }
}
```

**Response** (HTTP 202 - Still Waiting):
```json
{
  "error": "authorization_pending",
  "message": "User has not yet authorized. Continue polling."
}
```

**Response** (HTTP 429 - Polling Too Fast):
```json
{
  "error": "slow_down",
  "message": "Polling too fast. Increase interval to 10+ seconds."
}
```

**Response** (HTTP 410 - Device Code Expired):
```json
{
  "error": "expired_token",
  "message": "Device code expired. Request a new one."
}
```

**Response** (HTTP 403 - User Denied):
```json
{
  "error": "access_denied",
  "message": "User denied authorization"
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `missing_device_code` | 400 | Missing `device_code` parameter |
| `authorization_pending` | 202 | User hasn't authorized yet |
| `slow_down` | 429 | Polling too frequently |
| `expired_token` | 410 | Device code expired |
| `access_denied` | 403 | User denied authorization |

**Example - CLI Flow**:
```bash
# 1. Request device code
RESPONSE=$(curl -X POST http://localhost:8787/auth/device/request \
  -H "Content-Type: application/json" \
  -d '{}')

DEVICE_CODE=$(echo $RESPONSE | jq -r '.device_code')
USER_CODE=$(echo $RESPONSE | jq -r '.user_code')

# 2. Display to user
echo "Please visit https://github.com/login/device"
echo "Enter code: $USER_CODE"

# 3. Poll for token (every 5 seconds)
while true; do
  TOKEN=$(curl -X POST http://localhost:8787/auth/device/poll \
    -H "Content-Type: application/json" \
    -d "{\"device_code\": \"$DEVICE_CODE\"}")
  
  if echo $TOKEN | grep -q '"jwt"'; then
    echo "Authenticated!"
    echo $TOKEN | jq -r '.jwt'
    break
  fi
  
  sleep 5
done
```

---

### GET /auth/device/status

Check device flow status without polling.

**URL**: `GET /auth/device/status`

**Authentication**: Not required

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `device_code` | string | Yes | Device code to check |

**Response** (HTTP 200):
```json
{
  "status": "active",
  "expiresIn": 456
}
```

**Status Values**:
- `active` - Device code is valid
- `expired` - Device code has expired
- `invalid` - Device code not found

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `missing_device_code` | 400 | Missing `device_code` query parameter |

---

### POST /auth/device/cleanup

Cleanup expired device codes (admin only).

**URL**: `POST /auth/device/cleanup`

**Authentication**: Required (JWT token, admin user)

**Request Body**: Empty JSON object `{}`

**Response** (HTTP 200):
```json
{
  "message": "Device flow cleanup completed"
}
```

---

## System & Monitoring

### GET /

Gateway information and available endpoints.

**URL**: `GET /`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "message": "OpenAI API Gateway",
  "version": "1.0.0",
  "endpoints": [
    "/v1/chat/completions",
    "/v1/embeddings",
    "/v1/models",
    "/health",
    "/config",
    "/admin"
  ]
}
```

---

### GET /health

Health check with provider status and configuration.

**URL**: `GET /health`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "status": "ok",
  "message": "Gateway is running",
  "version": "1.0.0",
  "timestamp": "2025-02-18T12:00:00Z",
  "config": {
    "port": 8787,
    "max_retries": 3,
    "retry_delay": 1000,
    "cache_ttl": 3600000
  },
  "providers": {
    "openrouter": true,
    "gemini": true,
    "opencode": false
  },
  "sessions": {
    "totalSessions": 5,
    "activeSessions": 3,
    "closedSessions": 2,
    "totalMessages": 127
  },
  "opencode": {
    "connected": false,
    "error": "Connection refused"
  }
}
```

**Health Status Values**:
- `ok` - All systems operational
- `degraded` - Some providers unavailable
- `error` - Critical failure

**Example - cURL**:
```bash
curl http://localhost:8787/health
```

---

### GET /metrics

Prometheus-format metrics endpoint.

**URL**: `GET /metrics`

**Authentication**: Not required

**Response Content-Type**: `text/plain; version=0.0.4`

**Response Example**:
```
# HELP portatel_gateway_info Gateway system info
# TYPE portatel_gateway_info gauge
portatel_gateway_info{version="2.0"} 1

# HELP portatel_gateway_uptime_seconds Gateway uptime
# TYPE portatel_gateway_uptime_seconds counter
portatel_gateway_uptime_seconds 3600.5

# HELP portatel_http_requests_total Total HTTP requests
# TYPE portatel_http_requests_total counter
portatel_http_requests_total{endpoint="/v1/chat/completions",method="POST"} 142
portatel_http_requests_total{endpoint="/health",method="GET"} 48

# HELP portatel_chat_completions_total Total chat completions
# TYPE portatel_chat_completions_total counter
portatel_chat_completions_total 142

# HELP portatel_provider_requests_total Requests per provider
# TYPE portatel_provider_requests_total counter
portatel_provider_requests_total{provider="openRouter"} 120
portatel_provider_requests_total{provider="gemini"} 22
portatel_provider_errors_total{provider="openRouter"} 3
portatel_provider_errors_total{provider="gemini"} 1

# HELP portatel_rate_limit_hits Rate limit violations
# TYPE portatel_rate_limit_hits counter
portatel_rate_limit_hits 2

# HELP portatel_http_request_duration_seconds Request latency
# TYPE portatel_http_request_duration_seconds histogram
portatel_http_request_duration_seconds_sum{endpoint="/v1/chat/completions"} 2.5
portatel_http_request_duration_seconds_max{endpoint="/v1/chat/completions"} 1.2
portatel_http_request_duration_seconds{endpoint="/v1/chat/completions",le="p95"} 0.95
```

**Metrics Available**:

| Metric | Type | Description |
|--------|------|-------------|
| `portatel_gateway_info` | gauge | Gateway version info |
| `portatel_gateway_uptime_seconds` | counter | Uptime in seconds |
| `portatel_http_requests_total` | counter | Total requests per endpoint/method |
| `portatel_chat_completions_total` | counter | Total chat completions |
| `portatel_chat_completions_tokens_total` | counter | Total tokens used |
| `portatel_provider_requests_total` | counter | Requests per provider |
| `portatel_provider_errors_total` | counter | Errors per provider |
| `portatel_rate_limit_hits` | counter | Rate limit violations |
| `portatel_validation_errors` | counter | Validation errors |
| `portatel_http_request_duration_seconds` | histogram | Request latency stats |

**Example - Prometheus Integration**:
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'openai-gateway'
    static_configs:
      - targets: ['localhost:8787']
    metrics_path: '/metrics'
```

---

### GET /v1/emulate

Get information about available API providers for emulation.

**URL**: `GET /v1/emulate`

**Authentication**: Not required

**Response** (HTTP 200):
```json
{
  "availableApis": [
    {
      "id": "openai",
      "name": "OpenAI API (default)",
      "description": "Emulate OpenAI API endpoints",
      "endpoints": [
        "/v1/chat/completions",
        "/v1/embeddings",
        "/v1/models"
      ]
    },
    {
      "id": "custom-provider",
      "name": "My Custom API",
      "description": "Custom provider: https://api.example.com",
      "endpoints": [
        "/v1/chat/completions",
        "/v1/embeddings"
      ],
      "endpoint": "https://api.example.com",
      "modelPrefix": "my"
    }
  ],
  "currentEmulation": "openai"
}
```

---

### POST /v1/emulate

Switch to different API provider emulation.

**URL**: `POST /v1/emulate`

**Authentication**: Not required

**Request Body**:
```json
{
  "api": "custom-provider"
}
```

**Request Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api` | string | Yes | Provider ID: `openai` or custom provider name |

**Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Switched to custom-provider API emulation",
  "currentEmulation": "custom-provider"
}
```

**Error Responses**:

| Code | Status | Description |
|------|--------|-------------|
| `invalid_provider` | 400 | Unknown provider |

---

### GET /admin/test-storage

Test browser localStorage/sessionStorage shim (diagnostic).

**URL**: `GET /admin/test-storage`

**Authentication**: Not required

**Response**: HTML page with JavaScript storage test

---

## Error Handling

### Standard Error Response Format

All errors follow this format:

```json
{
  "error": {
    "message": "Descriptive error message",
    "type": "error_type",
    "code": "error_code",
    "param": "field_name or null"
  }
}
```

### Common Error Codes

| Code | Status | Type | Description |
|------|--------|------|-------------|
| `invalid_request` | 400 | validation_error | Malformed request |
| `invalid_api_key` | 401 | auth_failure | Invalid API key |
| `rate_limit_exceeded` | 429 | rate_limit | Too many requests |
| `provider_error` | 502-503 | server_error | Provider unavailable |
| `timeout_error` | 504 | network_error | Request timeout |
| `authentication_error` | 401 | auth_failure | Missing/invalid token |
| `forbidden` | 403 | authorization_error | Insufficient permissions |
| `not_found` | 404 | not_found | Resource not found |
| `configuration_error` | 503 | config_error | Provider not configured |

### Error Response Examples

**Invalid Request (400)**:
```json
{
  "error": {
    "message": "Invalid request parameters.",
    "type": "validation_error",
    "code": "invalid_request",
    "param": "model"
  }
}
```

**Rate Limited (429)**:
```json
{
  "error": {
    "message": "Rate limit exceeded. Too many requests.",
    "type": "rate_limit_exceeded",
    "code": "rate_limit_exceeded"
  }
}
```

**Provider Error (503)**:
```json
{
  "error": {
    "message": "Provider service temporarily unavailable.",
    "type": "server_error",
    "code": "provider_error"
  }
}
```

---

## Rate Limiting

### How It Works

The gateway uses token bucket algorithm for rate limiting:

1. **Bucket**: Each API key has a token bucket
2. **Refill Rate**: Tokens refill continuously over time
3. **Request Cost**: Each request costs 1 token
4. **Overflow**: Extra tokens are discarded

### Configuration

Set via environment variables:

```bash
# 60 second window, 100 requests maximum
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Default Limits

- **Window**: 60 seconds
- **Max Requests**: 100 per window
- **Effective Rate**: ~1.67 requests/second

### Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1645123456
```

### When Limited

Responses with HTTP 429:

```json
{
  "error": {
    "message": "Rate limit exceeded. Too many requests.",
    "type": "rate_limit_exceeded",
    "code": "rate_limit_exceeded"
  }
}
```

**Retry Strategy**:
```bash
# Exponential backoff
DELAY=1
MAX_RETRIES=5

for i in {1..MAX_RETRIES}; do
  RESPONSE=$(curl -X POST http://localhost:8787/v1/chat/completions ...)
  
  if [ $? -eq 0 ]; then
    echo "Success"
    break
  fi
  
  sleep $DELAY
  DELAY=$((DELAY * 2))
done
```

---

## Response Caching

### How It Works

The gateway caches non-streaming chat completion responses:

1. **Cache Key**: Hash of model + messages + parameters
2. **TTL**: Configurable (default 5 minutes)
3. **Scope**: Per-gateway instance (in-memory)
4. **Strategies**: LRU eviction when full

### Configuration

```bash
# 5 minutes (300,000 ms)
CACHE_TTL=300000
```

### Cache Behavior

- **Streaming requests**: Never cached
- **Streaming parameter**: Ignored for caching
- **Different parameters**: Different cache entries
- **Hit/Miss**: Logged in debug mode

### Benefits

- Reduces API calls to providers
- Lower latency (cache hits)
- Reduced costs
- Transparent to clients

---

## Webhooks & Event Streaming

Currently not implemented. All endpoints are request-response based.

---

## Endpoint Summary Table

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /v1/chat/completions | No | Chat completion (OpenAI compatible) |
| POST | /v1/embeddings | No | Text embeddings |
| GET | /v1/models | No | List available models |
| GET | /v1/models-by-provider | No | Models grouped by provider |
| GET | /v1/emulate | No | List emulation providers |
| POST | /v1/emulate | No | Switch emulation provider |
| GET | / | No | Gateway info |
| GET | /health | No | Health check |
| GET | /metrics | No | Prometheus metrics |
| GET | /config | No | Current configuration |
| GET | /config/providers | No | Provider details |
| POST | /config/models | Admin | Update model mapping |
| POST | /config/clear-cache | Admin | Clear response cache |
| POST | /config/providers | Admin | Add/remove API keys |
| POST | /config/providers/custom | Admin | Add custom provider |
| DELETE | /config/providers/custom/:name | Admin | Remove custom provider |
| POST | /config/fallbacks | Admin | Configure fallbacks |
| GET | /admin | Admin | Admin panel UI |
| GET | /session/status | No | Session statistics |
| GET | /session/:sessionId | No | Session details |
| DELETE | /session/:sessionId | No | Delete session |
| GET | /login | No | GitHub OAuth redirect |
| GET | /auth/github/callback | No | OAuth callback |
| GET | /auth/me | Auth | Current user |
| POST | /auth/logout | No | Logout |
| POST | /auth/device/request | No | Request device code |
| POST | /auth/device/poll | No | Poll for token |
| GET | /auth/device/status | No | Device flow status |
| POST | /auth/device/cleanup | Admin | Cleanup device codes |

---

## Changelog

### Version 1.0.0 (Current)

**Features**:
- ✅ OpenAI API emulation (chat completions, embeddings)
- ✅ Multi-provider support (OpenRouter, Gemini, OpenCode, custom)
- ✅ Rate limiting (token bucket)
- ✅ Response caching (LRU, TTL)
- ✅ Prometheus metrics
- ✅ Session management
- ✅ GitHub OAuth & Device Flow auth
- ✅ Admin panel
- ✅ Dynamic provider management
- ✅ Comprehensive error handling
- ✅ Streaming support
- ✅ Provider failover

**Known Limitations**:
- Gemini streaming not yet supported
- Single-instance memory cache (no Redis)
- Admin configuration not persisted

---

## Support & Resources

- **GitHub Issues**: Report bugs and request features
- **Documentation**: See README.md for setup and configuration
- **Troubleshooting**: Check README.md Troubleshooting section
- **Provider Status**: 
  - OpenRouter: https://openrouter.ai/status
  - Google Gemini: https://ai.google.dev/
  - GitHub: https://www.githubstatus.com/
