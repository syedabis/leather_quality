# syntax=docker/dockerfile:1.7

# ────────────────────────────────────────────────────────────────
# Stage 1 — builder: resolve and install Python dependencies with uv
# ────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

RUN pip install --no-cache-dir uv

WORKDIR /app

# Cache dependency layer separately from application code
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ────────────────────────────────────────────────────────────────
# Stage 2 — runner: minimal runtime with ODBC driver only
# ────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runner

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app

# Install Microsoft ODBC Driver for SQL Server (runtime requirement of pyodbc).
# msodbcsql18 is installed; the app auto-detects whichever version is present.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl gnupg2 apt-transport-https ca-certificates unixodbc \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] \
https://packages.microsoft.com/debian/12/prod bookworm main" \
        > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
 && apt-get purge -y --auto-remove curl gnupg2 apt-transport-https \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy resolved virtualenv from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source (placed last so code changes don't bust dep cache)
COPY app/ ./app/

# Create and switch to a non-root user
RUN useradd --create-home --shell /bin/bash app \
 && chown -R app:app /app
USER app

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health/db')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
