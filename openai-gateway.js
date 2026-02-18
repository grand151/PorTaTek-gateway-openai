// OpenAI-OpenRouter Gateway
// Gateway emulujący API OpenAI z przekierowaniem do darmowych modeli OpenRouter

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
// const { createOpencodeClient } = require('@opencode-ai/sdk'); // Zakomentariowane - SDK package ma problemy z package.json exports

const GitHubAuthManager = require('./auth');
const UserManager = require('./users');
const { createAuthMiddleware, optionalAuthMiddleware } = require('./middleware');

// Załadowanie zmiennych środowiskowych
dotenv.config();

// Logging Utility
const DEBUG = process.env.DEBUG === 'true';
const logger = {
  info: (module, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const dataStr = Object.keys(data).length ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${timestamp}] [${module}] ℹ️  ${message}${dataStr}`);
  },
  debug: (module, message, data = {}) => {
    if (!DEBUG) return;
    const timestamp = new Date().toISOString();
    const dataStr = Object.keys(data).length ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${timestamp}] [${module}] 🔍 ${message}${dataStr}`);
  },
  warn: (module, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const dataStr = Object.keys(data).length ? ` | ${JSON.stringify(data)}` : '';
    console.warn(`[${timestamp}] [${module}] ⚠️  ${message}${dataStr}`);
  },
  error: (module, message, error = null, data = {}) => {
    const timestamp = new Date().toISOString();
    const errorStr = error ? ` | Error: ${error.message}` : '';
    const dataStr = Object.keys(data).length ? ` | ${JSON.stringify(data)}` : '';
    console.error(`[${timestamp}] [${module}] ❌ ${message}${errorStr}${dataStr}`);
  }
};

// Walidacja wymaganych zmiennych środowiskowych (przynajmniej jeden provider musi być skonfigurowany)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!OPENROUTER_API_KEY && !GEMINI_API_KEY) {
  console.error('Brak wymaganych zmiennych środowiskowych: wymagany jest przynajmniej OPENROUTER_API_KEY lub GEMINI_API_KEY');
  process.exit(1);
}

// Inicjalizacja klientów API
let geminiClient = null;
if (GEMINI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
  logger.info('INIT', 'Google Gemini API client initialized');
}

if (OPENROUTER_API_KEY) {
  logger.info('INIT', 'OpenRouter API client initialized');
}

let opencodeClient = null;
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'http://localhost:4096';
const initializeOpencodeClient = async () => {
  try {
    opencodeClient = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL });
    logger.info('INIT', 'OpenCode client initialized', { baseUrl: OPENCODE_BASE_URL });
  } catch (error) {
    logger.warn('INIT', 'OpenCode client initialization failed', error, { baseUrl: OPENCODE_BASE_URL });
  }
};

initializeOpencodeClient().catch(error => {
  logger.warn('INIT', 'Failed to initialize OpenCode client on startup', error);
});

// OpenCode Session Management System
class SessionManager {
  constructor(ttl = 3600000) {
    this.sessions = new Map();
    this.messageHistory = new Map();
    this.sessionTTL = ttl;
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async createSession() {
    const sessionId = this.generateSessionId();
    const timestamp = Date.now();
    
    this.sessions.set(sessionId, {
      id: sessionId,
      created: timestamp,
      lastActivity: timestamp,
      status: 'active'
    });

    this.messageHistory.set(sessionId, []);
    logger.debug('SESSION', 'Session created', { sessionId, createdAt: new Date(timestamp).toISOString() });
    
    return sessionId;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  updateSessionActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  getMessageHistory(sessionId) {
    const history = this.messageHistory.get(sessionId) || [];
    logger.debug('SESSION', 'Message history retrieved', { sessionId, count: history.length });
    return history;
  }

  addMessage(sessionId, role, content) {
    if (!this.messageHistory.has(sessionId)) {
      this.messageHistory.set(sessionId, []);
    }
    
    const history = this.messageHistory.get(sessionId);
    history.push({
      role,
      content,
      timestamp: Date.now()
    });

    logger.debug('SESSION', 'Message added to history', { sessionId, role, contentLength: content.length, totalMessages: history.length });
    this.updateSessionActivity(sessionId);
    return history;
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'closed';
      logger.debug('SESSION', 'Session closed', { sessionId });
    }
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this.messageHistory.delete(sessionId);
    logger.debug('SESSION', 'Session deleted', { sessionId });
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.sessionTTL) {
        this.deleteSession(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('SESSION', 'Expired sessions cleaned up', { count: cleaned, totalActive: this.sessions.size });
    }
    
    return cleaned;
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      ...session,
      messagesCount: (this.messageHistory.get(session.id) || []).length
    }));
  }

  getSessionStats() {
    const sessions = this.getAllSessions();
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      closedSessions: sessions.filter(s => s.status === 'closed').length,
      totalMessages: Array.from(this.messageHistory.values()).reduce((sum, msgs) => sum + msgs.length, 0)
    };
  }
}

const sessionManager = new SessionManager(parseInt(process.env.SESSION_TTL || '3600000', 10));

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  sessionManager.cleanupExpiredSessions();
}, 300000);

const app = express();
const PORT = process.env.PORT || 8787;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '1000', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600000', 10);

// Konfiguracja middleware
app.use(cors());
app.use(bodyParser.json());

// Inicjalizacja auth systemów
const userManager = new UserManager('./users-db.json');
const githubAuth = new GitHubAuthManager({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:8787/auth/github/callback',
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-me'
});

const authMiddleware = createAuthMiddleware(githubAuth, userManager);
const optionalAuth = optionalAuthMiddleware(githubAuth, userManager);

// Mapowanie modeli OpenAI na modele OpenRouter
const MODEL_MAPPING = {
  // Standard GPT models -> Mistral/DeepSeek
  'gpt-3.5-turbo': 'deepseek/deepseek-r1-0528:free',
  'gpt-3.5-turbo-instruct': 'deepseek/deepseek-r1-0528:free',
  'gpt-3.5-turbo-16k': 'deepseek/deepseek-r1-0528:free',
  'gpt-4': 'deepseek/deepseek-r1-0528:free',
  'gpt-4-turbo': 'deepseek/deepseek-r1-0528:free',
  'gpt-4o': 'qwen/qwen3-235b-a22b:free',
  'gpt-4o-mini': 'qwen/qwen3-next-80b-a3b-instruct:free',
  'gpt-4o-mini-2024-07-18': 'qwen/qwen3-next-80b-a3b-instruct:free',
  
  // GPT-5 models emulation -> najnowsze modele
  'gpt-5': 'qwen/qwen3-235b-a22b:free',
  'gpt-5-turbo': 'qwen/qwen3-next-80b-a3b-instruct:free',
  'gpt-5-nano': 'opencode/gpt-5-nano:free',
  'gpt-5-preview': 'qwen/qwen3-235b-a22b:free',
  
  // Embedding models
  'text-embedding-ada-002': 'mistralai/mistral-embed:free',
  'text-davinci-003': 'mistralai/mistral-embed:free',
  
  // Vision models -> Qwen Vision
  'gpt-4-vision-preview': 'qwen/qwen3-vl-235b-a22b-thinking:free',
  'gpt-4-vision': 'qwen/qwen3-vl-30b-a3b-thinking:free',
  'gpt-4o-vision': 'qwen/qwen3-vl-235b-a22b-thinking:free',
  
  // Coding models -> Qwen Coder
  'gpt-4-code': 'qwen/qwen3-coder:free',
  'code-davinci-002': 'qwen/qwen3-coder:free',
  
  // Legacy Mistral mapping (for compatibility)
  'mistral-small': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'mistral-tiny': 'mistralai/mistral-small-2501:free',
  
  // Meta Llama models
  'llama-3.2': 'meta-llama/llama-3.2-3b-instruct:free',
  'llama-3.3': 'meta-llama/llama-3.3-70b-instruct:free',
  
  // Google Gemma models
  'gemma-7b': 'google/gemma-2-9b-it:free',
  'gemma-2b': 'google/gemma-2-2b-it:free',
  
  // OpenCode models
  'opencode-big-pickle': 'opencode/big-pickle:free',
  'opencode-glm-5': 'opencode/glm-5-free:free',
  'opencode-gpt-5-nano': 'opencode/gpt-5-nano:free',
  'opencode-kimi-k2.5': 'opencode/kimi-k2.5-free:free',
  'opencode-minimax-m2.5': 'opencode/minimax-m2.5-free:free',
  
  // Google Gemini models (direct API)
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-3-pro': 'gemini-3-pro-preview',
  'gemini-2.0-flash': 'gemini-2.0-flash-exp',
  'gemini-1.5-flash': 'gemini-1.5-flash',
  'gemini-1.5-pro': 'gemini-1.5-pro',
  
  // Domyślny fallback
  'default': 'deepseek/deepseek-r1-0528:free'
};

// Określenie providera dla poszczególnych modeli
const MODEL_PROVIDER = {
  'gemini-3-flash-preview': 'gemini',
  'gemini-3-pro-preview': 'gemini',
  'gemini-2.0-flash-exp': 'gemini',
  'gemini-1.5-flash': 'gemini',
  'gemini-1.5-pro': 'gemini',
  'opencode/big-pickle:free': 'opencode',
  'opencode/glm-5-free:free': 'opencode',
  'opencode/gpt-5-nano:free': 'opencode',
  'opencode/kimi-k2.5-free:free': 'opencode',
  'opencode/minimax-m2.5-free:free': 'opencode',
};

// Mapowanie fallbacków dla modeli (gdy główny model jest niedostępny)
const FALLBACK_MAPPING = {
  // DeepSeek fallbacks
  'deepseek/deepseek-r1-0528:free': 'qwen/qwen3-235b-a22b:free',
  
  // Qwen fallbacks
  'qwen/qwen3-235b-a22b:free': 'qwen/qwen3-next-80b-a3b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'qwen/qwen3-coder:free': 'mistralai/mistral-small-3.1-24b-instruct:free',
  
  // Vision model fallbacks
  'qwen/qwen3-vl-235b-a22b-thinking:free': 'qwen/qwen3-vl-30b-a3b-thinking:free',
  'qwen/qwen3-vl-30b-a3b-thinking:free': 'mistralai/mistral-small-3.1-24b-instruct:free',
  
  // Mistral fallbacks
  'mistralai/mistral-small-3.1-24b-instruct:free': 'mistralai/mistral-small-2501:free',
  'mistralai/mistral-small-2501:free': 'meta-llama/llama-3.3-70b-instruct:free',
  
  // Meta Llama fallbacks
  'meta-llama/llama-3.3-70b-instruct:free': 'meta-llama/llama-3.2-3b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free': 'google/gemma-2-9b-it:free',
  
  // Google Gemma fallbacks
  'google/gemma-2-9b-it:free': 'google/gemma-2-2b-it:free',
  
  // OpenCode model fallbacks
  'opencode/big-pickle:free': 'opencode/glm-5-free:free',
  'opencode/glm-5-free:free': 'opencode/gpt-5-nano:free',
  'opencode/gpt-5-nano:free': 'opencode/kimi-k2.5-free:free',
  'opencode/kimi-k2.5-free:free': 'opencode/minimax-m2.5-free:free',
  'opencode/minimax-m2.5-free:free': 'deepseek/deepseek-r1-0528:free'
};

// Konfiguracja cache'a dla odpowiedzi
const responseCache = new Map();

// Zarządzanie wieloma kluczami API dla providerów (in-memory storage)
// UWAGA: Konfiguracja jest przechowywana tylko w pamięci i zostanie zresetowana po restarcie serwera
// Dla trwałej konfiguracji używaj zmiennych środowiskowych w pliku .env
const providerApiKeys = {
  openrouter: OPENROUTER_API_KEY ? [OPENROUTER_API_KEY] : [],
  gemini: GEMINI_API_KEY ? [GEMINI_API_KEY] : []
};

// Indeksy aktualnie używanych kluczy (dla round-robin)
const providerKeyIndex = {
  openrouter: 0,
  gemini: 0
};

// Konfiguracja niestandardowych providerów
const customProviders = new Map();
// Format: { 
//   name: string, 
//   displayName: string, 
//   endpoint: string, 
//   apiKeys: string[], 
//   apiKeyHeader: string, 
//   modelPrefix: string 
// }

// Funkcja do generowania klucza cache'a
function generateCacheKey(model, messages, options) {
  return JSON.stringify({
    model,
    messages,
    options
  });
}

// Funkcja do pobierania klucza API z round-robin
function getProviderApiKey(providerName) {
  const keys = providerApiKeys[providerName];
  if (!keys || keys.length === 0) {
    return null;
  }
  
  // Round-robin selection
  const index = providerKeyIndex[providerName] || 0;
  const key = keys[index];
  
  // Update index for next call
  providerKeyIndex[providerName] = (index + 1) % keys.length;
  
  return key;
}

// Opóźnienie wykonania (do mechanizmu retry)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Funkcja do konwersji wiadomości OpenAI na format Gemini
function convertMessagesToGemini(messages) {
  const history = [];
  const systemInstructions = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstructions.push(msg.content);
    } else if (msg.role === 'user') {
      history.push({
        role: 'user',
        parts: [{ text: msg.content }]
      });
    } else if (msg.role === 'assistant') {
      history.push({
        role: 'model',
        parts: [{ text: msg.content }]
      });
    }
  }
  
  return { history, systemInstructions };
}

// Funkcja do wykonania zapytania do Google Gemini
async function fetchGeminiWithRetry(model, messages, options = {}, retries = 0) {
  if (!geminiClient) {
    throw new Error('Gemini API client not configured. Set GEMINI_API_KEY in environment variables.');
  }
  
  try {
    const { history, systemInstructions } = convertMessagesToGemini(messages);
    
    // Pobierz ostatnią wiadomość użytkownika jako prompt
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }
    
    // Konfiguracja modelu
    const modelConfig = {
      model: model,
    };
    
    if (systemInstructions.length > 0) {
      modelConfig.systemInstruction = systemInstructions.join('\n\n');
    }
    
    const generativeModel = geminiClient.getGenerativeModel(modelConfig);
    
    // Dla kontekstu konwersacji, użyj chat session
    if (history.length > 0) {
      const chat = generativeModel.startChat({
        history: history.slice(0, -1), // Wszystkie wiadomości oprócz ostatniej
        generationConfig: {
          maxOutputTokens: options.max_tokens || 2048,
          temperature: options.temperature || 0.7,
          topP: options.top_p || 0.95,
        }
      });
      
      const result = await chat.sendMessage(lastUserMessage.content);
      const response = result.response;
      const usage = response.usageMetadata || {};
      
      return {
        id: `gemini-${Date.now()}`,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.text()
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: usage.promptTokenCount || 0,
          completion_tokens: usage.candidatesTokenCount || 0,
          total_tokens: usage.totalTokenCount || 0
        }
      };
    } else {
      // Pojedyncze zapytanie bez historii
      const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: lastUserMessage.content }] }],
        generationConfig: {
          maxOutputTokens: options.max_tokens || 2048,
          temperature: options.temperature || 0.7,
          topP: options.top_p || 0.95,
        }
      });
      
      const response = result.response;
      const usage = response.usageMetadata || {};
      
      return {
        id: `gemini-${Date.now()}`,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.text()
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: usage.promptTokenCount || 0,
          completion_tokens: usage.candidatesTokenCount || 0,
          total_tokens: usage.totalTokenCount || 0
        }
      };
    }
  } catch (error) {
    console.error(`Error with Gemini model ${model}, attempt ${retries + 1}/${MAX_RETRIES}:`, error.message);
    
    if (retries >= MAX_RETRIES - 1) {
      throw error;
    }
    
    const waitTime = RETRY_DELAY * Math.pow(2, retries);
    console.log(`Retrying in ${waitTime}ms...`);
    await delay(waitTime);
    
    return fetchGeminiWithRetry(model, messages, options, retries + 1);
  }
}

async function fetchOpencodeWithRetry(model, messages, options = {}, retries = 0) {
  if (!opencodeClient) {
    throw new Error('OpenCode client not initialized. Ensure OPENCODE_BASE_URL is configured.');
  }

  try {
    const sessionId = options.sessionId || await sessionManager.createSession();
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    sessionManager.addMessage(sessionId, 'user', lastUserMessage.content);

    const requestBody = {
      model: {
        providerID: model.split('/')[0] || 'opencode',
        modelID: model
      },
      parts: [
        {
          type: 'text',
          text: lastUserMessage.content
        }
      ]
    };

    const response = await opencodeClient.session.prompt({
      path: { id: sessionId },
      body: requestBody
    });

    const assistantContent = response.content?.text || '';
    sessionManager.addMessage(sessionId, 'assistant', assistantContent);

    const usage = {
      prompt_tokens: messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0),
      completion_tokens: (assistantContent.length || 0) / 4,
      total_tokens: 0
    };

    return {
      id: `opencode-${Date.now()}`,
      sessionId: sessionId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: assistantContent
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: Math.ceil(usage.prompt_tokens),
        completion_tokens: Math.ceil(usage.completion_tokens),
        total_tokens: Math.ceil(usage.prompt_tokens + usage.completion_tokens)
      }
    };
  } catch (error) {
    console.error(`Error with OpenCode model ${model}, attempt ${retries + 1}/${MAX_RETRIES}:`, error.message);

    if (retries >= MAX_RETRIES - 1) {
      throw error;
    }

    const waitTime = RETRY_DELAY * Math.pow(2, retries);
    console.log(`Retrying in ${waitTime}ms...`);
    await delay(waitTime);

    return fetchOpencodeWithRetry(model, messages, options, retries + 1);
  }
}

// Funkcja do wykonania zapytania do OpenRouter z mechanizmem retry i fallback
async function fetchOpenRouterWithRetry(url, data, headers, retries = 0, modelFallbacks = []) {
  const currentModel = data.model;
  
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error(`Error with model ${currentModel}, attempt ${retries + 1}/${MAX_RETRIES}:`, error.message);
    
    // Jeśli przekroczyliśmy maksymalną liczbę prób dla tego modelu
    if (retries >= MAX_RETRIES - 1) {
      // Sprawdź czy mamy fallback model
      const fallbackModel = FALLBACK_MAPPING[currentModel];
      
      // Jeśli mamy fallback i nie został jeszcze użyty
      if (fallbackModel && !modelFallbacks.includes(fallbackModel)) {
        console.log(`Switching to fallback model: ${fallbackModel}`);
        
        // Dodaj aktualny model do listy użytych fallbacków
        const updatedFallbacks = [...modelFallbacks, currentModel];
        
        // Przygotuj nowe zapytanie z modelem fallback
        const fallbackData = {
          ...data,
          model: fallbackModel
        };
        
        // Spróbuj z modelem fallback (reset licznika prób)
        return fetchOpenRouterWithRetry(url, fallbackData, headers, 0, updatedFallbacks);
      }
      
      // Jeśli nie ma fallbacku lub wszystkie zostały wyczerpane - rzuć błąd
      throw error;
    }
    
    // Czekaj przed ponowną próbą (zwiększając czas z każdą próbą)
    const waitTime = RETRY_DELAY * Math.pow(2, retries);
    console.log(`Retrying in ${waitTime}ms...`);
    await delay(waitTime);
    
    // Rekurencyjne wywołanie z inkrementacją licznika prób
    return fetchOpenRouterWithRetry(url, data, headers, retries + 1, modelFallbacks);
  }
}

async function* streamOpencodeResponse(model, messages, options = {}) {
  try {
    const sessionId = options.sessionId || await sessionManager.createSession();
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    sessionManager.addMessage(sessionId, 'user', lastUserMessage.content);

    const requestBody = {
      model: {
        providerID: model.split('/')[0] || 'opencode',
        modelID: model
      },
      parts: [{
        type: 'text',
        text: lastUserMessage.content
      }]
    };

    const response = await opencodeClient.session.prompt({
      path: { id: sessionId },
      body: requestBody
    });

    const assistantContent = response.content?.text || '';
    sessionManager.addMessage(sessionId, 'assistant', assistantContent);

    yield {
      id: `opencode-${Date.now()}`,
      object: 'text_completion.chunk',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: assistantContent
        },
        finish_reason: null
      }]
    };

    yield {
      id: `opencode-${Date.now()}`,
      object: 'text_completion.chunk',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }]
    };
  } catch (error) {
    console.error('OpenCode streaming error:', error.message);
    throw error;
  }
}

// Middleware do logowania requestów
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ============= AUTH ROUTES =============

// Login page / redirect to GitHub OAuth
app.get('/login', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GitHub OAuth not configured (missing GITHUB_CLIENT_ID)' });
  }
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,user,gist`;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Login - PorTaTek Gateway</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
      <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center; max-width: 400px;">
        <h1>PorTaTek Gateway</h1>
        <p style="color: #666; margin: 20px 0;">Sign in with your GitHub account to access the admin panel and API</p>
        <a href="${githubAuthUrl}" style="display: inline-block; background: #333; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; font-weight: 600; margin-top: 20px; transition: background 0.3s;">
          Sign in with GitHub
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This application requires GitHub authentication to access full API and admin features.</p>
      </div>
    </body>
    </html>
  `);
});

// GitHub OAuth callback
app.get('/auth/github/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  
  if (error) {
    return res.status(400).json({ error: error_description || 'GitHub authentication failed' });
  }
  
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }
  
  try {
    const result = await githubAuth.handleCallback(code);
    
    // Utwórz sesję i token
    const user = await userManager.createOrUpdateUser(result.user);
    const token = githubAuth.generateJWT({ userId: user.id, username: user.login });
    
    // Redirect to admin panel z token w cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.redirect('/admin?success=true');
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
});

// Get current user info
app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({
    user: req.user,
    authenticated: true
  });
});

// Logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Logged out successfully' });
});

// ============= END AUTH ROUTES =============

// Endpoint dla /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model: requestedModel, messages, stream, ...otherOptions } = req.body;
    
    // Mapowanie modelu OpenAI na model docelowy
    const model = MODEL_MAPPING[requestedModel] || MODEL_MAPPING.default;
    
    // Określenie providera
    const provider = MODEL_PROVIDER[model] || 'openrouter';
    
    logger.info('API', 'Chat completion request received', { requestedModel, model, provider, stream, messageCount: messages.length });
    
    // Sprawdzenie czy odpowiedź jest w cache'u
    const cacheKey = generateCacheKey(model, messages, otherOptions);
    if (responseCache.has(cacheKey) && !stream) {
      logger.debug('API', 'Cache hit - returning cached response', { cacheKey });
      return res.json(responseCache.get(cacheKey));
    }
    
    // Routing na podstawie providera
    if (provider === 'gemini') {
      // Obsługa przez Google Gemini API
      if (!geminiClient) {
        return res.status(503).json({
          error: {
            message: 'Gemini API is not configured. Please set GEMINI_API_KEY.',
            type: 'configuration_error',
            code: 'gemini_not_configured'
          }
        });
      }
      
      if (stream) {
        // Gemini streaming (w uproszczonej wersji)
        return res.status(501).json({
          error: {
            message: 'Streaming is not yet supported for Gemini models',
            type: 'not_implemented',
            code: 'streaming_not_supported'
          }
        });
      }
      
       try {
         const geminiData = await fetchGeminiWithRetry(model, messages, otherOptions);
         
         const openAIResponse = {
           id: geminiData.id,
           object: 'chat.completion',
           created: Math.floor(Date.now() / 1000),
           model: requestedModel,
           choices: geminiData.choices,
           usage: geminiData.usage
         };
         
         responseCache.set(cacheKey, openAIResponse);
         setTimeout(() => responseCache.delete(cacheKey), CACHE_TTL);
         
         res.json(openAIResponse);
       } catch (error) {
         handleError(error, res, { provider: 'gemini' });
       }
    } else if (provider === 'opencode') {
      if (!opencodeClient) {
        return res.status(503).json({
          error: {
            message: 'OpenCode API is not configured. Please set OPENCODE_BASE_URL.',
            type: 'configuration_error',
            code: 'opencode_not_configured'
          }
        });
      }

      if (stream) {
        try {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const generator = streamOpencodeResponse(model, messages, otherOptions);
          
          for await (const chunk of generator) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          
          res.write('data: [DONE]\n\n');
          res.end();
         } catch (error) {
           handleStreamingError(error, res, { provider: 'opencode' });
           res.end();
         }
      } else {
        try {
          const opencodeData = await fetchOpencodeWithRetry(model, messages, otherOptions);

          const openAIResponse = {
            id: opencodeData.id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: opencodeData.choices,
            usage: opencodeData.usage,
            sessionId: opencodeData.sessionId
          };

          responseCache.set(cacheKey, openAIResponse);
          setTimeout(() => responseCache.delete(cacheKey), CACHE_TTL);

           res.json(openAIResponse);
         } catch (error) {
           handleError(error, res, { provider: 'opencode' });
         }
       }
     } else {
      // Obsługa przez OpenRouter (domyślna)
      const openrouterKey = getProviderApiKey('openrouter');
      if (!openrouterKey) {
        return res.status(503).json({
          error: {
            message: 'OpenRouter API is not configured. Please add API keys via /config/providers endpoint or the admin panel.',
            type: 'configuration_error',
            code: 'openrouter_not_configured'
          }
        });
      }
      
      // Przygotowanie zapytania do OpenRouter
      const openRouterRequest = {
        model,
        messages,
        stream,
        ...otherOptions
      };
      
      // Nagłówki dla OpenRouter
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': req.headers.referer || 'http://localhost:8787',
        'X-Title': 'OpenAI Gateway Emulator'
      };
      
      if (stream) {
        // Obsługa streamu
        try {
          const openRouterResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', 
            openRouterRequest, 
            { 
              headers,
              responseType: 'stream'
            }
          );
          
          // Przekazanie nagłówków
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          // Przekazanie streamu
          openRouterResponse.data.pipe(res);
         } catch (error) {
           handleStreamingError(error, res, { provider: 'openrouter' });
           res.end();
         }
       } else {
        // Standardowe zapytanie bez streamu
        try {
          // Użycie funkcji z retry i fallbackiem
          const openRouterData = await fetchOpenRouterWithRetry(
            'https://openrouter.ai/api/v1/chat/completions',
            openRouterRequest,
            headers
          );
          
          // Przekształcenie odpowiedzi z OpenRouter na format OpenAI
          const openAIResponse = {
            id: openRouterData.id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: requestedModel, // Zwracamy oryginalny model aby klient myślał, że komunikuje się z OpenAI
            choices: openRouterData.choices,
            usage: openRouterData.usage
          };
          
          // Dodanie do cache'a
          responseCache.set(cacheKey, openAIResponse);
          setTimeout(() => responseCache.delete(cacheKey), CACHE_TTL);
          
           res.json(openAIResponse);
         } catch (error) {
           handleError(error, res, { provider: 'openrouter' });
         }
       }
     }
   } catch (error) {
     handleError(error, res, { provider });
   }
});

// Endpoint dla /v1/embeddings
app.post('/v1/embeddings', async (req, res) => {
  try {
    const { model: requestedModel, input, ...otherOptions } = req.body;
    
    // Mapowanie modelu embeddings
    const model = MODEL_MAPPING[requestedModel] || MODEL_MAPPING['text-embedding-ada-002'];
    
    const openrouterKey = getProviderApiKey('openrouter');
    if (!openrouterKey) {
      return res.status(503).json({
        error: {
          message: 'OpenRouter API is not configured. Please add API keys via /config/providers endpoint or the admin panel.',
          type: 'configuration_error',
          code: 'openrouter_not_configured'
        }
      });
    }
    
    // Przygotowanie zapytania do OpenRouter
    const openRouterRequest = {
      model,
      input,
      ...otherOptions
    };
    
    // Nagłówki dla OpenRouter
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'HTTP-Referer': req.headers.referer || 'http://localhost:8787',
      'X-Title': 'OpenAI Gateway Emulator'
    };
    
    // Użycie funkcji z retry i fallbackiem
    const openRouterData = await fetchOpenRouterWithRetry(
      'https://openrouter.ai/api/v1/embeddings',
      openRouterRequest,
      headers
    );
    
    // Przekształcenie odpowiedzi z OpenRouter na format OpenAI
    const openAIResponse = {
      object: 'list',
      data: openRouterData.data,
      model: requestedModel, // Zwracamy oryginalny model
      usage: openRouterData.usage
    };
    
    res.json(openAIResponse);
  } catch (error) {
    handleError(error, res);
  }
});

// Enhanced Error Handling System
class OpenCodeError extends Error {
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.name = 'OpenCodeError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// Error classifier function
function classifyError(error) {
  // Check if already classified
  if (error instanceof OpenCodeError) {
    return {
      code: error.code,
      statusCode: error.statusCode,
      type: 'opencode_error',
      message: error.message,
      details: error.details
    };
  }

  // Check for HTTP response errors
  if (error.response) {
    const status = error.response.status;
    const message = error.response.data?.error?.message || error.message;
    
    if (status === 401 || status === 403) {
      return {
        code: 'authentication_error',
        statusCode: status,
        type: 'auth_failure',
        message: 'Authentication failed. Invalid or expired API key.',
        details: { originalMessage: message }
      };
    }
    
    if (status === 429) {
      return {
        code: 'rate_limit_error',
        statusCode: 429,
        type: 'rate_limit',
        message: 'Rate limit exceeded. Please retry after some time.',
        details: { originalMessage: message }
      };
    }
    
    if (status >= 500) {
      return {
        code: 'provider_error',
        statusCode: status,
        type: 'server_error',
        message: 'Provider service temporarily unavailable.',
        details: { originalMessage: message }
      };
    }
    
    if (status === 400) {
      return {
        code: 'invalid_request',
        statusCode: 400,
        type: 'validation_error',
        message: 'Invalid request parameters.',
        details: { originalMessage: message }
      };
    }

    return {
      code: 'api_error',
      statusCode: status,
      type: 'http_error',
      message: message || 'API request failed',
      details: {}
    };
  }

  // Check for timeout errors
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return {
      code: 'timeout_error',
      statusCode: 504,
      type: 'network_error',
      message: 'Request timeout. Provider took too long to respond.',
      details: {}
    };
  }

  // Check for connection errors
  if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
    return {
      code: 'connection_error',
      statusCode: 503,
      type: 'network_error',
      message: 'Cannot connect to provider. Service may be offline.',
      details: {}
    };
  }

  // Check for OpenCode-specific errors
  if (error.message?.includes('OpenCode client not initialized')) {
    return {
      code: 'opencode_not_configured',
      statusCode: 503,
      type: 'configuration_error',
      message: 'OpenCode provider is not configured. Check OPENCODE_BASE_URL.',
      details: {}
    };
  }

  // Check for session errors
  if (error.message?.includes('No user message found')) {
    return {
      code: 'invalid_request',
      statusCode: 400,
      type: 'validation_error',
      message: 'Request must contain at least one user message.',
      details: {}
    };
  }

  // Default error classification
  return {
    code: 'unknown_error',
    statusCode: 500,
    type: 'internal_error',
    message: error.message || 'An unexpected error occurred.',
    details: {}
  };
}

// Enhanced error handler
function handleError(error, res, options = {}) {
  const { provider = 'unknown', sessionId = null } = options;
  
  // Classify the error
  const errorInfo = classifyError(error);
  
  // Log detailed error information
  console.error(`[${errorInfo.type.toUpperCase()}] ${errorInfo.code}`, {
    message: errorInfo.message,
    provider,
    sessionId,
    timestamp: new Date().toISOString(),
    originalError: error.message,
    details: errorInfo.details
  });

  // Send structured error response
  const responseBody = {
    error: {
      message: errorInfo.message,
      type: errorInfo.type,
      code: errorInfo.code,
      param: null,
      status: errorInfo.statusCode
    }
  };

  // Add debugging context for non-production environments
  if (process.env.NODE_ENV !== 'production') {
    responseBody.error.debug = {
      originalError: error.message,
      provider,
      sessionId,
      timestamp: errorInfo.timestamp,
      details: errorInfo.details
    };
  }

  res.status(errorInfo.statusCode).json(responseBody);
}

// Streaming error handler for SSE
function handleStreamingError(error, res, options = {}) {
  const { provider = 'unknown', sessionId = null } = options;
  
  // Classify the error
  const errorInfo = classifyError(error);
  
  // Log detailed error information
  console.error(`[STREAMING_ERROR] ${errorInfo.code}`, {
    message: errorInfo.message,
    provider,
    sessionId,
    timestamp: new Date().toISOString(),
    originalError: error.message
  });

  // Create error chunk in SSE format
  const errorChunk = {
    error: {
      message: errorInfo.message,
      type: errorInfo.type,
      code: errorInfo.code,
      status: errorInfo.statusCode
    }
  };

  // Send error as SSE chunk if headers not yet sent
  if (!res.headersSent) {
    res.status(errorInfo.statusCode);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  if (res.writable) {
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.write(`data: [DONE]\n\n`);
  }
}

// Endpoint dla /v1/models - zwraca listę dostępnych modeli
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(modelId => ({
    id: modelId,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: modelId.includes('gpt-4') ? 'openai' : 'openai-internal',
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Endpointy testowe (health check)
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok', 
    message: 'Gateway is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    config: {
      port: PORT,
      max_retries: MAX_RETRIES,
      retry_delay: RETRY_DELAY,
      cache_ttl: CACHE_TTL
    },
    providers: {
      openrouter: !!process.env.OPENROUTER_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      opencode: !!opencodeClient
    },
    sessions: sessionManager.getSessionStats()
  };

  if (opencodeClient) {
    try {
      const config = await opencodeClient.config.providers();
      health.opencode = {
        connected: true,
        providers: config?.providers?.length || 0,
        default: config?.default ? Object.keys(config.default).length : 0
      };
    } catch (error) {
      health.opencode = {
        connected: false,
        error: error.message
      };
      health.status = 'degraded';
    }
  }

  res.json(health);
});

app.get('/', (req, res) => {
  res.json({
    message: 'OpenAI API Gateway',
    version: '1.0.0',
    endpoints: [
      '/v1/chat/completions',
      '/v1/embeddings',
      '/v1/models',
      '/health',
      '/config',
      '/admin'
    ]
  });
});

// Endpoint do pobrania modeli pogrupowanych po providerze
app.get('/v1/models-by-provider', (req, res) => {
  const providers = {
    openrouter: {
      name: 'OpenRouter',
      models: [
        { id: 'opencode/minimax-m2.1-free:free', name: 'MiniMax M2.1', priority: 'high' },
        { id: 'github-copilot/claude-haiku-4.5:free', name: 'Claude Haiku 4.5', priority: 'high' },
        { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen 235B', priority: 'medium' },
        { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1', priority: 'medium' },
        { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small', priority: 'low' },
        { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', priority: 'low' }
      ]
    },
    gemini: {
      name: 'Google Gemini',
      models: [
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', priority: 'high' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', priority: 'high' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', priority: 'medium' }
      ]
    },
    opencode: {
      name: 'OpenCode',
      models: [
        { id: 'opencode/big-pickle:free', name: 'Big Pickle', priority: 'high' },
        { id: 'opencode/glm-5-free:free', name: 'GLM-5 Free', priority: 'high' },
        { id: 'opencode/gpt-5-nano:free', name: 'GPT-5 Nano', priority: 'medium' },
        { id: 'opencode/kimi-k2.5-free:free', name: 'Kimi K2.5 Free', priority: 'medium' },
        { id: 'opencode/minimax-m2.5-free:free', name: 'MiniMax M2.5 Free', priority: 'low' }
      ]
    },
    custom: {
      name: 'Custom Providers',
      models: Array.from(customProviders.entries()).flatMap(([name, config]) => 
        (config.modelPrefix ? [{
          id: `${config.modelPrefix}-model`,
          name: `${config.displayName || name} (Custom)`,
          priority: 'low'
        }] : [])
      )
    }
  };
  
  res.json(providers);
});

// Endpoint dla wyboru API do emulacji
app.get('/v1/emulate', (req, res) => {
  res.json({
    availableApis: [
      {
        id: 'openai',
        name: 'OpenAI API (default)',
        description: 'Emulate OpenAI API endpoints',
        endpoints: ['/v1/chat/completions', '/v1/embeddings', '/v1/models']
      },
      ...Array.from(customProviders.entries()).map(([name, config]) => ({
        id: name,
        name: config.displayName || name,
        description: `Custom provider: ${config.endpoint}`,
        endpoints: [`/v1/chat/completions`, `/v1/embeddings`],
        endpoint: config.endpoint,
        modelPrefix: config.modelPrefix
      }))
    ],
    currentEmulation: process.env.EMULATE_API || 'openai'
  });
});

// Endpoint do zmiany API do emulacji (dla runtime configuration)
app.post('/v1/emulate', (req, res) => {
  try {
    const { api } = req.body;
    
    if (api !== 'openai' && !customProviders.has(api)) {
      return res.status(400).json({
        error: `Unknown API provider: ${api}`
      });
    }
    
    // Ustaw w zmiennych środowiskowych (dla tego session'u)
    process.env.EMULATE_API = api;
    
    res.json({
      success: true,
      message: `Switched to ${api} API emulation`,
      currentEmulation: process.env.EMULATE_API
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint panelu konfiguracyjnego (HTML)
app.get('/admin', authMiddleware, (req, res) => {
  res.send(getConfigPanelHTML());
});

// Endpoint do pobrania konfiguracji
app.get('/config', optionalAuth, (req, res) => {
  res.json({
    modelMapping: MODEL_MAPPING,
    fallbackMapping: FALLBACK_MAPPING,
    modelProvider: MODEL_PROVIDER,
    providers: {
      openrouter: {
        configured: providerApiKeys.openrouter.length > 0,
        keyCount: providerApiKeys.openrouter.length
      },
      gemini: {
        configured: providerApiKeys.gemini.length > 0,
        keyCount: providerApiKeys.gemini.length
      },
      custom: Array.from(customProviders.entries()).map(([name, config]) => ({
        name,
        endpoint: config.endpoint,
        configured: true
      }))
    },
    settings: {
      port: PORT,
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY,
      cacheTTL: CACHE_TTL,
      openrouterConfigured: providerApiKeys.openrouter.length > 0,
      geminiConfigured: providerApiKeys.gemini.length > 0
    },
    stats: {
      cacheSize: responseCache.size,
      uptime: process.uptime()
    }
  });
});

// Endpoint do aktualizacji konfiguracji modeli (tylko w pamięci, nie zapisuje do pliku)
app.post('/config/models', authMiddleware, (req, res) => {
  try {
    const { openaiModel, targetModel, provider } = req.body;
    
    if (!openaiModel || !targetModel) {
      return res.status(400).json({
        error: 'Missing required fields: openaiModel, targetModel'
      });
    }
    
    // Aktualizacja mapowania modelu
    MODEL_MAPPING[openaiModel] = targetModel;
    
    // Aktualizacja providera jeśli podano
    if (provider) {
      if (provider === 'gemini') {
        MODEL_PROVIDER[targetModel] = 'gemini';
      } else {
        delete MODEL_PROVIDER[targetModel];
      }
    }
    
    res.json({
      success: true,
      message: `Model mapping updated: ${openaiModel} -> ${targetModel}`,
      modelMapping: MODEL_MAPPING
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint do czyszczenia cache'a
app.post('/config/clear-cache', authMiddleware, (req, res) => {
  const cacheSize = responseCache.size;
  responseCache.clear();
  res.json({
    success: true,
    message: `Cache cleared. Removed ${cacheSize} entries.`
  });
});

// Endpoint do zarządzania providerami i kluczami API
app.get('/config/providers', (req, res) => {
  res.json({
    providers: {
      openrouter: {
        name: 'OpenRouter',
        configured: providerApiKeys.openrouter.length > 0,
        keyCount: providerApiKeys.openrouter.length,
        endpoint: 'https://openrouter.ai/api/v1'
      },
      gemini: {
        name: 'Google Gemini',
        configured: providerApiKeys.gemini.length > 0,
        keyCount: providerApiKeys.gemini.length,
        endpoint: 'Direct Google API'
      },
      custom: Array.from(customProviders.entries()).map(([name, config]) => ({
        name,
        displayName: config.displayName || name,
        endpoint: config.endpoint,
        configured: config.apiKeys && config.apiKeys.length > 0,
        keyCount: config.apiKeys ? config.apiKeys.length : 0,
        modelPrefix: config.modelPrefix
      }))
    }
  });
});

// Session status endpoint
app.get('/session/status', (req, res) => {
  res.json({
    stats: sessionManager.getSessionStats(),
    sessions: sessionManager.getAllSessions()
  });
});

// Get specific session details
app.get('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    session,
    messages: sessionManager.getMessageHistory(sessionId)
  });
});

// Close/delete session
app.delete('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  sessionManager.deleteSession(sessionId);
  res.json({ success: true, message: `Session ${sessionId} deleted` });
});

// Endpoint do dodawania/aktualizacji kluczy API dla providerów
app.post('/config/providers', authMiddleware, (req, res) => {
  try {
    const { provider, apiKey, action } = req.body;
    
    if (!provider || !apiKey) {
      return res.status(400).json({
        error: 'Missing required fields: provider, apiKey'
      });
    }
    
    // Walidacja providera
    if (!['openrouter', 'gemini'].includes(provider)) {
      return res.status(400).json({
        error: 'Invalid provider. Supported: openrouter, gemini'
      });
    }
    
    if (action === 'remove') {
      // Usuwanie klucza
      const index = providerApiKeys[provider].indexOf(apiKey);
      if (index > -1) {
        providerApiKeys[provider].splice(index, 1);
      }
      
      // Reset Gemini client if all keys removed
      if (provider === 'gemini' && providerApiKeys.gemini.length === 0) {
        geminiClient = null;
      }
      
      return res.json({
        success: true,
        message: `API key removed from ${provider}`,
        keyCount: providerApiKeys[provider].length
      });
    } else {
      // Dodawanie klucza (domyślna akcja)
      if (!providerApiKeys[provider].includes(apiKey)) {
        providerApiKeys[provider].push(apiKey);
        
        // Initialize Gemini client if first Gemini key
        if (provider === 'gemini' && !geminiClient) {
          geminiClient = new GoogleGenerativeAI(apiKey);
        }
      }
      
      return res.json({
        success: true,
        message: `API key added to ${provider}`,
        keyCount: providerApiKeys[provider].length
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint do dodawania niestandardowego providera
app.post('/config/providers/custom', authMiddleware, (req, res) => {
  try {
    const { name, displayName, endpoint, apiKeys, apiKeyHeader, modelPrefix } = req.body;
    
    if (!name || !endpoint) {
      return res.status(400).json({
        error: 'Missing required fields: name, endpoint'
      });
    }
    
    // Walidacja nazwy providera (tylko małe litery, cyfry i myślniki)
    if (!/^[a-z0-9-]+$/.test(name)) {
      return res.status(400).json({
        error: 'Provider name must contain only lowercase letters, numbers and hyphens'
      });
    }
    
    // Sprawdzenie czy nazwa nie koliduje z wbudowanymi providerami
    if (['openrouter', 'gemini'].includes(name.toLowerCase())) {
      return res.status(400).json({
        error: 'Cannot use reserved provider names: openrouter, gemini'
      });
    }
    
    customProviders.set(name, {
      displayName: displayName || name,
      endpoint,
      apiKeys: Array.isArray(apiKeys) ? apiKeys : (apiKeys ? [apiKeys] : []),
      apiKeyHeader: apiKeyHeader || 'Authorization',
      modelPrefix: modelPrefix || name
    });
    
    res.json({
      success: true,
      message: `Custom provider '${name}' added successfully`,
      provider: customProviders.get(name)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint do usuwania niestandardowego providera
app.delete('/config/providers/custom/:name', (req, res) => {
  try {
    const { name } = req.params;
    
    if (!customProviders.has(name)) {
      return res.status(404).json({
        error: `Custom provider '${name}' not found`
      });
    }
    
    customProviders.delete(name);
    
    res.json({
      success: true,
      message: `Custom provider '${name}' removed successfully`
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint do zarządzania fallbackami
app.post('/config/fallbacks', authMiddleware, (req, res) => {
  try {
    const { primaryModel, fallbackModel, action } = req.body;
    
    if (!primaryModel || !fallbackModel) {
      return res.status(400).json({
        error: 'Missing required fields: primaryModel, fallbackModel'
      });
    }
    
    if (action === 'remove') {
      delete FALLBACK_MAPPING[primaryModel];
      return res.json({
        success: true,
        message: `Fallback removed for ${primaryModel}`
      });
    } else {
      FALLBACK_MAPPING[primaryModel] = fallbackModel;
      return res.json({
        success: true,
        message: `Fallback added: ${primaryModel} -> ${fallbackModel}`,
        fallbackMapping: FALLBACK_MAPPING
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Funkcja generująca HTML panelu konfiguracyjnego
function getConfigPanelHTML() {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel Konfiguracyjny - OpenAI Gateway</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            line-height: 1.6;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px 40px;
            text-align: center;
        }
        
        header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        
        header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .content {
            padding: 40px;
        }
        
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 30px;
            border-bottom: 2px solid #e0e0e0;
            flex-wrap: wrap;
        }
        
        .tab {
            padding: 12px 24px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            color: #666;
            border-bottom: 3px solid transparent;
            transition: all 0.3s;
        }
        
        .tab:hover {
            color: #667eea;
        }
        
        .tab.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 20px;
            border: 1px solid #e0e0e0;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .card h3 {
            color: #667eea;
            margin-bottom: 15px;
            font-size: 1.4em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75em;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .status-ok {
            background: #10b981;
            color: white;
        }
        
        .status-error {
            background: #ef4444;
            color: white;
        }
        
        .status-warning {
            background: #f59e0b;
            color: white;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        
        .info-item {
            padding: 15px;
            background: white;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        
        .info-label {
            font-size: 0.85em;
            color: #666;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .info-value {
            font-size: 1.5em;
            font-weight: 700;
            color: #333;
            margin-top: 5px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
        }
        
        th {
            background: #667eea;
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }
        
        td {
            padding: 12px 15px;
            border-bottom: 1px solid #e0e0e0;
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        
        input, select {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        input:focus, select:focus {
            outline: none;
            border-color: #667eea;
        }
        
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        }
        
        .btn-secondary {
            background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
        }
        
        .alert {
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        
        .alert-success {
            background: #d1fae5;
            color: #065f46;
            border-left: 4px solid #10b981;
        }
        
        .alert-error {
            background: #fee2e2;
            color: #991b1b;
            border-left: 4px solid #ef4444;
        }
        
        .code-block {
            background: #1e293b;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            line-height: 1.6;
        }
        
        .endpoint-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 15px;
            border: 2px solid #e0e0e0;
        }
        
        .endpoint-method {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 4px;
            font-weight: 700;
            font-size: 0.85em;
            margin-right: 10px;
        }
        
        .method-get {
            background: #10b981;
            color: white;
        }
        
        .method-post {
            background: #3b82f6;
            color: white;
        }
        
        .refresh-btn {
            float: right;
            padding: 8px 16px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Panel Konfiguracyjny</h1>
            <p>OpenAI Gateway - Zarządzanie modelami i konfiguracją</p>
        </header>
        
        <div class="content">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('dashboard')">📊 Dashboard</button>
                <button class="tab" onclick="switchTab('emulation')">🎭 API Emulation</button>
                <button class="tab" onclick="switchTab('providers')">🔑 Providery</button>
                <button class="tab" onclick="switchTab('models')">🤖 Modele</button>
                <button class="tab" onclick="switchTab('fallbacks')">🔄 Fallbacki</button>
                <button class="tab" onclick="switchTab('config')">⚙️ Konfiguracja</button>
                <button class="tab" onclick="switchTab('api')">📡 API Docs</button>
            </div>
            
            <div id="dashboard" class="tab-content active">
                <button class="refresh-btn" onclick="loadConfig()">🔄 Odśwież</button>
                <h2 style="margin-bottom: 20px;">Status systemu</h2>
                
                <div class="card">
                    <h3>🔌 Providery API</h3>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">OpenRouter</div>
                            <div class="info-value" id="openrouter-status">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Google Gemini</div>
                            <div class="info-value" id="gemini-status">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Cache Size</div>
                            <div class="info-value" id="cache-size">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Uptime</div>
                            <div class="info-value" id="uptime">-</div>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h3>⚙️ Ustawienia</h3>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">Port</div>
                            <div class="info-value" id="port">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Max Retries</div>
                            <div class="info-value" id="max-retries">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Retry Delay</div>
                            <div class="info-value" id="retry-delay">-</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Cache TTL</div>
                            <div class="info-value" id="cache-ttl">-</div>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h3>📊 Statystyki</h3>
                    <p>Total modeli: <strong id="total-models">-</strong></p>
                    <p>Total fallbacków: <strong id="total-fallbacks">-</strong></p>
                    <button onclick="clearCache()" class="btn-danger" style="margin-top: 15px;">🗑️ Wyczyść Cache</button>
                </div>
            </div>
            
            <div id="emulation" class="tab-content">
                <h2 style="margin-bottom: 20px;">🎭 Wybór API do emulacji</h2>
                <p style="color: #666; margin-bottom: 20px;">Wybierz który interfejs API chcesz emulować. Wszystkie requesty będą kierowane do wybranego providera.</p>
                
                <div id="emulation-list" class="card">
                    <p style="text-align: center; color: #999;">Ładowanie dostępnych API...</p>
                </div>
                
                <div class="card" style="margin-top: 30px; background: #f0f9ff; border-left: 4px solid #3b82f6;">
                    <h3 style="color: #3b82f6;">💡 Informacja</h3>
                    <p><strong>OpenAI API (default)</strong> - Emuluje standardowy interfejs OpenAI. Wszystkie aliasy modeli mapowane zgodnie z konfiguracją.</p>
                    <p style="margin-top: 10px;"><strong>Custom Providers</strong> - Emuluje własny interfejs API. Requesty będą bezpośrednio kierowane do configurenego endpointu.</p>
                    <p style="margin-top: 10px; color: #666; font-size: 0.9em;">Zmiana API emulacji wymaga restartu serwera aby weszła w życie dla istniejących klientów.</p>
                </div>
            </div>
            
            <div id="providers" class="tab-content">
                <h2 style="margin-bottom: 20px;">Zarządzanie Providerami API</h2>
                
                <div id="providers-list"></div>
                
                <div class="card" style="margin-top: 30px;">
                    <h3>➕ Dodaj klucz API do providera</h3>
                    <div id="add-key-result"></div>
                    <form onsubmit="addProviderKey(event)">
                         <div class="form-group">
                             <label>Provider:</label>
                             <select id="key-provider" required>
                                 <option value="openrouter">OpenRouter</option>
                                 <option value="gemini">Google Gemini</option>
                                 <option value="opencode">OpenCode</option>
                             </select>
                         </div>
                        <div class="form-group">
                            <label>Klucz API:</label>
                            <input type="password" id="new-api-key" placeholder="Wklej swój klucz API" required>
                        </div>
                        <button type="submit">💾 Dodaj klucz</button>
                    </form>
                </div>
                
                <div class="card" style="margin-top: 30px;">
                    <h3>🔧 Dodaj niestandardowy provider</h3>
                    <div id="add-custom-provider-result"></div>
                    <form onsubmit="addCustomProvider(event)">
                        <div class="form-group">
                            <label>Nazwa providera:</label>
                            <input type="text" id="custom-provider-name" placeholder="np. opencode-ai" pattern="[a-z0-9-]+" required>
                            <small style="color: #666;">Tylko małe litery, cyfry i myślniki</small>
                        </div>
                        <div class="form-group">
                            <label>Wyświetlana nazwa:</label>
                            <input type="text" id="custom-provider-display-name" placeholder="np. OpenCode.ai">
                        </div>
                        <div class="form-group">
                            <label>Endpoint URL:</label>
                            <input type="url" id="custom-provider-endpoint" placeholder="https://api.opencode.ai/v1" required>
                        </div>
                        <div class="form-group">
                            <label>Klucze API (oddzielone przecinkami):</label>
                            <input type="text" id="custom-provider-keys" placeholder="klucz1,klucz2,klucz3">
                        </div>
                        <div class="form-group">
                            <label>Nagłówek autoryzacji:</label>
                            <input type="text" id="custom-provider-auth-header" placeholder="Authorization" value="Authorization">
                        </div>
                        <div class="form-group">
                            <label>Prefiks modeli:</label>
                            <input type="text" id="custom-provider-model-prefix" placeholder="np. opencode">
                        </div>
                        <button type="submit">💾 Dodaj niestandardowy provider</button>
                    </form>
                </div>
            </div>
            
            <div id="models" class="tab-content">
                <h2 style="margin-bottom: 20px;">Mapowanie modeli OpenAI</h2>
                <div id="models-list"></div>
                
                <div class="card" style="margin-top: 30px;">
                    <h3>➕ Dodaj nowe mapowanie</h3>
                    <div id="add-model-result"></div>
                    <form onsubmit="addModelMapping(event)">
                        <div class="form-group">
                            <label>Model OpenAI:</label>
                            <input type="text" id="new-openai-model" placeholder="np. gpt-5-custom" required>
                        </div>
                        <div class="form-group">
                            <label>Model docelowy:</label>
                            <input type="text" id="new-target-model" placeholder="np. qwen/qwen3-235b-a22b:free" required>
                        </div>
                         <div class="form-group">
                             <label>Provider:</label>
                             <select id="new-provider" onchange="onProviderChange()">
                                 <option value="openrouter">OpenRouter</option>
                                 <option value="gemini">Google Gemini</option>
                                 <option value="opencode">OpenCode</option>
                             </select>
                         </div>
                        <button type="submit">💾 Dodaj mapowanie</button>
                    </form>
                </div>
            </div>
            
            <div id="fallbacks" class="tab-content">
                <h2 style="margin-bottom: 20px;">Łańcuchy fallbacków</h2>
                <div id="fallbacks-list"></div>
                
                <div class="card" style="margin-top: 30px;">
                    <h3>➕ Dodaj fallback</h3>
                    <div id="add-fallback-result"></div>
                    <form onsubmit="addFallback(event)">
                        <div class="form-group">
                            <label>Model główny:</label>
                            <input type="text" id="fallback-primary-model" placeholder="np. deepseek/deepseek-r1-0528:free" required>
                        </div>
                        <div class="form-group">
                            <label>Model fallback:</label>
                            <input type="text" id="fallback-fallback-model" placeholder="np. qwen/qwen3-235b-a22b:free" required>
                        </div>
                        <button type="submit">💾 Dodaj fallback</button>
                    </form>
                </div>
            </div>
            
            <div id="config" class="tab-content">
                <h2 style="margin-bottom: 20px;">Pełna konfiguracja</h2>
                <div class="card">
                    <h3>📋 CONFIG JSON</h3>
                    <div class="code-block" id="config-json"></div>
                </div>
            </div>
            
            <div id="api" class="tab-content">
                <h2 style="margin-bottom: 20px;">Dokumentacja API</h2>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-get">GET</span>
                    <strong>/v1/chat/completions</strong>
                    <p style="margin-top: 10px; color: #666;">Endpoint zgodny z OpenAI API do generowania odpowiedzi czatu</p>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-get">GET</span>
                    <strong>/v1/models</strong>
                    <p style="margin-top: 10px; color: #666;">Lista wszystkich dostępnych modeli</p>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-get">GET</span>
                    <strong>/config</strong>
                    <p style="margin-top: 10px; color: #666;">Pobierz aktualną konfigurację gateway</p>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-post">POST</span>
                    <strong>/config/models</strong>
                    <p style="margin-top: 10px; color: #666;">Aktualizuj mapowanie modelu (tylko w pamięci)</p>
                    <div class="code-block" style="margin-top: 10px;">
{
  "openaiModel": "gpt-5-custom",
  "targetModel": "qwen/qwen3-235b-a22b:free",
  "provider": "openrouter"
}</div>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-post">POST</span>
                    <strong>/config/clear-cache</strong>
                    <p style="margin-top: 10px; color: #666;">Wyczyść cache odpowiedzi</p>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-get">GET</span>
                    <strong>/config/providers</strong>
                    <p style="margin-top: 10px; color: #666;">Pobierz listę wszystkich providerów i ich status</p>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-post">POST</span>
                    <strong>/config/providers</strong>
                    <p style="margin-top: 10px; color: #666;">Dodaj/usuń klucz API dla providera</p>
                    <div class="code-block" style="margin-top: 10px;">
{
  "provider": "openrouter",
  "apiKey": "sk-or-v1-xxx...",
  "action": "add"
}</div>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-post">POST</span>
                    <strong>/config/providers/custom</strong>
                    <p style="margin-top: 10px; color: #666;">Dodaj niestandardowy provider</p>
                    <div class="code-block" style="margin-top: 10px;">
{
  "name": "opencode-ai",
  "displayName": "OpenCode.ai",
  "endpoint": "https://api.opencode.ai/v1",
  "apiKeys": ["key1", "key2"],
  "apiKeyHeader": "Authorization",
  "modelPrefix": "opencode"
}</div>
                </div>
                
                <div class="endpoint-card">
                    <span class="endpoint-method method-post">POST</span>
                    <strong>/config/fallbacks</strong>
                    <p style="margin-top: 10px; color: #666;">Dodaj/usuń mapowanie fallback</p>
                    <div class="code-block" style="margin-top: 10px;">
{
  "primaryModel": "deepseek/deepseek-r1-0528:free",
  "fallbackModel": "qwen/qwen3-235b-a22b:free",
  "action": "add"
}</div>
                </div>
                
                <div class="card" style="margin-top: 20px;">
                    <h3>🔌 Przykład użycia (cURL)</h3>
                    <div class="code-block">
curl -X POST "http://localhost:8787/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'</div>
                </div>
                
                <div class="card">
                    <h3>🐍 Przykład użycia (Python)</h3>
                    <div class="code-block">
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="dowolny-string"
)

response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)</div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let configData = null;
        
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById(tabName).classList.add('active');
        }
        
        async function loadEmulationApis() {
            try {
                const response = await fetch('/v1/emulate');
                const data = await response.json();
                updateEmulationList(data);
            } catch (error) {
                console.error('Error loading emulation APIs:', error);
                document.getElementById('emulation-list').innerHTML = 
                    '<p style="color: #ef4444;">Błąd ładowania dostępnych API</p>';
            }
        }
        
        function updateEmulationList(data) {
            let html = '<table style="width: 100%;"><thead><tr><th>API Provider</th><th>Opis</th><th>Endpointy</th><th>Akcja</th></tr></thead><tbody>';
            
            for (const api of data.availableApis) {
                const isCurrent = api.id === data.currentEmulation;
                const statusBadge = isCurrent ? '<span class="status-badge status-ok">✓ AKTYWNY</span>' : '';
                const endpoints = api.endpoints.join(', ');
                const buttonText = isCurrent ? 'Aktywny' : 'Aktywuj';
                const buttonClass = isCurrent ? 'btn-secondary' : '';
                
                html += \`<tr style="\${isCurrent ? 'background: #f0f9ff;' : ''}">\`;
                html += \`<td><strong>\${api.name}</strong> \${statusBadge}</td>\`;
                html += \`<td><small>\${api.description}</small></td>\`;
                html += \`<td><code style="font-size: 0.8em;">\${endpoints}</code></td>\`;
                html += \`<td><button onclick="switchEmulationApi('\${api.id}')" class="\${buttonClass}" style="padding: 6px 12px; font-size: 14px;">\${buttonText}</button></td>\`;
                html += '</tr>';
            }
            
            html += '</tbody></table>';
            document.getElementById('emulation-list').innerHTML = html;
        }
        
        async function switchEmulationApi(apiId) {
            try {
                const response = await fetch('/v1/emulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api: apiId })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    alert('✓ Zmieniono emulację na: ' + apiId);
                    loadEmulationApis();
                } else {
                    alert('✗ Błąd: ' + result.error);
                }
            } catch (error) {
                alert('Błąd zmiany API: ' + error.message);
            }
        }
        
        async function loadConfig() {
            try {
                const response = await fetch('/config');
                configData = await response.json();

                updateDashboard();
                updateProvidersTable();
                updateModelsTable();
                updateFallbacksTable();
                updateConfigJSON();
                loadEmulationApis();
                populateProviderDropdown();
            } catch (error) {
                console.error('Error loading config:', error);
            }
        }
        
        function updateDashboard() {
            if (!configData) return;
            
            document.getElementById('openrouter-status').innerHTML = 
                configData.settings.openrouterConfigured ? 
                '<span class="status-badge status-ok">✓ Skonfigurowany</span>' : 
                '<span class="status-badge status-error">✗ Brak</span>';
                
            document.getElementById('gemini-status').innerHTML = 
                configData.settings.geminiConfigured ? 
                '<span class="status-badge status-ok">✓ Skonfigurowany</span>' : 
                '<span class="status-badge status-error">✗ Brak</span>';
                
            document.getElementById('cache-size').textContent = configData.stats.cacheSize;
            document.getElementById('uptime').textContent = Math.floor(configData.stats.uptime) + 's';
            document.getElementById('port').textContent = configData.settings.port;
            document.getElementById('max-retries').textContent = configData.settings.maxRetries;
            document.getElementById('retry-delay').textContent = configData.settings.retryDelay + 'ms';
            document.getElementById('cache-ttl').textContent = (configData.settings.cacheTTL / 1000) + 's';
            document.getElementById('total-models').textContent = Object.keys(configData.modelMapping).length;
            document.getElementById('total-fallbacks').textContent = Object.keys(configData.fallbackMapping).length;
        }
        
        function updateModelsTable() {
            if (!configData) return;
            
            let html = '<table><thead><tr><th>Model OpenAI</th><th>Model Docelowy</th><th>Provider</th></tr></thead><tbody>';
            
            for (const [openaiModel, targetModel] of Object.entries(configData.modelMapping)) {
                const provider = configData.modelProvider[targetModel] || 'OpenRouter';
                html += \`<tr>
                    <td><strong>\${openaiModel}</strong></td>
                    <td><code>\${targetModel}</code></td>
                    <td><span class="status-badge \${provider === 'gemini' ? 'status-warning' : 'status-ok'}">\${provider}</span></td>
                </tr>\`;
            }
            
            html += '</tbody></table>';
            document.getElementById('models-list').innerHTML = html;
        }
        
        function updateFallbacksTable() {
            if (!configData) return;
            
            let html = '<table><thead><tr><th>Model Główny</th><th>Model Fallback</th></tr></thead><tbody>';
            
            for (const [mainModel, fallbackModel] of Object.entries(configData.fallbackMapping)) {
                html += \`<tr>
                    <td><code>\${mainModel}</code></td>
                    <td><code>\${fallbackModel}</code></td>
                </tr>\`;
            }
            
            html += '</tbody></table>';
            document.getElementById('fallbacks-list').innerHTML = html;
        }
        
        async function updateProvidersTable() {
            try {
                const response = await fetch('/config/providers');
                const providersData = await response.json();
                
                if (!providersData || !providersData.providers) return;
                
                let html = '<div class="card"><h3>🔌 Wbudowane Providery</h3><table><thead><tr><th>Provider</th><th>Status</th><th>Liczba kluczy</th><th>Endpoint</th></tr></thead><tbody>';
                
                // OpenRouter
                const openrouter = providersData.providers.openrouter;
                html += \`<tr>
                    <td><strong>OpenRouter</strong></td>
                    <td><span class="status-badge \${openrouter.configured ? 'status-ok' : 'status-error'}">\${openrouter.configured ? '✓ Aktywny' : '✗ Nieaktywny'}</span></td>
                    <td>\${openrouter.keyCount}</td>
                    <td><code>\${openrouter.endpoint}</code></td>
                </tr>\`;
                
                // Gemini
                const gemini = providersData.providers.gemini;
                html += \`<tr>
                    <td><strong>Google Gemini</strong></td>
                    <td><span class="status-badge \${gemini.configured ? 'status-ok' : 'status-error'}">\${gemini.configured ? '✓ Aktywny' : '✗ Nieaktywny'}</span></td>
                    <td>\${gemini.keyCount}</td>
                    <td><code>\${gemini.endpoint}</code></td>
                </tr>\`;
                
                html += '</tbody></table></div>';
                
                // Custom providers
                if (providersData.providers.custom && providersData.providers.custom.length > 0) {
                    html += '<div class="card" style="margin-top: 20px;"><h3>🔧 Niestandardowe Providery</h3><table><thead><tr><th>Nazwa</th><th>Status</th><th>Liczba kluczy</th><th>Endpoint</th><th>Akcje</th></tr></thead><tbody>';
                    
                    for (const provider of providersData.providers.custom) {
                        html += \`<tr>
                            <td><strong>\${provider.displayName || provider.name}</strong></td>
                            <td><span class="status-badge \${provider.configured ? 'status-ok' : 'status-error'}">\${provider.configured ? '✓ Aktywny' : '✗ Nieaktywny'}</span></td>
                            <td>\${provider.keyCount || 0}</td>
                            <td><code>\${provider.endpoint}</code></td>
                            <td><button class="btn-danger" onclick="removeCustomProvider('\${provider.name}')" style="padding: 6px 12px; font-size: 14px;">Usuń</button></td>
                        </tr>\`;
                    }
                    
                    html += '</tbody></table></div>';
                }
                
                document.getElementById('providers-list').innerHTML = html;
            } catch (error) {
                console.error('Error updating providers table:', error);
            }
        }
        
        function updateConfigJSON() {
            if (!configData) return;
            document.getElementById('config-json').textContent = JSON.stringify(configData, null, 2);
        }
        
        async function populateProviderDropdown() {
            try {
                const select = document.getElementById('new-provider');
                if (!select) return;
                
                const response = await fetch('/v1/models-by-provider');
                const data = await response.json();
                
                // Clear existing options except built-in ones
                const builtInOptions = select.querySelectorAll('option');
                select.innerHTML = '';
                
                // Add built-in providers first
                const builtIn = [
                    { value: 'openrouter', label: 'OpenRouter' },
                    { value: 'gemini', label: 'Google Gemini' }
                ];
                
                builtIn.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.value;
                    option.textContent = item.label;
                    select.appendChild(option);
                });
                
                // Add custom providers from API response
                if (data.customProviders && data.customProviders.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Custom Providers';
                    
                    data.customProviders.forEach(provider => {
                        const option = document.createElement('option');
                        option.value = provider.name;
                        option.textContent = provider.displayName || provider.name;
                        optgroup.appendChild(option);
                    });
                    
                    select.appendChild(optgroup);
                }
            } catch (error) {
                console.error('Error populating provider dropdown:', error);
            }
        }
        
        async function onProviderChange() {
            try {
                const provider = document.getElementById('new-provider').value;
                const targetModelInput = document.getElementById('new-target-model');
                
                if (!targetModelInput) return;
                
                const response = await fetch('/v1/models-by-provider');
                const data = await response.json();
                
                let availableModels = [];
                
                if (provider === 'openrouter' && data.openrouter) {
                    availableModels = data.openrouter.map(m => m.id);
                } else if (provider === 'gemini' && data.gemini) {
                    availableModels = data.gemini.map(m => m.id);
                } else if (data.customProviders) {
                    const customProvider = data.customProviders.find(p => p.name === provider);
                    if (customProvider && customProvider.models) {
                        availableModels = customProvider.models;
                    }
                }
                
                if (availableModels.length > 0) {
                    targetModelInput.placeholder = 'e.g. ' + availableModels[0];
                } else {
                    targetModelInput.placeholder = 'Enter model identifier';
                }
            } catch (error) {
                console.error('Error updating provider models:', error);
            }
        }
        
        async function addModelMapping(event) {
            event.preventDefault();
            
            const openaiModel = document.getElementById('new-openai-model').value;
            const targetModel = document.getElementById('new-target-model').value;
            const provider = document.getElementById('new-provider').value;
            
            try {
                const response = await fetch('/config/models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ openaiModel, targetModel, provider })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    document.getElementById('add-model-result').innerHTML = 
                        '<div class="alert alert-success">✓ Mapowanie dodane pomyślnie!</div>';
                    loadConfig();
                    event.target.reset();
                } else {
                    document.getElementById('add-model-result').innerHTML = 
                        \`<div class="alert alert-error">✗ Błąd: \${result.error}</div>\`;
                }
            } catch (error) {
                document.getElementById('add-model-result').innerHTML = 
                    \`<div class="alert alert-error">✗ Błąd połączenia: \${error.message}</div>\`;
            }
            
            setTimeout(() => {
                document.getElementById('add-model-result').innerHTML = '';
            }, 5000);
        }
        
        async function clearCache() {
            if (!confirm('Czy na pewno chcesz wyczyścić cache?')) return;
            
            try {
                const response = await fetch('/config/clear-cache', { method: 'POST' });
                const result = await response.json();
                
                if (response.ok) {
                    alert(result.message);
                    loadConfig();
                }
            } catch (error) {
                alert('Błąd czyszczenia cache: ' + error.message);
            }
        }
        
        async function addProviderKey(event) {
            event.preventDefault();
            
            const provider = document.getElementById('key-provider').value;
            const apiKey = document.getElementById('new-api-key').value;
            
            try {
                const response = await fetch('/config/providers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, apiKey })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    document.getElementById('add-key-result').innerHTML = 
                        '<div class="alert alert-success">✓ Klucz API dodany pomyślnie!</div>';
                    loadConfig();
                    event.target.reset();
                } else {
                    document.getElementById('add-key-result').innerHTML = 
                        \`<div class="alert alert-error">✗ Błąd: \${result.error}</div>\`;
                }
            } catch (error) {
                document.getElementById('add-key-result').innerHTML = 
                    \`<div class="alert alert-error">✗ Błąd połączenia: \${error.message}</div>\`;
            }
            
            setTimeout(() => {
                document.getElementById('add-key-result').innerHTML = '';
            }, 5000);
        }
        
        async function addCustomProvider(event) {
            event.preventDefault();
            
            const name = document.getElementById('custom-provider-name').value;
            const displayName = document.getElementById('custom-provider-display-name').value;
            const endpoint = document.getElementById('custom-provider-endpoint').value;
            const keysStr = document.getElementById('custom-provider-keys').value;
            const apiKeyHeader = document.getElementById('custom-provider-auth-header').value;
            const modelPrefix = document.getElementById('custom-provider-model-prefix').value;
            
            const apiKeys = keysStr ? keysStr.split(',').map(k => k.trim()).filter(k => k) : [];
            
            try {
                const response = await fetch('/config/providers/custom', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, displayName, endpoint, apiKeys, apiKeyHeader, modelPrefix })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    document.getElementById('add-custom-provider-result').innerHTML = 
                        '<div class="alert alert-success">✓ Niestandardowy provider dodany pomyślnie!</div>';
                    loadConfig();
                    event.target.reset();
                } else {
                    document.getElementById('add-custom-provider-result').innerHTML = 
                        \`<div class="alert alert-error">✗ Błąd: \${result.error}</div>\`;
                }
            } catch (error) {
                document.getElementById('add-custom-provider-result').innerHTML = 
                    \`<div class="alert alert-error">✗ Błąd połączenia: \${error.message}</div>\`;
            }
            
            setTimeout(() => {
                document.getElementById('add-custom-provider-result').innerHTML = '';
            }, 5000);
        }
        
        async function removeCustomProvider(name) {
            if (!confirm(\`Czy na pewno chcesz usunąć providera '\${name}'?\`)) return;
            
            try {
                const response = await fetch(\`/config/providers/custom/\${name}\`, {
                    method: 'DELETE'
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    alert(result.message);
                    loadConfig();
                } else {
                    alert('Błąd: ' + result.error);
                }
            } catch (error) {
                alert('Błąd połączenia: ' + error.message);
            }
        }
        
        async function addFallback(event) {
            event.preventDefault();
            
            const primaryModel = document.getElementById('fallback-primary-model').value;
            const fallbackModel = document.getElementById('fallback-fallback-model').value;
            
            try {
                const response = await fetch('/config/fallbacks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ primaryModel, fallbackModel })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    document.getElementById('add-fallback-result').innerHTML = 
                        '<div class="alert alert-success">✓ Fallback dodany pomyślnie!</div>';
                    loadConfig();
                    event.target.reset();
                } else {
                    document.getElementById('add-fallback-result').innerHTML = 
                        \`<div class="alert alert-error">✗ Błąd: \${result.error}</div>\`;
                }
            } catch (error) {
                document.getElementById('add-fallback-result').innerHTML = 
                    \`<div class="alert alert-error">✗ Błąd połączenia: \${error.message}</div>\`;
            }
            
            setTimeout(() => {
                document.getElementById('add-fallback-result').innerHTML = '';
            }, 5000);
        }
        
        // Load config on page load
        loadConfig();
        
        // Auto-refresh every 30 seconds
        setInterval(loadConfig, 30000);
    </script>
</body>
</html>`;
}

// Obsługa nieznanych endpointów
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Not found',
      type: 'invalid_request_error',
      code: 'resource_not_found',
      status: 404
    }
  });
});

// Obsługa błędów
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error',
      status: 500
    }
  });
});

// Uruchomienie serwera
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenAI Gateway running on 0.0.0.0:${PORT}`);
  console.log(`Local: http://localhost:${PORT}/health`);
  console.log(`External: http://<your-server-ip>:${PORT}/health`);
});

module.exports = app;
