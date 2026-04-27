// video-fade-init.js
// Finds all <video data-fade="N"> elements and attaches the attachFade helper
// Usage: <video src="..." data-fade="3" controls></video>
(function () {
  function parseFadeAttr(v) {
    if (!v) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function init() {
    if (!window.attachFade) {
      // If helper not loaded yet, try again shortly
      setTimeout(init, 120);
      return;
    }

    const videos = document.querySelectorAll('video[data-fade]');
    videos.forEach((video) => {
      const raw = video.getAttribute('data-fade');
      const fadeSec = parseFadeAttr(raw) || 3;
      try {
        // attachFade works with <audio> or <video> (MediaElementSource)
        const controller = window.attachFade(video, fadeSec);
        // store controller so pages can detach if needed
        video.__fadeController = controller;
      } catch (e) {
        // no-op
        console.warn('attachFade failed', e);
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
