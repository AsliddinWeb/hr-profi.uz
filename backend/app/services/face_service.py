"""Server-side face recognition for the kiosk attendance flow.

Uses :mod:`insightface` (ArcFace, 512-d embeddings) over the
``buffalo_s`` model. ArcFace is ~5 years newer than the dlib ResNet
we used previously and is dramatically more robust to head pose,
lighting and aging — operators were reporting genuine
cross-identification with dlib that disappears once the embeddings
come from ArcFace.

Performance:
    ``buffalo_s`` runs at ~25–50 ms per frame on a 2-core VPS for
    detection + alignment + embedding combined. We cap the input
    image at 640 px (ArcFace likes slightly more than dlib did
    because of the alignment crop). Brute-force matching over
    embeddings is numpy-vectorised and trivial at <5 000 employees.

Match metric:
    InsightFace embeddings are L2-normalised, so cosine similarity
    is just a dot product. We work in similarity space (higher =
    closer) to keep the math intuitive at call sites.
"""
from __future__ import annotations

import base64
import binascii
import io
import logging
import os
from dataclasses import dataclass
from threading import Lock
from typing import Iterable

import numpy as np

logger = logging.getLogger(__name__)


# 512-d float32 numpy array → 2048 raw bytes. InsightFace returns
# float32 already-normalised vectors; we keep the bytes layout simple
# and don't store a header — column type tells dimension by length.
EMBEDDING_DIM = 512
EMBEDDING_DTYPE = np.float32
EMBEDDING_BYTES = EMBEDDING_DIM * EMBEDDING_DTYPE().itemsize  # 2048

# Bytes-length of the legacy dlib embeddings (128-d float64 = 1024 B).
# Used during the migration window so callers can detect and skip
# stale rows without crashing on a shape mismatch.
LEGACY_EMBEDDING_BYTES = 128 * np.float64().itemsize  # 1024


# Cosine-similarity threshold. ArcFace embeddings are L2-normalised
# so similarity ∈ [-1, 1]; same-person pairs cluster around 0.6–0.9,
# different-person pairs around -0.1 to 0.3. 0.40 is the standard
# kiosk threshold for buffalo_s — tight enough to reject lookalikes,
# loose enough to survive moderate angle/lighting changes.
DEFAULT_MATCH_THRESHOLD = 0.40

# Minimum similarity gap between the best and second-best match. If
# two enrolled employees both score within 0.05 of each other, refuse
# to pick — much safer than guessing under genuine ambiguity. This
# is the InsightFace analog of the gap guard we used with dlib.
MIN_MATCH_GAP = 0.05


# ---------- Lazy InsightFace loader ----------------------------------------


_face_app = None  # type: ignore[var-annotated]
_app_lock = Lock()


# Where the model archive lives inside the container. We bake it into
# the image so the first call doesn't pay the download (insightface
# normally yanks it from GitHub on demand). The path is overridable
# via env so tests can point at a local dir.
INSIGHTFACE_ROOT = os.environ.get(
    "INSIGHTFACE_ROOT", "/app/.insightface_models"
)
INSIGHTFACE_MODEL = os.environ.get("INSIGHTFACE_MODEL", "buffalo_s")


def _get_face_app():
    """Lazily build the InsightFace FaceAnalysis instance.

    The model loads ~80 MB of weights and pins them in memory; we
    only want to pay that cost once per worker process. The lock
    serialises concurrent first-request races.
    """
    global _face_app
    if _face_app is not None:
        return _face_app
    with _app_lock:
        if _face_app is not None:
            return _face_app
        from insightface.app import FaceAnalysis  # type: ignore[import-not-found]

        app = FaceAnalysis(
            name=INSIGHTFACE_MODEL,
            root=INSIGHTFACE_ROOT,
            # CPUExecutionProvider keeps the container portable. GPU
            # would only matter at >100 req/s sustained, which we're
            # nowhere near.
            providers=["CPUExecutionProvider"],
            # det+rec are the only modules we use; skip landmark/
            # gender/age stages to halve startup memory + per-frame
            # latency.
            allowed_modules=["detection", "recognition"],
        )
        # det_size: detector input. 320 keeps detection ~10 ms; the
        # crop fed to recognition is fixed at 112x112 regardless.
        app.prepare(ctx_id=-1, det_size=(320, 320))
        _face_app = app
    return _face_app


def _pil_loader():
    from PIL import Image  # type: ignore[import-not-found]

    return Image


# ---------- (de)serialization ----------------------------------------------


def encode_embedding(arr: np.ndarray) -> bytes:
    """Serialize a (512,) float32 array to bytes."""
    if arr.shape != (EMBEDDING_DIM,):
        raise ValueError(
            f"unexpected shape {arr.shape}; expected ({EMBEDDING_DIM},)"
        )
    if arr.dtype != EMBEDDING_DTYPE:
        arr = arr.astype(EMBEDDING_DTYPE)
    return arr.tobytes()


def decode_embedding(buf: bytes) -> np.ndarray | None:
    """Return the stored embedding as float32 — or None if the row
    still holds a legacy dlib 1024-byte blob (those need re-enrolling
    before they can be matched against the new ArcFace target).
    """
    if not buf:
        return None
    if len(buf) == LEGACY_EMBEDDING_BYTES:
        # Stale dlib embedding — caller should re-enroll. Returning
        # None silently is the safer behaviour: the kiosk treats that
        # employee as "not enrolled yet" instead of trying to compare
        # 128-d-float64 bytes against a 512-d-float32 target.
        return None
    if len(buf) != EMBEDDING_BYTES:
        return None
    try:
        return np.frombuffer(buf, dtype=EMBEDDING_DTYPE).copy()
    except (ValueError, TypeError):
        return None


# ---------- Encoding (photo → embedding) -----------------------------------


def _decode_image_bytes(payload: bytes | str) -> np.ndarray | None:
    """Accept either raw bytes or a base64 string (with or without
    ``data:image/...;base64,`` prefix). Returns a BGR numpy array
    (OpenCV-style) suitable for InsightFace, or ``None`` if decoding
    fails. InsightFace was trained on BGR data so the channel swap
    here is load-bearing — feeding RGB silently halves accuracy.
    """
    Image = _pil_loader()
    if isinstance(payload, str):
        raw = payload
        if raw.startswith("data:"):
            try:
                raw = raw.split(",", 1)[1]
            except (ValueError, IndexError):
                return None
        try:
            data = base64.b64decode(raw, validate=False)
        except (binascii.Error, ValueError):
            return None
    else:
        data = payload
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        # Cap the long edge at 640 px. ArcFace likes slightly more
        # resolution than dlib needed (the alignment crop is sharper
        # when the source has more pixels to interpolate from). At
        # 640 px the whole detect+embed pipeline still finishes in
        # well under 60 ms on a 2-core VPS.
        img.thumbnail((640, 640))
        rgb = np.asarray(img)
        # Convert RGB → BGR for InsightFace.
        return rgb[:, :, ::-1].copy()
    except Exception:  # noqa: BLE001 — Pillow raises a zoo of types
        logger.warning("face: image decode failed", exc_info=False)
        return None


def compute_embedding(payload: bytes | str) -> np.ndarray | None:
    """Decode an image payload and return its 512-d face embedding.

    Returns ``None`` when the image is unreadable, when no face is
    found, or when face_recognition couldn't compute an embedding.
    Picks the largest face when multiple are present (closest to
    the camera).
    """
    img = _decode_image_bytes(payload)
    if img is None:
        return None
    try:
        app = _get_face_app()
        faces = app.get(img)
    except Exception:  # noqa: BLE001
        logger.exception("face: insightface inference failed")
        return None
    if not faces:
        return None
    # Pick the largest detected face. Each Face.bbox is [x1, y1, x2, y2].
    if len(faces) > 1:
        faces = sorted(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
            reverse=True,
        )
    face = faces[0]
    # ``normed_embedding`` is L2-normalised already, so cosine
    # similarity reduces to a plain dot product downstream.
    emb = getattr(face, "normed_embedding", None)
    if emb is None:
        emb = face.embedding
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
    return np.asarray(emb, dtype=EMBEDDING_DTYPE)


# ---------- Matching --------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    employee_id: object  # uuid.UUID at the call site; kept generic so
    # this module stays free of SQLAlchemy/UUID imports.
    embedding: np.ndarray


@dataclass(frozen=True)
class Match:
    employee_id: object
    distance: float  # 1 - similarity, kept for back-compat with callers.
    score: float    # cosine similarity, [-1, 1]. Higher = closer.


def find_match(
    target: np.ndarray,
    candidates: Iterable[Candidate],
    *,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    min_gap: float = MIN_MATCH_GAP,
) -> Match | None:
    """Brute-force nearest-neighbour using cosine similarity.

    ``threshold`` is the *minimum* similarity to count as a match.
    ``min_gap`` rejects the match when the runner-up's similarity is
    within ``min_gap`` of the winner's — refuses to pick between two
    near-equally-close enrolled employees.

    Returns the closest candidate that satisfies both, else ``None``.
    """
    if target is None or target.shape != (EMBEDDING_DIM,):
        return None
    # Ensure target is also normalised (compute_embedding already
    # returns normed, but defensive when callers feed pre-stored
    # vectors back in).
    t_norm = float(np.linalg.norm(target))
    if t_norm > 0:
        target = (target / t_norm).astype(EMBEDDING_DTYPE)

    best: Match | None = None
    second_score: float | None = None
    for c in candidates:
        if c.embedding is None or c.embedding.shape != (EMBEDDING_DIM,):
            continue
        sim = float(np.dot(target, c.embedding))
        if best is None or sim > best.score:
            if best is not None:
                second_score = best.score
            best = Match(
                employee_id=c.employee_id,
                distance=max(0.0, 1.0 - sim),
                score=sim,
            )
        elif second_score is None or sim > second_score:
            second_score = sim

    if best is None or best.score < threshold:
        return None
    if second_score is not None and (best.score - second_score) < min_gap:
        return None
    return best


__all__ = [
    "Candidate",
    "DEFAULT_MATCH_THRESHOLD",
    "EMBEDDING_BYTES",
    "EMBEDDING_DIM",
    "LEGACY_EMBEDDING_BYTES",
    "MIN_MATCH_GAP",
    "Match",
    "compute_embedding",
    "decode_embedding",
    "encode_embedding",
    "find_match",
]
