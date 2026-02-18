# Emulator API OpenAI z użyciem darmowych modeli

Ten projekt to gateway (proxy), który emuluje interfejs API OpenAI, przekierowując zapytania do darmowych modeli dostępnych przez OpenRouter oraz Google Gemini API.

## Funkcje

- 🔄 Pełna emulacja API OpenAI (drop-in replacement)
- 🆓 Wykorzystanie darmowych modeli z OpenRouter i Google Gemini
- 🗺️ Automatyczne mapowanie modeli GPT na darmowe alternatywy
- 🚀 Wsparcie dla emulacji GPT-5 i najnowszych modeli
- 🔄 Automatyczny retry w przypadku błędów
- 🔀 Fallback do alternatywnych modeli w przypadku awarii
- 💾 Cachowanie odpowiedzi dla oszczędności czasu i zasobów
- 🖼️ Obsługa modeli multimodalnych (tekst + obrazy)
- 🤖 Wsparcie dla wielu providerów (OpenRouter, Google Gemini)
- 🎛️ Panel konfiguracyjny z interfejsem webowym

## Dostępne modele

### Modele z OpenRouter (darmowe)

#### DeepSeek (najnowsze, wydajne)
- **deepseek-r1-0528** - 164K context, świetny dla reasoning i dialogu

#### Qwen (multimodalne, kodowanie)
- **qwen3-235b** - 262K context, zaawansowane reasoning
- **qwen3-next-80b** - 262K context, szybki i wszechstronny
- **qwen3-coder** - specjalizowany w kodowaniu
- **qwen3-vl-235b-thinking** - model wizyjny z thinking
- **qwen3-vl-30b-thinking** - model wizyjny, lżejszy

#### Mistral AI
- **mistral-small-3.1-24b** - 128K context, vision, narzędzia
- **mistral-small-2501** - nowa wersja, fallback
- **mistral-embed** - embeddings

#### Meta Llama
- **llama-3.3-70b** - duży model, wysokiej jakości
- **llama-3.2-3b** - szybki, lekki model

#### Google Gemma
- **gemma-2-9b** - open source, uniwersalny
- **gemma-2-2b** - najmniejszy, najszybszy

#### OpenCode (nowe modele)
- **opencode-big-pickle** - model opencode Big Pickle
- **opencode-glm-5** - model opencode GLM-5
- **opencode-gpt-5-nano** - model opencode GPT-5 Nano
- **opencode-kimi-k2.5** - model opencode Kimi K2.5
- **opencode-minimax-m2.5** - model opencode Minimax M2.5

### Modele Google Gemini (bezpośrednie API)

- **gemini-3-flash** - najnowszy, ultraszybki
- **gemini-3-pro** - najlepszy reasoning i analiza
- **gemini-2.0-flash** - do 1M tokenów context
- **gemini-1.5-flash** - szybki, 128K context
- **gemini-1.5-pro** - zaawansowany, 1M context

## Mapowanie modeli

| Model OpenAI | Model docelowy | Provider |
|--------------|----------------|----------|
| gpt-3.5-turbo | DeepSeek R1 | OpenRouter |
| gpt-4 | DeepSeek R1 | OpenRouter |
| gpt-4o | Qwen3 235B | OpenRouter |
| gpt-4o-mini | Qwen3 Next 80B | OpenRouter |
| **gpt-5** | **Qwen3 235B** | **OpenRouter** |
| **gpt-5-turbo** | **Qwen3 Next 80B** | **OpenRouter** |
| **gpt-5-nano** | **OpenCode GPT-5 Nano** | **OpenRouter** |
| **gpt-5-preview** | **Qwen3 235B** | **OpenRouter** |
| gpt-4-vision | Qwen3 VL 235B | OpenRouter |
| gpt-4-code | Qwen3 Coder | OpenRouter |
| opencode-big-pickle | OpenCode Big Pickle | OpenRouter |
| opencode-glm-5 | OpenCode GLM-5 | OpenRouter |
| opencode-gpt-5-nano | OpenCode GPT-5 Nano | OpenRouter |
| opencode-kimi-k2.5 | OpenCode Kimi K2.5 | OpenRouter |
| opencode-minimax-m2.5 | OpenCode Minimax M2.5 | OpenRouter |
| gemini-3-flash | Gemini 3 Flash | Google Gemini |
| gemini-1.5-pro | Gemini 1.5 Pro | Google Gemini |
| text-embedding-ada-002 | Mistral Embed | OpenRouter |


## Wymagania

- Node.js 14+
- npm lub yarn
- Klucz API OpenRouter (opcjonalny, jeśli używasz Gemini)
- Klucz API Google Gemini (opcjonalny, jeśli używasz OpenRouter)

**Uwaga:** Wymagany jest przynajmniej jeden klucz API (OpenRouter lub Gemini).

## Uzyskanie kluczy API

### OpenRouter API Key (darmowy)
1. Zarejestruj się na [https://openrouter.ai](https://openrouter.ai)
2. Przejdź do ustawień konta
3. Wygeneruj nowy klucz API
4. Darmowe modele mają limity: ~20 req/min, ~200 req/dzień

### Google Gemini API Key (darmowy)
1. Odwiedź [https://aistudio.google.com](https://aistudio.google.com)
2. Zaloguj się kontem Google
3. Kliknij "Get API Key" lub "Create API key"
4. Skopiuj i bezpiecznie zapisz klucz
5. Darmowy tier: ~15 req/min (Flash), ~2-5 req/min (Pro)

## Instalacja

```bash
# Klonowanie repozytorium
git clone <repo-url>
cd openai-gateway

# Instalacja zależności
npm install

# Konfiguracja zmiennych środowiskowych
cp .env.example .env
# Edytuj plik .env z twoimi ustawieniami
```

## Uruchomienie

```bash
# Standardowe uruchomienie
npm start

# Tryb deweloperski z automatycznym restartem
npm run dev
```

Gateway będzie dostępny pod adresem `http://localhost:8787`.

## Panel Konfiguracyjny

Gateway posiada wbudowany panel konfiguracyjny dostępny pod adresem `http://localhost:8787/admin`.

### Funkcje panelu:
- 📊 **Dashboard** - Status systemu, providery API, statystyki
- 🤖 **Modele** - Przeglądanie i dodawanie mapowań modeli
- 🔄 **Fallbacki** - Lista łańcuchów fallbacków
- ⚙️ **Konfiguracja** - Pełny widok konfiguracji JSON
- 📡 **API Docs** - Dokumentacja endpointów i przykłady użycia

### Zarządzanie modelami przez API:

```bash
# Dodanie nowego mapowania modelu
curl -X POST "http://localhost:8787/config/models" \
  -H "Content-Type: application/json" \
  -d '{
    "openaiModel": "gpt-5-custom",
    "targetModel": "qwen/qwen3-235b-a22b:free",
    "provider": "openrouter"
  }'

# Pobranie aktualnej konfiguracji
curl "http://localhost:8787/config"

# Wyczyszczenie cache
curl -X POST "http://localhost:8787/config/clear-cache"
```

**Uwaga:** Zmiany konfiguracji przez panel są tymczasowe (tylko w pamięci). Po restarcie serwera, konfiguracja wraca do wartości domyślnych.

## Użycie

Możesz używać tego gateway dokładnie tak samo jak normalnego API OpenAI. Gateway automatycznie wykrywa i kieruje żądania do odpowiedniego providera.

### Przykład z modelami OpenRouter

```bash
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
        {"role": "user", "content": "Wyjaśnij jak działa AI"}
    ]
  }'
```

### Przykład z modelami Gemini

```bash
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [
        {"role": "user", "content": "Co to jest machine learning?"}
    ]
  }'
```

### Przykład z modelami kodowania

```bash
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4-code",
    "messages": [
        {"role": "user", "content": "Napisz funkcję sortującą w Python"}
    ]
  }'
```

### Przykład z modelami OpenCode

```bash
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode-big-pickle",
    "messages": [
        {"role": "user", "content": "Wyjaśnij koncepcję machine learning"}
    ]
  }'
```

### Przykład z modelami GPT-5 (emulacja)

```bash
# GPT-5 (mapowany na Qwen3 235B)
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "messages": [
        {"role": "user", "content": "Co nowego w AI w 2026?"}
    ]
  }'

# GPT-5 Turbo (mapowany na Qwen3 Next 80B)
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-turbo",
    "messages": [
        {"role": "user", "content": "Szybka odpowiedź na pytanie"}
    ]
  }'

# GPT-5 Nano (mapowany na OpenCode GPT-5 Nano)
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-nano",
    "messages": [
        {"role": "user", "content": "Lekki i szybki model"}
    ]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

# Inicjalizacja klienta z nowym base URL
client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="dowolny-string"  # klucz nie jest sprawdzany
)

# Użycie dokładnie jak z OpenAI
response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[
        {"role": "user", "content": "Twoje pytanie"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: "dowolny-string" // klucz nie jest sprawdzany
});

const response = await client.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [
    { role: "user", content: "Twoje pytanie" }
  ]
});

console.log(response.choices[0].message.content);
```

## Dostępne endpointy

- `/v1/chat/completions` - generowanie odpowiedzi czatu
- `/v1/embeddings` - generowanie embeddingów
- `/v1/models` - lista dostępnych modeli
- `/health` - sprawdzenie statusu serwera
- `/` - informacje o gateway
- `/admin` - panel konfiguracyjny (interfejs webowy)
- `/config` - pobieranie konfiguracji (JSON)
- `/config/models` - zarządzanie mapowaniem modeli (POST)
- `/config/clear-cache` - czyszczenie cache (POST)

## Docker

```bash
# Budowanie obrazu
docker build -t openai-gateway .

# Uruchomienie
docker run -p 8787:8787 --env-file .env openai-gateway
```

Możesz też użyć docker-compose:

```bash
docker-compose up -d
```

## Zmienne środowiskowe

| Zmienna | Opis | Domyślna wartość |
|---------|------|------------------|
| PORT | Port na którym działa serwer | 8787 |
| OPENROUTER_API_KEY | Klucz API do OpenRouter | (opcjonalny*) |
| GEMINI_API_KEY | Klucz API do Google Gemini | (opcjonalny*) |
| CACHE_TTL | Czas życia cache w milisekundach | 3600000 (1h) |
| MAX_RETRIES | Maksymalna liczba ponownych prób | 3 |
| RETRY_DELAY | Opóźnienie między próbami (ms) | 1000 |

*Wymagany przynajmniej jeden z kluczy API (OPENROUTER_API_KEY lub GEMINI_API_KEY)

## Limity i ograniczenia

### OpenRouter
- Darmowe modele mogą być wolniejsze niż oryginalne modele OpenAI
- Limity: ~20 zapytań/minutę, ~200 zapytań/dzień
- Dostępność zależy od OpenRouter

### Google Gemini
- Gemini Flash: ~15 zapytań/minutę
- Gemini Pro: ~2-5 zapytań/minutę
- Streaming nie jest jeszcze wspierany dla modeli Gemini
- Niektóre zaawansowane funkcje OpenAI mogą nie działać

### Ogólne
- Gateway automatycznie wybiera fallback gdy główny model jest niedostępny
- Cache pomaga zaoszczędzić limity dla identycznych zapytań

## Rozwiązywanie problemów

1. **Timeout** - Zwiększ MAX_RETRIES w pliku .env
2. **Błędy modelu** - Sprawdź logi, zweryfikuj poprawność klucza API
3. **Problemy z wydajnością** - Dostosuj ustawienia cache i retry

## Licencja

MIT
