# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies + better-sqlite3 build tools
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

# Copy built client and server
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY database ./database
COPY templates ./templates
COPY knowledge ./knowledge
COPY forms ./forms

# Create directories for uploads and runtime data
RUN mkdir -p audio photos message-photos message-audio certs .challenges

EXPOSE 3070 3513

CMD ["node", "server/index.js"]
