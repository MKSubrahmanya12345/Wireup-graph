/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the API base URL. Defaults to '/api' (proxied by Vite in dev). */
  readonly VITE_API_URL?: string;
  /** Backend target for the dev proxy. Defaults to http://localhost:5000. */
  readonly VITE_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}