(function () {
  var b = document.querySelector('.burger');
  var n = document.getElementById('nav');
  if (b && n) {
    b.addEventListener('click', function () {
      var open = n.classList.toggle('open');
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    n.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        n.classList.remove('open');
        b.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var postsEl = document.getElementById('posts');
  if (!postsEl) return;
  postsEl.innerHTML = (window.POSTS || []).map(function (p) {
    return '<a class="post" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
      '<div class="post-top"><span class="tag">' + esc(p.tag) + '</span><time>' + esc(p.date) + '</time></div>' +
      '<p>' + esc(p.text) + '</p><span class="go">View on X →</span></a>';
  }).join('');
})();
