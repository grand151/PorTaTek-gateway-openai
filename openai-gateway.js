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
  'google/gemma-2-9b-it:free': 'google/gemma-2-2b-it:free'
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
      '/health'
    ]
  });
});

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
