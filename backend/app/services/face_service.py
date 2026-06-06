"""Server-side face recognition for the kiosk attendance flow.

Pipeline:
    1. JPEG bytes → RGB ndarray (Pillow).
    2. Channel swap to BGR (OpenCV + InsightFace convention).
    3. SCRFD detector → list of (bbox, 5 keypoints, score).
    4. Pick the largest detected face; compute a similarity transform
       from its 5 landmarks to the ArcFace canonical positions and
       warp the crop to 112×112.
    5. ArcFace recogniser → 512-d L2-normalised embedding.
    6. Match candidates with cosine similarity (dot product).

Why direct ONNX instead of the ``insightface`` Python package:
    The full package transitively requires matplotlib, scikit-image,
    scikit-learn, albumentations — none of which we need for pure
    inference. Pulling them adds ~500 MB to the container image and
    five minutes to the build. ``onnxruntime`` + ``opencv-python-
    headless`` covers everything we actually run.

Models live under ``$FACE_MODEL_DIR`` (default ``/app/.face_models``)
and are downloaded by ``scripts/download_face_models.py`` during the
Docker build. The runtime loader raises if either model file is
missing — the operator can re-run the download script in that case.
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

import cv2  # type: ignore[import-not-found]
import numpy as np
import onnxruntime as ort  # type: ignore[import-not-found]

logger = logging.getLogger(__name__)


# ---------- Constants ------------------------------------------------------


# 512-d float32 (ArcFace w600k_mbf output).
EMBEDDING_DIM = 512
EMBEDDING_DTYPE = np.float32
EMBEDDING_BYTES = EMBEDDING_DIM * EMBEDDING_DTYPE().itemsize  # 2048

# Legacy dlib embeddings were 128-d float64 = 1024 bytes. Treated as
# "not enrolled" until the re-enrollment script runs against them.
LEGACY_EMBEDDING_BYTES = 128 * np.float64().itemsize  # 1024


# Cosine-similarity threshold. ArcFace embeddings are L2-normalised
# so similarity ∈ [-1, 1]; same-person pairs cluster around 0.5-0.9,
# different-person pairs cluster around 0.0-0.3. 0.40 is the
# standard buffalo_s kiosk threshold — tight enough to reject
# lookalikes, loose enough to survive mild angle/lighting changes.
DEFAULT_MATCH_THRESHOLD = 0.40

# Refuse to choose when the runner-up is within this similarity of
# the winner — protects against identical-twin-ish matches.
MIN_MATCH_GAP = 0.05

# SCRFD detection knobs.
SCRFD_INPUT_SIZE = 320      # input is square, padded with zeros
SCRFD_SCORE_THRESHOLD = 0.5
SCRFD_NMS_THRESHOLD = 0.4

# ArcFace canonical landmark positions for a 112×112 crop. These are
# the same constants every ArcFace deployment uses; copying them
# here keeps face_service entirely self-contained.
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


MODEL_DIR = os.environ.get("FACE_MODEL_DIR", "/app/.face_models")
DETECTOR_PATH = os.path.join(MODEL_DIR, "det_500m.onnx")
RECOGNIZER_PATH = os.path.join(MODEL_DIR, "w600k_mbf.onnx")


# ---------- Session loader -------------------------------------------------


_detector: ort.InferenceSession | None = None
_recognizer: ort.InferenceSession | None = None
_session_lock = Lock()


def _build_session(path: str) -> ort.InferenceSession:
    if not os.path.exists(path):
        raise RuntimeError(
            f"face model missing at {path}; run scripts/download_face_models.py"
        )
    opts = ort.SessionOptions()
    # Single-thread per session — uvicorn/celery already serve one
    # request per process worker, so additional intra-op threading
    # just contends for the same cores.
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    return ort.InferenceSession(
        path, sess_options=opts, providers=["CPUExecutionProvider"]
    )


def _get_sessions() -> tuple[ort.InferenceSession, ort.InferenceSession]:
    global _detector, _recognizer
    if _detector is not None and _recognizer is not None:
        return _detector, _recognizer
    with _session_lock:
        if _detector is None:
            _detector = _build_session(DETECTOR_PATH)
        if _recognizer is None:
            _recognizer = _build_session(RECOGNIZER_PATH)
    return _detector, _recognizer


# ---------- (de)serialisation ---------------------------------------------


def encode_embedding(arr: np.ndarray) -> bytes:
    """Serialise a (512,) float32 array to bytes."""
    if arr.shape != (EMBEDDING_DIM,):
        raise ValueError(
            f"unexpected shape {arr.shape}; expected ({EMBEDDING_DIM},)"
        )
    if arr.dtype != EMBEDDING_DTYPE:
        arr = arr.astype(EMBEDDING_DTYPE)
    return arr.tobytes()


def decode_embedding(buf: bytes) -> np.ndarray | None:
    """Return the stored embedding as float32 — or ``None`` if the
    row still holds a legacy 128-d dlib blob (skip and let the
    backfill task replace it)."""
    if not buf:
        return None
    if len(buf) == LEGACY_EMBEDDING_BYTES:
        # Stale dlib row — silently skip rather than crash on the
        # shape mismatch downstream.
        return None
    if len(buf) != EMBEDDING_BYTES:
        return None
    try:
        return np.frombuffer(buf, dtype=EMBEDDING_DTYPE).copy()
    except (ValueError, TypeError):
        return None


# ---------- Image decode ---------------------------------------------------


def _decode_image_bytes(payload: bytes | str) -> np.ndarray | None:
    """Accept raw bytes or a base64 string (with or without the
    ``data:image/...;base64,`` prefix). Returns a BGR uint8 ndarray
    (OpenCV format) suitable for SCRFD, or ``None``.

    BGR vs RGB matters: SCRFD + ArcFace were trained on BGR samples.
    Feeding RGB silently halves recognition accuracy because the
    channel order shifts the embeddings.
    """
    from PIL import Image  # local import — keeps face_service.py cheap to import

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
        # Cap at 640 px on the long edge. SCRFD operates on a 320×320
        # padded square anyway, so anything larger just costs decode
        # time without improving detection quality.
        img.thumbnail((640, 640))
        rgb = np.asarray(img)
        # RGB → BGR.
        return rgb[:, :, ::-1].copy()
    except Exception:  # noqa: BLE001 — Pillow raises a zoo of types
        logger.warning("face: image decode failed", exc_info=False)
        return None


# ---------- SCRFD detection ------------------------------------------------


def _distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """SCRFD regresses distance from anchor to each box edge. Convert
    back to (x1, y1, x2, y2)."""
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """5 landmark x/y deltas from the anchor centre."""
    coords: list[np.ndarray] = []
    for i in range(0, distance.shape[1], 2):
        coords.append(points[:, 0] + distance[:, i])
        coords.append(points[:, 1] + distance[:, i + 1])
    return np.stack(coords, axis=-1)


def _nms(dets: np.ndarray, thresh: float) -> list[int]:
    """Standard greedy NMS. ``dets`` is (N, 5) = bbox + score."""
    x1 = dets[:, 0]
    y1 = dets[:, 1]
    x2 = dets[:, 2]
    y2 = dets[:, 3]
    scores = dets[:, 4]
    areas = (x2 - x1 + 1.0) * (y2 - y1 + 1.0)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1.0)
        h = np.maximum(0.0, yy2 - yy1 + 1.0)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


def _detect_faces(img_bgr: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """SCRFD inference + decode. Returns ``[(bbox_xyxy, kps_5x2, score), ...]``
    in original image coordinates."""
    detector, _ = _get_sessions()
    h, w = img_bgr.shape[:2]
    if h == 0 or w == 0:
        return []
    scale = min(SCRFD_INPUT_SIZE / w, SCRFD_INPUT_SIZE / h)
    new_w = int(round(w * scale))
    new_h = int(round(h * scale))
    resized = cv2.resize(img_bgr, (new_w, new_h))
    canvas = np.zeros((SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE, 3), dtype=np.uint8)
    canvas[:new_h, :new_w] = resized
    # SCRFD normalisation: (BGR - 127.5) / 128.0
    blob = (canvas.astype(np.float32) - 127.5) / 128.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]

    input_name = detector.get_inputs()[0].name
    outputs = detector.run(None, {input_name: blob})

    # det_500m.onnx returns 9 outputs in the order:
    #   [score_8, score_16, score_32, bbox_8, bbox_16, bbox_32,
    #    kps_8,   kps_16,   kps_32]
    # i.e. all scores first, then bboxes, then kps. ``fmc`` = 3.
    fmc = 3
    strides = (8, 16, 32)
    num_anchors = 2

    all_scores: list[np.ndarray] = []
    all_bboxes: list[np.ndarray] = []
    all_kpss: list[np.ndarray] = []

    for idx, stride in enumerate(strides):
        scores_pred = outputs[idx]
        bbox_pred = outputs[idx + fmc] * stride
        kps_pred = outputs[idx + 2 * fmc] * stride

        height = SCRFD_INPUT_SIZE // stride
        width = SCRFD_INPUT_SIZE // stride
        ax, ay = np.meshgrid(np.arange(width), np.arange(height))
        anchor_centers = np.stack([ax, ay], axis=-1).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape(-1, 2)
        # Two anchors per location.
        anchor_centers = np.stack(
            [anchor_centers] * num_anchors, axis=1
        ).reshape(-1, 2)

        scores_flat = scores_pred.reshape(-1)
        bbox_flat = bbox_pred.reshape(-1, 4)
        kps_flat = kps_pred.reshape(-1, 10)

        pos = np.where(scores_flat >= SCRFD_SCORE_THRESHOLD)[0]
        if pos.size == 0:
            continue
        all_scores.append(scores_flat[pos])
        all_bboxes.append(_distance2bbox(anchor_centers[pos], bbox_flat[pos]))
        all_kpss.append(_distance2kps(anchor_centers[pos], kps_flat[pos]))

    if not all_scores:
        return []

    scores = np.concatenate(all_scores)
    bboxes = np.concatenate(all_bboxes)
    kpss = np.concatenate(all_kpss).reshape(-1, 5, 2)

    # Undo the letterbox.
    bboxes /= scale
    kpss /= scale

    dets = np.concatenate([bboxes, scores[:, None]], axis=1)
    keep = _nms(dets, SCRFD_NMS_THRESHOLD)
    return [
        (bboxes[i], kpss[i], float(scores[i]))
        for i in keep
    ]


# ---------- ArcFace alignment + embedding ----------------------------------


def _align_face(img_bgr: np.ndarray, kps: np.ndarray) -> np.ndarray | None:
    """Compute a 2D similarity transform from the detected 5 landmarks
    to the ArcFace canonical positions and warp to 112×112."""
    src = np.asarray(kps, dtype=np.float32)
    if src.shape != (5, 2):
        return None
    matrix, _ = cv2.estimateAffinePartial2D(src, ARCFACE_DST, method=cv2.LMEDS)
    if matrix is None:
        return None
    return cv2.warpAffine(img_bgr, matrix, (112, 112), borderValue=0)


def _embed_face(aligned_bgr: np.ndarray) -> np.ndarray | None:
    """Run ArcFace on an aligned 112×112 BGR crop and return the
    L2-normalised 512-d embedding."""
    if aligned_bgr.shape != (112, 112, 3):
        return None
    _, recognizer = _get_sessions()
    # ArcFace normalisation: (BGR - 127.5) / 127.5 — slightly
    # different from SCRFD's /128.0 — keep them straight.
    blob = (aligned_bgr.astype(np.float32) - 127.5) / 127.5
    blob = blob.transpose(2, 0, 1)[np.newaxis]
    input_name = recognizer.get_inputs()[0].name
    outputs = recognizer.run(None, {input_name: blob})
    emb = np.asarray(outputs[0][0], dtype=EMBEDDING_DTYPE)
    norm = float(np.linalg.norm(emb))
    if norm > 0:
        emb = (emb / norm).astype(EMBEDDING_DTYPE)
    return emb


def compute_embedding(payload: bytes | str) -> np.ndarray | None:
    """Decode an image payload and return its 512-d face embedding.

    Returns ``None`` when:
      * the image is unreadable,
      * no face is detected,
      * the alignment / embedding step errors.
    """
    img_bgr = _decode_image_bytes(payload)
    if img_bgr is None:
        return None
    try:
        faces = _detect_faces(img_bgr)
    except Exception:  # noqa: BLE001
        logger.exception("face: detection failed")
        return None
    if not faces:
        return None
    # Largest face wins — for kiosk + selfie this is always the
    # subject. ``b`` is (x1, y1, x2, y2).
    faces.sort(
        key=lambda f: (f[0][2] - f[0][0]) * (f[0][3] - f[0][1]),
        reverse=True,
    )
    _, kps, _ = faces[0]
    aligned = _align_face(img_bgr, kps)
    if aligned is None:
        return None
    try:
        return _embed_face(aligned)
    except Exception:  # noqa: BLE001
        logger.exception("face: embedding failed")
        return None


# ---------- Matching --------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    employee_id: object  # uuid.UUID at the call site; kept generic
    embedding: np.ndarray


@dataclass(frozen=True)
class Match:
    employee_id: object
    distance: float  # 1 - similarity, kept for back-compat with old callers.
    score: float    # cosine similarity in [-1, 1]; higher = closer.


def find_match(
    target: np.ndarray,
    candidates: Iterable[Candidate],
    *,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    min_gap: float = MIN_MATCH_GAP,
) -> Match | None:
    """Brute-force nearest-neighbour using cosine similarity.

    ``threshold`` is the *minimum* similarity for a hit. ``min_gap``
    rejects the match if the runner-up is within ``min_gap`` of the
    winner — refuses to pick between two near-equal enrolled
    employees rather than silently logging the wrong identity.
    """
    if target is None or target.shape != (EMBEDDING_DIM,):
        return None
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
