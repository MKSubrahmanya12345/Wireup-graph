# ── Wireup: one image serves the React frontend AND the Express API ─────────
# Same-origin on $PORT — no CORS, no separate web deploy. The image includes
# g++ so the firmware compile gate and the MERN build/boot smoke test run.
# pnpm is the package manager throughout, and the image BAKES the warm
# node_modules store for the generated website scaffold — a build on this
# image never installs the scaffold's boilerplate from the network (minutes
# cold → seconds warm, same idea as the firmware toolchain cache).
# Optional bake: docker build --build-arg INSTALL_EMBEDDED_TOOLCHAIN=1 .
# (bakes PlatformIO + wokwi-cli into the image for real ESP32 compile/sim).

# 1) Build the frontend (vite → static dist) ─────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
RUN npm install -g pnpm@10 --no-audit --no-fund
COPY frontend/package.json ./
RUN pnpm install --reporter=append-only
COPY frontend/ ./
RUN pnpm run build

# 2) Build the backend (TypeScript → dist) + warm the dependency store ───────
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
RUN npm install -g pnpm@10 --no-audit --no-fund
COPY backend/package.json ./
RUN pnpm install --reporter=append-only
COPY backend/ ./
RUN pnpm run build
# The generated website's dependencies are fixed boilerplate: install them
# ONCE here so every build the server ever runs hydrates node_modules from
# this store instead of doing a cold registry install per validation attempt.
ENV AGENTIC_PKG_CACHE=/app/pkg-cache
RUN node scripts/warmPkgCache.mjs

# 3) Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG INSTALL_EMBEDDED_TOOLCHAIN=0

# g++ runs the firmware syntax-compile gate; git/ca-certificates help tooling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && if [ "$INSTALL_EMBEDDED_TOOLCHAIN" = "1" ]; then \
       apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv || true; \
       pip install --break-system-packages platformio || true; \
       pio platform install espressif32 || true; \
       pio pkg install --library "adafruit/DHT sensor library" || true; \
       pio pkg install --library "Adafruit Unified Sensor" || true; \
       pio pkg install --library "Adafruit BME280 Library" || true; \
       pio pkg install --library "Adafruit SSD1306" || true; \
       pio pkg install --library "Adafruit GFX Library" || true; \
       pio pkg install --library "milesburton/DallasTemperature" || true; \
       pio pkg install --library "paulstoffregen/OneWire" || true; \
       pio pkg install --library "madhephaestus/ESP32Servo" || true; \
       npm install -g wokwi-cli || true; \
     fi \
  && npm install -g pnpm@10 --no-audit --no-fund

ENV NODE_ENV=production
ENV AGENTIC_EMBEDDED_COMPILE=1
ENV AGENTIC_WOKWI=1

# Warm dependency store baked above — the website stage hydrates the
# generated trees from here instead of installing from the registry. pnpm
# stays available for the rare cold fallback (a generated package.json that
# deviates from the scaffold template).
COPY --from=backend-build /app/pkg-cache /app/pkg-cache
ENV AGENTIC_PKG_CACHE=/app/pkg-cache

# Backend compiled JS + production dependencies (pnpm).
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/package.json ./package.json
COPY --from=backend-build /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --reporter=append-only

# Assets the build engine needs at runtime.
COPY --from=backend-build /app/scaffolds ./scaffolds
COPY --from=backend-build /app/agentic ./agentic

# Built frontend served same-origin by Express (app.ts → ./public).
COPY --from=frontend /frontend/dist ./public

# Writable area for the per-build sandboxes (firmware/MERN validation).
ENV AGENTIC_WORKDIR=/tmp/wireup-agentic
RUN mkdir -p /tmp/wireup-agentic

# The port is resolved at BOOT: $PORT when the host injects it, otherwise
# 5000, otherwise the next free port if 5000 is taken — never a hard-coded
# requirement. The boot log says where the API actually listens.
ENV PORT=5000
EXPOSE 5000
CMD ["sh", "-c", "node dist/server.js"]
