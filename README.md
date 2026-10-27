# Tempass

Tempass is a private, YouTube-only watch-party web application for two people. One creates a
room, shares an invitation link, and both participants watch the same embeddable YouTube video
with synchronized playback and real-time chat.

This repository currently contains the **project skeleton only**. Rooms, authentication, chat,
presence, and playback synchronization are not implemented yet.

## Requirements

- Node.js 24 or newer (verified with 24.19.0)
- npm 11 or newer (verified with 11.17.0)

## Getting started

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run dev
```

- Web app: http://localhost:5173
- API server: http://localhost:3001
- Health check: http://localhost:3001/health

The Vite dev server proxies `/health`, `/api`, and `/socket.io` to the API server, so the browser
uses a single origin during development.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server and web app together |
| `npm run dev:server` | Start only the API server (`tsx watch`) |
| `npm run dev:web` | Start only the Vite dev server |
| `npm run typecheck` | Type-check every workspace |
| `npm run build` | Type-check, then build the web app |
| `npm test` | Run unit and smoke tests with Vitest |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run start:server` | Start the API server without watch mode |

## Workspace layout

```text
apps/
  server/   Express + TypeScript API (health endpoint, configuration, errors)
  web/      React + Vite + Tailwind client (landing page shell)
packages/
  shared/   Zod contracts and shared types
```

## Environment

Server configuration lives in `apps/server/.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |

No secrets are required for the skeleton. Never commit `.env` files.

## Scope and limitations

- YouTube only, using the official IFrame Player API when playback is implemented.
- Videos that disallow embedding, require sign-in, or are region-restricted cannot be watched.
- Tempass must not bypass DRM, advertisements, authentication, or access restrictions.
- Room state will be in memory at first; restarting the server will erase active rooms.
- Both participants will eventually have equal playback controls. No host-only model.
