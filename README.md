# Hum

Voice-first communication — stripped back to what matters.

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9 — install with `npm install -g pnpm@9`

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run in development mode

Start the server and client together with a single command:

```bash
pnpm dev
```

- **Client** — http://localhost:5173
- **Server** — http://localhost:3001

The server watches for file changes via `tsx watch`. The client hot-reloads via Vite.

### 3. Run server and client separately (optional)

```bash
# terminal 1
pnpm --filter @hum/server dev

# terminal 2
pnpm --filter @hum/client dev
```

## Environment variables

Both packages work out of the box with no configuration. If you need to override defaults:

| Variable             | Default                  | Description                                                                      |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `PORT`               | `3001`                   | Port the API server listens on                                                   |
| `CLIENT_ORIGIN`      | `http://localhost:5173`  | Allowed CORS origin for the client                                               |
| `DATABASE_URL`       | _(unset — uses SQLite)_  | PostgreSQL connection string (opt-in). Use the **pooler URL** for Neon.          |
| `DATABASE_POOL_SIZE` | `10`                     | Max PostgreSQL connections in the pool. Ignored when using SQLite.               |
| `DB_PATH`            | `hum.db` (repo root)     | SQLite file path (ignored when PG in use)                                        |

Set variables in your shell or create a `.env` file in `packages/server/` before running.

### Database: SQLite (default) vs PostgreSQL (opt-in)

Hum uses **SQLite by default** — no extra services required. The database file is created automatically on first run.

To switch to **PostgreSQL**, set `DATABASE_URL` before starting the server:

```bash
export DATABASE_URL=postgres://hum:hum@localhost:5432/hum
pnpm dev
```

The server detects the URL prefix at startup and selects the correct Drizzle adapter automatically. Migrations are applied on first boot for both drivers.

## Building for production

```bash
pnpm build
```

This compiles the server TypeScript to `packages/server/dist/` and bundles the client to `packages/client/dist/`.

To run the compiled server:

```bash
pnpm --filter @hum/server start
```

## Self-hosting

### SQLite (simplest — no extra services)

```bash
cp .env.example .env   # edit JWT_SECRET and CLIENT_ORIGIN
docker compose up -d frontend
```

The backend writes `hum.db` to the `hum_data` volume. No database service needed.

### PostgreSQL (recommended for production)

```bash
cp .env.example .env
# Set DATABASE_URL in .env:
#   DATABASE_URL=postgres://hum:STRONG_PASSWORD@postgres:5432/hum
#   POSTGRES_PASSWORD=STRONG_PASSWORD
docker compose up -d
```

The `postgres` service starts automatically and the backend runs migrations on first boot.

> **Tip:** Generate a secure JWT secret with `openssl rand -base64 32`.

### Cloud hosting with Neon (serverless PostgreSQL)

[Neon](https://neon.tech) is the recommended managed PostgreSQL provider for cloud deployments. It scales to zero, has a generous free tier, and bundles pgBouncer connection pooling out of the box — no extra services needed.

**1. Create a Neon project** at neon.tech and copy the **pooler connection string** (the endpoint URL contains `.pooler.`):

```
postgresql://user:password@ep-xxx.pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**2. Set environment variables** in your deployment:

```bash
DATABASE_URL=postgresql://user:password@ep-xxx.pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DATABASE_POOL_SIZE=10   # pgBouncer manages the server-side pool; keep this ≤ 10
JWT_SECRET=$(openssl rand -base64 32)
CLIENT_ORIGIN=https://your-frontend-domain.com
```

**3. Deploy with Docker** (no postgres service needed — Neon is external):

```bash
docker compose up -d frontend
```

The backend connects to Neon on startup and applies any pending migrations automatically. The `postgres` service in `docker-compose.yml` is only used for self-hosted deployments; when `DATABASE_URL` points to an external host, you can skip starting it.

## Project structure

```
hum/
├── packages/
│   ├── client/   # React + Vite + Tailwind frontend
│   └── server/   # Express + Drizzle ORM + WebSocket API
│       ├── drizzle/      # SQLite migrations
│       └── drizzle.pg/   # PostgreSQL migrations
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

## Linting

```bash
pnpm lint
```
