FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    POETRY_VERSION=1.8.3 \
    POETRY_HOME=/opt/poetry \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1 \
    PATH="/opt/poetry/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    # WeasyPrint runtime: HTML/CSS → PDF needs the cairo/pango/gdk-pixbuf
    # stack. Without these the import succeeds but every render call
    # returns a stack trace the moment it touches text or images.
    libcairo2 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://install.python-poetry.org | python3 -

WORKDIR /app

# Dependencies layer.
# INSTALL_DEV defaults to "true" — dev tooling (pytest, ruff, mypy) is included
# so the same image works for `make test` and IDE workflows. Prod builds set
# `--build-arg INSTALL_DEV=false` for a smaller, lockdown image.
ARG INSTALL_DEV=true
COPY pyproject.toml poetry.lock* /app/
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        poetry install --no-root --with dev; \
    else \
        poetry install --no-root --without dev; \
    fi

# Application code
COPY . /app

EXPOSE 8000

# Default command: API. Override in docker-compose for celery workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
