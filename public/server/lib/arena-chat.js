'use strict';

/**
 * Per-arena spectator chat. Stored beside the tourney JSON so a busy room
 * does not rewrite the bracket on every message.
 */

const fs = require('fs');
const path = require('path');

const MAX_BODY = 280;
const MAX_HANDLE = 24;
const MAX_MESSAGES = 250;
const POST_GAP_MS = 1400;
const DUP_MS = 8000;
const USER_WINDOW_MS = 60_000;
const USER_MAX = 12;
const PRESENCE_TTL_MS = 25_000;
const VIEWER_RE = /^[a-zA-Z0-9_-]{4,24}$/;
const DISCORD_AVATAR_RE = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//i;

const posts = new Map();
const presence = new Map();

function fail(status, message) {
	const err = new Error(message);
	err.status = status;
	return err;
}

function safeSlug(raw) {
	return String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 64);
}

function chatDir(dataDir) {
	return path.join(dataDir, 'chat');
}

function chatFile(dataDir, slug) {
	const id = safeSlug(slug);
	if (!id) throw fail(400, 'Invalid arena');
	return path.join(chatDir(dataDir), `${id}.json`);
}

function emptyRoom() {
	return { nextId: 1, rev: 0, messages: [] };
}

function loadRoom(dataDir, slug) {
	try {
		const parsed = JSON.parse(fs.readFileSync(chatFile(dataDir, slug), 'utf8'));
		if (!parsed || typeof parsed !== 'object') return emptyRoom();
		const messages = Array.isArray(parsed.messages) ? parsed.messages.filter((row) => row && Number(row.id) > 0) : [];
		const nextId = Math.max(Number(parsed.nextId) || 1, messages.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1);
		const rev = Math.max(Number(parsed.rev) || 0, messages.length);
		return { nextId, rev, messages };
	} catch (err) {
		if (err && err.code === 'ENOENT') return emptyRoom();
		return emptyRoom();
	}
}

function saveRoom(dataDir, slug, room) {
	fs.mkdirSync(chatDir(dataDir), { recursive: true });
	const file = chatFile(dataDir, slug);
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({
		nextId: room.nextId,
		rev: room.rev,
		messages: room.messages,
	}));
	try {
		fs.renameSync(tmp, file);
	} catch (_err) {
		fs.copyFileSync(tmp, file);
		try { fs.unlinkSync(tmp); } catch (_e2) {}
	}
}

function sanitizeBody(raw) {
	return String(raw || '')
		.replace(/\r\n/g, '\n')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, MAX_BODY);
}

function sanitizeHandle(raw) {
	return String(raw || '')
		.replace(/[\u0000-\u001F\u007F]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_HANDLE);
}

function safeAvatarUrl(raw) {
	const href = String(raw || '').trim();
	if (!DISCORD_AVATAR_RE.test(href)) return '';
	return href.slice(0, 240);
}

function publicMessage(row) {
	return {
		id: Number(row.id),
		userId: Number(row.userId) || 0,
		handle: String(row.handle || 'Player'),
		avatarUrl: String(row.avatarUrl || ''),
		role: row.role === 'host' || row.role === 'player' ? row.role : 'viewer',
		body: String(row.body || ''),
		createdAt: String(row.createdAt || ''),
	};
}

function readRoom(dataDir, slug, sinceRev) {
	const room = loadRoom(dataDir, slug);
	const rev = Number(room.rev) || 0;
	const known = Number(sinceRev);
	if (Number.isFinite(known) && known > 0 && known === rev) {
		return { rev, unchanged: true, messages: [] };
	}
	return {
		rev,
		unchanged: false,
		messages: room.messages.slice(-MAX_MESSAGES).map(publicMessage),
	};
}

function assertCanPost(userKey) {
	const now = Date.now();
	const hits = (posts.get(userKey) || []).filter((t) => now - t.at < USER_WINDOW_MS);
	if (hits.length && now - hits[hits.length - 1].at < POST_GAP_MS) {
		throw fail(429, 'Wait a moment before sending another message.');
	}
	if (hits.length >= USER_MAX) {
		throw fail(429, 'Slow down — too many messages in a minute.');
	}
	return hits;
}

function addMessage(dataDir, slug, input) {
	const body = sanitizeBody(input && input.body);
	if (body.length < 1) throw fail(400, 'Type a message first.');
	const handle = sanitizeHandle(input && input.handle);
	if (handle.length < 2) throw fail(400, 'Set a tourney handle before chatting.');
	const userId = Number(input && input.userId) || 0;
	if (!(userId > 0)) throw fail(401, 'Sign in with Discord to chat.');
	const userKey = `u:${userId}`;
	const hits = assertCanPost(userKey);
	const room = loadRoom(dataDir, slug);
	const last = room.messages.filter((row) => Number(row.userId) === userId).pop();
	if (last && last.body === body && Date.now() - Date.parse(last.createdAt || 0) < DUP_MS) {
		throw fail(429, 'That message was just sent.');
	}
	const row = {
		id: room.nextId,
		userId,
		handle,
		avatarUrl: safeAvatarUrl(input && input.avatarUrl),
		role: input && (input.role === 'host' || input.role === 'player') ? input.role : 'viewer',
		body,
		createdAt: new Date().toISOString(),
	};
	room.nextId += 1;
	room.rev = (Number(room.rev) || 0) + 1;
	room.messages.push(row);
	if (room.messages.length > MAX_MESSAGES) {
		room.messages = room.messages.slice(-MAX_MESSAGES);
	}
	saveRoom(dataDir, slug, room);
	hits.push({ at: Date.now() });
	posts.set(userKey, hits);
	return publicMessage(row);
}

function deleteMessage(dataDir, slug, messageId, opts) {
	const id = Number(messageId);
	if (!(id > 0)) throw fail(400, 'Pick a message to remove.');
	const room = loadRoom(dataDir, slug);
	const idx = room.messages.findIndex((row) => Number(row.id) === id);
	if (idx < 0) throw fail(404, 'That message is already gone.');
	const row = room.messages[idx];
	const userId = Number(opts && opts.userId) || 0;
	const moderate = Boolean(opts && opts.moderate);
	if (!moderate && Number(row.userId) !== userId) {
		throw fail(403, 'You can only remove your own messages.');
	}
	room.messages.splice(idx, 1);
	room.rev = (Number(room.rev) || 0) + 1;
	saveRoom(dataDir, slug, room);
	return { ok: true, id, rev: room.rev };
}

function removeRoom(dataDir, slug) {
	try {
		fs.unlinkSync(chatFile(dataDir, slug));
	} catch (_err) {}
	presence.delete(safeSlug(slug));
}

function viewerToken(raw) {
	const token = String(raw || '');
	return VIEWER_RE.test(token) ? token : '';
}

function heartbeat(slug, opts) {
	const id = safeSlug(slug);
	if (!id) return 0;
	const now = Date.now();
	let room = presence.get(id);
	if (!room) {
		room = new Map();
		presence.set(id, room);
	}
	const sessionId = Number(opts && opts.userId) || 0;
	const token = viewerToken(opts && opts.viewer);
	const key = sessionId > 0 ? `u:${sessionId}` : (token ? `v:${token}` : '');
	if (key) {
		room.set(key, { at: now });
	}
	for (const [k, row] of room) {
		if (now - row.at > PRESENCE_TTL_MS) room.delete(k);
	}
	return room.size;
}

module.exports = {
	MAX_BODY,
	sanitizeBody,
	sanitizeHandle,
	safeAvatarUrl,
	listSince: readRoom,
	readRoom,
	addMessage,
	deleteMessage,
	removeRoom,
	heartbeat,
	loadRoom,
	publicMessage,
};
