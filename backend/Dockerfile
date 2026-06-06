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
    # opencv-python-headless still links against libGL even in
    # headless mode (used by some OpenCV image-decode paths) and
    # libglib for GIO. Without these ``import cv2`` blows up with
    # "libGL.so.1: cannot open".
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://install.python-poetry.org | python3 -

WORKDIR /app

# Dependencies layer.
# INSTALL_DEV defaults to "true" — dev tooling (pytest, ruff, mypy) is included
# so the same image works for `make test` and IDE workflows. Prod builds set
# `--build-arg INSTALL_DEV=false` for a smaller, lockdown image.
ARG INSTALL_DEV=true
COPY pyproject.toml poetry.lock* /app/
# Drop the committed poetry.lock if its hash doesn't match the
# current pyproject.toml so the install step doesn't fail with
# "lockfile is not consistent". Then resolve fresh and install.
RUN poetry check --lock --quiet 2>/dev/null || rm -f poetry.lock
RUN poetry lock
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        poetry install --no-root --with dev; \
    else \
        poetry install --no-root --without dev; \
    fi

# Pre-bake the face-recognition ONNX models (SCRFD detector +
# ArcFace recogniser) so the first /recognize call doesn't pay a
# ~10-second download on a cold worker. ``--allow-failure`` makes
# this step non-fatal if the build environment has no internet;
# the runtime loader will surface a clear error and the operator
# can re-run the script via ``docker compose exec api …``.
ENV FACE_MODEL_DIR=/app/.face_models
COPY scripts/download_face_models.py /app/scripts/
RUN mkdir -p $FACE_MODEL_DIR && \
    python /app/scripts/download_face_models.py --out $FACE_MODEL_DIR --allow-failure

# Application code
COPY . /app

EXPOSE 8000

# Default command: API. Override in docker-compose for celery workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
