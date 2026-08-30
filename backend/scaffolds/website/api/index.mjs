/**
 * Vercel serverless entry for the Express API.
 *
 * Vercel mounts files in the project-root `api/` directory as serverless
 * functions. `index.mjs` here maps to `/api`. It imports the same Express app
 * that runs locally (built to backend/dist by the root build step), so
 * behaviour is identical in dev and production.
 *
 * For a self-hosted deployment, ignore this file and run:
 *   npm run start:backend   (node backend/dist/server.js)
 */
import app from '../backend/dist/app.js';

export default app;
