(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.KickUrl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_LEN = 240;
  const CHANNEL_RE = /^[A-Za-z0-9_-]{3,32}$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CLIP_RE = /^[A-Za-z0-9_-]{4,96}$/;
  const STAMP_RE = /^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/i;
  const RESERVED = new Set([
    'about', 'api', 'browse', 'categories', 'category', 'channel', 'channels',
    'clip', 'clips', 'community', 'dashboard', 'directory', 'embed', 'explore',
    'following', 'help', 'home', 'live', 'login', 'messages', 'notifications',
    'player', 'plus', 'premium', 'privacy', 'register', 'search', 'settings',
    'signup', 'terms', 'video', 'videos',
  ]);

  function emptyLink() {
    return { href: '', kind: '', channel: '', videoId: '', clipSlug: '', label: '' };
  }

  function channelOf(slug) {
    const text = String(slug || '');
    if (!CHANNEL_RE.test(text) || RESERVED.has(text.toLowerCase())) return '';
    return text;
  }

  function stampOf(url) {
    const t = String((url && url.searchParams && url.searchParams.get('t')) || '').trim();
    if (!t) return '';
    if (/^\d+$/.test(t)) return t;
    if (STAMP_RE.test(t) && /[hms]/i.test(t)) return t.toLowerCase();
    return '';
  }

  function withStamp(href, stamp) {
    return stamp ? `${href}?t=${encodeURIComponent(stamp)}` : href;
  }

  function pack(href, kind, extra) {
    return {
      href,
      kind,
      channel: (extra && extra.channel) || '',
      videoId: (extra && extra.videoId) || '',
      clipSlug: (extra && extra.clipSlug) || '',
      label: String(href || '').replace(/^https:\/\//i, ''),
    };
  }

  function parseKickMedia(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return emptyLink();
    if (text.length > MAX_LEN) return null;

    const bare = channelOf(text);
    if (bare && !/[./]/.test(text)) {
      return pack(`https://kick.com/${bare}`, 'live', { channel: bare });
    }

    let parsed;
    try {
      parsed = new URL(text.includes('://') ? text : `https://${text}`);
    } catch (_err) {
      return null;
    }
    const host = String(parsed.hostname || '').replace(/^www\./i, '').toLowerCase();
    if (host !== 'kick.com' && host !== 'player.kick.com') return null;
    const parts = String(parsed.pathname || '').split('/').filter(Boolean);
    if (!parts.length) return null;
    const stamp = stampOf(parsed);

    if (host === 'player.kick.com') {
      const channel = channelOf(parts[0]);
      if (!channel || parts.length > 1) return null;
      return pack(`https://kick.com/${channel}`, 'live', { channel });
    }

    const first = String(parts[0] || '').toLowerCase();
    if (first === 'video' && UUID_RE.test(parts[1] || '')) {
      const videoId = String(parts[1]).toLowerCase();
      return pack(withStamp(`https://kick.com/video/${videoId}`, stamp), 'vod', { videoId });
    }
    if (first === 'embed') {
      const channel = channelOf(parts[1]);
      if (!channel) return null;
      return pack(`https://kick.com/${channel}`, 'live', { channel });
    }

    const channel = channelOf(parts[0]);
    if (!channel) return null;
    const second = String(parts[1] || '').toLowerCase();
    const third = parts[2] || '';

    if ((second === 'videos' || second === 'video') && UUID_RE.test(third)) {
      const videoId = String(third).toLowerCase();
      return pack(
        withStamp(`https://kick.com/${channel}/videos/${videoId}`, stamp),
        'vod',
        { channel, videoId }
      );
    }
    if ((second === 'clips' || second === 'clip') && CLIP_RE.test(third)) {
      return pack(`https://kick.com/${channel}/clips/${third}`, 'clip', { channel, clipSlug: third });
    }
    if (!second || ((second === 'live' || second === 'videos' || second === 'clips') && !third)) {
      return pack(`https://kick.com/${channel}`, 'live', { channel });
    }
    return null;
  }

  function sanitizeKickStream(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    const parsed = parseKickMedia(text);
    if (!parsed || !parsed.href) {
      throw Object.assign(
        new Error('Paste a Kick channel, livestream, VOD, or clip URL (kick.com/yourname).'),
        { status: 400 }
      );
    }
    return parsed.href;
  }

  return {
    MAX_LEN,
    parseKickMedia,
    sanitizeKickStream,
  };
});
