# Emulator API OpenAI z użyciem darmowych modeli

Ten projekt to gateway (proxy), który emuluje interfejs API OpenAI, przekierowując zapytania do darmowych modeli dostępnych przez OpenRouter, głównie Mistral Small.

## Funkcje

- 🔄 Pełna emulacja API OpenAI (drop-in replacement)
- 🆓 Wykorzystanie darmowych modeli OpenRouter
- 🗺️ Automatyczne mapowanie modeli GPT na darmowe alternatywy
- 🔄 Automatyczny retry w przypadku błędów
- 🔀 Fallback do alternatywnych modeli w przypadku awarii
- 💾 Cachowanie odpowiedzi dla oszczędności czasu i zasobów
- 🖼️ Obsługa modeli multimodalnych (tekst + obrazy)

## Mapowanie modeli

| Model OpenAI | Model OpenRouter |
|--------------|------------------|
| gpt-3.5-turbo | mistralai/mistral-small-3.1-24b-instruct:free |
| gpt-4 | mistralai/mistral-small-3.1-24b-instruct:free |
| gpt-4-vision | qwen/qwen2.5-vl-32b-instruct:free |
| text-embedding-ada-002 | mistralai/mistral-embed:free |

## Wymagania

- Node.js 14+
- npm lub yarn

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

## Użycie

Możesz używać tego gateway dokładnie tak samo jak normalnego API OpenAI:

### Curl

```bash
curl -X POST "http://localhost:8787/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
        {"role": "user", "content": "Twoje pytanie"}
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
| OPENROUTER_API_KEY | Klucz API do OpenRouter | (wymagany) |
| CACHE_TTL | Czas życia cache w milisekundach | 3600000 (1h) |
| MAX_RETRIES | Maksymalna liczba ponownych prób | 3 |
| RETRY_DELAY | Opóźnienie między próbami (ms) | 1000 |

## Limity i ograniczenia

- Darmowe modele mogą być wolniejsze niż oryginalne modele OpenAI
- Niektóre zaawansowane funkcje OpenAI mogą nie działać
- Dostępność zależy od usług OpenRouter

## Rozwiązywanie problemów

1. **Timeout** - Zwiększ MAX_RETRIES w pliku .env
2. **Błędy modelu** - Sprawdź logi, zweryfikuj poprawność klucza API
3. **Problemy z wydajnością** - Dostosuj ustawienia cache i retry

## Licencja

MIT
