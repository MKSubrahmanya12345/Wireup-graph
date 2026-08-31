# Hosting Wireup

Wireup ships as **one container that serves both the React app and the API on a
single port (same-origin)** — no CORS, no separate frontend deploy. The build
engine (the "terminal" that compiles firmware and builds/boots the MERN app)
runs **on the server**; users only need a browser.

## What runs where

| Thing | Where | Required in the image |
| --- | --- | --- |
| Frontend (Vite static build) | served by Express at `/` | built into `backend/public` |
| API + agentic pipeline | Express on `$PORT` | Node |
| Firmware syntax gate (`g++ -fsyntax-only`) | server | **g++** (installed in the image) |
| MERN `npm install` / `tsc` / `vite build` / boot smoke | server | Node + network to npm |
| Real ESP32 compile (PlatformIO/arduino-cli) | server | optional, auto-skips |
| Wokwi firmware simulation | server | optional (`wokwi-cli` + token), auto-skips |

Host it as a **long-running service**, not serverless — a build streams for
minutes. Recommended: **Fly.io** (no aggressive request timeout) or **Render
(Docker web service)**. The repo includes `fly.toml`, `render.yaml`, and a
multi-stage `Dockerfile`.

## Deploy on Fly.io

```bash
fly launch --no-deploy          # pick a name/region; it detects the Dockerfile
fly secrets set JWT_SECRET="$(openssl rand -hex 32)"
fly secrets set MONGO_URI="mongodb+srv://..."   # optional but recommended
fly secrets set GROQ_API_KEY="..."              # optional (LLM draft/repair/revision)
fly deploy
fly status                       # health check is /api/healthz
```

The Docker build runs `npm run build` for the frontend and `tsc` for the
backend; the runtime image includes `g++`. Set the service to at least ~1 GB.

## Deploy on Render

1. New → **Blueprint**, select this repo (reads `render.yaml`), **or**
   New → **Web Service** → Runtime **Docker** → Dockerfile `./Dockerfile`.
2. Health check path: `/api/healthz`.
3. Add env vars (below). Use a **paid** instance — free tier sleeps and caps
   long streaming requests mid-build.

## Environment variables

| Var | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `PORT` | *(host injects)* | defaults to 5000 locally |
| `JWT_SECRET` | `openssl rand -hex 32` | **required** in prod (signs sessions) |
| `MONGO_URI` | MongoDB Atlas SRV URI | without it, accounts/projects use a local file that resets on redeploy |
| `GROQ_API_KEY` | Groq key | optional — enables LLM first-draft, diagnostics repair, multi-turn revision |
| `CORS_ORIGIN` | public URL | only needed if you host the frontend separately |
| `AGENTIC_TERMINAL_VALIDATION` | `1` | firmware + MERN gates |
| `AGENTIC_SMOKE_TEST` | `1` | boot the generated MERN app in the build; set `0` for faster builds |
| `AGENTIC_EMBEDDED_COMPILE` | `0` | set `1` only if PlatformIO/arduino-cli is installed |
| `AGENTIC_WOKWI` | `0` | set `1` only if wokwi-cli + `WOKWI_CLI_TOKEN` are present |

The deterministic core works with **no API keys at all** — guests get full
builds; the LLM only raises the ceiling for parts outside the knowledge base.

## Verify the deployment (each component)

1. Open the public URL → the Wireup UI loads.
2. `GET /api/healthz` → `{"status":"ok",...}`.
3. `GET /api/healthz/toolchain` → `gpp` has a version, `node`/`npm` present
   (`platformio`/`arduinoCli`/`wokwiCli` are null unless installed — expected).
4. Click **Skip — try as guest** → reaches the pipeline (no signup).
5. Run the reference prompt and watch the streamed log:
   *"a dht22 sensor i have and esp32, then i want codes and a website to access
   this on my local computer"* → firmware `g++` ✔ → MERN install/tsc/vite/boot ✔
   → contract ✔ → two zips download.
6. Hard refresh on `/build` (or any deep link) still loads the SPA (same-origin
   fallback), not a 404.

## Users, the "bypass", and mobile

- **Bypass / no signup:** users click **Skip — try as guest**. That calls
  `POST /api/auth/guest` and returns a signed 7-day session; builds and
  downloads work immediately. Saved/cross-device projects need an account +
  `MONGO_URI`.
- **The terminal is the server's.** What users watch on the build page is an
  NDJSON log streamed from the container — it renders fine in a phone browser
  (iOS/Android). They never install a compiler or run a command to *use*
  Wireup.
- **The generated artifacts:**
  - The **firmware zip** is flashed to an ESP32. First flash needs a computer
    over USB (Arduino IDE / PlatformIO); after that, OTA updates work over
    Wi-Fi. Once flashed, **the device serves its own dashboard** at
    `http://<device-ip>/` — a **phone on the same Wi-Fi** opens it directly
    (live tiles, chart, Wi-Fi settings), no laptop or cloud.
  - The **software zip** (optional MERN history dashboard) runs on a computer
    or small server; it is not required to view the device.
- So a mobile-only tester can generate builds and use a flashed board's
  on-device dashboard; only the first USB flash needs a computer.

## Rate limiting / abuse

The build/plan endpoints are rate-limited per IP (`PLAN_RATE_LIMIT_MAX`,
default 10/min) and sit behind `requireAuth` (guest tokens count). With
`trust proxy` enabled, the platform router's real client IP is used. Raise the
limit or put the service behind your own auth if you open it widely.
