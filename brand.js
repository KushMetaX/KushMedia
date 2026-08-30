// brand.js — Hamburger menu toggle + active nav for KushMetaX inner pages
// Skips initialization when loaded inside an iframe (portal crossfade compat)
(function () {
  if (window !== window.top) return; // inside iframe — do nothing

  function normalizePath(path) {
    var cleanPath = String(path || '/').split('#')[0].split('?')[0];

    if (!cleanPath || cleanPath === '.') {
      return '/';
    }

    if (!cleanPath.startsWith('/')) {
      var base = window.location.pathname;
      base = base.endsWith('/') ? base : base.substring(0, base.lastIndexOf('/') + 1);
      cleanPath = new URL(cleanPath, window.location.origin + base).pathname;
    }

    cleanPath = cleanPath.replace(/\/+/g, '/');

    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }

    if (cleanPath.endsWith('/index.html')) {
      cleanPath = cleanPath.slice(0, -11) || '/';
    }

    if (cleanPath.endsWith('.html')) {
      cleanPath = cleanPath.slice(0, -5) || '/';
    }

    return cleanPath || '/';
  }

  function init() {
    var btn = document.querySelector('.hamburger');
    var overlay = document.querySelector('.nav-overlay');
    if (!btn || !overlay) return;

    // Toggle menu
    btn.addEventListener('click', function () {
      document.body.classList.toggle('menu-open');
    });

    // Close on nav link click
    var links = overlay.querySelectorAll('.nav-link');
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        document.body.classList.remove('menu-open');
      });
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
        document.body.classList.remove('menu-open');
        btn.focus();
      }
    });

    // Click outside menu content closes it
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        document.body.classList.remove('menu-open');
      }
    });

    // Highlight active page
    var currentPath = normalizePath(window.location.pathname);
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;

      var linkPath = normalizePath(href);
      if (linkPath === currentPath) {
        link.classList.add('active');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
