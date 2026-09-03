/**
 * Bake the website-stage warm dependency store (runs in the Docker
 * `backend-build` stage, AFTER `pnpm run build` — it imports the compiled
 * pkgCache).
 *
 * The generated MERN scaffold's dependencies are fixed boilerplate, so
 * installing them belongs to the image build, not to a user's build request:
 * this runs ONE real install per scaffold package and files the resulting
 * node_modules under $AGENTIC_PKG_CACHE, keyed by the package.json hash.
 * At request time the validator copies the tree in seconds instead of
 * installing from the network for minutes.
 *
 * Run with: node scripts/warmPkgCache.mjs
 */
import { ensureScaffoldWarmTrees, warmTreePathFor, SCAFFOLD_PKGS } from '../dist/agentic/pkgCache.js';

const log = (line) => console.log(`[warm] ${line}`);

log(`warming scaffold trees into ${process.env.AGENTIC_PKG_CACHE ?? '(default cache root)'} …`);
for (const pkg of SCAFFOLD_PKGS) {
  log(`${pkg}: store path ${await warmTreePathFor(pkg)}`);
}
await ensureScaffoldWarmTrees(log);
log('done — builds on this image will hydrate dependencies without touching the network');
