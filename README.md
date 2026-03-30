# Voice Report

A voice-first reporting application for construction and industrial workers. Workers record voice reports that are transcribed (OpenAI Whisper) and structured into standardized daily reports using AI (Anthropic Claude).

## Features

- **Voice Input** - Record reports via voice; automatic transcription and AI-powered structuring
- **Trade-Specific Templates** - Electrical, Instrumentation, Pipe Fitting, Industrial Erection, Safety
- **Structured Reports** - Work completed, equipment issues, safety observations, quality notes, plans
- **Safety Hub** - Built-in safety rules, vocabulary, and observation tracking
- **Job Safety Analysis (JSA)** - Detailed JSA/JHA creation and management
- **People Management** - Track workers with roles, trades, and skill levels
- **Dynamic Forms** - Create and submit custom forms
- **Daily Plans & Tasks** - Planning and task management
- **Punch List** - Work tracking and completion status
- **Messaging** - Internal messaging with audio and photo support
- **Internationalization** - Multi-language support via i18next
- **WebAuthn** - Passwordless authentication

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8 |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL (primary), SQLite (fallback) |
| AI | OpenAI (Whisper, TTS), Anthropic Claude |
| Process Manager | PM2 |
| Testing | Jest, Supertest |

## Prerequisites

- Node.js
- PostgreSQL (or SQLite for local development)
- OpenAI API key
- Anthropic API key

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd voice-report
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and database credentials
   ```

4. Set up the database:
   - **PostgreSQL**: Run the schema in `database/postgres-schema.sql`
   - **SQLite**: The database file will be created automatically

5. Build the frontend:
   ```bash
   npm run build
   ```

## Running

### Development

```bash
npm run dev          # Start both server and Vite dev server
npm run dev:server   # Server only (port 3000)
npm run dev:client   # Vite dev server only (port 5173)
```

### Production

```bash
npm start            # Start the server (port 3000)
```

Or with PM2:
```bash
pm2 start ecosystem.config.cjs
```

### Cloudflare Tunnel (expose to internet)

The app uses a Cloudflare Tunnel to serve traffic through `www.voice-report.ai` and `api.voice-report.ai`.

1. Install `cloudflared` if not already installed.

2. The tunnel config is at `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: www.voice-report.ai
       service: http://localhost:5173
     - hostname: api.voice-report.ai
       service: http://localhost:3070
     - service: http_status:404
   ```

3. Start the tunnel alongside the dev server:
   ```bash
   npm run dev                    # Start Vite (5173) + API server (3070)
   cloudflared tunnel run voice-report  # Expose via Cloudflare
   ```

   Both commands must be running for `www.voice-report.ai` to work.

### Testing

```bash
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
```

## Project Structure

```
voice-report/
├── client/              # React frontend (Vite)
│   └── src/
│       ├── views/       # Page-level components
│       ├── components/  # Reusable UI components
│       ├── hooks/       # Custom React hooks
│       └── utils/       # Utilities
├── server/              # Express backend
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic (AI, forms)
│   ├── middleware/       # Express middleware
│   ├── auth/            # Authentication
│   ├── config/          # Server configuration
│   └── lib/             # Utility libraries
├── database/            # Schemas and migrations
├── templates/           # Report templates
├── tests/               # Test files
├── docs/                # Documentation
├── ecosystem.config.cjs # PM2 configuration
├── vite.config.js       # Vite configuration
└── jest.config.js       # Jest configuration
```

## Environment Variables

See `.env.example` for required variables:
- `OPENAI_API_KEY` - OpenAI API key (Whisper transcription, TTS)
- `ANTHROPIC_API_KEY` - Anthropic API key (Claude report structuring)
- `ADMIN_PIN` - Admin access PIN
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` - PostgreSQL connection (optional)
