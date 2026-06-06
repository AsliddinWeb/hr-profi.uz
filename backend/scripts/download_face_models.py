"""Download SCRFD detector + ArcFace recogniser ONNX models.

Run from the Dockerfile at build time so the API container ships with
the models baked in — the first ``/recognize`` call shouldn't pay a
~10-second download. Falls back gracefully (exit 0 with a WARN) when
the build environment has no internet, in which case the runtime
loader will raise and the operator can re-run this script later via
``docker compose exec api python -m scripts.download_face_models``.

Models are pulled from the InsightFace project's GitHub release
``buffalo_s`` archive. We extract only the two files we actually use:

  * ``det_500m.onnx`` — SCRFD detector (~1.6 MB)
  * ``w600k_mbf.onnx`` — ArcFace recogniser (~13 MB)

Anything else in the zip (landmark, gender-age, alt detectors) is
discarded to keep the image small.
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import urllib.request
import zipfile


BUFFALO_S_URL = (
    "https://github.com/deepinsight/insightface/releases/"
    "download/v0.7/buffalo_s.zip"
)
WANTED_FILES = {"det_500m.onnx", "w600k_mbf.onnx"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=os.environ.get("FACE_MODEL_DIR", "/app/.face_models"),
        help="Output directory for the ONNX files.",
    )
    parser.add_argument(
        "--allow-failure",
        action="store_true",
        help=(
            "Exit 0 even if download fails (Dockerfile build-time mode). "
            "Otherwise non-zero on any error."
        ),
    )
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    if all(os.path.exists(os.path.join(args.out, f)) for f in WANTED_FILES):
        print("[face-models] already present, skipping download")
        return 0

    print(f"[face-models] downloading {BUFFALO_S_URL}")
    try:
        req = urllib.request.Request(
            BUFFALO_S_URL,
            headers={"User-Agent": "hr-profi-build"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except Exception as exc:  # noqa: BLE001
        msg = f"[face-models] download failed: {exc}"
        print(msg, file=sys.stderr)
        return 0 if args.allow_failure else 1

    print(f"[face-models] {len(data) // 1024} KB downloaded, extracting...")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for entry in zf.namelist():
                base = os.path.basename(entry)
                if base in WANTED_FILES:
                    out_path = os.path.join(args.out, base)
                    with zf.open(entry) as src, open(out_path, "wb") as dst:
                        dst.write(src.read())
                    print(f"[face-models] wrote {out_path}")
    except Exception as exc:  # noqa: BLE001
        msg = f"[face-models] extract failed: {exc}"
        print(msg, file=sys.stderr)
        return 0 if args.allow_failure else 1

    missing = [
        f for f in WANTED_FILES if not os.path.exists(os.path.join(args.out, f))
    ]
    if missing:
        msg = f"[face-models] archive missing expected files: {missing}"
        print(msg, file=sys.stderr)
        return 0 if args.allow_failure else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
