# Tempass

Tempass is a private watch-party web application for two people. One creates a room, shares an
invitation link, and both participants meet in the same room with synchronized playback and chat.

Two playback modes:

- **YouTube mode** — paste a link, and the embedded player is driven by the room. Both
  participants have equal controls, and clock-synchronised drift correction keeps them aligned.
- **Companion mode** — for sites that refuse framing (`X-Frame-Options: DENY`,
  `frame-ancestors 'none'`). The presenter runs the companion script in the tab that is
  actually playing the video; it reports the media state to the room and applies play / pause /
  seek commands for everyone. Nothing is proxied or re-hosted.

Plus one general-purpose mode:

- **Live tab** — the presenter picks any browser tab and the other participant watches it
  live, one way, with no remote control. Nothing is re-hosted; the picture is a peer-to-peer
  tab capture, so it works for pages that are not video at all (documents, dashboards, games).
  Desktop Chrome or Edge only, because `getDisplayMedia` tab capture is unavailable on mobile.

The current stage implements **rooms, optional passwords, sessions, live participant presence,
real-time chat, synchronized YouTube playback, the source-site companion bridge, and one-way
live tab sharing**.

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
5. Both windows should show both participants as online. Send a chat message from either window
   and confirm it appears in both, sender name included.
6. Closing or reloading one window marks that participant as reconnecting for up to 30 seconds;
   **Leave room** removes them.

Invitation links point at the configured `WEB_ORIGIN`, which defaults to `localhost`. Set it to the
deployed frontend origin when testing a hosted build.

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

## Test deployment

The repository is prepared for a Vercel frontend and one Render backend instance. The backend is
in-memory and must not be scaled beyond one instance. See [DEPLOYMENT.md](DEPLOYMENT.md) for the
Render/Vercel environment variables, deployment order, CORS checks, and free-tier limitations.

Production startup requires HTTPS, non-localhost `CORS_ORIGIN` and `WEB_ORIGIN` values. The
frontend reads `VITE_API_URL` at build time; leave it unset for local development.

## Workspace layout

```text
apps/
  server/   Express + Socket.IO API (rooms, sessions, presence, chat, cleanup)
  web/      React + Vite + Tailwind client (create, join, room, and chat UI)
packages/
  shared/   Zod contracts, socket event types, and shared constants
```

## Environment

Server configuration lives in `apps/server/.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `HOST` | `127.0.0.1` locally, `0.0.0.0` in production | Interface the API binds to |
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Exact allowed browser origin for API and Socket.IO |
| `WEB_ORIGIN` | `http://localhost:5173` | Base URL used to build invitation links |
| `MAX_PARTICIPANTS` | `2` | Room capacity (1–10) |
| `RECONNECT_GRACE_MS` | `30000` | How long a disconnected participant can reconnect |
| `EMPTY_ROOM_TTL_MS` | `300000` | How long an empty room is kept before deletion |
| `ROOM_MAX_AGE_MS` | `43200000` | Absolute room lifetime (12 hours) |
| `CLEANUP_INTERVAL_MS` | `30000` | Expiry sweep interval |

The web client reads `VITE_API_URL` at build time (see `apps/web/.env.example`). Leave it empty
locally so the Vite proxy is used; set it to the public backend origin for a deployed build.

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

### Chat

- Clients emit `chat:message` with `{ text }` and receive an acknowledgement:
  `{ ok: true, message }` or `{ ok: false, code }`.
- The server derives the room, participant ID, display name, message ID, and timestamp from
  authenticated socket state. Client-supplied sender, room, or timestamp fields are rejected by the
  strict payload schema.
- Message text is trimmed, must contain 1–500 characters, and rejects binary control characters.
  Newlines and tabs are allowed. Rejected messages are acknowledged and never broadcast.
- Accepted messages are broadcast only with `io.to(roomId)`, so they never leave the room. The
  sender receives the same canonical message object as the other participant.
- Each room keeps its most recent 100 messages in memory. History is included in the
  `room:snapshot` sent after joining or reconnecting. Histories are per-room and are discarded with
  the room.
- A lightweight per-socket limit allows 10 accepted messages per 10 seconds. Rejected sends return
  `RATE_LIMITED`. Malformed sends do not consume the allowance.
- The web client prevents repeated submits while a send is pending, trims the draft, and only clears
  it after the server accepts the message. Shift+Enter inserts a newline; Enter sends.

### Live tab sharing

- A participant clicks **Share this tab** in the room, picks one tab in the browser's own
  picker, and the other participant watches it. It is view-only: no clicks, scrolls, or seeks
  are relayed, and the presenter's tab is the only thing captured.
- The server only records *who is presenting* (`share:start` / `share:stop`, broadcast as
  `share:state`). Media travels peer-to-peer over WebRTC; the server never sees it.
- Only one participant can present at a time. A second `share:start` is refused with
  `SHARE_BUSY`, and a viewer cannot stop someone else's share.
- The presenter's capture survives switching to other tabs and in-app navigation. Reloading or
  closing the room tab ends it, as does Chrome's own "Stop sharing" bar.
- When the other participant disconnects, the capture stays alive but no frames are encoded;
  sharing resumes automatically when they reconnect.
- Audio is optional and comes from the shared tab only. If the presenter does not tick
  **Share tab audio**, the room shows a warning instead of silently sending a silent stream.

## Security notes

- API request bodies and socket payloads are validated with strict Zod schemas.
- Display names are trimmed, limited to 24 characters, and reject control characters.
- Chat messages are stored and rendered as plain text only. The UI does not parse HTML or markdown.
- Passwords are 4–64 characters and compared with scrypt.
- Passwords, session tokens, chat contents, and internal password hashes are never logged.
- Join rate limiting is not implemented yet, and per-socket chat limits are only a basic abuse
  control. Do not expose this development server directly to the public internet.

## Scope and limitations

- YouTube only. Video selection and the official IFrame Player API integration come later.
- Videos that disallow embedding, require sign-in, or are region-restricted cannot be watched.
- Live tab sharing needs desktop Chrome or Edge; mobile browsers cannot capture a tab.
- Live tab sharing is view-only. Co-browsing (letting the other person click) would need a
  browser extension and is not implemented.
- Only one tab is shared at a time, and the viewer does not follow the presenter to other tabs.
- Signalling uses a public STUN server only. Without TURN, a share may fail to connect on
  restrictive networks.
- Some source sites ship a Content-Security-Policy that only allows `https:` scripts and
  connections. A deployed (https) Tempass works, but pointing the companion at a local
  `http://localhost` API from such a site is blocked by the browser. Use an https tunnel or a
  site without a strict policy when testing the companion against one of those.
- Tempass must not bypass DRM, advertisements, authentication, or access restrictions.
- Room state and chat history are in memory on a single server. Restarting the server erases rooms,
  sessions, and all messages.
- Chat has no attachments, images, reactions, read receipts, typing indicators, private messages,
  editing, or deletion.
- There is no server-side idempotency key or duplicate-message merge; the client prevents repeated
  submits while a send is pending. Message IDs are unique per accepted message.
- A video queue and reconnection resync of playback are not implemented yet. implemented
  yet.
- Both participants will eventually have equal playback controls. No host-only model.
