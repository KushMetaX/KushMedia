import { useEffect, useRef, useState } from "react";
import type { DrawingUtils, HandLandmarker } from "@mediapipe/tasks-vision";
import { Video } from "lucide-react";
import { createHandLandmarker, loadVision } from "@/irl-table/hand-track";
import { cn } from "@/lib/utils";

const STROKE = "#e8a317";
const FILL = "#f6e7c8";

export function HandCam({
  stream,
  muted,
  label,
  waiting,
  onHands,
}: {
  stream: MediaStream | null;
  muted: boolean;
  label: string;
  waiting: string;
  onHands?: (count: number) => void;
}) {
  const onHandsRef = useRef(onHands);
  onHandsRef.current = onHands;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const drawRef = useRef<DrawingUtils | null>(null);
  const DrawClassRef = useRef<(typeof import("@mediapipe/tasks-vision").DrawingUtils) | null>(null);
  const connectionsRef = useRef<{ start: number; end: number }[] | null>(null);
  const rafRef = useRef(0);
  const lastTs = useRef(-1);
  const lastCount = useRef(-1);
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "error">("off");
  const [handCount, setHandCount] = useState(0);
  const [handLabels, setHandLabels] = useState<string[]>([]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    if (!stream) {
      setStatus("off");
      setHandCount(0);
      setHandLabels([]);
      if (lastCount.current !== 0) {
        lastCount.current = 0;
        onHandsRef.current?.(0);
      }
      return;
    }

    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        const [lm, mod] = await Promise.all([createHandLandmarker(), loadVision()]);
        if (cancelled) {
          lm.close();
          return;
        }
        landmarkerRef.current = lm;
        connectionsRef.current = mod.HandLandmarker.HAND_CONNECTIONS;
        DrawClassRef.current = mod.DrawingUtils;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) drawRef.current = new mod.DrawingUtils(ctx);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [stream]);

  useEffect(() => {
    if (status !== "ready" || !stream) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let mpTs = 0;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.drawImage(video, 0, 0, w, h);

      if (!drawRef.current && DrawClassRef.current) {
        drawRef.current = new DrawClassRef.current(ctx);
      }
      const lm = landmarkerRef.current;
      const draw = drawRef.current;
      const connections = connectionsRef.current;
      if (!lm || !draw || !connections) return;
      const ts = video.currentTime;
      if (ts === lastTs.current) return;
      lastTs.current = ts;

      let result;
      try {
        mpTs = Math.max(mpTs + 1, Math.round(ts * 1000));
        result = lm.detectForVideo(video, mpTs);
      } catch {
        return;
      }

      const hands = result.landmarks ?? [];
      for (const landmarks of hands) {
        draw.drawConnectors(landmarks, connections, {
          color: STROKE,
          lineWidth: 3,
        });
        draw.drawLandmarks(landmarks, {
          color: FILL,
          fillColor: STROKE,
          lineWidth: 1,
          radius: 3,
        });
      }

      const count = hands.length;
      const labels = (result.handedness ?? []).map((h) => h[0]?.categoryName ?? "Hand");
      if (count !== lastCount.current) {
        lastCount.current = count;
        setHandCount(count);
        setHandLabels(labels);
        onHandsRef.current?.(count);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, stream]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-raised shadow-[var(--shadow-border)]">
      <div className="aspect-video bg-bg">
        {stream ? (
          <>
            <video
              ref={videoRef}
              className="pointer-events-none absolute size-px opacity-0"
              playsInline
              autoPlay
              muted={muted}
            />
            <canvas ref={canvasRef} className="size-full object-cover" />
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Video className="size-8 text-subtle" />
            <p className="text-sm text-muted">{waiting}</p>
          </div>
        )}
      </div>
      <p className="absolute top-2 left-2 rounded-md bg-bg/80 px-2 py-1 text-xs tracking-wide uppercase">
        {label}
      </p>
      {stream ? (
        <p
          className={cn(
            "absolute top-2 right-2 rounded-md px-2 py-1 text-xs tracking-wide uppercase",
            handCount > 0
              ? "bg-success/90 text-bg"
              : status === "loading"
                ? "bg-bg/80 text-muted"
                : status === "error"
                  ? "bg-bg/80 text-danger"
                  : "bg-bg/80 text-muted",
          )}
        >
          {status === "loading"
            ? "Loading tracker"
            : status === "error"
              ? "Tracker failed"
              : handCount > 0
                ? `${handLabels.join(" · ") || "Hand"} locked`
                : "Show a hand"}
        </p>
      ) : null}
    </div>
  );
}
