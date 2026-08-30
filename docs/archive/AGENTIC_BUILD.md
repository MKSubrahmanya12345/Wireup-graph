# Agentic Build — Firmware + Website Generation

This adds an **Agentic Build** stage to Wireup that turns an accepted hardware
architecture into:

1. **Firmware** (the hardware part) — real embedded source for the device.
2. A **Website Requirements** section — exactly what a web app needs to connect
   to the hardware over the same Wi-Fi / local network.
3. A **hosting-ready MERN website** assembled on a hardcoded scaffold, with the
   AI wiring only the device-specific files.

The image generator and 3D model generator are left untouched.

---

## How it fits the rules

- **Firmware and website are separate** — the firmware is its own artifact
  (own files, own zip), generated and shown before anything website-related.
- **If the brief implies a website** (any mention — dashboard, remote monitor,
  control from a browser, telemetry UI, etc.) the pipeline still generates the
  **hardware (firmware) first**, then produces the separate **"Website
  Requirements"** section, then builds the website.
- **Website = simple MERN, hosting-ready.** The `frontend/` + `backend/` folder
  structure and all basic plumbing (`vercel.json`, Express app, Vite config,
  env handling, API client, generic data-driven UI) are **hardcoded** in
  `backend/scaffolds/website/` — the AI never writes them.
- **The agentic AI builds on top of it** — it only fills the two device-specific
  files (`frontend/src/lib/deviceSpec.ts` and
  `backend/src/config/deviceEndpoints.ts`) plus env hints and a README section.

---

## Pipeline

```
                    ┌─────────────────────────────────────────────┐
   accepted graph ─▶│  1. Firmware (hardware)                     │
   + brief          │  2. Website Requirements (info to connect)  │
                    │  3. Website build (scaffold + AI wiring)    │
                    └─────────────────────────────────────────────┘
```

Everything runs in that exact order. Firmware always comes first.

---

## Backend

New endpoints (all rate-limited; spend Groq credits except `/scaffold`):

| Method | Path                            | Description                                  |
| ------ | ------------------------------- | -------------------------------------------- |
| GET    | `/api/build/scaffold`           | The hardcoded MERN scaffold (no LLM call)    |
| POST   | `/api/build/firmware`           | Generate firmware source from the graph      |
| POST   | `/api/build/website-requirements`| The "Website Requirements" section           |
| POST   | `/api/build/website`            | Assemble the MERN codebase                   |
| POST   | `/api/build/all`                | Run the whole pipeline in order              |

New files:
- `backend/scaffolds/website/**` — the committed, hardcoded MERN template.
- `backend/src/schemas/build.ts` — zod contracts for firmware / requirements / build.
- `backend/src/services/scaffoldService.ts` — reads the scaffold tree.
- `backend/src/services/firmwareGenerator.ts` — LLM → embedded code.
- `backend/src/services/websiteRequirementsGenerator.ts` — LLM → connection spec.
- `backend/src/services/websiteBuilder.ts` — merges scaffold + AI wiring.
- `backend/src/controllers/buildController.ts` + `backend/src/routes/buildRoutes.ts`.

The website builder merge is deterministic:
- replaces `frontend/src/lib/deviceSpec.ts` and `backend/src/config/deviceEndpoints.ts`
- substitutes `{project-name}` tokens across the tree
- writes derived `DEVICE_IP` / `DEVICE_PORT` / `DEVICE_PROTOCOL` into `backend/.env.example`
- appends the AI README section

## Frontend

- New page **`/build` · "Agentic build"** (`frontend/src/pages/AgenticBuildPage.tsx`)
  with the three-stage UI: firmware files → website requirements → website build.
- `CodeBlock` component (view/copy code), `lib/zip.ts` (JSZip download of the
  full firmware or website codebase).
- Nav item + route added; styles appended to `styles/index.css`.
- `jszip` added to the frontend (`package.json`, `bun.lock`, `pnpm-lock.yaml`).

---

## The hardcoded MERN scaffold (`backend/scaffolds/website/`)

A real, compilable, deployable project:

```
.
├── vercel.json            # frontend static + backend serverless at /api
├── api/index.mjs          # Vercel serverless entry (imports Express app)
├── frontend/              # React 19 + Vite SPA, data-driven from deviceSpec
└── backend/               # Express 5 + optional Mongo, LAN proxy to device
```

The AI only ever edits the two `[AI-GENERATED]` files. Everything else is
plumbing that always compiles.

The scaffold was verified independently: `npm install && npm run typecheck && npm run build` pass.

---

## Verification

- Backend and frontend `typecheck` + `build` are clean.
- The full pipeline was exercised end-to-end against a stubbed Groq server
  (firmware → website requirements → merged MERN tree with token substitution,
  env update, README append, vercel.json present).
- No API keys in the client bundle.

### Pre-existing fixes (unrelated files on `main`)

While wiring the new routes in, the repo's backend didn't compile because of
pre-existing bugs in the validation-loop feature. These are fixed minimally so
the whole project builds:
- `uuid` was imported but never declared — switched to Node's `crypto.randomUUID()`.
- `ApiError.serviceUnavailable` was used but never defined — added it.
- Mongoose `Schema.Types.Mixed` array typing, undefined-index guards, and two
  type casts in the Graph DSA / validation code.
