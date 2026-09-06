#!/usr/bin/env bash
# Copies MediaPipe WASM from node_modules and downloads the hand model
# into public/mediapipe so the IRL table can run on-device.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# When this script lives inside the unzipped pack, ROOT is the pack.
# After files are copied into an app, run it from the app root:
APP="${1:-.}"
mkdir -p "$APP/public/mediapipe"
if [ -d "$APP/node_modules/@mediapipe/tasks-vision/wasm" ]; then
  cp -a "$APP/node_modules/@mediapipe/tasks-vision/wasm" "$APP/public/mediapipe/wasm"
else
  echo "Run npm install @mediapipe/tasks-vision first." >&2
  exit 1
fi
curl -fsSL -o "$APP/public/mediapipe/hand_landmarker.task" \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
echo "MediaPipe assets ready in $APP/public/mediapipe"
