# ── Stage 1: build Vite frontend ─────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend-vite
COPY frontend-vite/package*.json ./
RUN npm ci
COPY frontend-vite/ ./
# VITE_API_URL="" means same-origin (frontend and API share one Render URL)
RUN npm run build

# ── Stage 2: production backend ───────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Install deps first (layer cache friendly)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Copy compiled frontend where main.py expects it: <project_root>/frontend/
COPY --from=frontend-builder /build/frontend-vite/dist ./frontend

EXPOSE 8000

# Subprocess sandbox — no Docker daemon available inside Render containers.
ENV SANDBOX_USE_DOCKER=false

# startup.py: stamps DB at head if no alembic_version exists, then runs upgrade head.
# Uses ; (not &&) so uvicorn always starts even if the migration step errors.
COPY startup.py ./
CMD sh -c "python startup.py; uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"
