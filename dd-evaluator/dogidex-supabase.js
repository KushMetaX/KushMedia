/**
 * DogiDex on Supabase: passwords handled entirely by Supabase Auth (hosted; never touches your VPS).
 * Dex rows live in Postgres with RLS. Configure before this script loads:
 *
 *   window.__DOGIDEX_SUPABASE__ = {
 *     url: 'https://xxxxx.supabase.co',
 *     anonKey: 'eyJ...',
 *     emailRedirectUrl: 'https://yourdomain.com/dd-evaluator' // optional; avoids localhost in emails
 *   };
 *
 * anon key is public (safe in-browser) once RLS is enabled — see dd-evaluator/supabase-schema.sql
 */
(function (global) {
  'use strict';

  function dexTierFromUniqueCount(count) {
    var c = Math.max(0, Math.floor(Number(count) || 0));
    if (c >= 10000) return { tier: 6, rankTitle: 'Living Dex Legend' };
    if (c >= 5000) return { tier: 5, rankTitle: 'Floor Whale' };
    if (c >= 2000) return { tier: 4, rankTitle: 'Diamond Kennel' };
    if (c >= 500) return { tier: 3, rankTitle: 'Grail Scout' };
    if (c >= 100) return { tier: 2, rankTitle: 'Bag Builder' };
    if (c >= 1) return { tier: 1, rankTitle: 'Street Mint' };
    return { tier: 0, rankTitle: 'Unminted Curator' };
  }

  function getEmailRedirectUrl() {
    var C = global.__DOGIDEX_SUPABASE__ || {};
    var explicit = String(C.emailRedirectUrl || C.siteUrl || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    return String(global.location.href.split('#')[0] || '')
      .trim()
      .replace(/\/+$/, '');
  }

  function getCfg() {
    var C = global.__DOGIDEX_SUPABASE__ || {};
    return {
      url: String(C.url || '').replace(/\/+$/, ''),
      anonKey: String(C.anonKey || '').trim(),
    };
  }

  function configured() {
    var c = getCfg();
    return Boolean(c.url && c.anonKey && c.anonKey.length >= 20);
  }

  function storageKeys() {
    return { at: 'dogidex_sb_at', rt: 'dogidex_sb_rt' };
  }

  function getTokens() {
    try {
      var k = storageKeys();
      return {
        accessToken: sessionStorage.getItem(k.at) || null,
        refreshToken: sessionStorage.getItem(k.rt) || null,
      };
    } catch (_e) {
      return { accessToken: null, refreshToken: null };
    }
  }

  function setTokens(accessToken, refreshToken) {
    var k = storageKeys();
    if (accessToken) sessionStorage.setItem(k.at, accessToken); else sessionStorage.removeItem(k.at);
    if (refreshToken) sessionStorage.setItem(k.rt, refreshToken); else sessionStorage.removeItem(k.rt);
  }

  function clearTokens() {
    setTokens(null, null);
  }

  /**
   * Magic links, email confirmations, and recovery redirects often land with
   * #access_token=...&refresh_token=... (implicit flow). We use manual fetch
   * elsewhere, so we must copy those into sessionStorage or the user looks logged out.
   */
  function parseOAuthRedirectParams(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var at = null;
    var rt = null;
    var err = null;
    try {
      var sp = new URLSearchParams(raw);
      at = sp.get('access_token');
      rt = sp.get('refresh_token');
      err = sp.get('error_description') || sp.get('error');
    } catch (_e) {}
    if (!at) {
      var parts = raw.split('&');
      for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        var eq = seg.indexOf('=');
        if (eq < 0) continue;
        var k = seg.slice(0, eq);
        var v = seg.slice(eq + 1);
        try {
          k = decodeURIComponent(k.replace(/\+/g, ' '));
          v = decodeURIComponent(v.replace(/\+/g, ' '));
        } catch (_e2) {}
        if (k === 'access_token') at = v;
        else if (k === 'refresh_token') rt = v;
        else if (k === 'error_description' || k === 'error') err = err || v;
      }
    }
    if (err) console.warn('[DogidexSupabase] Auth redirect error:', err);
    if (!at) return null;
    return { at: at, rt: rt || null };
  }

  function consumeAuthRedirectFromUrl() {
    if (!global.location) return false;
    var hashRaw = String(global.location.hash || '').replace(/^#/, '');
    var pair = hashRaw ? parseOAuthRedirectParams(hashRaw) : null;
    var fromQuery = false;
    if (!pair && global.location.search) {
      pair = parseOAuthRedirectParams(global.location.search.slice(1));
      fromQuery = !!pair;
    }
    if (!pair) return false;
    try {
      setTokens(pair.at, pair.rt);
    } catch (storErr) {
      console.warn('[DogidexSupabase] Could not store session:', storErr && storErr.message ? storErr.message : storErr);
      return false;
    }
    try {
      if (global.sessionStorage) global.sessionStorage.setItem('dogidex_just_redirect_auth', '1');
    } catch (_s) {}
    try {
      if (fromQuery) {
        var u = new URL(global.location.href);
        ['access_token', 'refresh_token', 'expires_in', 'token_type', 'type'].forEach(function (k) {
          u.searchParams.delete(k);
        });
        global.history.replaceState(null, '', u.pathname + u.search);
      } else {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      }
    } catch (_e) {}
    return true;
  }

  async function authFetch(method, authPath, bodyObj, bearer) {
    var c = getCfg();
    var headers = {
      apikey: c.anonKey,
      Authorization: 'Bearer ' + (bearer || c.anonKey),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    var opt = { method: method || 'POST', headers: headers };
    if (bodyObj && method !== 'GET') opt.body = JSON.stringify(bodyObj);
    var url = c.url.replace(/\/+$/, '') + '/auth/v1' + authPath;
    var res = await fetch(url, opt);
    var txt = await res.text();
    var data = null;
    if (txt && txt.trim()) {
      try {
        data = JSON.parse(txt);
      } catch (_e) {
        data = null;
      }
    }
    if (!res.ok) {
      var msg = data && (data.msg || data.error_description || data.message || data.error);
      var err = new Error(typeof msg === 'string' ? msg : res.statusText);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  async function refreshAccessToken() {
    var c = getCfg();
    var rt = getTokens().refreshToken;
    if (!rt) return null;
    var data = await authFetch(
      'POST',
      '/token?grant_type=refresh_token',
      { refresh_token: rt },
      c.anonKey
    );
    if (data && data.access_token) {
      setTokens(data.access_token, data.refresh_token || rt);
      return data.access_token;
    }
    return null;
  }

  /**
   * @param headerOverrides Optional — e.g. { Range: '0-0' } for exact count without hauling rows.
   */
  async function restFetch(method, queryPath, bodyObj, headerOverrides) {
    var c = getCfg();
    var token = getTokens().accessToken;
    if (!token) token = await refreshAccessToken();
    if (!token) {
      var err = new Error('Not authenticated.');
      err.status = 401;
      throw err;
    }
    var h = headerOverrides ? Object.assign({}, headerOverrides) : {};
    var m = method || 'GET';
    var headers = {
      apikey: c.anonKey,
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    };
    if (m !== 'GET' && m !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    if (m === 'GET') {
      headers.Prefer = h.Prefer || 'count=exact';
      if (h.Range !== undefined && h.Range !== null) headers.Range = String(h.Range);
    } else {
      headers.Prefer = h.Prefer || 'return=minimal';
    }
    Object.keys(h).forEach(function (k) {
      if (k !== 'Prefer' && k !== 'Range') headers[k] = h[k];
    });
    var opt = { method: m, headers: headers };
    if (bodyObj && m !== 'GET' && m !== 'HEAD') opt.body = JSON.stringify(bodyObj);
    var url = c.url.replace(/\/+$/, '') + '/rest/v1/' + queryPath;

    async function doit(tok) {
      headers.Authorization = 'Bearer ' + tok;
      return fetch(url, opt);
    }

    var res = await doit(token);
    if (res.status === 401) {
      token = await refreshAccessToken();
      if (!token) throw Object.assign(new Error('Session expired.'), { status: 401 });
      res = await doit(token);
    }
    var txt = await res.text();
    var data = txt
      ? /^\s*[\[{]/.test(txt)
        ? JSON.parse(txt)
        : txt
      : null;
    if (!res.ok) {
      var er =
        typeof data === 'object' && data && data.message
          ? new Error(data.message + (data.hint ? ' — ' + data.hint : ''))
          : new Error(res.statusText);
      er.status = res.status;
      er.body = data;
      throw er;
    }
    return { res: res, data: data };
  }

  function parseTotalFromContentRange(res) {
    var cr =
      res.headers.get('Content-Range') || res.headers.get('content-range') || '';
    var m = cr.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]) || 0;
    return 0;
  }

  /** Count rows without downloading all dog numbers. */
  async function loadDexAggregate(userId) {
    var { res } = await restFetch(
      'GET',
      'dogidex_entries?select=dog_number&user_id=eq.' + encodeURIComponent(userId),
      null,
      { Prefer: 'count=exact', Range: '0-0' }
    );
    var exact = parseTotalFromContentRange(res);
    var t = dexTierFromUniqueCount(exact);
    return { uniqueCount: exact, tier: t.tier, rankTitle: t.rankTitle };
  }

  async function refreshAuthSession() {
    if (!configured()) return null;
    var c = getCfg();
    var token = getTokens().accessToken;
    if (!token) token = await refreshAccessToken();
    if (!token) return null;

    async function fetchUser(tok) {
      var headers = {
        apikey: c.anonKey,
        Authorization: 'Bearer ' + tok,
        Accept: 'application/json',
      };
      var u = await fetch(c.url.replace(/\/+$/, '') + '/auth/v1/user', { headers: headers });
      if (!u.ok) return null;
      return u.json();
    }

    var userJson = await fetchUser(token);
    if (!userJson || !userJson.id) {
      var rt0 = getTokens().refreshToken;
      if (rt0) {
        var tok2 = await refreshAccessToken();
        if (tok2) userJson = await fetchUser(tok2);
      }
    }
    if (!userJson || !userJson.id) {
      clearTokens();
      return null;
    }

    var dex = await loadDexAggregate(userJson.id).catch(function () {
      var z = dexTierFromUniqueCount(0);
      return { uniqueCount: 0, tier: z.tier, rankTitle: z.rankTitle };
    });

    return {
      ok: true,
      user: { id: userJson.id, email: userJson.email },
      dex: dex,
    };
  }

  async function login(email, password) {
    var c = getCfg();
    var data = await authFetch(
      'POST',
      '/token?grant_type=password',
      { email: String(email || '').trim(), password: String(password || '') },
      c.anonKey
    );
    if (!data.access_token) throw new Error('Login failed.');
    setTokens(data.access_token, data.refresh_token);
    return refreshAuthSession();
  }

  async function register(email, password) {
    var redirect = getEmailRedirectUrl();
    try {
      var data = await authFetch('POST', '/signup', {
        email: String(email || '').trim(),
        password: String(password || ''),
        data: {},
        redirect_to: redirect,
      });
      if (data.access_token && data.refresh_token) {
        setTokens(data.access_token, data.refresh_token);
        return refreshAuthSession();
      }
      return {
        ok: true,
        needsEmailConfirm: true,
        message: 'Confirm the email Supabase sends you, then log in.',
      };
    } catch (e) {
      var bm = String((e.body && e.message) || e.message || '').toLowerCase();
      if (bm.indexOf('registered') !== -1 || bm.indexOf('already') !== -1)
        throw new Error('This email already has an account. Try logging in.');
      throw e;
    }
  }

  async function logout() {
    clearTokens();
  }

  async function forgotPassword(email) {
    if (!configured()) throw new Error('Supabase not configured.');
    var c = getCfg();
    var redirect = getEmailRedirectUrl();
    var url = c.url.replace(/\/+$/, '') + '/auth/v1/recover';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: c.anonKey,
        Authorization: 'Bearer ' + c.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(email || '').trim(),
        redirect_to: redirect,
      }),
    });
    if (!res.ok && ![200, 204].includes(res.status)) {
      var txt = await res.text();
      var parsed = txt;
      try {
        parsed = JSON.parse(txt);
      } catch (_e2) {}
      var message =
        parsed && typeof parsed === 'object' && parsed.msg
          ? parsed.msg
          : 'Password reset request failed.';
      throw new Error(message);
    }
    return true;
  }

  async function postDexIndex(dogNum) {
    var n = Math.floor(Number(dogNum));
    if (!Number.isFinite(n) || n < 1 || n > 10000) return null;
    try {
      await restFetch('POST', 'dogidex_entries', {
        dog_number: n,
        indexed_at: Date.now(),
      });
    } catch (err) {
      if (err.status === 409) {
        /** duplicate unique — treat as OK */
      } else throw err;
    }
    return refreshAuthSession();
  }

  async function dexFetchPage(page, limit) {
    var sess = await refreshAuthSession();
    if (!sess || !sess.user) throw Object.assign(new Error('Not authenticated.'), { status: 401 });
    var off = Math.max(0, (page - 1) * limit);
    var path =
      'dogidex_entries?select=dog_number,indexed_at&user_id=eq.' +
      encodeURIComponent(sess.user.id) +
      '&order=indexed_at.desc&limit=' +
      limit +
      '&offset=' +
      off;
    var { res: res1, data: rows } = await restFetch('GET', path, null);
    var total = parseTotalFromContentRange(res1);
    var totalPages =
      total > 0 ? Math.ceil(total / limit) : Array.isArray(rows) && rows.length ? page : 1;
    return {
      ok: true,
      page: page,
      totalPages: totalPages,
      dex: sess.dex || {},
      entries: Array.isArray(rows)
        ? rows.map(function (r) {
            return { dogNumber: Number(r.dog_number), indexed_at: r.indexed_at };
          })
        : [],
    };
  }

  consumeAuthRedirectFromUrl();

  global.DogidexSupabase = {
    configured: configured,
    /** Current Supabase access token (for bridging to KushMetaX cookie sessions / paywall). */
    getAccessToken: function () {
      return getTokens().accessToken;
    },
    consumeAuthRedirectFromUrl: consumeAuthRedirectFromUrl,
    refreshAuthSession: refreshAuthSession,
    login: login,
    register: register,
    logout: logout,
    forgotPassword: forgotPassword,
    postDexIndex: postDexIndex,
    dexFetchPage: dexFetchPage,
    dexTierFromUniqueCount: dexTierFromUniqueCount,
    clearTokensOnMissingConfig: clearTokens,
  };
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
