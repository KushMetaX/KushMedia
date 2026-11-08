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

    if (!overlay.id) overlay.id = 'site-nav';
    btn.setAttribute('aria-controls', overlay.id);

    if (!btn.querySelector('.hamburger-bars')) {
      var bars = document.createElement('span');
      bars.className = 'hamburger-bars';
      bars.setAttribute('aria-hidden', 'true');
      Array.prototype.slice.call(btn.childNodes).forEach(function (node) {
        if (node.nodeType === 1) bars.appendChild(node);
        else node.remove();
      });
      btn.appendChild(bars);
    }

    var label = btn.querySelector('.hamburger-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'hamburger-label';
      btn.appendChild(label);
    }

    function setOpen(open) {
      document.body.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      label.textContent = open ? 'Close' : 'Menu';
    }

    setOpen(false);

    btn.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('menu-open'));
    });

    // Let the link navigate. Closing the overlay in the click handler
    // hides the link before the browser follows it.
    var links = overlay.querySelectorAll('.nav-link');

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
        setOpen(false);
        btn.focus();
      }
    });

    // Click outside menu content closes it
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        setOpen(false);
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
