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
    # dlib build (used by face_recognition). cmake compiles dlib from
    # source; libopenblas+liblapack give it a fast BLAS path so the
    # 128-d face embedding takes ~30 ms instead of ~200 ms per call on
    # cheap VPS CPUs. The X11/GTK deps the upstream README mentions are
    # GUI-only (camera preview); we don't need them on the server.
    cmake \
    libopenblas-dev \
    liblapack-dev \
    # InsightFace pulls in opencv-python-headless which links against
    # libGL even in headless mode (used by some OpenCV image-decode
    # paths). Adding libgl1 + libglib2.0-0 keeps `import cv2` from
    # blowing up on container start with "libGL.so.1: cannot open".
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
# Re-resolve the lockfile if pyproject.toml has drifted (typical
# during local-only dependency adds where we don't commit the lock).
# ``--no-update`` keeps existing pins intact; new deps are added with
# fresh resolution. Then install for real.
RUN poetry lock --no-update || poetry lock
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        poetry install --no-root --with dev; \
    else \
        poetry install --no-root --without dev; \
    fi

# Pre-bake the InsightFace model so the first /recognize call doesn't
# pay a 5-10 s download on a cold worker. Failure is non-fatal — the
# runtime loader falls back to the on-demand download path, which is
# what insightface does by default. Pinning the env var so the same
# directory wins at runtime.
ENV INSIGHTFACE_ROOT=/app/.insightface_models
ENV INSIGHTFACE_MODEL=buffalo_s
RUN mkdir -p $INSIGHTFACE_ROOT && \
    python -c "from insightface.app import FaceAnalysis; \
app = FaceAnalysis(name='${INSIGHTFACE_MODEL}', root='${INSIGHTFACE_ROOT}', \
providers=['CPUExecutionProvider'], allowed_modules=['detection','recognition']); \
app.prepare(ctx_id=-1, det_size=(320, 320))" \
    || echo "WARN: insightface model prefetch failed; will lazy-load at runtime"

# Application code
COPY . /app

EXPOSE 8000

# Default command: API. Override in docker-compose for celery workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
