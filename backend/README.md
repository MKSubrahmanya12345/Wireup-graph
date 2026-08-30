# backend

Wireup API — Express 5 + Mongoose (optional) + Zod, TypeScript (ESM).

Includes the **Wireup agentic engine** (`src/agentic/`): RAG knowledge base,
deterministic architect, firmware/MERN synthesisers, and terminal validators
(g++, npx tsc, vite build) with bounded repair loops. Auth lives in
`src/auth/` (JWT + bcrypt; Mongo user store when configured, file store
otherwise). Works fully without any external API key; set `GROQ_API_KEY` only
if you want optional LLM drafting — still terminally validated either way.

## Run

```bash
npm install
cp .env.example .env   # everything has a working default
npm run dev            # → tsx watch src/server.ts
```

| Script | What it does |
| --- | --- |
| `dev` | `tsx watch src/server.ts` |
| `build` | `tsc` → `dist/` |
| `start` | `node dist/server.js` |
| `typecheck` | `tsc --noEmit` |
| `test` | `tsx --test test/*.test.mjs` |

## Environment

Validated at boot by `src/config/env.ts` — the process exits with a readable
message rather than failing on the first request.

| Variable | Required | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | for `/plan` and `/interpret` | Without it those routes return 500. |
| `MONGO_URI` | no | Persistence is optional; the API serves fine without it and simply does not save. |
| `PORT` | no | Default `5000`. |
| `CORS_ORIGIN` | no | Comma-separated allow-list. Never `*` in production. |
| `GROQ_MODEL` | no | Default `openai/gpt-oss-120b`. |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | for `/render` | Image generation only. |

## The two-and-a-half pass pipeline

1. **Interpret** (`services/interpretService.ts`) — turns a free-text brief into
   a structured intent contract and returns only the questions the model
   genuinely cannot answer. Every question carries a recommended default, so the
   human's happy path is one click.
2. **Repair** (`data/repairGraph.ts`) — deterministic, no tokens. The planner is
   a language model, so its JSON arrives *almost* right: pin names instead of
   ids, a reused id, a link to a component it forgot to emit, missing
   coordinates. Left alone, Zod accepts all of it and the human gets a diagram
   with edges floating in space or components stacked on top of each other —
   nothing throws, it just looks broken. This pass fixes it and records every
   change in `repairs`, which the client renders so a silent fix is never
   indistinguishable from a bug.
3. **Plan + verify** (`services/architectureService.ts`) — the planner builds the
   graph, `data/engineeringRules.ts` applies deterministic engineering checks,
   and an independent verifier pass reviews the result. A failed verifier
   degrades the report to `unavailable`; it never fails the request.

The graph contract lives in one place — `schemas/architecture.ts` — and is
mirrored by `frontend/src/types/architecture.ts`. Keep them in sync.

## Tests

`test/graphPipeline.test.mjs` pins the graph contract using `node:test`. It
exercises the real modules (including the frontend `graphAdapter`, which it
bundles on the fly) and drives `planAndVerify` against a stubbed Groq server, so
no API key is needed.
