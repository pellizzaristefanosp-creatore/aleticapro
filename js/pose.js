// Wrapper MediaPipe Pose Landmarker (eseguito interamente nel browser, nessun upload del video).
import { FilesetResolver, PoseLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const WASM = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  full: new URL('../models/pose_landmarker_full.task', import.meta.url).href,
  lite: new URL('../models/pose_landmarker_lite.task', import.meta.url).href,
};

let fileset = null;
const cache = {};

async function create(mode, model, delegate) {
  fileset ||= await FilesetResolver.forVisionTasks(WASM);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    runningMode: mode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export async function getLandmarker(mode = 'VIDEO', model = 'full') {
  const key = `${mode}-${model}`;
  if (cache[key]) return cache[key];
  try {
    cache[key] = await create(mode, model, 'GPU');
  } catch (e) {
    console.warn('GPU non disponibile, uso CPU', e);
    cache[key] = await create(mode, model, 'CPU');
  }
  return cache[key];
}

/** Rilascia l'istanza VIDEO per ripartire con timestamp da zero (tracking pulito). */
export function resetVideoLandmarker(model = 'full') {
  const key = `VIDEO-${model}`;
  cache[key]?.close();
  delete cache[key];
}

export function landmarksFromResult(res) {
  const l = res?.landmarks?.[0];
  if (!l) return null;
  return l.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 0 }));
}
