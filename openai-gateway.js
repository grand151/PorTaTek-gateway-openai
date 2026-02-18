// OpenAI-OpenRouter Gateway
// Gateway emulujący API OpenAI z przekierowaniem do darmowych modeli OpenRouter

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Załadowanie zmiennych środowiskowych
dotenv.config();

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
  console.log('Google Gemini API client initialized');
}

if (OPENROUTER_API_KEY) {
  console.log('OpenRouter API client initialized');
}

const app = express();
const PORT = process.env.PORT || 8787;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '1000', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600000', 10);

// Konfiguracja middleware
app.use(cors());
app.use(bodyParser.json());

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
  // Wszystkie inne modele używają OpenRouter jako domyślnego providera
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

// Funkcja do generowania klucza cache'a
function generateCacheKey(model, messages, options) {
  return JSON.stringify({
    model,
    messages,
    options
  });
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

// Middleware do logowania requestów
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Endpoint dla /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model: requestedModel, messages, stream, ...otherOptions } = req.body;
    
    // Mapowanie modelu OpenAI na model docelowy
    const model = MODEL_MAPPING[requestedModel] || MODEL_MAPPING.default;
    
    // Określenie providera
    const provider = MODEL_PROVIDER[model] || 'openrouter';
    
    console.log(`Request for model: ${requestedModel} -> ${model} (provider: ${provider})`);
    
    // Sprawdzenie czy odpowiedź jest w cache'u
    const cacheKey = generateCacheKey(model, messages, otherOptions);
    if (responseCache.has(cacheKey) && !stream) {
      console.log('Cache hit - returning cached response');
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
        
        // Dodanie do cache'a
        responseCache.set(cacheKey, openAIResponse);
        setTimeout(() => responseCache.delete(cacheKey), CACHE_TTL);
        
        res.json(openAIResponse);
      } catch (error) {
        handleError(error, res);
      }
    } else {
      // Obsługa przez OpenRouter (domyślna)
      if (!OPENROUTER_API_KEY) {
        return res.status(503).json({
          error: {
            message: 'OpenRouter API is not configured. Please set OPENROUTER_API_KEY.',
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
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
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
          console.error('Stream error:', error.message);
          // W przypadku błędu streamu, kończymy strumień z komunikatem błędu
          res.write(`data: ${JSON.stringify({ error: { message: 'Stream error occurred' } })}\n\n`);
          res.write('data: [DONE]\n\n');
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
          handleError(error, res);
        }
      }
    }
  } catch (error) {
    handleError(error, res);
  }
});

// Endpoint dla /v1/embeddings
app.post('/v1/embeddings', async (req, res) => {
  try {
    const { model: requestedModel, input, ...otherOptions } = req.body;
    
    // Mapowanie modelu embeddings
    const model = MODEL_MAPPING[requestedModel] || MODEL_MAPPING['text-embedding-ada-002'];
    
    // Przygotowanie zapytania do OpenRouter
    const openRouterRequest = {
      model,
      input,
      ...otherOptions
    };
    
    // Nagłówki dla OpenRouter
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
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

// Funkcja do obsługi błędów
function handleError(error, res) {
  console.error('Error:', error.message);
  
  // Próba odczytania błędu z OpenRouter
  let errorMessage = 'Internal server error';
  let statusCode = 500;
  
  if (error.response) {
    errorMessage = error.response.data.error?.message || errorMessage;
    statusCode = error.response.status;
  }
  
  // Zwracanie błędu w formacie zgodnym z OpenAI
  res.status(statusCode).json({
    error: {
      message: errorMessage,
      type: 'api_error',
      code: 'internal_error',
      param: null,
      status: statusCode
    }
  });
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Gateway is running',
    version: '1.0.0',
    config: {
      port: PORT,
      max_retries: MAX_RETRIES,
      retry_delay: RETRY_DELAY,
      cache_ttl: CACHE_TTL
    }
  });
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

// Endpoint panelu konfiguracyjnego (HTML)
app.get('/admin', (req, res) => {
  res.send(getConfigPanelHTML());
});

// Endpoint do pobrania konfiguracji
app.get('/config', (req, res) => {
  res.json({
    modelMapping: MODEL_MAPPING,
    fallbackMapping: FALLBACK_MAPPING,
    modelProvider: MODEL_PROVIDER,
    settings: {
      port: PORT,
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY,
      cacheTTL: CACHE_TTL,
      openrouterConfigured: !!OPENROUTER_API_KEY,
      geminiConfigured: !!GEMINI_API_KEY
    },
    stats: {
      cacheSize: responseCache.size,
      uptime: process.uptime()
    }
  });
});

// Endpoint do aktualizacji konfiguracji modeli (tylko w pamięci, nie zapisuje do pliku)
app.post('/config/models', (req, res) => {
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
app.post('/config/clear-cache', (req, res) => {
  const cacheSize = responseCache.size;
  responseCache.clear();
  res.json({
    success: true,
    message: `Cache cleared. Removed ${cacheSize} entries.`
  });
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
                            <select id="new-provider">
                                <option value="openrouter">OpenRouter</option>
                                <option value="gemini">Google Gemini</option>
                            </select>
                        </div>
                        <button type="submit">💾 Dodaj mapowanie</button>
                    </form>
                </div>
            </div>
            
            <div id="fallbacks" class="tab-content">
                <h2 style="margin-bottom: 20px;">Łańcuchy fallbacków</h2>
                <div id="fallbacks-list"></div>
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
        
        async function loadConfig() {
            try {
                const response = await fetch('/config');
                configData = await response.json();
                updateDashboard();
                updateModelsTable();
                updateFallbacksTable();
                updateConfigJSON();
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
        
        function updateConfigJSON() {
            if (!configData) return;
            document.getElementById('config-json').textContent = JSON.stringify(configData, null, 2);
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
app.listen(PORT, () => {
  console.log(`OpenAI Gateway running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/health for status`);
});

module.exports = app;
