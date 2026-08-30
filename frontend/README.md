# Wireup frontend

React 19 + Vite + TypeScript (ESM). Three pages behind auth:

- `/` — **Prompt & Questions** (brief composer + agent question cards)
- `/graph` — **Architecture graph** (React Flow canvas, optional 3D view, validation dock)
- `/build` — **Agentic build console** (live NDJSON terminal, validation badges, file browser, two zip downloads)

`src/store/` holds the three zustand stores (design session, graph, agentic build stream) plus `useAuth`.
The dev server proxies `/api` → `http://localhost:5000` (see `vite.config.ts`).

```bash
npm install
npm run dev
```
