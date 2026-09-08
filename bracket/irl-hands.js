/**
 * On-device MediaPipe hand landmarks over IRL table cameras.
 */
(function (global) {
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const STROKE = '#e8a317';
  const FILL = '#f6e7c8';

  let visionMod = null;
  let landmarker = null;
  let loadPromise = null;
  let raf = 0;
  let mpTs = 0;
  let lastRun = 0;
  let feedCursor = 0;
  const feeds = new Map();

  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
  ];

  function load() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        visionMod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
        const fileset = await visionMod.FilesetResolver.forVisionTasks(WASM);
        const options = {
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        };
        try {
          landmarker = await visionMod.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
            ...options,
          });
        } catch (_err) {
          landmarker = await visionMod.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
            ...options,
          });
        }
        return landmarker;
      } catch (err) {
        loadPromise = null;
        throw err;
      }
    })();
    return loadPromise;
  }

  function drawHands(ctx, w, h, landmarks) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, w / 280);
    ctx.strokeStyle = STROKE;
    ctx.fillStyle = FILL;
    (landmarks || []).forEach((hand) => {
      CONNECTIONS.forEach(([a, b]) => {
        const pa = hand[a];
        const pb = hand[b];
        if (!pa || !pb) return;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      });
      hand.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, Math.max(2, w / 220), 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!landmarker || !feeds.size) return;
    const now = performance.now();
    if (now - lastRun < 120) return;
    lastRun = now;
    const list = [...feeds.values()];
    const feed = list[feedCursor % list.length];
    feedCursor += 1;
    if (!feed) return;
    const video = feed.video;
    const canvas = feed.canvas;
    if (!video || !canvas || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const dw = Math.min(480, w);
    const dh = Math.max(1, Math.round(dw * h / w));
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ts = video.currentTime;
    if (ts === feed.lastTs) return;
    feed.lastTs = ts;
    const detectW = 320;
    const detectH = Math.max(1, Math.round(detectW * h / w));
    const detectC = feed.detectC || (feed.detectC = document.createElement('canvas'));
    if (detectC.width !== detectW) detectC.width = detectW;
    if (detectC.height !== detectH) detectC.height = detectH;
    const dctx = detectC.getContext('2d');
    if (!dctx) return;
    dctx.drawImage(video, 0, 0, detectW, detectH);
    let result;
    try {
      mpTs = Math.max(mpTs + 1, Math.round(now));
      result = landmarker.detectForVideo(detectC, mpTs);
    } catch (_err) {
      return;
    }
    const hands = result && result.landmarks ? result.landmarks : [];
    drawHands(ctx, dw, dh, hands);
    const count = hands.length;
    const labels = ((result && result.handedness) || []).map((row) => {
      const hit = Array.isArray(row) ? row[0] : row;
      return (hit && (hit.categoryName || hit.displayName)) || 'Hand';
    });
    if (count !== feed.count) {
      feed.count = count;
      feed.labels = labels;
      if (typeof feed.onHands === 'function') feed.onHands(count, labels);
    }
  }

  function ensureLoop() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function watch(video, canvas, onHands) {
    if (!video || !canvas) return { stop() {} };
    const key = video;
    feeds.set(key, {
      video,
      canvas,
      onHands,
      count: -1,
      labels: [],
      lastTs: -1,
    });
    load().then(() => {
      if (!feeds.has(key)) return;
      feeds.get(key).status = 'ready';
      if (typeof onHands === 'function') onHands(0, [], 'ready');
      ensureLoop();
    }).catch(() => {
      const feed = feeds.get(key);
      if (!feed) return;
      feed.status = 'error';
      if (typeof onHands === 'function') onHands(0, [], 'error');
    });
    if (typeof onHands === 'function') onHands(0, [], 'loading');
    ensureLoop();
    return {
      stop() {
        feeds.delete(key);
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!feeds.size && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
    };
  }

  function stopAll() {
    feeds.clear();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  global.DdlIrlHands = { load, watch, stopAll };
})(window);
