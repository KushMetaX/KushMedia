'use strict';

/**
 * WebRTC signaling relay for the IRL table.
 * Roster + SDP/ICE only — game state and video go peer-to-peer afterwards.
 * In-memory (30s peer TTL, 60s signal TTL). Does not touch tourney or payment tables.
 */

const express = require('express');

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const PEER_TTL_MS = 30_000;
const SIGNAL_TTL_MS = 60_000;
const MAX_PEERS = 32;
const MAX_INBOX = 200;
const MAX_PAYLOAD = 32_768;

const peers = new Map();
const signals = [];
let signalSeq = 0;
let lastPrune = 0;

function json(response, body, status = 200) {
	response.status(status).set({
		'content-type': 'application/json',
		'cache-control': 'no-store',
	}).send(JSON.stringify(body));
}

function peerKey(room, peer) {
	return `${room}\0${peer}`;
}

function prune(now) {
	if (now - lastPrune < 400) return;
	lastPrune = now;
	for (const [key, row] of peers) {
		if (now - row.lastSeen > PEER_TTL_MS) peers.delete(key);
	}
	let i = 0;
	while (i < signals.length) {
		if (now - signals[i].createdAt > SIGNAL_TTL_MS) signals.splice(i, 1);
		else i += 1;
	}
}

function claimedSeat(value) {
	const n = Number(value);
	return n === 1 || n === 2 ? n : 0;
}

function roster(room, now) {
	const out = [];
	for (const row of peers.values()) {
		if (row.room !== room) continue;
		if (now - row.lastSeen > PEER_TTL_MS) continue;
		out.push({ id: row.peer, name: row.name, seat: row.seat || 0 });
		if (out.length >= MAX_PEERS) break;
	}
	out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return out;
}

function touchPeer(room, peer, name, now, seat) {
	const key = peerKey(room, peer);
	const existing = peers.get(key);
	const label = String(name || '').slice(0, 64);
	const claimed = claimedSeat(seat);
	if (existing) {
		existing.lastSeen = now;
		existing.name = label;
		existing.seat = claimed;
		return;
	}
	let n = 0;
	for (const row of peers.values()) {
		if (row.room === room) n += 1;
	}
	if (n >= MAX_PEERS) {
		const err = new Error('Room is full');
		err.status = 400;
		throw err;
	}
	peers.set(key, { room, peer, name: label, lastSeen: now, seat: claimed });
}

function validId(value) {
	return typeof value === 'string' && ID.test(value);
}

function handleGet(request, response, canClaimSeat) {
	const room = String(request.query.room || '');
	const peer = String(request.query.peer || '');
	const name = String(request.query.name || '');
	const since = Number(request.query.since || 0);
	const seat = claimedSeat(request.query.seat);
	if (!validId(room) || !validId(peer) || !Number.isFinite(since) || since < 0) {
		json(response, { error: 'invalid query' }, 400);
		return;
	}
	if (seat) {
		const allowed = typeof canClaimSeat === 'function' && canClaimSeat(request, room, seat);
		if (!allowed) {
			json(response, { error: 'Sign in with Discord as the listed player to sit. Anyone can spectate.' }, 403);
			return;
		}
		for (const [key, row] of peers) {
			if (row.room === room && row.seat === seat && row.peer !== peer) peers.delete(key);
		}
	}
	const now = Date.now();
	if (since === 0 || Math.random() < 0.02) prune(now);
	try {
		touchPeer(room, peer, name, now, seat);
	} catch (err) {
		json(response, { error: err.message || 'invalid request' }, err.status || 400);
		return;
	}
	const inbox = [];
	for (const sig of signals) {
		if (sig.room !== room || sig.to !== peer || sig.id <= since) continue;
		inbox.push({
			id: sig.id,
			from: sig.from,
			kind: sig.kind,
			payload: sig.payload,
		});
		if (inbox.length >= MAX_INBOX) break;
	}
	json(response, { peers: roster(room, now), signals: inbox });
}

function handlePost(request, response) {
	const body = request.body || {};
	const op = body.op;
	if (op === 'leave') {
		if (!validId(body.room) || !validId(body.peer)) {
			json(response, { error: 'invalid request' }, 400);
			return;
		}
		peers.delete(peerKey(body.room, body.peer));
		json(response, { ok: true });
		return;
	}
	if (op !== 'signal') {
		json(response, { error: 'invalid request' }, 400);
		return;
	}
	const room = body.room;
	const from = body.from;
	const to = body.to;
	const kind = body.kind;
	if (!validId(room) || !validId(from) || !validId(to)) {
		json(response, { error: 'invalid request' }, 400);
		return;
	}
	if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') {
		json(response, { error: 'invalid request' }, 400);
		return;
	}
	if (body.payload === undefined) {
		json(response, { error: 'invalid request' }, 400);
		return;
	}
	let encoded;
	try {
		encoded = JSON.stringify(body.payload);
	} catch (_err) {
		json(response, { error: 'invalid request' }, 400);
		return;
	}
	if (encoded.length > MAX_PAYLOAD) {
		json(response, { error: 'payload too large' }, 400);
		return;
	}
	signalSeq += 1;
	signals.push({
		id: signalSeq,
		room,
		to,
		from,
		kind,
		payload: body.payload,
		createdAt: Date.now(),
	});
	json(response, { ok: true });
}

function createRouter(options) {
	const canClaimSeat = options && options.canClaimSeat;
	const router = express.Router();
	router.get('/', (request, response) => handleGet(request, response, canClaimSeat));
	router.post('/', handlePost);
	return router;
}

module.exports = {
	createRouter,
	handleGet,
	handlePost,
};
