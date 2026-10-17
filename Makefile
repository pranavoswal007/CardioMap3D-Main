# CardioMap 3D Automation Makefile

SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn
PYTEST := $(VENV)/bin/pytest
RUFF := $(VENV)/bin/ruff
MYPY := $(VENV)/bin/mypy
UV := $(shell which uv 2>/dev/null || echo "$$HOME/.local/bin/uv")

.PHONY: all help setup train metrics-table verify-artifacts openapi api web test lint clean check web-typecheck web-build

all: help

help:
	@echo "CardioMap 3D - Monorepo Commands"
	@echo "=================================="
	@echo "  make setup   : Initialize virtualenv and install ML, API, and Web dependencies"
	@echo "  make train   : Execute reproducible ML training pipeline"
	@echo "  make openapi : Export OpenAPI schema to api/openapi.json"
	@echo "  make api     : Start FastAPI backend server on http://localhost:8000"
	@echo "  make web     : Start Vite React frontend dev server on http://localhost:5173"
	@echo "  make test    : Run Python test suite (leakage assertion & API endpoints)"
	@echo "  make lint    : Run Ruff Python linter and TypeScript build check"
	@echo "  make clean   : Clean build artifacts and temporary caches"

setup:
	@echo "==> Setting up Python virtual environment..."
	@if [ -x "$(UV)" ]; then \
		$(UV) venv --allow-existing --python 3.11 $(VENV); \
		$(UV) pip install --python $(VENV) -r requirements.txt; \
		$(UV) pip install --python $(VENV) -e .; \
	else \
		python3 -m venv $(VENV); \
		$(PYTHON) -m pip install --upgrade pip; \
		$(PYTHON) -m pip install -r requirements.txt; \
		$(PYTHON) -m pip install -e .; \
	fi
	@echo "==> Installing Web dependencies..."
	@cd web && npm install
	@echo "==> Setup completed successfully."

train:
	@echo "==> Executing CardioMap 3D ML training pipeline..."
	$(PYTHON) -m cardiomap_ml.train

metrics-table:
	@echo "==> Generating baseline metrics comparison table..."
	$(PYTHON) -m cardiomap_ml.metrics_table

verify-artifacts:
	@echo "==> Verifying artifact consistency..."
	$(PYTHON) -m cardiomap_ml.verify_artifacts

openapi:
	@echo "==> Exporting OpenAPI schema to api/openapi.json..."
	$(PYTHON) -m api.app.export_openapi

api:
	@echo "==> Launching FastAPI application at http://0.0.0.0:8000..."
	$(UVICORN) api.app.main:app --host 0.0.0.0 --port 8000 --reload

web:
	@echo "==> Launching Vite frontend dev server at http://localhost:5173..."
	cd web && npm run dev -- --host 0.0.0.0

test:
	@echo "==> Running test suite..."
	$(PYTEST)

lint:
	@echo "==> Linting Python code with Ruff..."
	$(RUFF) check .
	@echo "==> Type checking Python code with Mypy..."
	$(MYPY) ml api
	@echo "==> Linting Web frontend..."
	cd web && npm run lint

web-typecheck:
	@echo "==> Type checking TypeScript frontend..."
	cd web && npm run type-check

web-build:
	@echo "==> Building web frontend..."
	cd web && npm run build

check: lint web-typecheck web-build test
	@echo "==> All checks passed successfully!"

clean:
	rm -rf .pytest_cache .ruff_cache build dist *.egg-info web/dist
	find . -type d -name "__pycache__" -exec rm -rf {} +
