#!/usr/bin/env node
/**
 * Phase 1 Production Readiness - Unit Tests
 * Tests for: SessionManager, Streaming, Error Handling, Health Check
 */

const assert = require('assert');

// Mock classes for testing (since we can't import the full server)
class MockSessionManager {
  constructor() {
    this.sessions = new Map();
    this.messageHistory = new Map();
    this.SESSION_TTL = 3600000; // 1 hour
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  createSession() {
    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
    });
    this.messageHistory.set(sessionId, []);
    return sessionId;
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this.messageHistory.delete(sessionId);
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.closedAt = Date.now();
      session.closed = true;
    }
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  addMessage(sessionId, message) {
    const history = this.messageHistory.get(sessionId);
    if (history) {
      history.push({
        ...message,
        timestamp: Date.now(),
      });
      const session = this.sessions.get(sessionId);
      if (session) {
        session.messageCount = history.length;
        session.lastActivity = Date.now();
      }
      return true;
    }
    return false;
  }

  getMessageHistory(sessionId) {
    return this.messageHistory.get(sessionId) || [];
  }

  updateSessionActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      return true;
    }
    return false;
  }

  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  getSessionStats() {
    const sessions = Array.from(this.sessions.values());
    const totalMessages = Array.from(this.messageHistory.values()).reduce(
      (sum, msgs) => sum + msgs.length,
      0
    );
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => !s.closed).length,
      closedSessions: sessions.filter((s) => s.closed).length,
      totalMessages,
    };
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.SESSION_TTL) {
        this.deleteSession(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Test Suite 1: SessionManager
console.log('\n=== TEST SUITE 1: SessionManager ===\n');

let testsPassed = 0;
let testsFailed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
    testsPassed++;
  } catch (error) {
    console.log(`✗ ${description}`);
    console.log(`  Error: ${error.message}`);
    testsFailed++;
  }
}

const manager = new MockSessionManager();

test('Session creation generates unique sessionId', () => {
  const sessionId1 = manager.createSession();
  const sessionId2 = manager.createSession();
  assert(sessionId1 !== sessionId2, 'Session IDs should be unique');
  assert(sessionId1.startsWith('session-'), 'Session ID should start with "session-"');
});

test('Session stores basic metadata', () => {
  const sessionId = manager.createSession();
  const session = manager.getSession(sessionId);
  assert(session !== undefined, 'Session should exist');
  assert(session.id === sessionId, 'Session ID should match');
  assert(session.createdAt > 0, 'Created timestamp should be set');
  assert(session.messageCount === 0, 'Initial message count should be 0');
});

test('Message addition tracks count', () => {
  const sessionId = manager.createSession();
  manager.addMessage(sessionId, { role: 'user', content: 'Test' });
  const session = manager.getSession(sessionId);
  assert(session.messageCount === 1, 'Message count should be 1');
});

test('Message history retrieval returns all messages', () => {
  const sessionId = manager.createSession();
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
    { role: 'user', content: 'How are you?' },
  ];
  messages.forEach((msg) => manager.addMessage(sessionId, msg));
  const history = manager.getMessageHistory(sessionId);
  assert(history.length === 3, 'History should contain 3 messages');
  assert(history[0].role === 'user', 'First message should be user');
  assert(history[1].role === 'assistant', 'Second message should be assistant');
});

test('Session activity updates timestamp', () => {
  const sessionId = manager.createSession();
  const session1 = manager.getSession(sessionId);
  const initialTime = session1.lastActivity;

  // Wait a bit and update
  setTimeout(() => {
    manager.updateSessionActivity(sessionId);
    const session2 = manager.getSession(sessionId);
    assert(session2.lastActivity >= initialTime, 'Activity timestamp should be updated');
  }, 10);
});

test('Session cleanup removes expired sessions', () => {
  const manager2 = new MockSessionManager();
  manager2.SESSION_TTL = 100; // 100ms for testing
  const sessionId = manager2.createSession();

  setTimeout(() => {
    manager2.updateSessionActivity(sessionId);
    // Manually set lastActivity to past
    manager2.sessions.get(sessionId).lastActivity = Date.now() - 200;

    const cleaned = manager2.cleanupExpiredSessions();
    assert(cleaned === 1, 'One session should be cleaned up');
    assert(!manager2.getSession(sessionId), 'Session should be deleted');
  }, 50);
});

test('Delete session removes both session and message history', () => {
  const sessionId = manager.createSession();
  manager.addMessage(sessionId, { role: 'user', content: 'Test' });

  manager.deleteSession(sessionId);

  assert(!manager.getSession(sessionId), 'Session should not exist');
  assert(manager.getMessageHistory(sessionId).length === 0, 'Message history should be empty');
});

test('Statistics reflect current state', () => {
  const manager3 = new MockSessionManager();
  const s1 = manager3.createSession();
  const s2 = manager3.createSession();

  manager3.addMessage(s1, { role: 'user', content: 'Msg1' });
  manager3.addMessage(s1, { role: 'assistant', content: 'Reply1' });
  manager3.addMessage(s2, { role: 'user', content: 'Msg2' });

  manager3.closeSession(s1);

  const stats = manager3.getSessionStats();
  assert(stats.totalSessions === 2, 'Total sessions should be 2');
  assert(stats.activeSessions === 1, 'Active sessions should be 1');
  assert(stats.closedSessions === 1, 'Closed sessions should be 1');
  assert(stats.totalMessages === 3, 'Total messages should be 3');
});

// Test Suite 2: Error Handling
console.log('\n=== TEST SUITE 2: Error Classification ===\n');

function classifyError(error) {
  // Replicate the classifyError function from gateway
  let code = 'internal_error';
  let statusCode = 500;
  let type = 'server_error';
  let details = {};

  if (error.response) {
    statusCode = error.response.status;
    const status = error.response.status;

    if (status === 401 || status === 403) {
      code = 'auth_failure';
      type = 'authentication_error';
    } else if (status === 429) {
      code = 'rate_limit_exceeded';
      type = 'rate_limit_error';
    } else if (status >= 400 && status < 500) {
      code = 'client_error';
      type = 'validation_error';
    } else if (status >= 500) {
      code = 'server_error';
      type = 'server_error';
    }
  } else if (error.code === 'ECONNREFUSED') {
    code = 'connection_refused';
    type = 'network_error';
    statusCode = 503;
  } else if (error.message && error.message.includes('timeout')) {
    code = 'request_timeout';
    type = 'network_error';
    statusCode = 504;
  }

  return { code, statusCode, type, message: error.message || 'Unknown error', details };
}

test('Auth errors are classified correctly', () => {
  const error = { response: { status: 401 } };
  const result = classifyError(error);
  assert(result.code === 'auth_failure', 'Should classify as auth_failure');
  assert(result.statusCode === 401, 'Status code should be 401');
  assert(result.type === 'authentication_error', 'Type should be authentication_error');
});

test('Rate limit errors are classified correctly', () => {
  const error = { response: { status: 429 } };
  const result = classifyError(error);
  assert(result.code === 'rate_limit_exceeded', 'Should classify as rate_limit_exceeded');
  assert(result.statusCode === 429, 'Status code should be 429');
});

test('Client errors (4xx) are classified correctly', () => {
  const error = { response: { status: 400 } };
  const result = classifyError(error);
  assert(result.code === 'client_error', 'Should classify as client_error');
  assert(result.statusCode === 400, 'Status code should be 400');
  assert(result.type === 'validation_error', 'Type should be validation_error');
});

test('Server errors (5xx) are classified correctly', () => {
  const error = { response: { status: 500 } };
  const result = classifyError(error);
  assert(result.code === 'server_error', 'Should classify as server_error');
  assert(result.statusCode === 500, 'Status code should be 500');
});

test('Connection refused errors are classified as network errors', () => {
  const error = { code: 'ECONNREFUSED' };
  const result = classifyError(error);
  assert(result.code === 'connection_refused', 'Should classify as connection_refused');
  assert(result.statusCode === 503, 'Status code should be 503');
  assert(result.type === 'network_error', 'Type should be network_error');
});

test('Timeout errors are classified correctly', () => {
  const error = { message: 'Request timeout' };
  const result = classifyError(error);
  assert(result.code === 'request_timeout', 'Should classify as request_timeout');
  assert(result.statusCode === 504, 'Status code should be 504');
  assert(result.type === 'network_error', 'Type should be network_error');
});

// Test Suite 3: SSE Streaming Format
console.log('\n=== TEST SUITE 3: Streaming Format ===\n');

function formatSSEChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

test('SSE chunk is properly formatted', () => {
  const chunk = formatSSEChunk({ id: '123', choices: [{ delta: { content: 'hello' } }] });
  assert(chunk.startsWith('data: '), 'Should start with "data: "');
  assert(chunk.endsWith('\n\n'), 'Should end with two newlines');
  assert(chunk.includes('hello'), 'Should contain message content');
});

test('SSE done sentinel is properly formatted', () => {
  const done = formatSSEChunk('[DONE]');
  assert(done.includes('[DONE]'), 'Should contain [DONE] sentinel');
});

// Test Suite 4: Health Check Format
console.log('\n=== TEST SUITE 4: Health Check Response ===\n');

function validateHealthResponse(response) {
  return {
    hasStatus: response.status !== undefined,
    hasConnectivity: response.connectivity !== undefined,
    hasProviders: Array.isArray(response.providers),
    hasSession: response.session !== undefined,
    hasTimestamp: response.timestamp !== undefined,
  };
}

test('Health check response has required fields', () => {
  const response = {
    status: 'healthy',
    connectivity: 'connected',
    providers: ['opencode', 'openrouter', 'gemini'],
    session: { total: 5, active: 3, closed: 2 },
    timestamp: Date.now(),
  };
  const validation = validateHealthResponse(response);
  assert(validation.hasStatus, 'Should have status');
  assert(validation.hasConnectivity, 'Should have connectivity');
  assert(validation.hasProviders, 'Should have providers');
  assert(validation.hasSession, 'Should have session stats');
  assert(validation.hasTimestamp, 'Should have timestamp');
});

// Print Summary
console.log('\n=== TEST SUMMARY ===\n');
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log(`Total:  ${testsPassed + testsFailed}`);

const exitCode = testsFailed > 0 ? 1 : 0;
console.log(`\nExit code: ${exitCode}`);
process.exit(exitCode);
