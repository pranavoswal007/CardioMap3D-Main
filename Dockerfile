# Dockerfile for CardioMap 3D FastAPI Backend
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install minimal OS dependencies required for LightGBM and numerical libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt pyproject.toml /app/
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -e .

# Copy application code and trained artifacts
COPY artifacts/ /app/artifacts/
COPY data/ /app/data/
COPY ml/ /app/ml/
COPY api/ /app/api/

EXPOSE 8000

# Health check to ensure API is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Launch FastAPI with Uvicorn
CMD ["uvicorn", "api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
