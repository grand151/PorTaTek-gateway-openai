# API Quick Reference - OpenAI Gateway

**Total Endpoints**: 31  
**Documentation**: See `API_DOCUMENTATION.md` for complete details

---

## Endpoint Categories

### 🤖 AI & Models (4 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/chat/completions` | Chat responses (streaming supported) |
| POST | `/v1/embeddings` | Text embeddings |
| GET | `/v1/models` | List all models |
| GET | `/v1/models-by-provider` | Models grouped by provider |

### ⚙️ Configuration & Admin (8 endpoints)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/config` | No | Current configuration |
| GET | `/config/providers` | No | Provider details |
| POST | `/config/models` | Admin | Update model mapping |
| POST | `/config/clear-cache` | Admin | Clear response cache |
| POST | `/config/providers` | Admin | Add/remove API keys |
| POST | `/config/providers/custom` | Admin | Add custom provider |
| DELETE | `/config/providers/custom/:name` | Admin | Remove custom provider |
| POST | `/config/fallbacks` | Admin | Configure fallbacks |
| GET | `/admin` | Admin | Admin panel UI |

### 📊 Sessions (3 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/session/status` | Session statistics |
| GET | `/session/:sessionId` | Session details |
| DELETE | `/session/:sessionId` | Delete session |

### 🔐 Authentication (8 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/login` | GitHub OAuth redirect |
| GET | `/auth/github/callback` | OAuth callback |
| GET | `/auth/me` | Current user (requires auth) |
| POST | `/auth/logout` | Logout |
| POST | `/auth/device/request` | Request device code |
| POST | `/auth/device/poll` | Poll for access token |
| GET | `/auth/device/status` | Device flow status |
| POST | `/auth/device/cleanup` | Cleanup device codes (admin) |

### 📈 System & Monitoring (6 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Gateway info |
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |
| GET | `/v1/emulate` | List emulation providers |
| POST | `/v1/emulate` | Switch emulation provider |
| GET | `/admin/test-storage` | Storage test (diagnostic) |

---

## Quick Examples

### Chat Completion
```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

### Get Models
```bash
curl http://localhost:8787/v1/models
```

### Health Check
```bash
curl http://localhost:8787/health
```

### Metrics (Prometheus)
```bash
curl http://localhost:8787/metrics
```

### Device Flow Auth (CLI)
```bash
# Request device code
curl -X POST http://localhost:8787/auth/device/request

# Poll for token
curl -X POST http://localhost:8787/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code": "ABC123..."}'
```

### Admin: Update Model Mapping
```bash
curl -X POST http://localhost:8787/config/models \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "openaiModel": "gpt-4",
    "targetModel": "qwen/qwen3-235b:free",
    "provider": "openrouter"
  }'
```

---

## Authentication Methods

### 1. No Authentication (Public Endpoints)
```bash
curl http://localhost:8787/v1/models
```

### 2. Rate Limiting (Automatic)
```bash
# All endpoints have rate limiting
# Default: 100 requests per 60 seconds
# Use X-API-Key header or Authorization for per-key limits
curl -H "X-API-Key: my-key" http://localhost:8787/v1/models
```

### 3. JWT Authentication (Admin Endpoints)
```bash
# Via Bearer token
curl -H "Authorization: Bearer <jwt_token>" http://localhost:8787/admin

# Via cookie
curl -H "Cookie: auth_token=<jwt_token>" http://localhost:8787/admin
```

### 4. GitHub Device Flow (CLI)
```bash
# Step 1: Get device code
curl -X POST http://localhost:8787/auth/device/request

# Step 2: User authorizes at github.com/login/device

# Step 3: Poll for JWT token
curl -X POST http://localhost:8787/auth/device/poll \
  -d '{"device_code": "..."}'
```

---

## Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Chat completion returned |
| 202 | Accepted (pending) | Device flow - waiting for user |
| 400 | Bad request | Invalid parameters |
| 401 | Unauthorized | Invalid/missing token |
| 403 | Forbidden | Non-admin user accessing admin endpoint |
| 404 | Not found | Session doesn't exist |
| 429 | Rate limited | Too many requests |
| 502 | Bad gateway | Provider unavailable |
| 503 | Service unavailable | Provider not configured |
| 504 | Gateway timeout | Provider timeout |

---

## Rate Limiting

**Default**: 100 requests per 60 seconds per API key

**Headers in response**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1645123456
```

**When exceeded** → HTTP 429:
```json
{
  "error": {
    "message": "Rate limit exceeded. Too many requests.",
    "type": "rate_limit_exceeded"
  }
}
```

**Retry strategy**: Exponential backoff with `X-RateLimit-Reset` header

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "message": "Description",
    "type": "error_type",
    "code": "error_code"
  }
}
```

**Common codes**:
- `invalid_request` - Bad parameters
- `authentication_error` - Auth failed
- `rate_limit_exceeded` - Rate limit hit
- `provider_error` - Provider unavailable
- `timeout_error` - Request timeout
- `configuration_error` - Provider not configured

---

## Supported Models

### Default Model Mappings
| Your Request | Routes To | Provider |
|--------------|-----------|----------|
| gpt-3.5-turbo | DeepSeek R1 | OpenRouter |
| gpt-4 | DeepSeek R1 | OpenRouter |
| gpt-4o | Qwen3 235B | OpenRouter |
| gpt-4o-mini | Qwen3 Next 80B | OpenRouter |
| gpt-5 | Qwen3 235B | OpenRouter |
| gemini-3-flash | Gemini 3 Flash | Google |
| gemini-1.5-pro | Gemini 1.5 Pro | Google |

Use `/v1/models` or `/v1/models-by-provider` to get live list.

---

## Response Caching

- **Enabled**: For non-streaming chat completions
- **Default TTL**: 5 minutes (300,000 ms)
- **Cache Key**: Hash of model + messages + parameters
- **Scope**: Per-gateway instance (in-memory)
- **Benefit**: Reduced latency, lower API costs

---

## Metrics Available

**Endpoint**: `GET /metrics` (Prometheus format)

**Key metrics**:
- `portatel_http_requests_total` - Request count per endpoint
- `portatel_chat_completions_total` - Chat completion count
- `portatel_provider_requests_total` - Requests per provider
- `portatel_rate_limit_hits` - Rate limit violations
- `portatel_http_request_duration_seconds` - Latency (p95, max, avg)

---

## Configuration via Environment

```bash
# Server
PORT=8787
DEBUG=false

# API Keys (at least ONE required)
OPENROUTER_API_KEY=...
GEMINI_API_KEY=...

# GitHub OAuth (optional)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:8787/auth/github/callback
JWT_SECRET=your-secret

# Performance
CACHE_TTL=300000          # 5 minutes
MAX_RETRIES=3
RETRY_DELAY=1000          # 1 second

# Rate Limiting
RATE_LIMIT_WINDOW=60000   # 60 seconds
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Common Use Cases

### 1. Drop-in OpenAI Replacement
```python
from openai import OpenAI

# Just change the base_url!
client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="any-key-works"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### 2. CLI Authentication (Device Flow)
```bash
# Get device code
RESPONSE=$(curl -s -X POST http://localhost:8787/auth/device/request)
DEVICE_CODE=$(echo $RESPONSE | jq -r '.device_code')
USER_CODE=$(echo $RESPONSE | jq -r '.user_code')

# Display to user
echo "Visit: https://github.com/login/device"
echo "Code: $USER_CODE"

# Poll for token
while true; do
  TOKEN=$(curl -s -X POST http://localhost:8787/auth/device/poll \
    -H "Content-Type: application/json" \
    -d "{\"device_code\": \"$DEVICE_CODE\"}" | jq -r '.jwt')
  
  if [ "$TOKEN" != "null" ]; then
    echo "Token: $TOKEN"
    break
  fi
  sleep 5
done
```

### 3. Monitor Gateway Health
```bash
# Simple health check
curl http://localhost:8787/health

# Prometheus metrics
curl http://localhost:8787/metrics | grep portatel_
```

### 4. Manage Multiple API Keys
```bash
# Add OpenRouter key
curl -X POST http://localhost:8787/config/providers \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{"provider": "openrouter", "apiKey": "sk-or-v1-..."}'

# Add Gemini key
curl -X POST http://localhost:8787/config/providers \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{"provider": "gemini", "apiKey": "AIz..."}'
```

### 5. Add Custom Provider
```bash
curl -X POST http://localhost:8787/config/providers/custom \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-provider",
    "displayName": "My API",
    "endpoint": "https://api.example.com/v1",
    "apiKeys": ["key1"],
    "modelPrefix": "my"
  }'
```

---

## Troubleshooting

**503 Provider not configured**
→ Set API key via `/config/providers` or environment variable

**429 Rate limited**
→ Increase `RATE_LIMIT_MAX_REQUESTS` or wait for rate limit reset

**504 Timeout**
→ Provider took too long; increase `MAX_RETRIES` or reduce `max_tokens`

**401 Unauthorized**
→ Missing or invalid JWT token for admin endpoints

**202 Device flow authorization_pending**
→ User hasn't authorized yet; keep polling

---

## Links

- **Full Documentation**: `API_DOCUMENTATION.md`
- **README**: `README.md` (setup, configuration, troubleshooting)
- **Device Flow**: `DEVICE_FLOW.md`
- **Source Code**: `openai-gateway.js`

---

**Gateway Version**: 1.0.0  
**Last Updated**: February 2025
