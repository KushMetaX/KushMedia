/**
 * Full-mesh WebRTC rooms for the IRL table. Signaling is polled from
 * /tourney-api/rtc (with the same host-quirk fallbacks as the rest of tourney).
 */
(function (global) {
  const RTC_BASES = ['/tourney-api/rtc', '/kmx-tourney/rtc', '/kk-tourney/rtc', '/kmx-rtc', '/kk-rtc', '/api/rtc'];
  const FAST_POLL_MS = 400;
  const IDLE_POLL_MS = 2000;
  const PING_INTERVAL_MS = 2000;
  const STALL_MS = 10_000;
  const MAX_RECOVERY_ATTEMPTS = 3;
  const SIGNAL_RETRY_DELAYS_MS = [250, 750];

  let rtcBase = RTC_BASES[0];

  function looksHtml(text) {
    return /^\s*</.test(String(text || ''));
  }

  async function rtcFetch(method, query, body, extra) {
    const bases = [rtcBase].concat(RTC_BASES.filter((base) => base !== rtcBase));
    let lastErr;
    for (const base of bases) {
      try {
        const url = method === 'GET' ? `${base}?${query}` : base;
        const res = await fetch(url, {
          method,
          headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          body: method === 'POST' ? JSON.stringify(body) : undefined,
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: Boolean(extra && extra.keepalive),
        });
        const text = await res.text();
        if (looksHtml(text) && !String(text).includes('"error"')) {
          lastErr = new Error(`Signaling returned a web page (${res.status})`);
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Signaling failed (${res.status})`);
        rtcBase = base;
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Signaling failed');
  }

  function defaultIceServers() {
    return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  }

  function descJson(desc) {
    if (!desc) return null;
    if (typeof desc.toJSON === 'function') return desc.toJSON();
    return { type: desc.type, sdp: desc.sdp };
  }

  class P2PRoom {
    constructor(opts) {
      this.opts = opts;
      this.peers = new Map();
      this.signalQueues = new Map();
      this.cursor = 0;
      this.pollTimer = null;
      this.pingTimer = null;
      this.closed = false;
      this.everPolled = false;
      this.lastPeersFingerprint = '';
      this.localStream = null;
      this.rosterSeats = new Map();
    }

    async join() {
      try {
        await this.pollOnce();
      } catch (err) {
        if (this.opts.onJoinError) this.opts.onJoinError(err);
      }
      if (this.closed) return;
      this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
      this.pingTimer = setInterval(() => {
        this.pingAll();
        this.watchdog();
      }, PING_INTERVAL_MS);
    }

    close() {
      this.closed = true;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      if (this.pingTimer) clearInterval(this.pingTimer);
      for (const slot of this.peers.values()) slot.pc.close();
      this.peers.clear();
      void rtcFetch('POST', '', {
        op: 'leave',
        room: this.opts.room,
        peer: this.opts.selfId,
      }, { keepalive: true }).catch(() => {});
    }

    broadcast(data) {
      const wire = JSON.stringify({ t: 'd', d: data });
      for (const slot of this.peers.values()) {
        if (slot.state && slot.state.readyState === 'open') slot.state.send(wire);
      }
    }

    send(data, peerId) {
      const wire = JSON.stringify({ t: 'd', d: data });
      const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
      for (const slot of targets) {
        if (slot && slot.reliable && slot.reliable.readyState === 'open') slot.reliable.send(wire);
      }
    }

    seatOf(peerId) {
      const fromRoster = this.rosterSeats && this.rosterSeats.get(peerId);
      if (fromRoster === 1 || fromRoster === 2) return fromRoster;
      const slot = this.peers.get(peerId);
      const n = slot && slot.info && slot.info.seat;
      return n === 1 || n === 2 ? n : 0;
    }

    peerList() {
      return [...this.peers.values()].map((s) => ({ ...s.info }));
    }

    setLocalStream(stream) {
      this.localStream = stream;
      for (const slot of this.peers.values()) this.syncTracks(slot);
    }

    syncTracks(slot) {
      const stream = this.localStream;
      const senders = slot.pc.getSenders();
      if (!stream) {
        for (const sender of senders) {
          if (sender.track) slot.pc.removeTrack(sender);
        }
        return;
      }
      for (const track of stream.getTracks()) {
        const existing = senders.find((s) => s.track && s.track.kind === track.kind);
        if (existing) {
          if (existing.track !== track) void existing.replaceTrack(track);
        } else {
          slot.pc.addTrack(track, stream);
        }
      }
    }

    schedulePoll(delay) {
      if (this.closed) return;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(() => void this.poll(), delay);
    }

    anyPairConnecting() {
      for (const s of this.peers.values()) {
        if (s.terminal) continue;
        if (s.info.connectionState !== 'connected') return true;
      }
      return false;
    }

    async pollOnce() {
      const params = new URLSearchParams({
        room: this.opts.room,
        peer: this.opts.selfId,
        name: this.opts.name || '',
        since: String(this.cursor),
        seat: this.opts.seat === 1 || this.opts.seat === 2 ? String(this.opts.seat) : '0',
      });
      const body = await rtcFetch('GET', params.toString());
      if (this.closed) return;
      if (!this.everPolled) {
        this.everPolled = true;
        if (this.opts.onConnected) this.opts.onConnected();
      }
      this.reconcileRoster(body.peers || []);
      const roster = new Set((body.peers || []).map((p) => p.id));
      for (const sig of body.signals || []) {
        this.cursor = Math.max(this.cursor, sig.id);
        await this.onSignal(sig.from, sig.kind, sig.payload, roster);
        if (this.closed) return;
      }
    }

    async poll() {
      if (this.closed) return;
      try {
        await this.pollOnce();
      } catch (err) {
        const msg = err && err.message ? String(err.message) : '';
        if (/listed player|Discord/i.test(msg) && this.opts.onJoinError) {
          this.opts.onJoinError(err);
        }
      }
      this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
    }

    reconcileRoster(list) {
      const alive = new Set(list.map((p) => p.id));
      this.rosterSeats = new Map();
      for (const p of list) {
        const claimed = p.seat === 1 || p.seat === 2 ? p.seat : 0;
        this.rosterSeats.set(p.id, claimed);
        if (p.id === this.opts.selfId) continue;
        const existing = this.peers.get(p.id);
        if (existing) {
          existing.info.name = p.name;
          existing.info.seat = claimed;
        } else {
          this.connectTo(p.id, p.name, this.opts.selfId > p.id, claimed);
        }
      }
      for (const [id, slot] of this.peers) {
        if (!alive.has(id)) {
          slot.pc.close();
          this.peers.delete(id);
        }
      }
      this.emitPeers();
    }

    connectTo(peerId, name, initiator, seat) {
      if (this.closed) return null;
      const pc = new RTCPeerConnection({
        iceServers: this.opts.iceServers || defaultIceServers(),
      });
      const slot = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
        lastProgressAt: Date.now(),
        recoveryAttempts: 0,
        info: {
          id: peerId,
          name,
          seat: seat === 1 || seat === 2 ? seat : 0,
          connectionState: pc.connectionState,
          candidateType: null,
          rttMs: null,
        },
      };
      this.peers.set(peerId, slot);

      pc.onicecandidate = (e) => {
        if (e.candidate) void this.sendSignal(peerId, 'ice', e.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        slot.info.connectionState = pc.connectionState;
        if (pc.connectionState === 'connecting' || pc.connectionState === 'connected') {
          slot.lastProgressAt = Date.now();
        }
        if (pc.connectionState === 'connected') {
          slot.recoveryAttempts = 0;
          slot.terminal = false;
          void this.readCandidateType(slot);
        }
        this.emitPeers();
        if (pc.connectionState === 'failed') pc.restartIce();
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          this.schedulePoll(FAST_POLL_MS);
        }
      };
      pc.onnegotiationneeded = async () => {
        try {
          slot.makingOffer = true;
          await pc.setLocalDescription();
          await this.sendSignal(peerId, 'offer', descJson(pc.localDescription));
        } catch (_err) {
          // Retried on the next negotiationneeded.
        } finally {
          slot.makingOffer = false;
        }
      };
      pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        if (this.opts.onTrack) this.opts.onTrack(peerId, stream);
      };
      this.syncTracks(slot);

      if (initiator) {
        this.attachChannel(slot, pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
        this.attachChannel(slot, pc.createDataChannel('reliable', { ordered: true }));
      }
      return slot;
    }

    attachChannel(slot, channel) {
      if (channel.label === 'state') slot.state = channel;
      else slot.reliable = channel;
      channel.onopen = () => {
        slot.lastProgressAt = Date.now();
      };
      channel.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (_err) {
          return;
        }
        if (msg.t === 'ping') {
          if (slot.state && slot.state.readyState === 'open') {
            slot.state.send(JSON.stringify({ t: 'pong' }));
          }
        } else if (msg.t === 'pong') {
          if (slot.pingSentAt) {
            slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
            slot.pingSentAt = undefined;
            this.emitPeers();
          }
        } else if (this.opts.onMessage) {
          this.opts.onMessage(slot.info.id, msg.d, channel.label === 'state' ? 'state' : 'reliable');
        }
      };
    }

    async flushPendingCandidates(slot) {
      while (slot.pendingCandidates.length > 0) {
        const candidate = slot.pendingCandidates.shift();
        try {
          await slot.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!slot.ignoreOffer) console.warn('[p2p] addIceCandidate failed:', err);
        }
        if (this.closed) return;
      }
    }

    async onSignal(from, kind, payload, roster) {
      if (this.closed) return;
      let slot = this.peers.get(from);
      if (!slot) {
        if (!roster.has(from)) return;
        const created = this.connectTo(from, '', false);
        if (!created) return;
        slot = created;
      }
      const polite = this.opts.selfId < from;

      try {
        if (kind === 'offer' || kind === 'answer') {
          const description = payload;
          const collision = kind === 'offer' && (slot.makingOffer || slot.pc.signalingState !== 'stable');
          slot.ignoreOffer = !polite && collision;
          if (slot.ignoreOffer) return;
          try {
            await slot.pc.setRemoteDescription(description);
          } catch (err) {
            if (kind !== 'offer' || slot.recreatedForOffer) throw err;
            const attempts = slot.recoveryAttempts;
            const name = slot.info.name;
            slot.pc.close();
            this.peers.delete(from);
            const fresh = this.connectTo(from, name, false);
            if (!fresh) return;
            fresh.recoveryAttempts = attempts;
            fresh.recreatedForOffer = true;
            slot = fresh;
            await slot.pc.setRemoteDescription(description);
          }
          if (this.closed) return;
          await this.flushPendingCandidates(slot);
          if (this.closed) return;
          if (kind === 'offer') {
            await slot.pc.setLocalDescription();
            if (this.closed) return;
            await this.sendSignal(from, 'answer', descJson(slot.pc.localDescription));
          }
        } else if (kind === 'ice') {
          if (!slot.pc.remoteDescription) {
            slot.pendingCandidates.push(payload);
            return;
          }
          try {
            await slot.pc.addIceCandidate(payload);
          } catch (err) {
            if (!slot.ignoreOffer) console.warn('[p2p] addIceCandidate failed:', err);
          }
        }
      } catch (_err) {
        // Visible via connectionState.
      }
    }

    sendSignal(to, kind, payload) {
      const prev = this.signalQueues.get(to) || Promise.resolve();
      const next = prev.then(() => this.postSignal(to, kind, payload));
      this.signalQueues.set(to, next.catch(() => {}));
      return next;
    }

    async postSignal(to, kind, payload) {
      for (let attempt = 0; ; attempt += 1) {
        if (this.closed) return;
        try {
          await rtcFetch('POST', '', {
            op: 'signal',
            room: this.opts.room,
            from: this.opts.selfId,
            to,
            kind,
            payload,
          });
          return;
        } catch (err) {
          if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
            console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
            return;
          }
          await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
        }
      }
    }

    pingAll() {
      const wire = JSON.stringify({ t: 'ping' });
      for (const slot of this.peers.values()) {
        if (!slot.state || slot.state.readyState !== 'open') continue;
        const stale = slot.pingSentAt !== undefined && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
        if (slot.pingSentAt === undefined || stale) {
          slot.pingSentAt = performance.now();
          slot.state.send(wire);
        }
      }
    }

    watchdog() {
      if (this.closed) return;
      const now = Date.now();
      for (const [peerId, slot] of this.peers) {
        const live = slot.pc.connectionState;
        if (live !== slot.info.connectionState) {
          slot.info.connectionState = live;
          if (live === 'connecting' || live === 'connected') slot.lastProgressAt = now;
          this.emitPeers();
        }
        if (slot.terminal || live === 'connected') continue;
        if (now - slot.lastProgressAt <= STALL_MS) continue;
        if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          slot.terminal = true;
          this.emitPeers();
          continue;
        }
        slot.recoveryAttempts += 1;
        slot.lastProgressAt = now;
        if (this.opts.selfId > peerId) {
          const { name } = slot.info;
          const attempts = slot.recoveryAttempts;
          slot.pc.close();
          this.peers.delete(peerId);
          const fresh = this.connectTo(peerId, name, true);
          if (fresh) fresh.recoveryAttempts = attempts;
          this.schedulePoll(FAST_POLL_MS);
        }
      }
    }

    async readCandidateType(slot) {
      try {
        const stats = await slot.pc.getStats();
        let selected;
        stats.forEach((s) => {
          if (s.type === 'candidate-pair' && s.nominated) selected = s;
        });
        const localId = selected && selected.localCandidateId;
        if (localId) {
          const local = stats.get(localId);
          slot.info.candidateType = (local && local.candidateType) || null;
          this.emitPeers();
        }
      } catch (_err) {
        // diagnostics only
      }
    }

    emitPeers() {
      const list = this.peerList();
      const fingerprint = JSON.stringify(
        list.map((p) => [p.id, p.name, p.seat, p.connectionState, p.candidateType, p.rttMs]),
      );
      if (fingerprint === this.lastPeersFingerprint) return;
      this.lastPeersFingerprint = fingerprint;
      if (this.opts.onPeersChanged) this.opts.onPeersChanged(list);
    }
  }

  global.DdlP2PRoom = P2PRoom;
  global.DdlP2PDefaultIce = defaultIceServers;
})(window);
