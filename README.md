# OpenAI OpenRouter Gateway

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-14+-green.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)](#status)

A production-grade gateway that emulates the OpenAI API while transparently routing requests to free AI models from OpenRouter and Google Gemini. Perfect for development, testing, and cost-effective inference at scale.

## 🎯 Quick Start

```bash
# Clone and setup
git clone <repo-url>
cd openai-gateway
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys (see Configuration below)

# Start the gateway
npm start
# Gateway available at http://localhost:8787

# Use like OpenAI API
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## ✨ Key Features

- **🔄 Drop-in OpenAI Replacement** - Identical API interface, zero client code changes
- **🆓 Free Models** - Access to 15+ free LLMs from OpenRouter + Google Gemini  
- **🚀 GPT-5 Emulation** - Request `gpt-5` or `gpt-5-turbo`, transparently route to state-of-the-art models
- **📊 Production Features**:
  - Token-bucket rate limiting (60 req/min per key)
  - Request validation and sanitization
  - Response caching with configurable TTL
  - Prometheus metrics endpoint (`/metrics`)
  - Provider failover (Gemini → OpenRouter, etc.)
- **🔐 Security** - Per-API-key rate limiting, payload size limits, input validation
- **📡 Observability** - Structured logging, metrics, session tracking
- **🐳 Container-Ready** - Dockerfile + docker-compose included
- **🎭 Device Flow Auth** - GitHub Device Flow for CLI/headless applications
- **⚙️ Admin Panel** - Web UI for configuration and monitoring

## 📋 Architecture Overview

```
Client Application
    ↓
    ├─ OpenAI SDK (unchanged)
    └─ Custom HTTP Client
         ↓
    [OpenAI Gateway - Port 8787]
         ├─ Auth Middleware (GitHub OAuth/Device Flow)
         ├─ Rate Limiter (Token bucket)
         ├─ Request Validator
         ├─ Response Cache (LRU, TTL)
         ├─ Metrics Recorder (Prometheus)
         ├─ Session Manager
         └─ Router Logic
              ├─→ OpenRouter API (DeepSeek, Qwen, Mistral, Llama, Gemma, OpenCode)
              ├─→ Google Gemini API (Gemini 3 Flash, 2.0 Flash, 1.5 Pro)
              └─→ Fallback Provider (if primary fails)
```

## 🛠 Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 14+ |
| **Framework** | Express.js | 4.18.2 |
| **Auth** | JWT + GitHub OAuth | jsonwebtoken 9.0.3 |
| **AI Providers** | OpenRouter, Google Gemini | Latest |
| **HTTP Client** | Axios | 1.6.7 |
| **Caching** | In-Memory LRU | Built-in |
| **Environment** | dotenv | 16.4.5 |
| **Container** | Docker | Latest |

## 📦 Available Models

### OpenRouter Models (15+ Free Models)

| Family | Model | Context | Specialty |
|--------|-------|---------|-----------|
| **DeepSeek** | `deepseek-r1-0528` | 164K | Reasoning, Math, Code |
| **Qwen3** | `qwen3-235b` | 262K | Advanced reasoning |
| **Qwen3** | `qwen3-next-80b` | 262K | Fast, general-purpose |
| **Qwen3** | `qwen3-coder` | 262K | Code generation |
| **Mistral** | `mistral-small-3.1-24b` | 128K | Vision + Tools |
| **Llama** | `llama-3.3-70b` | 8K | High quality |
| **Gemma** | `gemma-2-9b` | 8K | Open source |
| **OpenCode** | `opencode-big-pickle` | ? | OpenCode models |

### Google Gemini Models

| Model | Context | Speed | Best For |
|-------|---------|-------|----------|
| `gemini-3-flash` | 1M tokens | ⚡ Ultra-fast | Real-time responses |
| `gemini-3-pro` | 1M tokens | 🎯 Balanced | Reasoning + speed |
| `gemini-2.0-flash` | 1M tokens | ⚡ Very fast | High throughput |
| `gemini-1.5-flash` | 128K | ⚡ Fast | Latency-sensitive |
| `gemini-1.5-pro` | 1M tokens | 🤔 Slow | Complex reasoning |

### Model Mapping (Transparent)

When you request a standard OpenAI model, the gateway automatically maps it:

| Your Request | Routed To | Provider |
|--------------|-----------|----------|
| `gpt-3.5-turbo` | DeepSeek R1 | OpenRouter |
| `gpt-4` | DeepSeek R1 | OpenRouter |
| `gpt-4o` | Qwen3 235B | OpenRouter |
| `gpt-4o-mini` | Qwen3 Next 80B | OpenRouter |
| `gpt-5` | Qwen3 235B | OpenRouter |
| `gpt-5-turbo` | Qwen3 Next 80B | OpenRouter |
| `gpt-4-vision` | Qwen3 VL 235B | OpenRouter |
| `gpt-4-code` | Qwen3 Coder | OpenRouter |
| `gemini-3-flash` | Gemini 3 Flash | Google |

## ⚙️ Configuration

### Environment Variables

Create `.env` file (copy from `.env.example`):

```bash
# Server
PORT=8787                              # Gateway port
DEBUG=false                            # Enable debug logging

# API Keys (at least ONE is required)
OPENROUTER_API_KEY=your_key_here      # For OpenRouter models
GEMINI_API_KEY=your_key_here          # For Google Gemini models
OPENCODE_API_KEY=your_key_here        # For OpenCode models

# GitHub OAuth (optional, for auth features)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=http://localhost:8787/auth/github/callback
JWT_SECRET=your_jwt_secret_key        # Change in production!

# Performance
CACHE_TTL=300000                       # Cache TTL in ms (5 min default)
MAX_RETRIES=3                          # Retry failed requests
RETRY_DELAY=1000                       # Delay between retries (ms)

# Rate Limiting
RATE_LIMIT_WINDOW=60000                # 1 minute window
RATE_LIMIT_MAX_REQUESTS=100            # Requests per window
```

### Getting API Keys

#### 🔑 OpenRouter API Key (Free, ~200 req/day limit)

1. Visit https://openrouter.ai
2. Sign up / Log in
3. Navigate to Account Settings → Keys
4. Create new API key
5. Copy to `.env`

**Free Tier Limits**: ~20 requests/min, ~200 requests/day for free models

#### 🔑 Google Gemini API Key (Free, ~15 req/min limit)

1. Visit https://aistudio.google.com
2. Log in with Google account
3. Click "Create API Key"
4. Copy key to `.env`

**Free Tier Limits**: 
- Gemini Flash: ~15 req/min
- Gemini Pro: ~2-5 req/min

## 🚀 Usage Examples

### Command Line (cURL)

```bash
# Simple chat completion
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Explain quantum computing"}
    ]
  }'

# With parameters
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4-code",
    "messages": [
      {"role": "system", "content": "You are a Python expert"},
      {"role": "user", "content": "Write a quicksort function"}
    ],
    "temperature": 0.7,
    "max_tokens": 500
  }'

# Check health
curl http://localhost:8787/health

# View metrics (Prometheus format)
curl http://localhost:8787/metrics

# Get available models
curl http://localhost:8787/v1/models
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

# Point to gateway instead of OpenAI
client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="any-key-works"  # Not validated by gateway
)

# Use normally
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Hello, world!"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: "any-key-works"
});

const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "user", content: "What is machine learning?" }
  ]
});

console.log(response.choices[0].message.content);
```

### Node.js Streaming

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: "any-key-works"
});

const stream = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "user", content: "Count to 10" }
  ],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0].delta.content || "");
}
```

## 📡 API Endpoints

### Chat Completions
- **`POST /v1/chat/completions`** - Generate chat responses (streaming supported)
- Request body: OpenAI chat completion schema
- Response: OpenAI completion format + `sessionId`

### Embeddings
- **`POST /v1/embeddings`** - Generate text embeddings

### Models
- **`GET /v1/models`** - List all available models
- **`GET /v1/models-by-provider`** - Models grouped by provider

### Gateway Info
- **`GET /`** - Gateway information and version
- **`GET /health`** - Health check (status, providers, session stats)
- **`GET /metrics`** - Prometheus metrics

### Admin & Configuration
- **`GET /admin`** - Web UI (requires auth)
- **`GET /config`** - Current configuration (JSON)
- **`POST /config/models`** - Add model mapping
- **`POST /config/clear-cache`** - Clear response cache
- **`GET /config/providers`** - List all providers
- **`POST /config/providers/custom`** - Add custom provider

### Authentication
- **`GET /auth/github/callback`** - GitHub OAuth callback
- **`POST /auth/device/request`** - Request device code
- **`POST /auth/device/poll`** - Poll for access token
- **`GET /auth/me`** - Get current user (requires auth)
- **`POST /auth/logout`** - Logout

### Sessions
- **`GET /session/status`** - Session statistics
- **`GET /session/:sessionId`** - Get session details
- **`DELETE /session/:sessionId`** - Delete session

### API Emulation (Advanced)
- **`GET /v1/emulate`** - Current emulation + available APIs
- **`POST /v1/emulate`** - Switch to different API provider

## 🏃 Production Features

### ⚡ Rate Limiting

Prevents abuse and API quota exhaustion using token bucket algorithm:

```javascript
// 100 requests per 60 seconds per API key
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100
```

When limit exceeded: HTTP 429 with `Retry-After` header

### 💾 Response Caching

LRU cache with TTL reduces latency and costs:

```bash
# Cache for 5 minutes (300,000 ms)
CACHE_TTL=300000
```

Cache key: `hash(model + messages + parameters)`
- Applies to non-streaming completions
- Reduces latency from 1-5 seconds → milliseconds
- Saves API quota

### 📊 Prometheus Metrics

Full observability endpoint at `/metrics`:

```
# Request counts per endpoint
http_requests_total{endpoint="/v1/chat/completions", method="POST"}

# Request latency
http_request_duration_seconds{endpoint="/v1/chat/completions", method="POST"}

# Provider-specific metrics
openrouter_requests_total
gemini_requests_total
opencode_requests_total

# Rate limiting metrics
rate_limit_hits_total

# Cache metrics
response_cache_hits_total
response_cache_misses_total

# Chat metrics
chat_completions_total
chat_completion_tokens_used
```

Integrate with Prometheus/Grafana for real-time dashboards.

### 🔀 Provider Failover

Automatic fallback when primary provider fails:

- **Gemini error** → Fallback to OpenRouter
- **OpenCode error** → Fallback to OpenRouter
- **OpenRouter error** → Fallback to Gemini (if available)

Maintains request compatibility and ensures service continuity.

### ✅ Request Validation

Multi-layer validation prevents malformed requests:

- Content-Type must be `application/json`
- Body size max 10MB (DoS protection)
- Chat completion schema validation
- Message format validation (role + content required)
- Parameter range validation:
  - `temperature`: 0-2
  - `top_p`: 0-1
  - `max_tokens`: 1-4096

### 📝 Comprehensive Logging

Structured logging for debugging and monitoring:

```bash
# Enable debug logging
DEBUG=true npm start
```

Logs include:
- Session lifecycle events
- Provider initialization
- Request routing decisions
- Error classification
- Performance metrics

## 🐳 Docker Deployment

### Using Docker Run

```bash
# Build image
docker build -t openai-gateway:latest .

# Run container
docker run -d \
  -p 8787:8787 \
  --env-file .env \
  --name gateway \
  openai-gateway:latest

# View logs
docker logs -f gateway

# Stop container
docker stop gateway
```

### Using Docker Compose

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**docker-compose.yml** includes:
- Gateway service (port 8787)
- Environment configuration
- Volume mounts for persistence
- Health checks

## 🧪 Testing & Validation

### Unit Tests (Phase 1)

17 comprehensive tests covering:
- Session management (create, delete, cleanup)
- Error classification (auth, rate limit, network)
- Streaming format (SSE)
- Health checks

```bash
npm test
# or
node test-phase1.js
```

### Load Testing (Phase 2)

```bash
node load-test-phase2.js
```

Tests:
- Rate limiting enforcement
- Request validation (5 scenarios)
- Metrics endpoint format
- Provider failover
- Response caching

## 📊 Monitoring & Observability

### Health Check

```bash
curl http://localhost:8787/health
```

Response includes:
- Gateway status
- Provider connectivity
- Session statistics
- Timestamp

### Session Management

```bash
# Get session status
curl http://localhost:8787/session/status

# Get session details
curl http://localhost:8787/session/{sessionId}

# Delete session
curl -X DELETE http://localhost:8787/session/{sessionId}
```

Sessions automatically expire after 1 hour (configurable).

### Logging

Gateway logs key events:
- API key rate limit status
- Model routing decisions
- Provider failures and failovers
- Error details with context
- Performance warnings

Enable debug mode for detailed diagnostics:

```bash
DEBUG=true npm start
```

## 🔑 Authentication (Optional)

### GitHub OAuth

For web applications:

```bash
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=http://localhost:8787/auth/github/callback
JWT_SECRET=your_jwt_secret_key
```

### GitHub Device Flow

For CLI/headless applications:

```bash
# Request device code
curl -X POST http://localhost:8787/auth/device/request

# Get response:
# {
#   "device_code": "...",
#   "user_code": "XXXX-XXXX",
#   "verification_uri": "https://github.com/login/device",
#   "expires_in": 900
# }

# User visits github.com/login/device and enters user_code

# Poll for token
curl -X POST http://localhost:8787/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code": "..."}'

# Returns JWT token
# {
#   "token": "eyJhbGc...",
#   "user": {"id": "...", "login": "...", "email": "..."}
# }
```

See [DEVICE_FLOW.md](./DEVICE_FLOW.md) for full details.

## 🐛 Troubleshooting

### Issue: "Rate limit exceeded"

**Solution**: Increase rate limit window or max requests:

```bash
RATE_LIMIT_WINDOW=120000      # 2 minutes
RATE_LIMIT_MAX_REQUESTS=200   # Requests per window
```

### Issue: "Provider unreachable"

**Check**: 
1. API keys are valid and have quota
2. Network connectivity: `curl https://api.openrouter.ai/api/v1/models`
3. Provider status pages (OpenRouter, Google, etc.)
4. View logs with `DEBUG=true`

### Issue: "Slow responses"

**Optimize**:
1. Cache is enabled: `CACHE_TTL=300000`
2. Reduce `MAX_RETRIES` if acceptable
3. Use faster models: `gemini-3-flash` or `qwen3-next-80b`
4. Check `/metrics` for bottlenecks

### Issue: "Out of API quota"

**Solutions**:
1. Switch to models with higher quota
2. Enable response caching to reduce API calls
3. Reduce rate limits to slow consumption
4. Upgrade to paid tiers on provider

### Issue: "502 Bad Gateway"

**Debug**:
```bash
# Check health
curl http://localhost:8787/health

# View recent logs
docker logs gateway

# Verify backend connectivity
curl -v https://api.openrouter.ai/api/v1/models
```

## 📚 Documentation

- **[PHASE1_COMPLETION_REPORT.md](./PHASE1_COMPLETION_REPORT.md)** - Production readiness implementation (session management, error handling, logging)
- **[PHASE2_COMPLETION_REPORT.md](./PHASE2_COMPLETION_REPORT.md)** - Advanced production features (rate limiting, validation, metrics, failover)
- **[DEVICE_FLOW.md](./DEVICE_FLOW.md)** - GitHub Device Flow authentication guide

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Quality

- Maintain Node.js 14+ compatibility
- Use modern async/await
- Include error handling
- Add tests for new features
- Update README for breaking changes

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[OpenRouter](https://openrouter.ai)** - Free AI model aggregation
- **[Google Gemini](https://ai.google.dev/)** - Free Gemini API
- **[OpenAI](https://openai.com)** - Original API specification
- **[Express.js](https://expressjs.com/)** - Web framework

## 📞 Support

For issues, questions, or suggestions:

1. Check the [Troubleshooting](#-troubleshooting) section
2. Review [PHASE1_COMPLETION_REPORT.md](./PHASE1_COMPLETION_REPORT.md) for known solutions
3. Check provider status pages (OpenRouter, Google, OpenCode)
4. Enable `DEBUG=true` for detailed logging

## 🗺️ Roadmap

- ✅ Phase 1: Production readiness (session management, error handling, logging)
- ✅ Phase 2: Advanced production features (rate limiting, validation, metrics, failover)
- 📋 Phase 3: Persistence & optimization (Redis caching, cost tracking, A/B testing)
- 📋 Advanced monitoring (Datadog/New Relic integration)
- 📋 Database integration for persistent caching
- 📋 Provider cost optimization and analytics

---

**Status**: ✅ Production Ready  
**Current Version**: 1.0.0  
**Last Updated**: February 2026
