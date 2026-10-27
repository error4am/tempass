# Test deployment

This repository is prepared for a **single-instance test deployment**:

- Frontend: Vercel, static Vite build at `apps/web/dist`
- Backend: Render, one Node web service running Express + Socket.IO
- State: in memory only, with no database or Redis

This is not a production-ready architecture. The backend must stay at exactly one instance because
rooms, sessions, and chat history live in that process. Do not enable autoscaling or multiple
instances.

## Prerequisites

- Node.js 24 or newer
- A private GitHub repository containing this project
- Free Vercel and Render accounts
- No paid add-ons or external database are required

## Environment values

The frontend and backend have a circular dependency on each other's URLs. Create the projects in
the order below and expect one frontend redeployment after the backend URL is known.

### Vercel

| Variable | Scope | Value |
| --- | --- | --- |
| `VITE_API_URL` | Production build | Public Render service origin, for example `https://tempass-server.onrender.com` |

`VITE_API_URL` is embedded into the static build, so changing it requires a new deployment. Leave it
unset for local development; Vite then proxies requests to the local backend.

### Render

`render.yaml` sets the non-secret values. Render prompts for the two marked `sync: false` values:

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` (from blueprint) |
| `HOST` | `0.0.0.0` (from blueprint) |
| `PORT` | Supplied automatically by Render |
| `CORS_ORIGIN` | Exact Vercel production origin, for example `https://tempass.vercel.app` |
| `WEB_ORIGIN` | The same Vercel production origin, used for invitation links |

Production startup rejects HTTP origins, localhost origins, and missing values. Use the actual
`https://` Vercel production domain with no trailing slash. Do not use `*`.

Vercel preview deployments have different origins. They only work if `CORS_ORIGIN` and `WEB_ORIGIN`
are pointed at that preview origin and the backend is redeployed. Prefer testing the production
domain.

## Deployment order

### 1. Push the repository

Create a private GitHub repository and push `main`. Keep the repository root as the project root;
the app is an npm workspace and the shared package lives outside `apps/web`.

### 2. Create the Vercel project

1. Import the private repository into Vercel.
2. Set **Root Directory** to the repository root, not `apps/web`.
3. Use the **Other** framework preset. The committed `vercel.json` supplies:
   - install: `npm ci`
   - build: `npm run build`
   - output: `apps/web/dist`
   - SPA rewrites for `/join/*` and `/room/*`
4. Add `VITE_API_URL` under Production with the expected Render URL.
5. Deploy. The first build can point at a placeholder backend URL; it will be corrected after the
   backend exists.

### 3. Create the Render service

1. In Render, create a new **Blueprint** from the same repository. Render reads `render.yaml`.
2. Confirm the free plan, one instance, health check `/health`, build command `npm ci --omit=dev`,
   and start command `npm run start:server`.
3. Enter `CORS_ORIGIN` and `WEB_ORIGIN` using the actual Vercel production origin.
4. Deploy and wait until the health check passes.
5. Copy the public Render service origin.

The start script uses `tsx` as a runtime dependency, not a development-only dependency. The server
binds to `0.0.0.0` and listens on Render's `PORT`.

### 4. Connect the frontend to the backend

1. Update the Vercel Production `VITE_API_URL` to the Render origin.
2. Redeploy the Vercel project so the new value is compiled into the frontend.
3. If the Vercel production domain later changes, update both Render origins and redeploy all three
   services.

## Verification

Check the API:

```bash
curl -fsS https://<render-service>.onrender.com/health
```

Check CORS for the exact frontend origin:

```bash
curl -i -X OPTIONS https://<render-service>.onrender.com/api/rooms \
  -H 'Origin: https://<vercel-project>.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Confirm the response contains `Access-Control-Allow-Origin` with the Vercel origin, not `*`.

Then verify in two browser windows:

1. Create a room with an optional password.
2. Open the invitation link in a second browser profile.
3. Confirm both participants show the correct presence.
4. Send chat messages both ways and confirm sender names and ordering.
5. Reload one window and confirm the session reconnects and restores chat history.
6. Open a third room and confirm messages do not cross rooms.
7. Try an invalid password and an over-capacity join.

## Free-tier limitations

- A free Render web service spins down after a period of inactivity. Cold starts can take longer
  than the 30-second reconnect grace period.
- Spinning down, redeploying, or crashing the backend erases every room, session, and message.
- The test plan has limited CPU and memory and is not suitable for real usage.
- Socket.IO connections drop whenever the service stops.
- Vercel static hosting is fine for the frontend, but preview URLs are separate origins and are not
  automatically allowed by CORS.
- There is no persistent storage, backup, or recovery. Do not add horizontal scaling without moving
  room state to shared storage and adding a Socket.IO adapter.

## Security notes

- No secrets belong in this repository. Configure values only in Vercel and Render.
- The API intentionally allows one exact frontend origin. Never replace it with `*` in production.
- HTTPS is required in production, and localhost origins are rejected.
- This deployment is for testing only; join rate limiting and persistent abuse controls are still
  missing.
- YouTube playback is not part of this deployment yet.
