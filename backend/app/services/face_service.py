"""Server-side face recognition for the kiosk attendance flow.

Uses :mod:`face_recognition` (dlib's ResNet-based 128-d encoder). Each
employee gets a single embedding generated from their primary photo;
on a kiosk capture we compute the same encoding for the incoming
frame and pick the closest stored employee inside the kiosk's branch.

Performance note:
    For ~5 000 employees per branch the brute-force match runs in
    well under 50 ms (numpy vectorisation; the embedding compute is
    the bottleneck at ~80–150 ms per frame on a typical VPS CPU).
    If a tenant ever exceeds that scale we'll switch to ``pgvector``
    + an HNSW index — but the column already stores raw float bytes
    so the upgrade is column-only, no API change.
"""
from __future__ import annotations

import base64
import binascii
import io
import logging
from dataclasses import dataclass
from typing import Iterable

import numpy as np

logger = logging.getLogger(__name__)

# face_recognition is heavy (lazy-loaded) — see _ensure_face_recognition.
_face_recognition = None  # type: ignore[var-annotated]
_pil_image = None  # type: ignore[var-annotated]


def _ensure_face_recognition():
    """Lazy import. dlib loads ~150 MB of model weights on first import,
    which we don't want to pay during a regular API request that doesn't
    touch face matching (e.g. /auth/login on a fresh worker)."""
    global _face_recognition, _pil_image
    if _face_recognition is None:
        import face_recognition  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]

        _face_recognition = face_recognition
        _pil_image = Image
    return _face_recognition, _pil_image


# 128-d float64 numpy array → 1024 raw bytes.
EMBEDDING_DIM = 128
EMBEDDING_DTYPE = np.float64
EMBEDDING_BYTES = EMBEDDING_DIM * EMBEDDING_DTYPE().itemsize  # 1024


# Default match threshold: distance below this counts as the same face.
# face_recognition recommends 0.6 for "lenient" and 0.5 for "strict".
# 0.5 is right for a kiosk where false positives ("logged X as Y")
# are far worse than false negatives ("please try again"). An
# earlier bump to 0.6 caused real cross-identification in
# production, so we walked it back.
DEFAULT_MATCH_THRESHOLD = 0.5

# Minimum gap between the best and second-best candidate's distance
# for a match to count. Two siblings / similar-looking employees can
# both land within the threshold; without this guard the matcher
# picks whichever is marginally closer and we silently log the
# wrong identity. 0.04 is roughly the within-person jitter
# face_recognition produces between frames of the same face, so a
# match that's tighter than that against the runner-up is no
# better than the noise floor.
MIN_MATCH_GAP = 0.04


# ---------- (de)serialization -----------------------------------------------


def encode_embedding(arr: np.ndarray) -> bytes:
    """Serialize a (128,) float64 array to bytes for the ``employees``
    column. We don't bother with versioning — the dimension and dtype
    are fixed by dlib's ResNet."""
    if arr.shape != (EMBEDDING_DIM,):
        raise ValueError(f"unexpected shape {arr.shape}; expected ({EMBEDDING_DIM},)")
    if arr.dtype != EMBEDDING_DTYPE:
        arr = arr.astype(EMBEDDING_DTYPE)
    return arr.tobytes()


def decode_embedding(buf: bytes) -> np.ndarray | None:
    if not buf or len(buf) != EMBEDDING_BYTES:
        return None
    try:
        return np.frombuffer(buf, dtype=EMBEDDING_DTYPE).copy()
    except (ValueError, TypeError):
        return None


# ---------- Encoding (photo → embedding) ------------------------------------


def _decode_image_bytes(payload: bytes | str) -> np.ndarray | None:
    """Accept either raw bytes or a base64 string (with or without
    ``data:image/...;base64,`` prefix). Returns an RGB numpy array
    suitable for face_recognition, or ``None`` if decoding fails."""
    fr, Image = _ensure_face_recognition()
    _ = fr  # unused here; only needed for downstream callers
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
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
        # Cap at 480 px on the long edge. The whole pipeline downstream
        # (HOG face detection, dlib encoding) scales with pixel count;
        # going from 640 to 480 cuts ~45% of the work and the embedding
        # quality difference is below the matcher's noise floor. Tablet
        # cameras occasionally push 1080p; without this cap a single
        # frame would be 4× slower than necessary.
        img.thumbnail((480, 480))
        return np.asarray(img)
    except Exception:  # noqa: BLE001 — Pillow raises a zoo of types
        logger.warning("face: image decode failed", exc_info=False)
        return None


def compute_embedding(payload: bytes | str) -> np.ndarray | None:
    """Decode an image payload and return its 128-d face embedding.

    Returns ``None`` when the image is unreadable, when no face is
    found, or when more than one face is present (we won't guess in
    a kiosk context — the operator can re-frame).
    """
    fr, _ = _ensure_face_recognition()
    img = _decode_image_bytes(payload)
    if img is None:
        return None
    # Use the HOG model — CPU-friendly. CNN gives slightly better recall
    # at far higher cost; not worth it on a $5 VPS.
    #
    # number_of_times_to_upsample=0 is the single biggest speed lever
    # here: the default of 1 upscales the image 2× before sliding the
    # HOG kernel (≈4× work). Kiosk faces fill most of the frame so the
    # upsampling never helps — we just want the bbox, fast.
    boxes = fr.face_locations(img, model="hog", number_of_times_to_upsample=0)
    if not boxes:
        # Retry once with the default upsample — covers the corner
        # case where the user stands a step too far from the camera.
        boxes = fr.face_locations(img, model="hog", number_of_times_to_upsample=1)
    if not boxes:
        return None
    if len(boxes) > 1:
        # Pick the largest face (closest to the camera). For employee
        # photos this is virtually always the subject; for a busy kiosk
        # capture it's the person actually facing the screen.
        boxes.sort(key=lambda b: (b[2] - b[0]) * (b[1] - b[3]), reverse=True)
        boxes = boxes[:1]
    encs = fr.face_encodings(img, known_face_locations=boxes, num_jitters=1)
    if not encs:
        return None
    return np.asarray(encs[0], dtype=EMBEDDING_DTYPE)


# ---------- Matching --------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    employee_id: object  # uuid.UUID at the call site; kept generic so
    # this module stays free of SQLAlchemy/UUID imports.
    embedding: np.ndarray


@dataclass(frozen=True)
class Match:
    employee_id: object
    distance: float
    score: float  # 1 - distance, clamped to [0, 1]; nicer to render in UI


def find_match(
    target: np.ndarray,
    candidates: Iterable[Candidate],
    *,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    min_gap: float = MIN_MATCH_GAP,
) -> Match | None:
    """Brute-force nearest-neighbour over ``candidates``.

    ``threshold`` is the *maximum* distance still considered a match.
    ``min_gap`` rejects the match if the runner-up is within that
    distance of the winner — protects against the embedding being
    "near two people at once" and silently picking the wrong one.
    """
    best: Match | None = None
    second_distance: float | None = None
    for c in candidates:
        if c.embedding is None or c.embedding.shape != (EMBEDDING_DIM,):
            continue
        # Euclidean distance — face_recognition uses this internally.
        dist = float(np.linalg.norm(target - c.embedding))
        if best is None or dist < best.distance:
            if best is not None:
                second_distance = best.distance
            best = Match(
                employee_id=c.employee_id,
                distance=dist,
                score=max(0.0, min(1.0, 1.0 - dist)),
            )
        elif second_distance is None or dist < second_distance:
            second_distance = dist

    if best is None or best.distance > threshold:
        return None
    # Ambiguous between two enrolled employees — refuse rather than
    # guess. The operator can re-try (lighting / angle nudge usually
    # breaks the tie) or fall back to manual employee pick.
    if second_distance is not None and (second_distance - best.distance) < min_gap:
        return None
    return best


__all__ = [
    "Candidate",
    "DEFAULT_MATCH_THRESHOLD",
    "EMBEDDING_BYTES",
    "EMBEDDING_DIM",
    "Match",
    "compute_embedding",
    "decode_embedding",
    "encode_embedding",
    "find_match",
]
