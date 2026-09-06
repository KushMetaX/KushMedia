import type { HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker.task";

type VisionMod = typeof import("@mediapipe/tasks-vision");

let modPromise: Promise<VisionMod> | null = null;
let filesetPromise: Promise<Awaited<ReturnType<VisionMod["FilesetResolver"]["forVisionTasks"]>>> | null =
  null;

export function loadVision(): Promise<VisionMod> {
  modPromise ??= import("@mediapipe/tasks-vision").catch((err) => {
    modPromise = null;
    throw err;
  });
  return modPromise;
}

function getFileset(mod: VisionMod) {
  filesetPromise ??= mod.FilesetResolver.forVisionTasks(WASM_PATH).catch((err) => {
    filesetPromise = null;
    throw err;
  });
  return filesetPromise;
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const mod = await loadVision();
  const vision = await getFileset(mod);
  const options = {
    runningMode: "VIDEO" as const,
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  };
  try {
    return await mod.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      ...options,
    });
  } catch {
    return mod.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      ...options,
    });
  }
}
