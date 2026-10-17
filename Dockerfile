# Dockerfile for CardioMap 3D FastAPI Backend
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/ml/src:/app

WORKDIR /app

# Install minimal OS dependencies required for LightGBM and numerical libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python third-party dependencies first to maximize Docker layer cache
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy package config, documentation, application code, and trained artifacts
COPY pyproject.toml README.md /app/
COPY artifacts/ /app/artifacts/
COPY data/ /app/data/
COPY ml/ /app/ml/
COPY api/ /app/api/

# Install local package in editable mode now that ml/src and README.md exist
RUN pip install --no-cache-dir -e .

ENV PORT=8000
EXPOSE 8000

# Health check to ensure API is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Launch FastAPI with Uvicorn (reads $PORT if set by cloud host like Render/CloudRun, defaults to 8000)
CMD ["sh", "-c", "uvicorn api.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
