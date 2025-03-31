// OpenAI-OpenRouter Gateway
// Gateway emulujący API OpenAI z przekierowaniem do darmowych modeli OpenRouter

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

// Załadowanie zmiennych środowiskowych
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '1000', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600000', 10);

// Konfiguracja middleware
app.use(cors());
app.use(bodyParser.json());

// Mapowanie modeli OpenAI na modele OpenRouter
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'gpt-3.5-turbo-16k': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'gpt-4': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'gpt-4-turbo': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'gpt-4o': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'text-embedding-ada-002': 'mistralai/mistral-embed:free',
  
  // Model z obsługą obrazów
  'gpt-4-vision-preview': 'qwen/qwen2.5-vl-32b-instruct:free',
  'gpt-4-vision': 'qwen/qwen2.5-vl-32b-instruct:free',
  
  // Domyślny fallback
  'default': 'mistralai/mistral-small-3.1-24b-instruct:free'
};

// Mapowanie fallbacków dla modeli (gdy główny model jest niedostępny)
const FALLBACK_MAPPING = {
  'qwen/qwen2.5-vl-32b-instruct:free': 'mistralai/mistral-small-3.1-24b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free': 'mistralai/mistral-small-2501:free'
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
    
    // Mapowanie modelu OpenAI na model OpenRouter
    const model = MODEL_MAPPING[requestedModel] || MODEL_MAPPING.default;
    
    // Sprawdzenie czy odpowiedź jest w cache'u
    const cacheKey = generateCacheKey(model, messages, otherOptions);
    if (responseCache.has(cacheKey) && !stream) {
      console.log('Cache hit - returning cached response');
      return res.json(responseCache.get(cacheKey));
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
