import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Camera, CameraOff, ScanFace } from "lucide-react";

import { cn } from "@/lib/cn";

/* Front-camera preview for the tablet kiosk.
 *
 * The component owns its own stream and exposes ``captureFrame()`` via
 * a ref. Captured frames are base64-encoded JPEGs (no ``data:`` prefix
 * — the backend's ``_maybe_upload_selfie`` accepts both, but bare
 * base64 is smaller over the wire).
 *
 * Design notes:
 *   - Permission prompts are unavoidable on the *first* boot. After
 *     that, modern browsers remember the grant per-origin so the kiosk
 *     stops asking.
 *   - We pin ``facingMode: "user"`` so the front camera is preferred,
 *     but we don't *exact* it — some tablets only expose a single
 *     camera and exact would fail with NotFoundError.
 *   - If the user denies the camera, the kiosk still works with manual
 *     selection — selfies just won't be attached. We surface the
 *     "denied" state visibly so the operator knows. */

export interface CameraHandle {
  /** Returns a base64 (no prefix) JPEG of the current frame, or
   *  ``null`` if the camera isn't ready (permission denied / no track). */
  captureFrame(): string | null;
}

interface Props {
  /** Hide the live preview but keep the camera running. Used when the
   *  operator has decided privacy is preferred over a self-view. */
  hidden?: boolean;
  /** True while a recognize request is in flight — shows a subtle
   *  "scanning" badge so the operator knows the AI loop is alive. */
  scanning?: boolean;
}

export const CameraPreview = forwardRef<CameraHandle, Props>(
  function CameraPreview({ hidden, scanning }, ref) {
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<"denied" | "missing" | "other" | null>(
      null
    );
    const [ready, setReady] = useState(false);

    useEffect(() => {
      let active = true;
      let stream: MediaStream | null = null;

      async function start() {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("missing");
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: false,
          });
          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          setError(null);
          setReady(true);
        } catch (e: unknown) {
          const name = (e as { name?: string })?.name ?? "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            setError("denied");
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            setError("missing");
          } else {
            setError("other");
          }
          setReady(false);
        }
      }

      void start();
      return () => {
        active = false;
        if (stream) stream.getTracks().forEach((t) => t.stop());
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        captureFrame() {
          const video = videoRef.current;
          if (!video || !ready) return null;
          const w = video.videoWidth || 640;
          const h = video.videoHeight || 480;
          if (!w || !h) return null;
          let canvas = canvasRef.current;
          if (!canvas) {
            canvas = document.createElement("canvas");
            canvasRef.current = canvas;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(video, 0, 0, w, h);
          // 0.85 trades a couple of % quality for a much smaller payload
          // (~30 KB JPEG vs >100 KB at 1.0). The backend just stores it.
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          const idx = dataUrl.indexOf(",");
          return idx >= 0 ? dataUrl.slice(idx + 1) : null;
        },
      }),
      [ready]
    );

    return (
      <div
        className={cn(
          "camera-frame",
          hidden ? "h-0 w-0 opacity-0" : "aspect-video w-full"
        )}
      >
        {/* Mirror so the operator sees themselves like a mirror, not a
            camera feed (much less disorienting for tablets). */}
        <video
          ref={videoRef}
          className={cn(
            "h-full w-full object-cover",
            "scale-x-[-1] transform" // mirror
          )}
          muted
          playsInline
          autoPlay
        />

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900/80 p-4 text-center text-white">
            <CameraOff className="size-8 opacity-80" />
            <p className="text-sm font-semibold">
              {error === "denied"
                ? t("camera.denied")
                : error === "missing"
                  ? t("camera.missing")
                  : t("camera.error")}
            </p>
            <p className="max-w-[260px] text-xs text-white/70">
              {t("camera.fallback_hint")}
            </p>
          </div>
        )}

        {!error && !ready && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Camera className="mr-2 size-5 animate-pulse" />
            <span className="text-sm">{t("camera.loading")}</span>
          </div>
        )}

        {ready && !error && (
          <>
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
              <span className="size-1.5 rounded-full bg-rose-400 live-dot" />
              {t("camera.live")}
            </span>

            {/* Face-detection corner brackets — purely cosmetic but
                they make the camera feel like a face scanner instead of
                a generic webcam. */}
            <FaceBrackets />

            {scanning && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow backdrop-blur">
                <ScanFace className="size-3 animate-pulse" />
                {t("camera.scanning")}
              </span>
            )}
          </>
        )}
      </div>
    );
  }
);

/* Decorative L-shaped corner brackets — only visual, no behaviour. They
 * frame the centre of the preview the way a real face scanner UI would,
 * which makes the kiosk feel like a face terminal instead of a Zoom call. */
function FaceBrackets() {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* 4 corners of a centered ~60% box */}
      <path
        d="M22 28V22h6 M78 28V22h-6 M22 72v6h6 M78 72v6h-6"
        stroke="white"
        strokeWidth="0.6"
        strokeOpacity="0.7"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
