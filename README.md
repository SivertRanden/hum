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

| Variable        | Default                  | Description                        |
| --------------- | ------------------------ | ---------------------------------- |
| `PORT`          | `3001`                   | Port the API server listens on     |
| `CLIENT_ORIGIN` | `http://localhost:5173`  | Allowed CORS origin for the client |

Set variables in your shell or create a `.env` file in `packages/server/` before running.

## Building for production

```bash
pnpm build
```

This compiles the server TypeScript to `packages/server/dist/` and bundles the client to `packages/client/dist/`.

To run the compiled server:

```bash
pnpm --filter @hum/server start
```

## Project structure

```
hum/
├── packages/
│   ├── client/   # React + Vite + Tailwind frontend
│   └── server/   # Express + SQLite + WebSocket API
├── package.json          # Workspace root scripts
└── pnpm-workspace.yaml
```

## Linting

```bash
pnpm lint
```
