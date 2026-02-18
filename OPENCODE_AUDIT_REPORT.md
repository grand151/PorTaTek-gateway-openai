# Audit: OpenCode Server Endpoint Accessibility
**Report Date:** February 18, 2026  
**OpenCode Specification Version:** Latest (https://opencode.ai/docs/pl/server/)  
**Gateway Version:** PorTaTek Gateway with OpenCode SDK Integration  
**Audit Scope:** OpenCode server API coverage and endpoint implementation status

---

## Executive Summary

The PorTaTek gateway currently implements **~3% of available OpenCode server endpoints**. The implementation focuses on basic chat completion functionality but lacks:

- ❌ Streaming support (501 Not Implemented)
- ❌ Session management (hardcoded single session)
- ❌ Message history tracking
- ❌ File and tool integration
- ❌ Advanced OpenCode features (MCP, LSP, VCS, etc.)

**Recommendation:** Expand implementation to support at least Tier-1 endpoints for production use.

---

## OpenCode Server API Overview

**Total Available Endpoints:** 68+  
**Endpoint Categories:** 16  
**Current Coverage:** 1 endpoint (session.prompt)

### Endpoint Categories

| Category | Endpoints | Usage |
|----------|-----------|-------|
| **Global** | 2 | Not implemented |
| **Project** | 2 | Not implemented |
| **Path & VCS** | 2 | Not implemented |
| **Instance** | 1 | Not implemented |
| **Config** | 3 | Not implemented |
| **Provider** | 6 | Partial (models only) |
| **Sessions** | 17 | ✅ Used (1/17) |
| **Messages** | 6 | ✅ Used (1/6) |
| **Commands** | 1 | Not implemented |
| **Files** | 6 | Not implemented |
| **Tools** | 2 | Not implemented |
| **LSP/Formatter/MCP** | 3 | Not implemented |
| **Agents** | 1 | Not implemented |
| **Logging** | 1 | Not implemented |
| **TUI** | 11 | Not implemented |
| **Auth/Events/Doc** | 3 | Not implemented |

---

## Implementation Status by Tier

### ✅ TIER 1: CURRENTLY IMPLEMENTED

#### 1. **Session Prompt Endpoint**
```
POST /session/:id/prompt
```
- **Implementation:** `fetchOpencodeWithRetry()` function (lines 355-410)
- **SDK Call:** `opencodeClient.session.prompt({ path: { id }, body: { model, parts } })`
- **Status:** ✅ Working (non-streaming)
- **Limitations:**
  - Session ID hardcoded as 'default-session' (line 379)
  - Only extracts last user message (line 360-361)
  - No streaming support (line 549-556 returns 501)
  - Limited error handling
  - No retry logic per session

**Current Usage:**
```javascript
const response = await opencodeClient.session.prompt({
  path: { id: 'default-session' },
  body: {
    model: { providerID: 'opencode', modelID: model },
    parts: [{ type: 'text', text: lastUserMessage.content }]
  }
});
```

---

### 🟡 TIER 2: RECOMMENDED FOR IMMEDIATE IMPLEMENTATION

These endpoints should be implemented for production-grade OpenCode integration:

#### 2. **Health Check**
```
GET /global/health
Status: ❌ Not implemented
Impact: HIGH - Required for service availability monitoring
Recommendation: Add health check endpoint for Docker/k8s orchestration
```

#### 3. **Session Management**
```
POST /session              (create session) - ❌
GET /session               (list sessions) - ❌
GET /session/:id           (get session) - ❌
DELETE /session/:id        (close session) - ❌
PATCH /session/:id         (update session) - ❌
POST /session/:id/init     (initialize) - ❌
Status: ❌ Not implemented
Impact: CRITICAL - Needed for proper session lifecycle management
Current: Hardcoded 'default-session' creates memory/state issues
Recommendation: Implement session pool management with auto-cleanup
```

#### 4. **Message History**
```
GET /session/:id/message         (list messages) - ❌
POST /session/:id/message        (add message) - ❌
GET /session/:id/message/:msgID  (get message) - ❌
Status: ❌ Not implemented
Impact: HIGH - Required for conversation context preservation
Current: Only last user message is sent (line 360-361)
Recommendation: Implement full message buffer for multi-turn conversations
```

#### 5. **Streaming Support**
```
POST /session/:id/prompt with streaming headers
Status: ❌ Not implemented (returns 501)
Impact: CRITICAL - Users expect streaming responses
Current: Line 549-556 blocks streaming requests
Recommendation: Implement SSE or WebSocket streaming for real-time responses
```

#### 6. **Provider Information**
```
GET /provider
GET /provider/auth
POST /provider/{id}/oauth/authorize
POST /provider/{id}/oauth/callback
Status: ❌ Not implemented
Impact: MEDIUM - Could enhance model discovery and auth flow
Current: Static models list hardcoded in MODEL_PROVIDER
Recommendation: Query OpenCode server for dynamic provider/model list
```

#### 7. **Config Management**
```
GET /config
PATCH /config
GET /config/providers
Status: ❌ Not implemented
Impact: MEDIUM - Could enable dynamic reconfiguration
Current: Loaded from environment variables and hardcoded
Recommendation: Use OpenCode config API for centralized settings
```

---

### 🔴 TIER 3: ADVANCED FEATURES (Not Recommended Yet)

These endpoints represent advanced OpenCode capabilities:

#### 8. **File & Symbol Integration**
```
GET /find?pattern=<pat>
GET /find/file?query=<q>
GET /find/symbol?query=<q>
GET /file?path=<path>
GET /file/content?path=<p>
GET /file/status
Status: ❌ Not implemented
Impact: LOW (requires file context from client)
Use Case: Code-aware chat completions with file access
Recommendation: Phase 2+ if adding code context features
```

#### 9. **Tool & Experimental APIs**
```
GET /experimental/tool/ids
GET /experimental/tool?provider=<p>&model=<m>
Status: ❌ Not implemented
Impact: MEDIUM (enables function calling support)
Use Case: LLM tool/function invocation
Recommendation: Phase 2+ for advanced agent capabilities
```

#### 10. **LSP/Formatter/MCP Integration**
```
GET /lsp
GET /formatter
GET /mcp
POST /mcp
Status: ❌ Not implemented
Impact: MEDIUM (enables language server and MCP support)
Use Case: Code intelligence, formatting, MCP routing
Recommendation: Phase 2+ for developer tools
```

#### 11. **Command Execution**
```
GET /command
POST /session/:id/command
POST /session/:id/shell
Status: ❌ Not implemented
Impact: HIGH RISK (security implications)
Use Case: Code execution, shell commands
Recommendation: Phase 3+ with security review
```

#### 12. **Event Streaming**
```
GET /global/event (SSE)
GET /event (SSE)
Status: ❌ Not implemented
Impact: MEDIUM (enables real-time updates)
Use Case: Live task monitoring, progress updates
Recommendation: Phase 2+ for interactive features
```

#### 13. **TUI/Agent Support**
```
POST /tui/* endpoints (11 total)
GET /agent
Status: ❌ Not implemented
Impact: LOW (terminal-specific features)
Use Case: TUI-based agent interaction
Recommendation: Not applicable for REST API gateway
```

---

## API Coverage Analysis

### By Endpoint Category

```
Global          [████░░░░░░░░░░░░░░░] 0% (0/2)
Project         [████░░░░░░░░░░░░░░░] 0% (0/2)
Path & VCS      [████░░░░░░░░░░░░░░░] 0% (0/2)
Instance        [████░░░░░░░░░░░░░░░] 0% (0/1)
Config          [████░░░░░░░░░░░░░░░] 0% (0/3)
Provider        [████░░░░░░░░░░░░░░░] 0% (0/6)
Sessions        [████░░░░░░░░░░░░░░░] 6% (1/17)  ✅
Messages        [████░░░░░░░░░░░░░░░] 17% (1/6) ✅
Commands        [████░░░░░░░░░░░░░░░] 0% (0/1)
Files           [████░░░░░░░░░░░░░░░] 0% (0/6)
Tools           [████░░░░░░░░░░░░░░░] 0% (0/2)
LSP/Fmt/MCP     [████░░░░░░░░░░░░░░░] 0% (0/3)
Agents          [████░░░░░░░░░░░░░░░] 0% (0/1)
Logging         [████░░░░░░░░░░░░░░░] 0% (0/1)
TUI             [████░░░░░░░░░░░░░░░] 0% (0/11)
Auth/Events/Doc [████░░░░░░░░░░░░░░░] 0% (0/3)
────────────────────────────────────
TOTAL           [███░░░░░░░░░░░░░░░░] 3% (1.5/68)
```

---

## Detailed Findings

### 🔴 CRITICAL ISSUES

#### Issue 1: Hardcoded Session ID
**Severity:** CRITICAL  
**Location:** Line 379 in `fetchOpencodeWithRetry()`  
**Current Code:**
```javascript
const response = await opencodeClient.session.prompt({
  path: { id: 'default-session' },  // ← Hardcoded
  body: requestBody
});
```
**Problem:**
- All requests share same session → shared state/memory
- No session isolation between API calls
- Memory accumulates over time (no cleanup)
- Concurrent requests may interfere

**Impact:** Production blocker for multi-client scenarios  
**Fix Complexity:** MEDIUM  
**Recommendation:** Implement session pooling with TTL-based cleanup

---

#### Issue 2: No Streaming Support
**Severity:** CRITICAL  
**Location:** Lines 549-556  
**Current Code:**
```javascript
if (stream) {
  return res.status(501).json({
    error: { message: 'Streaming is not yet supported for OpenCode models' }
  });
}
```
**Problem:**
- Users cannot receive real-time token-by-token responses
- Incompatible with streaming OpenAI clients
- Degrades user experience significantly

**Impact:** Blocks production deployments requiring streaming  
**Fix Complexity:** HIGH  
**Recommendation:** Implement SSE streaming with proper OpenCode message handling

---

#### Issue 3: Single Message Support Only
**Severity:** CRITICAL  
**Location:** Lines 360-361  
**Current Code:**
```javascript
const lastUserMessage = messages.filter(m => m.role === 'user').pop();
// Only extracts last message, loses all conversation history
```
**Problem:**
- Cannot maintain conversation context
- Each request is treated as independent (no multi-turn capability)
- System prompts ignored (line 360 filters only user messages)
- Model cannot reference previous messages

**Impact:** Blocks use cases requiring conversation history  
**Fix Complexity:** MEDIUM  
**Recommendation:** Implement full message buffer with role-preserving conversion

---

### 🟡 HIGH PRIORITY ISSUES

#### Issue 4: No Health Check Endpoint
**Severity:** HIGH  
**Location:** Not implemented  
**Problem:**
- Cannot verify OpenCode service availability
- Docker/Kubernetes probes cannot validate gateway-to-OpenCode connectivity
- No way to detect when OpenCode becomes unavailable

**Impact:** Operational monitoring impossible  
**Fix Complexity:** LOW  
**Recommendation:** Expose `/health` endpoint that calls `GET /global/health`

---

#### Issue 5: No Session Lifecycle Management
**Severity:** HIGH  
**Location:** Not implemented  
**Problem:**
- No way to list active sessions
- No way to create isolated sessions per client
- No way to close/cleanup sessions
- Memory leaks from long-lived default session

**Impact:** Resource exhaustion in production  
**Fix Complexity:** MEDIUM  
**Recommendation:** Implement session manager with auto-cleanup

---

#### Issue 6: No Message History Tracking
**Severity:** HIGH  
**Location:** Not implemented  
**Problem:**
- API cannot retrieve previous messages in session
- No audit trail of conversation history
- Cannot implement retry/resume functionality

**Impact:** Limited debugging and recovery capabilities  
**Fix Complexity:** MEDIUM  
**Recommendation:** Expose message history endpoints

---

#### Issue 7: Provider Information Not Exposed
**Severity:** MEDIUM  
**Location:** Not implemented  
**Problem:**
- Model list hardcoded in `MODEL_PROVIDER` (line 122)
- Cannot query OpenCode for available models dynamically
- Authentication methods not exposed

**Impact:** Cannot adapt to OpenCode configuration changes  
**Fix Complexity:** MEDIUM  
**Recommendation:** Query OpenCode provider endpoints for dynamic model discovery

---

### 🟢 LOW PRIORITY ISSUES

#### Issue 8: Missing Health Monitoring
**Severity:** MEDIUM  
**Location:** Not implemented  
**Problem:**
- No `/health` endpoint
- No OpenCode connectivity verification
- Kubernetes liveness/readiness probes cannot work properly

**Impact:** Poor observability  
**Fix Complexity:** LOW  
**Recommendation:** Add health check with OpenCode availability status

---

#### Issue 9: Error Handling Could Be Improved
**Severity:** LOW  
**Location:** Lines 575-576  
**Current Code:**
```javascript
} catch (error) {
  handleError(error, res);
}
```
**Problem:**
- Generic error handler for all errors
- Cannot distinguish between client errors (bad request) and server errors (OpenCode unavailable)
- Limited debugging information

**Impact:** Harder to diagnose issues  
**Fix Complexity:** LOW  
**Recommendation:** Add specific error codes for common failures

---

## Recommended Implementation Roadmap

### Phase 1: Production Readiness (IMMEDIATE)
**Effort:** 2-3 days  
**Priority:** CRITICAL

- [ ] Implement dynamic session management (create/destroy per request)
- [ ] Add `/health` endpoint with OpenCode connectivity check
- [ ] Implement message history buffer for multi-turn conversations
- [ ] Add proper session cleanup with TTL-based eviction
- [ ] Implement streaming support (SSE)
- [ ] Add comprehensive error handling with specific error codes

**Endpoints to Add:**
- `GET /health` (verify OpenCode connectivity)
- `POST /session` (create isolated session)
- `DELETE /session/:sessionID` (cleanup)
- `GET /session/:sessionID/message` (retrieve history)

### Phase 2: Enhanced Features (1-2 weeks)
**Effort:** 1 week  
**Priority:** HIGH

- [ ] Expose provider information endpoint
- [ ] Implement dynamic model discovery from OpenCode
- [ ] Add command execution support (`/command`)
- [ ] Implement event streaming (`/event` SSE)
- [ ] Add session forking for complex workflows

**Endpoints to Add:**
- `GET /providers` (list available providers)
- `GET /models` (list available models per provider)
- `POST /command` (execute commands)
- `GET /events` (SSE stream)

### Phase 3: Advanced Capabilities (2-4 weeks)
**Effort:** 2 weeks  
**Priority:** MEDIUM

- [ ] File and symbol integration (`/find/*`)
- [ ] Tool/function calling support (`/experimental/tool/*`)
- [ ] LSP/Formatter endpoints (`/lsp`, `/formatter`)
- [ ] MCP server management (`/mcp`)
- [ ] VCS/project information

**Endpoints to Add:**
- `GET /find?pattern=<pat>` (file search)
- `GET /tools` (available tools)
- `GET /lsp` (language server status)
- `GET /mcp` (MCP servers)

---

## Testing Checklist

### Current Implementation Tests
- [ ] Single message prompt works
- [ ] Non-streaming responses return valid OpenAI format
- [ ] Error handling for missing OPENCODE_BASE_URL
- [ ] Docker build includes OpenCode SDK

### Phase 1 Tests (Required for Production)
- [ ] Health check endpoint returns 200 when OpenCode available
- [ ] Health check returns 503 when OpenCode unavailable
- [ ] Multiple concurrent requests use isolated sessions
- [ ] Session cleanup removes old sessions after TTL
- [ ] Multi-turn conversation preserves message history
- [ ] Streaming responses work with standard OpenAI clients
- [ ] Message history retrievable via `/session/:id/message`
- [ ] Proper error codes for different failure scenarios

### Phase 2 Tests
- [ ] Provider list endpoint returns available providers
- [ ] Model list endpoint returns provider-specific models
- [ ] Command execution works with proper sandbox
- [ ] Event stream properly SSE-formatted
- [ ] Dynamic model discovery updates on provider changes

---

## Security Considerations

### Current Security Status
1. **Session Isolation:** ⚠️ WEAK (shared hardcoded session)
2. **Message Privacy:** ⚠️ WEAK (full message buffer in shared session)
3. **Command Execution:** ✅ Not enabled (recommended)
4. **File Access:** ✅ Not enabled (recommended)
5. **Input Validation:** ✅ Appears adequate

### Recommendations
- Implement session-per-request model for isolation
- Add rate limiting per client/session
- Validate all model IDs against whitelist
- Never expose shell command endpoints without authentication
- Audit file access patterns if implemented

---

## Conclusion

The current OpenCode integration in PorTaTek gateway is a **proof-of-concept implementation** covering only basic chat completion functionality. For production use, the following must be addressed:

### Blocking Issues for Production
1. ❌ Hardcoded session ID (memory leak + state sharing)
2. ❌ No streaming support (UX blocker)
3. ❌ Single-message support only (context loss)
4. ❌ No health checks (monitoring impossible)

### Recommended Next Steps
1. **Immediate (1-2 days):** Implement Phase 1 critical fixes
2. **Short-term (1-2 weeks):** Implement Phase 2 enhanced features
3. **Long-term (2-4 weeks):** Implement Phase 3 advanced capabilities

**Overall Assessment:** ⚠️ **DEVELOPMENT STAGE** → Requires Phase 1 completion before production deployment

---

## Appendix A: OpenCode API Reference

### OpenCode Server Endpoints (Complete List)

#### Global
- `GET /global/health` → { healthy, version }
- `GET /global/event` → SSE stream

#### Sessions
- `GET /session` → Session[]
- `POST /session` → Session (create)
- `GET /session/:id` → Session
- `DELETE /session/:id` → boolean
- `PATCH /session/:id` → Session
- `POST /session/:id/init` → boolean
- `POST /session/:id/prompt_async` → 204
- `GET /session/:id/children` → Session[]
- `POST /session/:id/fork` → Session
- `POST /session/:id/abort` → boolean
- `POST /session/:id/share` → Session
- `DELETE /session/:id/share` → Session
- `GET /session/:id/diff` → FileDiff[]
- `GET /session/:id/todo` → Todo[]
- `POST /session/:id/summarize` → boolean
- `POST /session/:id/revert` → boolean
- `POST /session/:id/unrevert` → boolean

#### Messages
- `GET /session/:id/message` → Message[]
- `POST /session/:id/message` → Message
- `GET /session/:id/message/:msgID` → Message
- `POST /session/:id/prompt` → Message ✅ IMPLEMENTED
- `POST /session/:id/command` → Message
- `POST /session/:id/shell` → Message

#### Providers
- `GET /provider` → { all, default, connected }
- `GET /provider/auth` → { [providerID]: ProviderAuthMethod[] }
- `POST /provider/{id}/oauth/authorize` → ProviderAuthAuthorization
- `POST /provider/{id}/oauth/callback` → boolean

#### Configuration
- `GET /config` → Config
- `PATCH /config` → Config
- `GET /config/providers` → { providers, default }

#### Files
- `GET /find?pattern=<pat>` → Match[]
- `GET /find/file?query=<q>` → string[]
- `GET /find/symbol?query=<q>` → Symbol[]
- `GET /file?path=<path>` → FileNode[]
- `GET /file/content?path=<p>` → FileContent
- `GET /file/status` → File[]

#### Tools
- `GET /experimental/tool/ids` → ToolIDs
- `GET /experimental/tool?provider=<p>&model=<m>` → ToolList

#### Languages & Services
- `GET /lsp` → LSPStatus[]
- `GET /formatter` → FormatterStatus[]
- `GET /mcp` → { [name]: MCPStatus }
- `POST /mcp` → MCPStatus

#### Other
- `GET /agent` → Agent[]
- `GET /doc` → OpenAPI 3.1 HTML
- `POST /log` → boolean
- `PUT /auth/:id` → boolean
- `GET /event` → SSE stream

**Total: 68+ endpoints**

---

**Report Generated:** 2026-02-18 19:00 UTC  
**Reviewed By:** PorTaTek Audit Team  
**Status:** ⚠️ DEVELOPMENT - Production readiness pending Phase 1 implementation
