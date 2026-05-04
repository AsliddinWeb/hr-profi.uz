"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, RotateCcw, X } from "lucide-react";

/** Open the device camera, capture a single still frame, return it as a
 * base64-encoded JPEG string (without the ``data:`` prefix — that's what
 * the FastAPI ``selfie_base64`` field expects).
 *
 * Uses the **front** camera by default (``facingMode: "user"``) since this
 * is for a selfie at check-in. We preview on a ``<video>`` element, then on
 * "Use this photo" we draw the current frame to a canvas and read it as a
 * dataURL.
 */
export function SelfieCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (base64: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, []);

  const snap = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror so the selfie reads naturally (front camera otherwise looks
    // flipped vs. how the user sees themselves in the preview).
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    // 0.85 quality keeps base64 under ~250KB for a 720p frame.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPhoto(dataUrl);
  };

  const reset = () => setPhoto(null);

  const accept = () => {
    if (!photo) return;
    // Strip the ``data:image/jpeg;base64,`` prefix per the API contract.
    const idx = photo.indexOf(",");
    const b64 = idx >= 0 ? photo.slice(idx + 1) : photo;
    onCapture(b64);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={onCancel}
          className="flex size-9 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
        <span className="text-sm font-medium">{t("today.selfie_hint")}</span>
        <span className="size-9" />
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <div className="m-4 rounded-lg border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-200">
            <p className="font-semibold">{t("today.camera_required")}</p>
            <p className="mt-1 text-xs opacity-80">{error}</p>
          </div>
        ) : photo ? (
          <img
            src={photo}
            alt="preview"
            className="h-full w-full object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
            // Mirror preview so the user sees themselves "naturally".
            style={{ transform: "scaleX(-1)" }}
          />
        )}
        {/* Round face guide overlay */}
        {!photo && !error && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-4 bg-black/80 px-4 py-6">
        {photo ? (
          <>
            <button
              type="button"
              onClick={reset}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25"
              aria-label="Retake"
            >
              <RotateCcw className="size-5" />
            </button>
            <button
              type="button"
              onClick={accept}
              className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-bold text-white shadow-lg active:scale-95"
            >
              {t("today.use_photo")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={snap}
            disabled={!!error}
            className="size-16 rounded-full bg-white ring-4 ring-white/40 active:scale-95 disabled:opacity-50"
            aria-label="Capture"
          >
            <Camera className="mx-auto size-6 text-slate-900" />
          </button>
        )}
      </div>
    </div>
  );
}
