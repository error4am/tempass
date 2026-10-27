# Tempass

Tempass is a private, YouTube-only watch-party web application for two people. One creates a
room, shares an invitation link, and both participants meet in the same room.

The current stage implements **rooms, optional passwords, sessions, and live participant
presence**. Chat, video selection, and synchronized playback are not implemented yet, and both
participants will eventually have equal playback controls.

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

The Vite dev server proxies `/health`, `/api`, and `/socket.io` (including WebSocket upgrades) to
the API server, so the browser uses a single origin during development.

## Trying the room flow with two participants

1. Open http://localhost:5173 in the first browser window.
2. Enter a display name, optionally set a password, and create the room.
3. Use **Copy invite link** and open that link in a second window or a private/incognito window.
4. Enter a second display name (and the password, if set) to join.
5. Both windows should show both participants as online. Closing or reloading one window marks
   that participant as reconnecting for up to 30 seconds; **Leave room** removes them.

Invitation links point at the configured `WEB_ORIGIN`, which defaults to `localhost`. They work on
this machine only until the app is deployed behind a shared origin.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server and web app together |
| `npm run dev:server` | Start only the API server (`tsx watch`) |
| `npm run dev:web` | Start only the Vite dev server |
| `npm run typecheck` | Type-check every workspace |
| `npm run build` | Type-check, then build the web app |
| `npm test` | Run unit and integration tests with Vitest |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run start:server` | Start the API server without watch mode |

## Workspace layout

```text
apps/
  server/   Express + Socket.IO API (rooms, sessions, presence, cleanup)
  web/      React + Vite + Tailwind client (create, join, and room screens)
packages/
  shared/   Zod contracts, socket event types, and shared constants
```

## Environment

Server configuration lives in `apps/server/.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin for API and Socket.IO |
| `WEB_ORIGIN` | `http://localhost:5173` | Base URL used to build invitation links |
| `MAX_PARTICIPANTS` | `2` | Room capacity (1–10) |
| `RECONNECT_GRACE_MS` | `30000` | How long a disconnected participant can reconnect |
| `EMPTY_ROOM_TTL_MS` | `300000` | How long an empty room is kept before deletion |
| `ROOM_MAX_AGE_MS` | `43200000` | Absolute room lifetime (12 hours) |
| `CLEANUP_INTERVAL_MS` | `30000` | Expiry sweep interval |

No external services or secrets are required. Never commit `.env` files.

## How rooms work

### Creating and joining

- `POST /api/rooms` creates a room and its first participant. It returns the room, the
  participant, a session token, and the invitation URL.
- `GET /api/rooms/:roomId` returns public room metadata (`requiresPassword`, capacity, participant
  count) without exposing participants or the password.
- `POST /api/rooms/:roomId/join` checks capacity and the password, then adds a participant and
  returns a session token.

Passwords are optional. When present they are hashed with scrypt and are never stored in plain
text, placed in invitation links, returned by the API, or broadcast over sockets. Room IDs and
participant IDs are random server-generated identifiers; clients cannot choose or edit them.

### Sessions and reconnects

- The session token is kept in `sessionStorage`, so each tab has its own identity and a full
  browser restart starts over. Tokens are stored server-side only as SHA-256 hashes.
- A token restores the same participant after a reload or short network drop.
- A disconnected participant has 30 seconds to reconnect by default. After that, the participant
  is removed and their token stops working.
- Connecting twice with the same token keeps one membership and evicts the older socket.
- A participant who never connects has the same grace period, so abandoned room-creation or join
  attempts are cleaned up.

### Presence and cleanup

- Socket.IO authenticates with the session token during the handshake. The server sends a
  `room:snapshot`, then broadcasts `presence:update` whenever someone joins, leaves, connects, or
  disconnects.
- `room:leave` removes only the caller’s own membership, even if extra identifiers are supplied.
- The server sweeps expired sessions, empty rooms, and rooms older than 12 hours. Deleted rooms
  disconnect any remaining sockets.

## Security notes

- API request bodies and socket payloads are validated with strict Zod schemas.
- Display names are trimmed, limited to 24 characters, and reject control characters.
- Passwords are 4–64 characters and compared with scrypt.
- Passwords, session tokens, and internal password hashes are never logged.
- Join rate limiting is not implemented yet; do not expose this development server directly to the
  public internet.

## Scope and limitations

- YouTube only. Video selection and the official IFrame Player API integration come later.
- Videos that disallow embedding, require sign-in, or are region-restricted cannot be watched.
- Tempass must not bypass DRM, advertisements, authentication, or access restrictions.
- Room state is in memory on a single server. Restarting the server erases rooms and sessions.
- Chat, a video queue, playback synchronization, and reconnection resync of playback are not
  implemented yet.
- Both participants will eventually have equal playback controls. No host-only model.
