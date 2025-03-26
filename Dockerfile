FROM node:18-alpine

WORKDIR /app

# Kopiowanie plików konfiguracyjnych
COPY package*.json ./

# Instalacja zależności
RUN npm ci --only=production

# Kopiowanie kodu źródłowego
COPY . .

# Odsłonięcie portu
EXPOSE 8787

# Uruchomienie aplikacji
CMD ["node", "openai-gateway.js"] 