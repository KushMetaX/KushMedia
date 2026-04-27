// attachFade(audioElement, fadeSeconds)
// - Uses Web Audio API (preferred) to create a GainNode and schedule a linear ramp
//   that fades the audio to 0 over the last `fadeSeconds` of playback.
// - If Web Audio API is unavailable or blocked, falls back to a simple interval
//   that lowers `audio.volume` smoothly during the last `fadeSeconds`.
// Usage example:
//   const audio = document.querySelector('audio');
//   const controller = attachFade(audio, 3);
//   // controller.detach() to remove listeners when done

function attachFade(audioEl, fadeSeconds = 3) {
  if (!audioEl) throw new Error('attachFade: audio element required');
  let audioCtx = null;
  let source = null;
  let gainNode = null;
  let fading = false;
  let fallbackInterval = null;

  // persistent handlers so we can detach later
  function onPlay() {
    // try to create/resume audio context only after user gestures
    tryCreateAudioContext();
    fading = false;
    restoreGainOrVolume();
  }

  function onLoadedMeta() {
    // if playing already, ensure scheduling will occur
    if (!audioEl.paused) {
      tryCreateAudioContext();
      fading = false;
      restoreGainOrVolume();
    }
  }

  function onTimeUpdate() {
    if (fading) return;
    const dur = audioEl.duration;
    if (!dur || isNaN(dur) || dur === Infinity) return;
    const remain = dur - audioEl.currentTime;
    if (remain <= 0) return;
    if (remain <= fadeSeconds) {
      fading = true;
      startFade(Math.min(remain, fadeSeconds));
    }
  }

  function onEnded() {
    // reset volumes so next play is full volume
    cancelFade();
    restoreGainOrVolume();
  }

  function tryCreateAudioContext() {
    if (audioCtx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return; // not supported
      audioCtx = new C();
      // create source and gain
      source = audioCtx.createMediaElementSource(audioEl);
      gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
    } catch (err) {
      // creating AudioContext may throw if browser blocks; leave audioCtx null
      audioCtx = null;
    }
  }

  function startFade(actualFadeSeconds) {
    // prefer WebAudio fade if available
    if (audioCtx && gainNode) {
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const now = audioCtx.currentTime;
        // cancel any scheduled values and start from current gain
        gainNode.gain.cancelScheduledValues(now);
        // get current gain value (safely)
        // setValueAtTime requires a numeric current value; read it from gainNode.gain.value
        const currentVal = typeof gainNode.gain.value === 'number' ? gainNode.gain.value : 1;
        gainNode.gain.setValueAtTime(currentVal, now);
        gainNode.gain.linearRampToValueAtTime(0.0, now + actualFadeSeconds);
      } catch (e) {
        // fallback if something goes wrong
        fallbackFade(actualFadeSeconds);
      }
    } else {
      fallbackFade(actualFadeSeconds);
    }
  }

  function fallbackFade(actualFadeSeconds) {
    // Simple fallback using audio.volume property
    if (fallbackInterval) clearInterval(fallbackInterval);
    const startVol = typeof audioEl.volume === 'number' ? audioEl.volume : 1;
    const steps = Math.max(8, Math.round(actualFadeSeconds * 30)); // ~30hz
    let step = 0;
    fallbackInterval = setInterval(() => {
      step++;
      const t = step / steps;
      const v = Math.max(0, startVol * (1 - t));
      audioEl.volume = v;
      if (step >= steps) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    }, (actualFadeSeconds * 1000) / steps);
  }

  function cancelFade() {
    try {
      if (audioCtx && gainNode) {
        const now = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(1, now);
      }
    } catch (e) {}
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    fading = false;
  }

  function restoreGainOrVolume() {
    // set gain back to 1 or volume back to 1
    try {
      if (audioCtx && gainNode) {
        const now = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(1, now);
      } else {
        audioEl.volume = 1;
      }
    } catch (e) {
      audioEl.volume = 1;
    }
  }

  // attach listeners
  audioEl.addEventListener('play', onPlay);
  audioEl.addEventListener('loadedmetadata', onLoadedMeta);
  audioEl.addEventListener('timeupdate', onTimeUpdate);
  audioEl.addEventListener('ended', onEnded);

  // return a controller so the caller can detach when needed
  return {
    detach() {
      audioEl.removeEventListener('play', onPlay);
      audioEl.removeEventListener('loadedmetadata', onLoadedMeta);
      audioEl.removeEventListener('timeupdate', onTimeUpdate);
      audioEl.removeEventListener('ended', onEnded);
      cancelFade();
      try {
        if (audioCtx) {
          // disconnect nodes (best-effort)
          try { source && source.disconnect(); } catch (e) {}
          try { gainNode && gainNode.disconnect(); } catch (e) {}
          try { audioCtx.close(); } catch (e) {}
        }
      } catch (e) {}
      audioCtx = null; source = null; gainNode = null;
    }
  };
}

// attach to window for easy usage when included as a script
if (typeof window !== 'undefined') window.attachFade = attachFade;

export default attachFade;
