# ── Wireup: one image serves the React frontend AND the Express API ─────────
# Same-origin on $PORT — no CORS, no separate web deploy. The image includes
# g++ so the firmware compile gate and the MERN build/boot smoke test run.
# Optional bake: docker build --build-arg INSTALL_EMBEDDED_TOOLCHAIN=1 .
# (bakes PlatformIO + wokwi-cli into the image for real ESP32 compile/sim).

# 1) Build the frontend (vite → static dist) ─────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Build the backend (TypeScript → dist) ───────────────────────────────────
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
RUN npm run build

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
     fi

ENV NODE_ENV=production
ENV AGENTIC_EMBEDDED_COMPILE=1
ENV AGENTIC_WOKWI=1

# Backend compiled JS + production dependencies.
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Assets the build engine needs at runtime.
COPY --from=backend-build /app/scaffolds ./scaffolds
COPY --from=backend-build /app/agentic ./agentic

# Built frontend served same-origin by Express (app.ts → ./public).
COPY --from=frontend /frontend/dist ./public

# Writable area for the per-build sandboxes (firmware/MERN validation).
ENV AGENTIC_WORKDIR=/tmp/wireup-agentic
RUN mkdir -p /tmp/wireup-agentic

EXPOSE 5000
# Hosts inject $PORT; default to 5000 for local `docker run`.
CMD ["sh", "-c", "node dist/server.js"]
