'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { timingSafeEqualString } = require('../security-utils');
const {
	generateSingleElim,
	generateDoubleElim,
	generateRoundRobin,
	pairSwissRound,
	defaultSwissRounds,
} = require('../lib/bracket-engine');
const records = require('../lib/tourney-records');
const authDex = require('./auth-dex');

const FORMATS = ['single_elim', 'double_elim', 'round_robin', 'swiss'];
const BEST_OF = [1, 3, 5];
const PAY_ASSETS = ['DOGE'];
const PAY_TO = {
	DOGE: 'DD4KcuppEUBR8vETG46d4w8BcgvDkzbss2',
};
/** Kept so older SOL invoices still display the wallet they were quoted against. */
const LEGACY_PAY_TO = {
	SOL: '3tNZfWyvPBhx6KsaTuCBoChajrK7fbLME2eC4mKwrWgW',
	DOGE: PAY_TO.DOGE,
};
const KNOWN_PAY_ASSETS = ['DOGE', 'SOL'];
const KICK_RESERVED = new Set([
	'about', 'api', 'browse', 'categories', 'category', 'channel', 'channels',
	'clip', 'clips', 'community', 'dashboard', 'directory', 'embed', 'explore',
	'following', 'help', 'home', 'live', 'login', 'messages', 'notifications',
	'player', 'plus', 'premium', 'privacy', 'register', 'search', 'settings',
	'signup', 'terms', 'video', 'videos',
]);

function kickChannelFrom(raw) {
	const text = String(raw || '').trim();
	if (!text) return '';
	if (/^[A-Za-z0-9_-]{3,32}$/.test(text) && !KICK_RESERVED.has(text.toLowerCase())) {
		return text;
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
	let slug = parts[0];
	if (slug.toLowerCase() === 'embed' && parts[1]) slug = parts[1];
	if (KICK_RESERVED.has(slug.toLowerCase())) return null;
	if (!/^[A-Za-z0-9_-]{3,32}$/.test(slug)) return null;
	return slug;
}

function sanitizeKickStream(raw) {
	const text = String(raw == null ? '' : raw).trim();
	if (!text) return '';
	const channel = kickChannelFrom(text);
	if (!channel) {
		throw Object.assign(new Error('Paste a Kick channel or livestream URL (kick.com/yourname).'), { status: 400 });
	}
	return `https://kick.com/${channel}`;
}

function normalizeBestOf(value, fallback = 3) {
	const n = Number(value);
	return BEST_OF.includes(n) ? n : (BEST_OF.includes(fallback) ? fallback : 3);
}

function winsNeeded(bestOf) {
	return Math.ceil(normalizeBestOf(bestOf) / 2);
}

function roundKey(side, round) {
	return `${side}:${Number(round) || 1}`;
}

function sanitizeRoundBestOf(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [key, value] of Object.entries(raw)) {
		if (!/^(winners|losers|grand|group):\d+$/.test(String(key))) continue;
		out[key] = normalizeBestOf(value, 3);
	}
	return out;
}

function bestOfFor(tournament, side, round) {
	const rules = (tournament && tournament.roundBestOf) || {};
	const keyed = rules[roundKey(side, round)];
	if (keyed) return normalizeBestOf(keyed, tournament && tournament.bestOf);
	return normalizeBestOf(tournament && tournament.bestOf, 3);
}

function shuffleList(list) {
	const next = [...list];
	for (let i = next.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[next[i], next[j]] = [next[j], next[i]];
	}
	return next;
}

function tallyGames(games) {
	let s1 = 0;
	let s2 = 0;
	for (const game of games || []) {
		if (Number(game && game.winnerSlot) === 2) s2 += 1;
		else if (Number(game && game.winnerSlot) === 1) s1 += 1;
	}
	return { s1, s2 };
}

function wantsLosersBracket(tournament) {
	if (!tournament) return false;
	if (tournament.losersBracket != null) return Boolean(tournament.losersBracket);
	return tournament.format === 'double_elim' || tournament.playoffFormat === 'double_elim';
}

function hasElimTree(store, tournament) {
	return (store.matches || []).some((m) => (
		m.tournamentId === tournament.id
		&& (m.side === 'winners' || m.side === 'losers' || m.side === 'grand' || m.side === 'placement')
	));
}

const MAX_PAYOUT_PLACES = 8;

function placeLabel(n) {
	const v = Math.round(Number(n) || 0);
	if (v < 1) return '';
	const mod100 = v % 100;
	const mod10 = v % 10;
	if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
	if (mod10 === 1) return `${v}st`;
	if (mod10 === 2) return `${v}nd`;
	if (mod10 === 3) return `${v}rd`;
	return `${v}th`;
}

function sanitizeRegistrationMode(value) {
	if (value === 'list') return 'list';
	return 'signup';
}

function sanitizeWhitelistSpots(value, fallback = 0) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return Math.min(16, Math.max(0, fallback));
	return Math.min(16, Math.max(0, n));
}

function wantsWhitelist(tournament) {
	return sanitizeWhitelistSpots(tournament && tournament.whitelistSpots, 0) > 0;
}

function isOpeningMatch(tournament, match) {
	if (!match || Number(match.round) !== 1) return false;
	if (match.side === 'winners' || match.side === 'group') return true;
	return false;
}

function isWhitelistEntry(entry) {
	return Boolean(entry && entry.whitelist);
}

function entryInMatches(matches, entryId) {
	const id = Number(entryId);
	return matches.some((m) => Number(m.entry1Id) === id || Number(m.entry2Id) === id);
}

function usesElimTree(tournament) {
	if (!tournament) return false;
	if (tournament.stage === 'playoff') return true;
	if (tournament.stage === 'groups') return false;
	const format = String(tournament.format || '');
	return format !== 'swiss' && format !== 'round_robin';
}

function destHasProgress(match) {
	if (!match) return false;
	if (match.status === 'complete') return true;
	if (Array.isArray(match.games) && match.games.length) return true;
	if (Number(match.score1) > 0 || Number(match.score2) > 0) return true;
	return false;
}

function canReverseBye(store, match) {
	if (!match || match.status !== 'bye') return false;
	const dest = findMatch(store, match.winnerGoesTo, match.tournamentId);
	if (!dest) return true;
	return !destHasProgress(dest);
}

function reverseByeAdvance(store, match) {
	const byeId = match.entry1Id || match.entry2Id;
	const dest = findMatch(store, match.winnerGoesTo, match.tournamentId);
	if (dest && byeId) {
		const slot = match.winnerGoesTo && Number(match.winnerGoesTo.slot);
		if (slot === 1 && Number(dest.entry1Id) === Number(byeId)) dest.entry1Id = null;
		else if (slot === 2 && Number(dest.entry2Id) === Number(byeId)) dest.entry2Id = null;
		else {
			if (Number(dest.entry1Id) === Number(byeId)) dest.entry1Id = null;
			if (Number(dest.entry2Id) === Number(byeId)) dest.entry2Id = null;
		}
		dest.games = [];
		dest.score1 = null;
		dest.score2 = null;
		if (Number(dest.winnerId) === Number(byeId)) dest.winnerId = null;
		dest.status = (dest.entry1Id && dest.entry2Id) ? 'ready' : 'pending';
	}
	match.winnerId = null;
	match.status = 'pending';
}

function findLateSeat(store, tournament, body) {
	const matches = store.matches.filter((m) => m.tournamentId === tournament.id);
	const matchId = Number(body && body.matchId);
	const askedSlot = Number(body && body.slot);
	const slotHint = askedSlot === 2 ? 2 : askedSlot === 1 ? 1 : 0;
	if (Number.isFinite(matchId) && matchId > 0) {
		const match = matches.find((m) => m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		if (!isOpeningMatch(tournament, match)) {
			throw Object.assign(new Error('Late players can only enter a first-round match'), { status: 400 });
		}
		if (match.status === 'complete') {
			throw Object.assign(new Error('That first-round match is already locked'), { status: 400 });
		}
		if (match.status === 'bye') {
			if (!canReverseBye(store, match)) {
				throw Object.assign(new Error('That bye already advanced too far to fill'), { status: 400 });
			}
			return { match, slot: slotHint || (match.entry1Id ? 2 : 1), kind: 'bye' };
		}
		if (!match.entry1Id || !match.entry2Id) {
			return { match, slot: match.entry1Id ? 2 : 1, kind: 'empty' };
		}
		return { match, slot: slotHint || 1, kind: 'replace' };
	}
	const bye = matches.find((m) => isOpeningMatch(tournament, m) && m.status === 'bye' && canReverseBye(store, m));
	if (bye) return { match: bye, slot: bye.entry1Id ? 2 : 1, kind: 'bye' };
	const empty = matches.find((m) => (
		isOpeningMatch(tournament, m)
		&& m.status !== 'complete'
		&& m.status !== 'bye'
		&& (!m.entry1Id || !m.entry2Id)
	));
	if (empty) return { match: empty, slot: empty.entry1Id ? 2 : 1, kind: 'empty' };
	return null;
}

function applyLateSeat(store, tournament, entry, seat) {
	if (seat.kind === 'bye') reverseByeAdvance(store, seat.match);
	if (seat.kind === 'replace') {
		const outgoingId = seat.slot === 2 ? seat.match.entry2Id : seat.match.entry1Id;
		const outgoing = store.entries.find((e) => e.tournamentId === tournament.id && e.id === outgoingId);
		if (!outgoing) throw Object.assign(new Error('Pick a player in that match to replace'), { status: 400 });
		if (outgoing.id === entry.id) throw Object.assign(new Error('That player is already in this match'), { status: 400 });
		outgoing.noShow = true;
		outgoing.status = 'no_show';
		entry.seed = outgoing.seed;
		entry.subbedIn = true;
	} else {
		const used = store.entries.filter((e) => e.tournamentId === tournament.id);
		entry.seed = used.reduce((n, e) => Math.max(n, Number(e.seed) || 0), 0) + 1;
	}
	if (seat.slot === 2) seat.match.entry2Id = entry.id;
	else seat.match.entry1Id = entry.id;
	entry.checkedIn = true;
	entry.subbedIn = true;
	entry.lateEntry = true;
	seat.match.games = [];
	seat.match.score1 = null;
	seat.match.score2 = null;
	seat.match.winnerId = null;
	seat.match.status = (seat.match.entry1Id && seat.match.entry2Id) ? 'ready' : 'pending';
}

function addRoundRobinLateMatches(store, tournament, entry) {
	const others = store.entries.filter((e) => (
		e.tournamentId === tournament.id
		&& e.id !== entry.id
		&& e.paid
		&& !e.noShow
		&& !isWhitelistEntry(e)
	));
	const matches = store.matches.filter((m) => m.tournamentId === tournament.id);
	const already = new Set();
	for (const m of matches) {
		if (Number(m.entry1Id) === entry.id && m.entry2Id) already.add(Number(m.entry2Id));
		if (Number(m.entry2Id) === entry.id && m.entry1Id) already.add(Number(m.entry1Id));
	}
	const need = others.filter((e) => !already.has(e.id));
	if (!need.length) return;
	const maxRound = matches.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
	const drafts = need.map((opp, i) => ({
		side: 'group',
		round: maxRound + 1,
		position: i + 1,
		entry1Id: entry.id,
		entry2Id: opp.id,
	}));
	store.matches.push(...draftsToMatches(store, tournament, drafts));
}

function addLateHostEntry(store, tournament, request) {
	if (usesElimTree(tournament)) {
		const seat = findLateSeat(store, tournament, request.body || {});
		if (!seat) {
			throw Object.assign(new Error('No open first-round slot. Pick a player to replace, or fill a bye.'), { status: 400 });
		}
		const entry = addHostEntry(store, tournament, request, { ignoreCap: true });
		applyLateSeat(store, tournament, entry, seat);
		return entry;
	}
	const entry = addHostEntry(store, tournament, request, {});
	entry.checkedIn = true;
	entry.lateEntry = true;
	if (tournament.format === 'round_robin' || tournament.stage === 'groups') {
		addRoundRobinLateMatches(store, tournament, entry);
	}
	return entry;
}

function sanitizePayouts(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue;
		const place = Math.min(MAX_PAYOUT_PLACES, Math.max(1, Math.round(Number(row.place) || 0)));
		if (!place || seen.has(place)) continue;
		const percentRaw = Number(row.percent);
		const percent = Number.isFinite(percentRaw) ? Math.min(100, Math.max(0, Math.round(percentRaw * 100) / 100)) : 0;
		const prize = String(row.prize != null ? row.prize : (row.label || '')).trim().slice(0, 120);
		if (percent <= 0 && !prize) continue;
		seen.add(place);
		out.push({ place, percent, prize });
	}
	return out.sort((a, b) => a.place - b.place);
}

function normalizeTournament(tournament) {
	if (!tournament || typeof tournament !== 'object') return tournament;
	tournament.bestOf = normalizeBestOf(tournament.bestOf, 3);
	tournament.roundBestOf = sanitizeRoundBestOf(tournament.roundBestOf);
	tournament.hostName = String(tournament.hostName || 'KushMetaX').trim() || 'KushMetaX';
	try {
		tournament.streamUrl = sanitizeKickStream(tournament.streamUrl);
	} catch (_err) {
		tournament.streamUrl = '';
	}
	tournament.rewardMode = tournament.rewardMode === 'prize' ? 'prize' : 'pot';
	tournament.payouts = sanitizePayouts(tournament.payouts);
	const hostUserId = tournament.hostUserId != null ? Number(tournament.hostUserId) : 0;
	tournament.hostUserId = Number.isFinite(hostUserId) && hostUserId > 0 ? hostUserId : null;
	tournament.game = String(tournament.game || 'Doginal Dogs Legends TCG').trim() || 'Doginal Dogs Legends TCG';
	tournament.stageType = tournament.stageType === 'two' ? 'two' : 'single';
	tournament.stage = tournament.stage === 'playoff' ? 'playoff' : (tournament.stageType === 'two' ? (tournament.stage || 'groups') : 'main');
	tournament.breakTies = Boolean(tournament.breakTies);
	const wasWhitelistMode = tournament.registrationMode === 'whitelist';
	tournament.registrationMode = sanitizeRegistrationMode(tournament.registrationMode);
	if (wasWhitelistMode && !(Number(tournament.whitelistSpots) > 0)) tournament.whitelistSpots = 2;
	tournament.whitelistSpots = sanitizeWhitelistSpots(tournament.whitelistSpots, 0);
	tournament.feeMode = tournament.feeMode === 'free' || Number(tournament.entryFeeUsd) === 0 ? 'free' : 'paid';
	tournament.requireTeams = Boolean(tournament.requireTeams);
	tournament.capPlayers = tournament.capPlayers !== false;
	tournament.startAt = tournament.startAt || null;
	tournament.startTentative = Boolean(tournament.startTentative);
	tournament.timezone = String(tournament.timezone || 'America/Halifax');
	tournament.requireCheckIn = Boolean(tournament.requireCheckIn);
	tournament.votingEnabled = Boolean(tournament.votingEnabled);
	tournament.predictionsEnabled = Boolean(tournament.predictionsEnabled);
	tournament.shareImages = Boolean(tournament.shareImages);
	tournament.requireVerifiedEmail = Boolean(tournament.requireVerifiedEmail);
	tournament.countryLock = Boolean(tournament.countryLock);
	tournament.allowedCountries = String(tournament.allowedCountries || '');
	tournament.predictionCustomFields = Boolean(tournament.predictionCustomFields);
	tournament.requireAccount = tournament.requireAccount !== false;
	tournament.official = tournament.official !== false;
	tournament.groupSize = Math.min(16, Math.max(2, Number(tournament.groupSize) || 4));
	tournament.advancePerGroup = Math.min(8, Math.max(1, Number(tournament.advancePerGroup) || 2));
	if (tournament.format === 'double_elim') tournament.losersBracket = true;
	else if (tournament.losersBracket == null) {
		tournament.losersBracket = tournament.playoffFormat === 'double_elim';
	} else {
		tournament.losersBracket = Boolean(tournament.losersBracket);
	}
	if (!tournament.losersBracket && tournament.format === 'double_elim') tournament.format = 'single_elim';
	if (tournament.losersBracket) tournament.breakTies = false;
	tournament.playoffFormat = tournament.losersBracket ? 'double_elim' : 'single_elim';
	return tournament;
}

function readSettings(body, current) {
	const src = body && typeof body === 'object' ? body : {};
	const t = current ? { ...current } : {};
	if (src.name != null) t.name = String(src.name).trim();
	if (src.description != null) t.description = String(src.description).trim().slice(0, 2000);
	if (src.hostName != null) t.hostName = String(src.hostName).trim() || 'KushMetaX';
	if (src.streamUrl != null) t.streamUrl = sanitizeKickStream(src.streamUrl);
	if (src.game != null) t.game = String(src.game).trim() || 'Doginal Dogs Legends TCG';
	if (src.format && FORMATS.includes(src.format)) t.format = src.format;
	if (src.stageType) t.stageType = src.stageType === 'two' ? 'two' : 'single';
	if (src.losersBracket != null) t.losersBracket = Boolean(src.losersBracket);
	if (src.playoffFormat && ['single_elim', 'double_elim'].includes(src.playoffFormat) && src.losersBracket == null) {
		t.losersBracket = src.playoffFormat === 'double_elim';
	}
	if (src.breakTies != null) t.breakTies = Boolean(src.breakTies);
	if (src.registrationMode) {
		if (src.registrationMode === 'whitelist') {
			t.registrationMode = 'signup';
			if (src.whitelistSpots == null && !(Number(t.whitelistSpots) > 0)) t.whitelistSpots = 2;
		} else {
			t.registrationMode = sanitizeRegistrationMode(src.registrationMode);
		}
	}
	if (src.whitelistSpots != null) t.whitelistSpots = sanitizeWhitelistSpots(src.whitelistSpots, t.whitelistSpots || 0);
	if (src.feeMode) t.feeMode = src.feeMode === 'free' ? 'free' : 'paid';
	if (src.requireTeams != null) t.requireTeams = Boolean(src.requireTeams);
	if (src.capPlayers != null) t.capPlayers = Boolean(src.capPlayers);
	if (src.maxPlayers != null) t.maxPlayers = Math.min(64, Math.max(2, Number(src.maxPlayers) || 16));
	if (src.entryFeeUsd != null) t.entryFeeUsd = Math.max(0, Number(src.entryFeeUsd) || 0);
	if (src.startAt !== undefined) t.startAt = src.startAt ? String(src.startAt) : null;
	if (src.startTentative != null) t.startTentative = Boolean(src.startTentative);
	if (src.timezone != null) t.timezone = String(src.timezone || 'America/Halifax');
	if (src.requireCheckIn != null) t.requireCheckIn = Boolean(src.requireCheckIn);
	if (src.votingEnabled != null) t.votingEnabled = Boolean(src.votingEnabled);
	if (src.predictionsEnabled != null) t.predictionsEnabled = Boolean(src.predictionsEnabled);
	if (src.shareImages != null) t.shareImages = Boolean(src.shareImages);
	if (src.requireVerifiedEmail != null) t.requireVerifiedEmail = Boolean(src.requireVerifiedEmail);
	if (src.countryLock != null) t.countryLock = Boolean(src.countryLock);
	if (src.allowedCountries != null) t.allowedCountries = String(src.allowedCountries || '').slice(0, 400);
	if (src.predictionCustomFields != null) t.predictionCustomFields = Boolean(src.predictionCustomFields);
	if (src.requireAccount != null) t.requireAccount = Boolean(src.requireAccount);
	if (src.official != null) t.official = Boolean(src.official);
	if (src.groupSize != null) t.groupSize = Math.min(16, Math.max(2, Number(src.groupSize) || 4));
	if (src.advancePerGroup != null) t.advancePerGroup = Math.min(8, Math.max(1, Number(src.advancePerGroup) || 2));
	if (src.bestOf != null) t.bestOf = normalizeBestOf(src.bestOf, t.bestOf);
	if (src.roundBestOf) t.roundBestOf = sanitizeRoundBestOf(src.roundBestOf);
	if (src.swissRounds != null) t.swissRounds = Math.min(12, Math.max(3, Number(src.swissRounds) || 3));
	if (src.rewardMode != null) t.rewardMode = src.rewardMode === 'prize' ? 'prize' : 'pot';
	if (src.payouts != null) t.payouts = sanitizePayouts(src.payouts);
	if (t.feeMode === 'free') t.entryFeeUsd = 0;
	return normalizeTournament(t);
}

function normalizeMatch(match, tournament) {
	if (!match || typeof match !== 'object') return match;
	match.bestOf = normalizeBestOf(match.bestOf, bestOfFor(tournament, match.side, match.round));
	match.games = Array.isArray(match.games) ? match.games : [];
	return match;
}

let priceCache = { at: 0, dogeUsd: 0, quotedAt: '' };

function roundCrypto(value, digits) {
	const factor = 10 ** digits;
	return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function entryFeeUsd(tournament) {
	const usd = Number(tournament && tournament.entryFeeUsd);
	if (Number.isFinite(usd) && usd >= 0) return usd;
	return 0;
}

function paidUsd(entry) {
	const usd = Number(entry && entry.amountUsd);
	if (Number.isFinite(usd) && usd > 0) return usd;
	return 0;
}

function rewardView(tournament, prizePool) {
	const mode = tournament && tournament.rewardMode === 'prize' ? 'prize' : 'pot';
	const pool = Math.max(0, Number(prizePool) || 0);
	const payouts = Array.isArray(tournament && tournament.payouts) ? tournament.payouts : [];
	const rows = [];
	for (const p of payouts) {
		if (mode === 'prize') {
			if (!p.prize) continue;
			rows.push({
				place: p.place,
				label: placeLabel(p.place),
				text: p.prize,
				amountUsd: null,
				percent: null,
			});
			continue;
		}
		const percent = Number(p.percent) || 0;
		if (!(percent > 0)) continue;
		rows.push({
			place: p.place,
			label: placeLabel(p.place),
			text: `${percent}%`,
			amountUsd: roundCrypto(pool * percent / 100, 2),
			percent,
		});
	}
	return { mode, pool, rows };
}

async function fetchJson(url) {
	const opts = {};
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		opts.signal = AbortSignal.timeout(12000);
	}
	const res = await fetch(url, opts);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error((data && data.error) || `Price HTTP ${res.status}`);
	}
	return data;
}

async function fetchUsdPrices() {
	const now = Date.now();
	if (now - priceCache.at < 20000 && priceCache.dogeUsd > 0) {
		return priceCache;
	}
	let dogeUsd = 0;
	try {
		const doge = await fetchJson('https://api.coinbase.com/v2/prices/DOGE-USD/spot');
		dogeUsd = Number(doge && doge.data && doge.data.amount);
	} catch (_err) {
		dogeUsd = 0;
	}
	if (!(dogeUsd > 0)) {
		const cg = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=dogecoin&vs_currencies=usd&precision=full');
		dogeUsd = Number(cg && cg.dogecoin && cg.dogecoin.usd) || dogeUsd;
	}
	if (!(dogeUsd > 0)) {
		const err = new Error('Could not fetch the live DOGE USD price');
		err.status = 502;
		throw err;
	}
	priceCache = {
		at: now,
		dogeUsd,
		quotedAt: new Date().toISOString(),
	};
	return priceCache;
}

function quoteAmounts(usd, prices) {
	const amount = Math.max(0, Number(usd) || 0);
	return {
		usd: roundCrypto(amount, 2),
		DOGE: roundCrypto(amount / prices.dogeUsd, 2),
		dogeUsd: prices.dogeUsd,
		quotedAt: prices.quotedAt,
	};
}

/** Trims whitespace, a UTF-8 BOM, and one layer of wrapping quotes from `.env` style values. */
function cleanSecret(value) {
	let out = String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
	if (out.length > 1 && /^(["']).*\1$/.test(out)) out = out.slice(1, -1).trim();
	return out;
}

function readFirstLine(filePath) {
	try {
		return cleanSecret(String(fs.readFileSync(filePath, 'utf8') || '').split(/\r?\n/)[0]);
	} catch (_err) {
		return '';
	}
}

function hostPasswordInfo(dataDir) {
	const fromEnv = cleanSecret(process.env.TOURNEY_PASSWORD);
	if (fromEnv) return { value: fromEnv, source: 'TOURNEY_PASSWORD env' };
	const fromFileEnv = String(process.env.TOURNEY_PASSWORD_FILE || '').trim();
	const candidates = [
		fromFileEnv,
		path.join(dataDir, '.tourney-password'),
		path.join(dataDir, '..', '..', '.tourney-password'),
	].filter(Boolean);
	for (const candidate of candidates) {
		const value = readFirstLine(candidate);
		if (value) return { value, source: `file ${path.basename(candidate)}` };
	}
	return { value: '', source: 'none' };
}

function resolveHostPassword(dataDir) {
	return hostPasswordInfo(dataDir).value;
}

function assertHostPassword(dataDir, given) {
	const { value: expected, source } = hostPasswordInfo(dataDir);
	if (!expected) {
		const err = new Error('Hosting is locked. Set TOURNEY_PASSWORD in Node, or put it on line 1 of public/server/data/.tourney-password');
		err.status = 403;
		throw err;
	}
	if (!timingSafeEqualString(expected, cleanSecret(given))) {
		const err = new Error(`Host password rejected — this server checks against ${source}. Clear any autofilled value and paste TOURNEY_PASSWORD exactly.`);
		err.status = 403;
		throw err;
	}
}

/** Host password as sent by the bracket UI: header on reads, body on writes. */
function hostSecretFrom(request) {
	const header = typeof request.get === 'function' ? request.get('x-tourney-host') : '';
	const body = request.body && request.body.hostPassword;
	return cleanSecret(header || body || '');
}

function isHostRequest(dataDir, request) {
	const { value: expected } = hostPasswordInfo(dataDir);
	if (!expected) return false;
	return timingSafeEqualString(expected, hostSecretFrom(request));
}

function resolveAdminPassword(dataDir) {
	const fromEnv = String(process.env.DD_ADMIN_PASSWORD || process.env.KUSH_ADMIN_PASSWORD || '').trim();
	if (fromEnv) return fromEnv;
	const fromFileEnv = String(process.env.DD_ADMIN_PASSWORD_FILE || '').trim();
	const candidates = [
		fromFileEnv,
		path.join(dataDir, '.dd-admin-password'),
		path.join(dataDir, '..', 'data', '.dd-admin-password'),
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			const value = String(fs.readFileSync(candidate, 'utf8') || '').trim();
			if (value) return value.split(/\r?\n/)[0].trim();
		} catch (_err) { /* try next */ }
	}
	return '';
}

function assertAdminPassword(dataDir, given) {
	const expected = resolveAdminPassword(dataDir);
	if (!expected) {
		const err = new Error('Admin delete is locked. Set DD_ADMIN_PASSWORD in Node (same as DD Evaluator).');
		err.status = 403;
		throw err;
	}
	if (!timingSafeEqualString(expected, String(given || '').trim())) {
		const err = new Error('Admin password rejected');
		err.status = 403;
		throw err;
	}
}

function slugify(name) {
	const base = String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 42);
	const suffix = Math.random().toString(36).slice(2, 6);
	return `${base || 'arena'}-${suffix}`;
}

function makeInvoiceCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = 'DDL-';
	for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
	return code;
}

function makeTreasury(_slug) {
	return PAY_TO.DOGE;
}

function entryStatus(entry) {
	if (entry && entry.noShow) return 'no_show';
	if (entry && entry.paid) return 'confirmed';
	return entry && entry.status === 'confirmed' ? 'confirmed' : 'pending';
}

function normalizeEntry(entry) {
	if (!entry || typeof entry !== 'object') return entry;
	entry.fromWallet = String(entry.fromWallet || entry.wallet || '').trim();
	entry.wallet = entry.fromWallet;
	entry.payAsset = KNOWN_PAY_ASSETS.includes(entry.payAsset) ? entry.payAsset : 'DOGE';
	entry.payTo = LEGACY_PAY_TO[entry.payAsset] || PAY_TO.DOGE;
	entry.whitelist = Boolean(entry.whitelist);
	entry.noShow = Boolean(entry.noShow);
	entry.subbedIn = Boolean(entry.subbedIn);
	entry.lateEntry = Boolean(entry.lateEntry);
	if (entry.noShow) {
		entry.status = 'no_show';
	} else {
		entry.status = entryStatus(entry);
		entry.paid = entry.status === 'confirmed';
	}
	entry.checkedIn = Boolean(entry.checkedIn);
	entry.email = String(entry.email || '').trim();
	entry.team = String(entry.team || '').trim();
	entry.country = String(entry.country || '').trim();
	entry.userId = entry.userId != null && Number(entry.userId) > 0 ? Number(entry.userId) : null;
	entry.ddlClass = records.normalizeDdlClass(entry.ddlClass) || '';
	return entry;
}

function readDdlClass(body) {
	return records.normalizeDdlClass(body && (body.ddlClass || body.class)) || 'Undeclared';
}

function resolveLinkedUser(body, typed) {
	const db = records.getDb();
	if (!db) return null;
	const askedId = Number(body && (body.userId || body.playerId));
	if (Number.isFinite(askedId) && askedId > 0) {
		const byId = records.findUserById(db, askedId);
		if (byId) return byId;
	}
	const name = String(typed || '').trim();
	if (name.length < 2) return null;
	return records.findUserByHandle(db, name) || records.findUserByDiscordUsername(db, name);
}

function linkArenaEntries(store, tournament) {
	const db = records.getDb();
	if (!db || !tournament) return;
	const entries = store.entries.filter((e) => e.tournamentId === tournament.id);
	const used = new Set(entries.filter((e) => e.userId).map((e) => Number(e.userId)));
	for (const entry of entries) {
		if (entry.userId) continue;
		const linked = records.findUserByHandle(db, entry.handle) || records.findUserByDiscordUsername(db, entry.handle);
		if (!linked) continue;
		const id = Number(linked.user_id);
		if (!id || used.has(id)) continue;
		entry.userId = id;
		used.add(id);
	}
}

function entryDiscordUser(entry) {
	const db = records.getDb();
	if (!db || !entry) return null;
	if (entry.userId) return records.publicDiscordUser(records.findUserById(db, entry.userId));
	return records.publicDiscordUser(
		records.findUserByHandle(db, entry.handle) || records.findUserByDiscordUsername(db, entry.handle)
	);
}

function addHostEntry(store, tournament, request, opts) {
	const typed = String((request.body && request.body.handle) || '').trim().replace(/\s+/g, ' ');
	if (typed.length < 2) throw Object.assign(new Error('Handle must be 2–24 characters'), { status: 400 });
	const linked = resolveLinkedUser(request.body, typed);
	const handle = String((linked && linked.tourney_handle) || typed).trim();
	if (handle.length < 2 || handle.length > 24) throw Object.assign(new Error('Handle must be 2–24 characters'), { status: 400 });
	const entries = store.entries.filter((e) => e.tournamentId === tournament.id);
	if (entries.some((e) => e.handle.toLowerCase() === handle.toLowerCase())) {
		throw Object.assign(new Error('That handle is already in'), { status: 400 });
	}
	const userId = linked ? Number(linked.user_id) : null;
	if (userId && entries.some((e) => Number(e.userId) === userId)) {
		throw Object.assign(new Error('That account is already in this arena'), { status: 400 });
	}
	const whitelist = Boolean(opts && opts.whitelist);
	if (whitelist) {
		if (!wantsWhitelist(tournament)) {
			throw Object.assign(new Error('Whitelist is off for this arena'), { status: 400 });
		}
		const spots = sanitizeWhitelistSpots(tournament.whitelistSpots, 0);
		const used = entries.filter(isWhitelistEntry).length;
		if (used >= spots) {
			throw Object.assign(new Error(`Whitelist is full (${spots} spot${spots === 1 ? '' : 's'})`), { status: 400 });
		}
	} else if (
		!(opts && opts.ignoreCap)
		&& tournament.capPlayers !== false
		&& entries.filter((e) => !isWhitelistEntry(e)).length >= tournament.maxPlayers
	) {
		throw Object.assign(new Error('This arena is full'), { status: 400 });
	}
	const now = new Date().toISOString();
	const entry = normalizeEntry({
		id: takeId(store),
		tournamentId: tournament.id,
		handle,
		userId,
		team: String((request.body && request.body.team) || '').trim(),
		ddlClass: readDdlClass(request.body),
		payAsset: 'DOGE',
		seed: null,
		paid: true,
		status: 'confirmed',
		checkedIn: false,
		invoiceCode: makeInvoiceCode(),
		amountUsd: entryFeeUsd(tournament),
		amountCrypto: 0,
		usdPerCoin: 0,
		addedByHost: true,
		whitelist,
		paidAt: now,
		createdAt: now,
	});
	store.entries.push(entry);
	return entry;
}

function emptyStore() {
	return { nextId: 1, tournaments: [], entries: [], matches: [], votes: [], predictions: [] };
}

function takeId(store) {
	const id = store.nextId;
	store.nextId += 1;
	return id;
}

function loadStore(filePath) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return emptyStore();
		parsed.nextId = Number(parsed.nextId) || 1;
		parsed.tournaments = (Array.isArray(parsed.tournaments) ? parsed.tournaments : []).map((t) => {
			if (!t || typeof t !== 'object') return t;
			const usd = Number(t.entryFeeUsd);
			t.entryFeeUsd = Number.isFinite(usd) && usd >= 0 ? usd : 0;
			return normalizeTournament(t);
		});
		parsed.entries = (Array.isArray(parsed.entries) ? parsed.entries : []).map(normalizeEntry);
		const byId = new Map(parsed.tournaments.map((t) => [t.id, t]));
		parsed.matches = (Array.isArray(parsed.matches) ? parsed.matches : []).map((m) => normalizeMatch(m, byId.get(m.tournamentId)));
		parsed.votes = Array.isArray(parsed.votes) ? parsed.votes : [];
		parsed.predictions = Array.isArray(parsed.predictions) ? parsed.predictions : [];
		return parsed;
	} catch (_err) {
		return emptyStore();
	}
}

function saveStore(filePath, store) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
	try {
		fs.renameSync(tmp, filePath);
	} catch (_err) {
		fs.copyFileSync(tmp, filePath);
		try { fs.unlinkSync(tmp); } catch (_e2) {}
	}
}

function isDemoTournament(store, tournament) {
	const slug = String(tournament && tournament.slug || '').toLowerCase();
	const name = String(tournament && tournament.name || '').toLowerCase().trim();
	const demoSlugs = ['rise-of-the-pack-open', 'ember-swiss', 'hearth-round-robin'];
	const demoNames = new Set(['rise of the pack open', 'ember swiss', 'hearth round robin']);
	if (demoNames.has(name)) return true;
	if (demoSlugs.some((base) => slug === base || slug.startsWith(`${base}-`))) return true;
	const entries = store.entries.filter((e) => e.tournamentId === tournament.id);
	if (!entries.length) return false;
	const demoHandles = new Set(['ash', 'blaze', 'cinder', 'drift', 'ember', 'flint', 'glow', 'hearth']);
	return entries.every((e) => demoHandles.has(String(e.handle || '').toLowerCase()) && !String(e.fromWallet || e.wallet || '').trim());
}

function removeTournament(store, tournament) {
	store.tournaments = store.tournaments.filter((row) => row.id !== tournament.id);
	store.entries = store.entries.filter((e) => e.tournamentId !== tournament.id);
	store.matches = store.matches.filter((m) => m.tournamentId !== tournament.id);
	store.votes = (store.votes || []).filter((v) => v.tournamentId !== tournament.id);
	store.predictions = (store.predictions || []).filter((p) => p.tournamentId !== tournament.id);
}

function stripDemoTournaments(store) {
	const demos = store.tournaments.filter((t) => isDemoTournament(store, t));
	for (const t of demos) removeTournament(store, t);
}

function draftsToMatches(store, tournament, drafts) {
	const created = [];
	for (const d of drafts) {
		const isBye = Boolean(d.byeAdvanced);
		created.push({
			id: takeId(store),
			tournamentId: tournament.id,
			side: d.side,
			round: d.round,
			position: d.position,
			entry1Id: d.entry1Id,
			entry2Id: d.entry2Id,
			group: d.group || null,
			winnerId: isBye ? (d.entry1Id || d.entry2Id) : null,
			score1: null,
			score2: null,
			bestOf: bestOfFor(tournament, d.side, d.round),
			games: [],
			status: isBye ? 'bye' : (d.entry1Id && d.entry2Id ? 'ready' : 'pending'),
			winnerGoesTo: d.winnerGoesTo || null,
			loserGoesTo: d.loserGoesTo || null,
		});
	}
	return created;
}

function attachPlacement(drafts) {
	const winners = drafts.filter((d) => d.side === 'winners');
	const maxRound = winners.reduce((n, d) => Math.max(n, d.round), 0);
	if (maxRound < 2) return drafts;
	const semis = winners.filter((d) => d.round === maxRound - 1).sort((a, b) => a.position - b.position);
	if (semis.length < 2) return drafts;
	drafts.push({ side: 'placement', round: 1, position: 1, entry1Id: null, entry2Id: null });
	semis.forEach((m, i) => {
		m.loserGoesTo = { side: 'placement', round: 1, position: 1, slot: (i % 2) + 1 };
	});
	return drafts;
}

function addMatches(store, tournament, paidEntries) {
	const seeded = [...paidEntries].sort((a, b) => (a.seed || 99) - (b.seed || 99));
	if (tournament.stageType === 'two' && tournament.stage !== 'playoff') {
		const size = tournament.groupSize || 4;
		const groups = [];
		for (let i = 0; i < seeded.length; i += size) groups.push(seeded.slice(i, i + size));
		tournament.stage = 'groups';
		tournament.groupCount = groups.length;
		for (let g = 0; g < groups.length; g++) {
			const drafts = generateRoundRobin(groups[g].map((e) => e.id)).map((d) => ({ ...d, group: g + 1 }));
			store.matches.push(...draftsToMatches(store, tournament, drafts));
		}
		return;
	}
	const ids = seeded.map((e) => e.id);
	let drafts;
	const inPlayoff = tournament.stage === 'playoff';
	const format = tournament.format;
	if (!inPlayoff && format === 'round_robin') drafts = generateRoundRobin(ids);
	else if (!inPlayoff && format === 'swiss') drafts = pairSwissRound(ids.map((id, i) => ({
		id, seed: i + 1, wins: 0, buchholz: 0, played: [],
	})), 1);
	else if (wantsLosersBracket(tournament) || format === 'double_elim') drafts = generateDoubleElim(ids);
	else drafts = generateSingleElim(ids);
	if (tournament.breakTies && !wantsLosersBracket(tournament) && drafts.some((d) => d.side === 'winners')) {
		attachPlacement(drafts);
	}
	store.matches.push(...draftsToMatches(store, tournament, drafts));
}

function findMatch(store, dest, tournamentId) {
	if (!dest) return null;
	return store.matches.find((m) => (
		(!tournamentId || m.tournamentId === tournamentId)
		&& m.side === dest.side && m.round === dest.round && m.position === dest.position
	)) || null;
}

function seat(match, slot, entryId) {
	if (!match || !entryId) return;
	if (slot === 1) match.entry1Id = entryId;
	else match.entry2Id = entryId;
	if (match.entry1Id && match.entry2Id && (match.status === 'pending' || match.status === 'bye')) {
		match.status = 'ready';
		match.winnerId = null;
	}
}

function reportMatch(store, match, score1, score2, games) {
	if (match.status === 'complete' || match.status === 'bye') {
		const err = new Error('That match is already closed');
		err.status = 400;
		throw err;
	}
	if (!match.entry1Id || !match.entry2Id) {
		const err = new Error('Match is not ready');
		err.status = 400;
		throw err;
	}
	const bestOf = normalizeBestOf(match.bestOf, 3);
	const need = winsNeeded(bestOf);
	let s1;
	let s2;
	let recorded = [];
	if (Array.isArray(games) && games.length) {
		recorded = games
			.map((game) => ({ winnerSlot: Number(game && game.winnerSlot) === 2 ? 2 : 1 }))
			.filter((game) => game.winnerSlot === 1 || game.winnerSlot === 2);
		const tally = tallyGames(recorded);
		s1 = tally.s1;
		s2 = tally.s2;
		if (recorded.length > bestOf) {
			const err = new Error(`Best of ${bestOf} cannot have more than ${bestOf} games`);
			err.status = 400;
			throw err;
		}
	} else {
		s1 = Number(score1);
		s2 = Number(score2);
		if (!Number.isFinite(s1) || !Number.isFinite(s2) || s1 < 0 || s2 < 0) {
			const err = new Error('Enter both game scores');
			err.status = 400;
			throw err;
		}
		recorded = [];
		for (let i = 0; i < s1; i++) recorded.push({ winnerSlot: 1 });
		for (let i = 0; i < s2; i++) recorded.push({ winnerSlot: 2 });
	}
	if (s1 === s2) {
		const err = new Error('Series cannot be tied');
		err.status = 400;
		throw err;
	}
	if (s1 !== need && s2 !== need) {
		const err = new Error(`First to ${need} wins (best of ${bestOf})`);
		err.status = 400;
		throw err;
	}
	if (s1 > need || s2 > need) {
		const err = new Error(`A player cannot win more than ${need} games`);
		err.status = 400;
		throw err;
	}
	match.bestOf = bestOf;
	match.games = recorded;
	match.score1 = s1;
	match.score2 = s2;
	match.winnerId = s1 > s2 ? match.entry1Id : match.entry2Id;
	match.status = 'complete';
	const loserId = match.winnerId === match.entry1Id ? match.entry2Id : match.entry1Id;
	const winDest = findMatch(store, match.winnerGoesTo, match.tournamentId);
	if (winDest && match.winnerGoesTo) seat(winDest, match.winnerGoesTo.slot, match.winnerId);
	const loseDest = findMatch(store, match.loserGoesTo, match.tournamentId);
	if (loseDest && match.loserGoesTo) seat(loseDest, match.loserGoesTo.slot, loserId);
}

function readGames(games, bestOf) {
	const need = winsNeeded(bestOf);
	const out = [];
	let s1 = 0;
	let s2 = 0;
	for (const game of Array.isArray(games) ? games : []) {
		const slot = Number(game && game.winnerSlot) === 2 ? 2 : (Number(game && game.winnerSlot) === 1 ? 1 : 0);
		if (!slot) continue;
		if (out.length >= bestOf || s1 >= need || s2 >= need) break;
		out.push({ winnerSlot: slot });
		if (slot === 1) s1 += 1;
		else s2 += 1;
	}
	return { games: out, s1, s2, need };
}

function saveGames(store, match, games, bestOf) {
	if (match.status === 'complete' || match.status === 'bye') {
		throw Object.assign(new Error('That match is already closed'), { status: 400 });
	}
	if (!match.entry1Id || !match.entry2Id) {
		throw Object.assign(new Error('Match is not ready'), { status: 400 });
	}
	const bo = normalizeBestOf(bestOf, match.bestOf);
	const tally = readGames(games, bo);
	match.bestOf = bo;
	match.games = tally.games;
	match.score1 = tally.games.length ? tally.s1 : null;
	match.score2 = tally.games.length ? tally.s2 : null;
	match.winnerId = null;
	match.status = 'ready';
	return match;
}

function standingsFor(store, tournament, group) {
	const entries = store.entries.filter((e) => (
		e.tournamentId === tournament.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
	));
	const matches = store.matches.filter((m) => m.tournamentId === tournament.id && (group ? m.group === group : true));
	const pool = group
		? entries.filter((e) => matches.some((m) => m.entry1Id === e.id || m.entry2Id === e.id))
		: entries;
	const byId = new Map(pool.map((e) => [e.id, {
		entryId: e.id, handle: e.handle, seed: e.seed, ddlClass: e.ddlClass || '',
		wins: 0, losses: 0, draws: 0, played: 0, playedIds: [], points: 0, buchholz: 0, mapDiff: 0,
	}]));
	for (const m of matches) {
		if (m.status === 'bye' && m.entry1Id && byId.has(m.entry1Id)) {
			byId.get(m.entry1Id).wins += 1;
			byId.get(m.entry1Id).points += 3;
			continue;
		}
		if (m.status !== 'complete' || !m.entry1Id || !m.entry2Id) continue;
		const s1 = byId.get(m.entry1Id);
		const s2 = byId.get(m.entry2Id);
		if (!s1 || !s2) continue;
		s1.played += 1;
		s2.played += 1;
		s1.playedIds.push(m.entry2Id);
		s2.playedIds.push(m.entry1Id);
		const sc1 = m.score1 ?? 0;
		const sc2 = m.score2 ?? 0;
		s1.mapDiff += sc1 - sc2;
		s2.mapDiff += sc2 - sc1;
		if (m.winnerId === m.entry1Id) { s1.wins += 1; s1.points += 3; s2.losses += 1; }
		else { s2.wins += 1; s2.points += 3; s1.losses += 1; }
	}
	return [...byId.values()].sort((a, b) => b.points - a.points || b.mapDiff - a.mapDiff || (a.seed || 99) - (b.seed || 99));
}

function maybeFinishOrAdvance(store, t) {
	const open = store.matches.filter((m) => m.tournamentId === t.id && m.status !== 'complete' && m.status !== 'bye');
	if (open.length) return;
	if (t.stageType === 'two' && t.stage === 'groups') {
		const advance = t.advancePerGroup || 2;
		const groups = t.groupCount || Math.max(...store.matches.filter((m) => m.tournamentId === t.id && m.group).map((m) => m.group), 0);
		const advancers = [];
		for (let g = 1; g <= groups; g++) {
			advancers.push(...standingsFor(store, t, g).slice(0, advance));
		}
		if (advancers.length >= 2) {
			t.stage = 'playoff';
			addMatches(store, t, advancers.map((s) => store.entries.find((e) => e.id === s.entryId)).filter(Boolean));
			return;
		}
	}
	if (t.format === 'swiss' && t.stageType !== 'two' && t.stage !== 'playoff') {
		const rounds = store.matches.filter((m) => m.tournamentId === t.id && m.side === 'group').map((m) => m.round);
		const maxRound = rounds.length ? Math.max(...rounds) : 0;
		if (maxRound < (t.swissRounds || 3)) {
			const table = standingsFor(store, t);
			const drafts = pairSwissRound(table.map((s) => ({
				id: s.entryId,
				seed: s.seed || 99,
				wins: s.wins,
				buchholz: s.buchholz,
				played: s.playedIds || [],
			})), maxRound + 1);
			store.matches.push(...draftsToMatches(store, t, drafts));
			return;
		}
	}
	if (
		wantsLosersBracket(t)
		&& t.stageType !== 'two'
		&& t.stage !== 'playoff'
		&& (t.format === 'swiss' || t.format === 'round_robin')
	) {
		const table = standingsFor(store, t);
		const seeded = table.map((s) => store.entries.find((e) => e.id === s.entryId)).filter(Boolean);
		if (seeded.length >= 2) {
			seeded.forEach((e, i) => { e.seed = i + 1; });
			t.stage = 'playoff';
			addMatches(store, t, seeded);
			return;
		}
	}
	t.status = 'completed';
	try {
		const db = records.getDb();
		if (db) {
			records.snapshotResults(db, store, t, {
				isDemo: isDemoTournament(store, t),
				podium: podiumFor(store, t),
				standings: standingsFor(store, t),
			});
		}
	} catch (err) {
		console.error('[tourney] snapshot:', err && err.message ? err.message : err);
	}
}

function podiumFor(store, tournament) {
	const entries = store.entries.filter((e) => e.tournamentId === tournament.id);
	const matches = store.matches.filter((m) => m.tournamentId === tournament.id);
	const byId = (id) => {
		const e = entries.find((row) => row.id === id);
		return e ? { id: e.id, handle: e.handle } : null;
	};
	const table = standingsFor(store, tournament);
	if (!hasElimTree(store, tournament)) {
		return {
			first: table[0] ? { id: table[0].entryId, handle: table[0].handle, record: `${table[0].wins}-${table[0].losses}` } : null,
			second: table[1] ? { id: table[1].entryId, handle: table[1].handle, record: `${table[1].wins}-${table[1].losses}` } : null,
			third: table[2] ? [{ id: table[2].entryId, handle: table[2].handle, record: `${table[2].wins}-${table[2].losses}` }] : [],
		};
	}
	const champ = championFor(store, tournament);
	let final = matches.find((m) => m.side === 'grand' && m.status === 'complete');
	if (!final) {
		final = [...matches]
			.filter((m) => m.side === 'winners' && m.status === 'complete')
			.sort((a, b) => b.round - a.round || a.position - b.position)[0];
	}
	const secondId = final && champ ? (final.winnerId === final.entry1Id ? final.entry2Id : final.entry1Id) : null;
	const place = matches.find((m) => m.side === 'placement' && m.status === 'complete');
	let third = [];
	if (place && place.winnerId) {
		const bronze = byId(place.winnerId);
		if (bronze) third = [bronze];
	} else if (wantsLosersBracket(tournament)) {
		const losersFinal = [...matches]
			.filter((m) => m.side === 'losers' && m.status === 'complete')
			.sort((a, b) => b.round - a.round || a.position - b.position)[0];
		if (losersFinal) {
			const thirdId = losersFinal.winnerId === losersFinal.entry1Id ? losersFinal.entry2Id : losersFinal.entry1Id;
			const bronze = byId(thirdId);
			if (bronze) third = [bronze];
		}
	} else if (final) {
		const maxW = matches.filter((m) => m.side === 'winners').reduce((n, m) => Math.max(n, m.round), 0);
		const semis = matches.filter((m) => m.side === 'winners' && m.round === maxW - 1 && m.status === 'complete');
		third = semis.map((m) => byId(m.winnerId === m.entry1Id ? m.entry2Id : m.entry1Id)).filter(Boolean);
	}
	const rec = (id) => {
		const row = table.find((s) => s.entryId === id);
		return row ? `${row.wins}-${row.losses}` : '';
	};
	return {
		first: champ ? { ...champ, record: rec(champ.id) } : null,
		second: secondId ? { ...byId(secondId), record: rec(secondId) } : null,
		third: third.map((p) => ({ ...p, record: rec(p.id) })),
	};
}

function championFor(store, tournament) {
	const matches = store.matches.filter((m) => m.tournamentId === tournament.id);
	if (wantsLosersBracket(tournament) && matches.some((m) => m.side === 'grand')) {
		const last = matches.find((m) => m.side === 'grand' && m.status === 'complete' && m.winnerId);
		if (!last) return null;
		const entry = store.entries.find((e) => e.id === last.winnerId);
		return entry ? { id: entry.id, handle: entry.handle } : null;
	}
	if (hasElimTree(store, tournament)) {
		const last = [...matches]
			.filter((m) => m.side === 'winners' && m.status === 'complete' && m.winnerId)
			.sort((a, b) => b.round - a.round || a.position - b.position)[0];
		if (!last) return null;
		const entry = store.entries.find((e) => e.id === last.winnerId);
		return entry ? { id: entry.id, handle: entry.handle } : null;
	}
	const table = standingsFor(store, tournament);
	if (!table.length) return null;
	const top = table[0];
	return { id: top.entryId, handle: top.handle };
}

function hostUserFor(tournament) {
	try {
		return records.publicDiscordUser(records.findOrganizerUser(records.getDb(), tournament));
	} catch (_err) {
		return null;
	}
}

function attachHostIdentity(request, tournament) {
	const session = authDex.getTourneySession(request && request.signedCookies);
	if (session && session.user_id) {
		tournament.hostUserId = Number(session.user_id);
		const fromDiscord = String(session.tourney_handle || session.discord_username || '').trim();
		const typed = String(tournament.hostName || '').trim();
		if (fromDiscord && (!typed || typed === 'KushMetaX')) tournament.hostName = fromDiscord;
	}
	return tournament;
}

function summarize(store, t) {
	const entries = store.entries.filter((e) => e.tournamentId === t.id);
	const paid = entries.filter((e) => e.paid && !e.noShow && (!e.whitelist || e.subbedIn));
	const prizePool = entries.filter((e) => e.paid && (!e.whitelist || e.subbedIn)).reduce((sum, e) => sum + paidUsd(e), 0);
	return {
		...t,
		hostUser: hostUserFor(t),
		paidCount: paid.length,
		entryCount: entries.length,
		prizePool,
		rewards: rewardView(t, prizePool),
		champion: t.status === 'completed' ? championFor(store, t) : null,
	};
}

/**
 * Visitors get the columns a public bracket page needs. Contact details, the wallet
 * an entrant paid from, and invoice codes stay with the host.
 */
const PUBLIC_ENTRY_FIELDS = [
	'id', 'tournamentId', 'handle', 'userId', 'team', 'seed', 'paid', 'status',
	'checkedIn', 'payAsset', 'amountUsd', 'amountCrypto', 'createdAt', 'paidAt',
	'whitelist', 'noShow', 'subbedIn', 'addedByHost', 'lateEntry', 'ddlClass',
];

function publicEntry(entry) {
	const out = {};
	for (const key of PUBLIC_ENTRY_FIELDS) out[key] = entry[key];
	return out;
}

function detail(store, t, isHost) {
	linkArenaEntries(store, t);
	const entries = store.entries.filter((e) => e.tournamentId === t.id);
	const matches = store.matches.filter((m) => m.tournamentId === t.id);
	const paid = entries.filter((e) => e.paid && (!e.whitelist || e.subbedIn));
	const prizePool = paid.reduce((sum, e) => sum + paidUsd(e), 0);
	const listed = entries.map((entry) => {
		const row = isHost ? { ...entry } : publicEntry(entry);
		row.discordUser = entryDiscordUser(entry);
		return row;
	});
	const db = records.getDb();
	const awards = db ? records.listAwards(db) : [];
	return {
		tournament: t,
		hostUser: hostUserFor(t),
		viewerIsHost: Boolean(isHost),
		entries: records.attachBadges(listed, awards),
		matches,
		standings: standingsFor(store, t),
		prizePool,
		rewards: rewardView(t, prizePool),
		champion: t.status === 'completed' ? championFor(store, t) : null,
		podium: podiumFor(store, t),
		votes: (store.votes || []).filter((v) => v.tournamentId === t.id),
		predictions: (store.predictions || []).filter((p) => p.tournamentId === t.id),
		payTo: PAY_TO,
		claims: isHost ? records.listClaimsForTournament(records.getDb(), t.id) : [],
	};
}

function createRouter(options) {
	const dataDir = options.dataDir;
	const storeFile = path.join(dataDir, 'tourney-store.json');
	const router = express.Router();

	function withStore(mutate) {
		return async (request, response) => {
			try {
				const store = loadStore(storeFile);
				stripDemoTournaments(store);
				const result = await mutate(store, request);
				saveStore(storeFile, store);
				response.json(result);
			} catch (err) {
				response.status(err.status || 400).json({ error: err.message || 'Request failed' });
			}
		};
	}

	function readOnly(fn) {
		return (request, response) => {
			try {
				const store = loadStore(storeFile);
				stripDemoTournaments(store);
				saveStore(storeFile, store);
				response.json(fn(store, request));
			} catch (err) {
				response.status(err.status || 400).json({ error: err.message || 'Request failed' });
			}
		};
	}

	router.get('/quote', async (request, response) => {
		try {
			const usd = Math.max(0, Number(request.query.usd) || 0);
			const prices = await fetchUsdPrices();
			response.json(quoteAmounts(usd, prices));
		} catch (err) {
			response.status(err.status || 502).json({ error: err.message || 'Price quote failed' });
		}
	});

	router.get('/status', (_request, response) => {
		response.json({
			ok: true,
			mode: 'static',
			rewards: true,
			hostPasswordSet: Boolean(resolveHostPassword(dataDir)),
			adminPasswordSet: Boolean(resolveAdminPassword(dataDir)),
			control: true,
			payTo: PAY_TO,
			discordOAuth: authDex.discordOAuthConfigured(),
			requireAccountDefault: true,
		});
	});

	router.get('/host-auth', (_request, response) => {
		const info = hostPasswordInfo(dataDir);
		response.json({ configured: Boolean(info.value), source: info.source });
	});

	router.post('/host-auth', (request, response) => {
		const info = hostPasswordInfo(dataDir);
		try {
			assertHostPassword(dataDir, request.body && request.body.hostPassword);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message, configured: Boolean(info.value), source: info.source });
			return;
		}
		response.json({ ok: true, source: info.source });
	});

	router.get('/arenas', readOnly((store) => (
		store.tournaments
			.map((t) => summarize(store, t))
			.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
	)));

	router.get('/arenas/:slug', readOnly((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		return detail(store, t, isHostRequest(dataDir, request));
	}));

	router.post('/arenas', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const body = request.body || {};
		const name = String(body.name || '').trim();
		const format = String(body.format || '');
		if (name.length < 2) throw Object.assign(new Error('Name is too short'), { status: 400 });
		if (!FORMATS.includes(format)) throw Object.assign(new Error('Pick a format'), { status: 400 });
		const wanted = String(body.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42);
		let slug = wanted || slugify(name);
		if (store.tournaments.some((row) => row.slug === slug)) slug = slugify(name);
		const maxPlayers = Math.min(64, Math.max(2, Number(body.maxPlayers) || 16));
		const t = readSettings(body, {
			id: takeId(store),
			slug,
			name,
			format,
			status: 'registration',
			entryFeeUsd: Math.max(0, Number(body.entryFeeUsd ?? body.entryFeeDoge) || 0),
			entryFeeDoge: 0,
			maxPlayers,
			swissRounds: format === 'swiss'
				? Math.min(12, Math.max(3, Number(body.swissRounds) || defaultSwissRounds(maxPlayers)))
				: defaultSwissRounds(maxPlayers),
			treasury: '',
			createdAt: new Date().toISOString(),
			stage: body.stageType === 'two' ? 'groups' : 'main',
		});
		t.id = t.id || takeId(store);
		t.slug = slug;
		t.treasury = makeTreasury(t.slug);
		attachHostIdentity(request, t);
		store.tournaments.push(t);
		return t;
	}));

	router.post('/arenas/:slug/enter', withStore(async (store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (t.status !== 'registration') throw Object.assign(new Error('Registration is closed'), { status: 400 });
		if (t.registrationMode === 'list') {
			throw Object.assign(new Error('This arena uses a host list. Ask the organizer to add you.'), { status: 400 });
		}
		if (t.startAt && !t.startTentative && Date.parse(t.startAt) && Date.now() > Date.parse(t.startAt) + 86400000) {
			throw Object.assign(new Error('Registration window has closed'), { status: 400 });
		}
		const session = authDex.getTourneySession(request.signedCookies);
		if (t.requireAccount !== false && !session) {
			throw Object.assign(new Error('Sign in with Discord to register'), { status: 401 });
		}
		const entries = store.entries.filter((e) => e.tournamentId === t.id);
		let handle = String((request.body && request.body.handle) || '').trim().replace(/\s+/g, ' ');
		let userId = null;
		if (session) {
			const owned = String(session.tourney_handle || '').trim();
			if (!owned) {
				throw Object.assign(new Error('Set a tournament handle on your account first'), { status: 400 });
			}
			handle = owned;
			userId = Number(session.user_id);
			if (entries.some((e) => Number(e.userId) === userId)) {
				throw Object.assign(new Error('You are already in this arena'), { status: 400 });
			}
		}
		if (handle.length < 2 || handle.length > 24) throw Object.assign(new Error('Handle must be 2–24 characters'), { status: 400 });
		const email = String((request.body && request.body.email) || '').trim();
		if (t.requireVerifiedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw Object.assign(new Error('A valid email is required to join'), { status: 400 });
		}
		const team = String((request.body && request.body.team) || '').trim();
		if (t.requireTeams && team.length < 2) throw Object.assign(new Error('Enter a team name'), { status: 400 });
		const country = String((request.body && request.body.country) || '').trim();
		if (t.countryLock) {
			const allowed = String(t.allowedCountries || '').split(/[,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
			if (allowed.length && !allowed.includes(country.toLowerCase())) {
				throw Object.assign(new Error('This arena is locked to specific countries'), { status: 400 });
			}
		}
		const fromWallet = String((request.body && (request.body.fromWallet || request.body.wallet)) || '').trim();
		const usd = entryFeeUsd(t);
		if (usd > 0 && (fromWallet.length < 8 || fromWallet.length > 64)) {
			throw Object.assign(new Error('Enter the DOGE wallet address you sent from'), { status: 400 });
		}
		const requestedAsset = String((request.body && request.body.payAsset) || 'DOGE').trim().toUpperCase() || 'DOGE';
		if (!PAY_ASSETS.includes(requestedAsset)) {
			throw Object.assign(new Error('Registration is DOGE only. Swap to DOGE on K9SWAP, then send the quoted amount.'), { status: 400 });
		}
		const payAsset = 'DOGE';
		if (t.capPlayers !== false && entries.filter((e) => !isWhitelistEntry(e)).length >= t.maxPlayers) {
			throw Object.assign(new Error('This arena is full'), { status: 400 });
		}
		if (entries.some((e) => e.handle.toLowerCase() === handle.toLowerCase())) {
			throw Object.assign(new Error('That handle is already in'), { status: 400 });
		}
		let quote = { usd: 0, DOGE: 0, dogeUsd: 0, quotedAt: new Date().toISOString() };
		if (usd > 0) {
			const prices = await fetchUsdPrices();
			quote = quoteAmounts(usd, prices);
		}
		const amountCrypto = quote.DOGE;
		const usdPerCoin = quote.dogeUsd;
		const autoPay = usd === 0;
		const entry = normalizeEntry({
			id: takeId(store),
			tournamentId: t.id,
			handle,
			userId,
			email,
			team,
			ddlClass: readDdlClass(request.body),
			country,
			fromWallet,
			wallet: fromWallet,
			payAsset,
			payTo: PAY_TO[payAsset],
			seed: null,
			paid: autoPay,
			status: autoPay ? 'confirmed' : 'pending',
			checkedIn: false,
			invoiceCode: makeInvoiceCode(),
			amountUsd: quote.usd,
			amountCrypto,
			usdPerCoin,
			quotedAt: quote.quotedAt,
			amountDoge: amountCrypto,
			paidAt: autoPay ? new Date().toISOString() : null,
			createdAt: new Date().toISOString(),
		});
		store.entries.push(entry);
		return entry;
	}));

	router.post('/arenas/:slug/pay', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const code = String((request.body && request.body.invoiceCode) || '').trim();
		const entry = store.entries.find((e) => e.tournamentId === t.id && e.invoiceCode === code);
		if (!entry) throw Object.assign(new Error('Invoice not found'), { status: 404 });
		entry.paid = true;
		entry.status = 'confirmed';
		entry.paidAt = new Date().toISOString();
		return entry;
	}));

	router.post('/arenas/:slug/confirm', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (t.status !== 'registration') throw Object.assign(new Error('Registration is closed'), { status: 400 });
		const codes = new Set((Array.isArray(request.body && request.body.invoiceCodes) ? request.body.invoiceCodes : [])
			.map((c) => String(c || '').trim())
			.filter(Boolean));
		const ids = new Set((Array.isArray(request.body && request.body.entryIds) ? request.body.entryIds : [])
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id)));
		const confirmAll = Boolean(request.body && request.body.confirmAll);
		/** `paid: false` reverses a mistaken confirm and drops the entry back to pending. */
		const wantPaid = !(request.body && request.body.paid === false);
		if (!confirmAll && !codes.size && !ids.size) {
			throw Object.assign(new Error('Select at least one participant to confirm'), { status: 400 });
		}
		let confirmed = 0;
		for (const entry of store.entries.filter((e) => e.tournamentId === t.id)) {
			const hit = confirmAll || codes.has(entry.invoiceCode) || ids.has(entry.id);
			if (!hit || entry.paid === wantPaid) continue;
			entry.paid = wantPaid;
			entry.status = wantPaid ? 'confirmed' : 'pending';
			entry.paidAt = wantPaid ? new Date().toISOString() : null;
			if (!wantPaid) entry.checkedIn = false;
			confirmed += 1;
		}
		return { ok: true, confirmed, ...detail(store, t, true) };
	}));

	/** Host-added player: covers list arenas, walk-ins, live late entries, and whitelist substitutes. */
	router.post('/arenas/:slug/add-entry', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const whitelist = Boolean(request.body && request.body.whitelist);
		if (t.status === 'completed') {
			throw Object.assign(new Error('This arena is finished — no new entries'), { status: 400 });
		}
		if (t.status !== 'registration') {
			if (whitelist) {
				if (!(wantsWhitelist(t) && t.status === 'in_progress')) {
					throw Object.assign(new Error('The bracket is locked — no new entries'), { status: 400 });
				}
				addHostEntry(store, t, request, { whitelist });
				return detail(store, t, true);
			}
			if (t.status !== 'in_progress') {
				throw Object.assign(new Error('The bracket is locked — no new entries'), { status: 400 });
			}
			addLateHostEntry(store, t, request);
			return detail(store, t, true);
		}
		addHostEntry(store, t, request, { whitelist });
		return detail(store, t, true);
	}));

	/** Put a whitelist substitute into a first-round slot: no-show, empty, or bye. */
	router.post('/arenas/:slug/sub-round1', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (!wantsWhitelist(t)) {
			throw Object.assign(new Error('Turn on whitelist spots to substitute a no-show'), { status: 400 });
		}
		if (t.status !== 'in_progress') {
			throw Object.assign(new Error('Lock the bracket before substituting a first-round player'), { status: 400 });
		}
		const body = request.body || {};
		const matchId = Number(body.matchId);
		if (!Number.isFinite(matchId) || matchId <= 0) {
			throw Object.assign(new Error('Pick a first-round slot'), { status: 400 });
		}
		const slot = Number(body.slot) === 2 ? 2 : 1;
		const seat = findLateSeat(store, t, { matchId, slot });
		if (!seat) throw Object.assign(new Error('No open first-round slot to fill'), { status: 400 });
		const matches = store.matches.filter((m) => m.tournamentId === t.id);
		let incoming = null;
		const incomingId = Number(body.entryId);
		if (Number.isFinite(incomingId) && incomingId > 0) {
			incoming = store.entries.find((e) => e.tournamentId === t.id && e.id === incomingId);
			if (!incoming) throw Object.assign(new Error('Whitelist player not found'), { status: 404 });
		} else {
			const typed = String(body.handle || '').trim().replace(/\s+/g, ' ');
			if (typed.length < 2) throw Object.assign(new Error('Pick a whitelist player or type a handle'), { status: 400 });
			incoming = store.entries.find((e) => (
				e.tournamentId === t.id && e.handle.toLowerCase() === typed.toLowerCase()
			));
			if (!incoming) incoming = addHostEntry(store, t, request, { whitelist: true });
		}
		if (!incoming.whitelist) {
			throw Object.assign(new Error('Only a whitelist player can take an open first-round slot'), { status: 400 });
		}
		if (incoming.noShow) throw Object.assign(new Error('That whitelist player already sat out'), { status: 400 });
		if (entryInMatches(matches, incoming.id)) {
			throw Object.assign(new Error('That whitelist player is already in the bracket'), { status: 400 });
		}
		applyLateSeat(store, t, incoming, seat);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/remove-entry', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const id = Number(request.body && request.body.entryId);
		const entry = store.entries.find((e) => e.tournamentId === t.id && e.id === id);
		if (!entry) throw Object.assign(new Error('Entry not found'), { status: 404 });
		const matches = store.matches.filter((m) => m.tournamentId === t.id);
		if (t.status !== 'registration') {
			const unusedWhitelist = entry.whitelist && !entry.subbedIn && !entry.noShow && !entryInMatches(matches, entry.id);
			if (!(unusedWhitelist && t.status === 'in_progress')) {
				throw Object.assign(new Error('The bracket is locked — entries can no longer be removed'), { status: 400 });
			}
		}
		store.entries = store.entries.filter((e) => e !== entry);
		store.predictions = (store.predictions || []).filter((p) => !(p.tournamentId === t.id && p.championId === id));
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/generate', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (t.status !== 'registration') throw Object.assign(new Error('Bracket already generated'), { status: 400 });
		const body = request.body || {};
		const requestedIds = Array.isArray(body.entryIds)
			? body.entryIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
			: [];
		const pool = store.entries.filter((e) => e.tournamentId === t.id && !isWhitelistEntry(e) && !e.noShow);
		const chosen = requestedIds.length
			? pool.filter((e) => requestedIds.includes(e.id))
			: pool.filter((e) => e.paid);
		if (!chosen.length) {
			throw Object.assign(new Error('Select at least two confirmed participants'), { status: 400 });
		}
		if (body.confirmSelected !== false) {
			for (const entry of chosen) {
				if (entry.paid) continue;
				entry.paid = true;
				entry.status = 'confirmed';
				entry.paidAt = entry.paidAt || new Date().toISOString();
			}
		}
		if (body.checkInSelected) {
			for (const entry of chosen) entry.checkedIn = true;
		}
		let paid = chosen.filter((e) => e.paid);
		if (t.requireCheckIn) paid = paid.filter((e) => e.checkedIn);
		if (paid.length < 2) {
			throw Object.assign(new Error(t.requireCheckIn
				? 'Need at least 2 checked-in participants to lock the bracket'
				: 'Need at least 2 confirmed participants to lock the bracket'), { status: 400 });
		}
		t.bestOf = normalizeBestOf(body.bestOf, t.bestOf);
		if (body.roundBestOf) t.roundBestOf = sanitizeRoundBestOf(body.roundBestOf);
		if (body.shuffle) paid = shuffleList(paid);
		else paid = [...paid].sort((a, b) => (a.seed || a.id) - (b.seed || b.id));
		paid.forEach((e, i) => { e.seed = i + 1; });
		store.matches = store.matches.filter((m) => m.tournamentId !== t.id);
		addMatches(store, t, paid);
		t.status = 'in_progress';
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/round-rules', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const body = request.body || {};
		if (body.bestOf != null) t.bestOf = normalizeBestOf(body.bestOf, t.bestOf);
		if (body.roundBestOf) t.roundBestOf = { ...t.roundBestOf, ...sanitizeRoundBestOf(body.roundBestOf) };
		for (const match of store.matches.filter((m) => m.tournamentId === t.id)) {
			if (match.status === 'complete' || match.status === 'bye') continue;
			match.bestOf = bestOfFor(t, match.side, match.round);
		}
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/games', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		saveGames(store, match, request.body && request.body.games, request.body && request.body.bestOf);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/report', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		if (request.body && request.body.bestOf && match.status !== 'complete' && match.status !== 'bye') {
			match.bestOf = normalizeBestOf(request.body.bestOf, match.bestOf);
		}
		reportMatch(
			store,
			match,
			Number(request.body && request.body.score1),
			Number(request.body && request.body.score2),
			request.body && request.body.games,
		);
		maybeFinishOrAdvance(store, t);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/settings', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const next = readSettings(request.body, t);
		Object.assign(t, next);
		t.slug = request.params.slug;
		t.id = next.id;
		attachHostIdentity(request, t);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/check-in', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const body = request.body || {};
		if (body.hostPassword) assertHostPassword(dataDir, body.hostPassword);
		const ids = Array.isArray(body.entryIds) ? body.entryIds.map(Number) : [];
		const handle = String(body.handle || '').trim().toLowerCase();
		let n = 0;
		for (const entry of store.entries.filter((e) => e.tournamentId === t.id)) {
			const hit = ids.includes(entry.id) || (handle && entry.handle.toLowerCase() === handle);
			if (!hit) continue;
			entry.checkedIn = body.checkedIn !== false;
			n += 1;
		}
		if (!n) throw Object.assign(new Error('No matching participants to check in'), { status: 400 });
		return detail(store, t, isHostRequest(dataDir, request));
	}));

	router.post('/arenas/:slug/vote', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (!t.votingEnabled) throw Object.assign(new Error('Voting is off for this arena'), { status: 400 });
		const voter = String((request.body && request.body.voter) || '').trim().slice(0, 24);
		const matchId = Number(request.body && request.body.matchId);
		const winnerId = Number(request.body && request.body.winnerId);
		if (voter.length < 2) throw Object.assign(new Error('Enter a voter handle'), { status: 400 });
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match || (match.status !== 'ready' && match.status !== 'pending')) {
			throw Object.assign(new Error('That match is not open for votes'), { status: 400 });
		}
		if (winnerId !== match.entry1Id && winnerId !== match.entry2Id) {
			throw Object.assign(new Error('Pick a player in this match'), { status: 400 });
		}
		store.votes = store.votes || [];
		store.votes = store.votes.filter((v) => !(v.tournamentId === t.id && v.matchId === matchId && v.voter.toLowerCase() === voter.toLowerCase()));
		store.votes.push({ tournamentId: t.id, matchId, voter, winnerId });
		return detail(store, t, isHostRequest(dataDir, request));
	}));

	router.post('/arenas/:slug/predict', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (!t.predictionsEnabled) throw Object.assign(new Error('Predictions are off for this arena'), { status: 400 });
		const voter = String((request.body && request.body.voter) || '').trim().slice(0, 24);
		const championId = Number(request.body && request.body.championId);
		const note = t.predictionCustomFields ? String((request.body && request.body.note) || '').trim().slice(0, 140) : '';
		if (voter.length < 2) throw Object.assign(new Error('Enter a handle to predict'), { status: 400 });
		const entry = store.entries.find((e) => e.tournamentId === t.id && e.id === championId);
		if (!entry) throw Object.assign(new Error('Pick a participant'), { status: 400 });
		store.predictions = store.predictions || [];
		store.predictions = store.predictions.filter((p) => !(p.tournamentId === t.id && p.voter.toLowerCase() === voter.toLowerCase()));
		store.predictions.push({ tournamentId: t.id, voter, championId, note });
		return detail(store, t, isHostRequest(dataDir, request));
	}));

	const removeArena = withStore((store, request) => {
		assertAdminPassword(dataDir, request.body && (request.body.adminPassword || request.body.hostPassword));
		const slug = String((request.body && request.body.slug) || request.body.arena || '').trim();
		const t = store.tournaments.find((row) => row.slug === slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		removeTournament(store, t);
		return { ok: true, removed: slug };
	});
	const purgeDemos = withStore((store, request) => {
		assertAdminPassword(dataDir, request.body && (request.body.adminPassword || request.body.hostPassword));
		const before = store.tournaments.length;
		stripDemoTournaments(store);
		return { ok: true, removed: before - store.tournaments.length };
	});
	router.post('/control/remove-arena', removeArena);
	router.post('/remove-arena', removeArena);
	router.post('/admin/remove-arena', removeArena);
	router.post('/control/purge-demos', purgeDemos);
	router.post('/purge-demos', purgeDemos);
	router.post('/admin/purge-demos', purgeDemos);

	function recordsUnavailable(response) {
		const detail = typeof authDex.lastDdDatabaseError === 'function' ? authDex.lastDdDatabaseError() : '';
		console.error('[tourney] records database unavailable', detail || '');
		response.status(503).json({
			error: detail
				? `Records database unavailable (${detail}).`
				: 'Records database unavailable.',
		});
	}

	function emptyHall() {
		const detail = typeof authDex.lastDdDatabaseError === 'function' ? authDex.lastDdDatabaseError() : '';
		if (detail) console.error('[tourney] records database unavailable', detail);
		return {
			ok: true,
			events: [],
			champions: [],
			mentions: [],
			ledgers: [],
			badges: [],
			awards: [],
			warning: 'The records ledger is offline right now.',
		};
	}

	router.get('/players/search', (request, response) => {
		try {
			assertHostPassword(dataDir, hostSecretFrom(request));
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
			return;
		}
		const db = records.getDb();
		if (!db) {
			response.json({ ok: true, players: [] });
			return;
		}
		const q = String((request.query && request.query.q) || '').trim();
		response.json({ ok: true, players: records.searchDiscordPlayers(db, q) });
	});

	router.get('/records', (_request, response) => {
		const db = records.getDb();
		if (!db) {
			response.json(emptyHall());
			return;
		}
		response.json({ ok: true, ...records.hallOfFame(db, 40) });
	});

	router.get('/records/awards', (_request, response) => {
		const db = records.getDb();
		if (!db) {
			response.json({ ok: true, awards: [] });
			return;
		}
		response.json({ ok: true, awards: records.listAwards(db) });
	});

	router.post('/records/host', (request, response) => {
		try {
			assertHostPassword(dataDir, request.body && request.body.hostPassword);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
			return;
		}
		const db = records.getDb();
		if (!db) {
			recordsUnavailable(response);
			return;
		}
		try {
			const result = records.hostOp(db, request.body && request.body.op, request.body);
			response.json({
				ok: true,
				...result,
				...records.hallOfFame(db, 80),
			});
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Ledger update failed' });
		}
	});

	router.get('/records/champions', (request, response) => {
		const db = records.getDb();
		if (!db) {
			response.json({ ok: true, champions: [] });
			return;
		}
		response.json({
			ok: true,
			champions: records.listChampions(db, {
				format: request.query && request.query.format,
				since: request.query && request.query.since,
			}),
		});
	});

	router.get('/records/unclaimed', (request, response) => {
		const session = authDex.getTourneySession(request.signedCookies);
		if (!session) {
			response.status(401).json({ error: 'Sign in with Discord first.' });
			return;
		}
		const db = records.getDb();
		response.json({
			ok: true,
			results: records.unclaimedForHandle(db, session.tourney_handle),
		});
	});

	router.get('/records/players/:handle', (request, response) => {
		const db = records.getDb();
		if (!db) {
			recordsUnavailable(response);
			return;
		}
		const handle = String(request.params.handle || '').trim();
		if (handle.length < 2) {
			response.status(400).json({ error: 'Handle is too short' });
			return;
		}
		response.json({ ok: true, ...records.playerProfile(db, handle) });
	});

	router.post('/records/claim', (request, response) => {
		const session = authDex.getTourneySession(request.signedCookies);
		if (!session) {
			response.status(401).json({ error: 'Sign in with Discord first.' });
			return;
		}
		const db = records.getDb();
		if (!db) {
			recordsUnavailable(response);
			return;
		}
		try {
			response.json(records.createClaim(
				db,
				session.user_id,
				request.body && request.body.tournamentId,
				request.body && request.body.entryId,
			));
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Claim failed' });
		}
	});

	router.post('/arenas/:slug/claims/:id/resolve', withStore((store, request) => {
		assertHostPassword(dataDir, request.body && request.body.hostPassword);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const db = records.getDb();
		if (!db) throw Object.assign(new Error(authDex.lastDdDatabaseError && authDex.lastDdDatabaseError()
			? `Records database unavailable (${authDex.lastDdDatabaseError()})`
			: 'Records database unavailable'), { status: 503 });
		const result = records.resolveClaim(db, request.params.id, request.body && request.body.approve !== false);
		if (result.status === 'approved') {
			const entry = store.entries.find((e) => e.tournamentId === result.tournamentId && e.id === result.entryId);
			if (entry) entry.userId = result.userId;
		}
		return { ...result, ...detail(store, t, true) };
	}));

	router.post('/control/backfill-results', (request, response) => {
		try {
			assertHostPassword(dataDir, request.body && request.body.hostPassword);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
			return;
		}
		const db = records.getDb();
		if (!db) {
			recordsUnavailable(response);
			return;
		}
		const store = loadStore(storeFile);
		response.json(records.backfillWithFns(db, store, isDemoTournament, podiumFor, standingsFor));
	});

	/**
	 * Without this, an unknown path falls through to the site's HTML 404 page and the
	 * bracket UI can only report "404 HTML" — which is what a stale Node process looks
	 * like after this file gains a route. Answer in JSON and name the cause.
	 */
	router.use((request, response) => {
		response.status(404).json({
			error: `No tourney endpoint for ${request.method} ${request.baseUrl || ''}${request.path}. `
				+ 'If this path is new, the Node process is still running the old routes — restart it.',
		});
	});

	return router;
}

const TOOL_TITLE = 'DDL Tourney - Legends Bracket';
const TOOL_DESCRIPTION = 'Host Doginal Dogs Legends pack tournaments. DOGE entry, paid roster, live brackets.';

function escapeAttr(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;');
}

function publicOrigin(request) {
	const raw = String(process.env.PUBLIC_SITE_URL || process.env.SITE_ORIGIN || process.env.BASE_URL || '').trim();
	if (raw) {
		try {
			return new URL(raw.endsWith('/') ? raw.slice(0, -1) : raw).origin;
		} catch (_err) {}
	}
	const proto = String(
		(request.get && (request.get('x-forwarded-proto') || request.get('x-forwarded-protocol')))
		|| request.protocol
		|| 'https'
	).split(',')[0].trim() || 'https';
	const host = String(
		(request.get && (request.get('x-forwarded-host') || request.get('host')))
		|| 'kushmedia.xyz'
	).split(',')[0].trim() || 'kushmedia.xyz';
	return `${proto}://${host}`;
}

function slugFromRequest(request) {
	const fromParam = request.params && request.params.slug;
	if (fromParam) return String(fromParam).trim();
	const query = request.query || {};
	const fromQuery = String(query.t || query.slug || '').trim();
	if (fromQuery) return fromQuery.slice(0, 64);
	const path = String((request.originalUrl || request.url || '').split('?')[0]);
	const match = path.match(/\/t\/([A-Za-z0-9][A-Za-z0-9-]{0,62})\/?$/);
	return match ? match[1] : '';
}

function shareMetaForSlug(dataDir, slug) {
	const wanted = String(slug || '').trim();
	if (!wanted) return null;
	const store = loadStore(path.join(dataDir, 'tourney-store.json'));
	const tournament = (store.tournaments || []).find((row) => String(row.slug) === wanted);
	if (!tournament) return null;
	const name = String(tournament.name || '').trim() || TOOL_TITLE;
	const extra = String(tournament.description || '').trim()
		|| `${name} — ${tournament.game || 'Doginal Dogs Legends TCG'} on ${TOOL_TITLE}.`;
	return {
		title: name,
		description: extra.slice(0, 200),
		slug: tournament.slug,
	};
}

function replaceNamedMeta(html, attr, key, content) {
	const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}">`;
	const re = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, 'i');
	if (re.test(html)) return html.replace(re, tag);
	return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}

function applyShareMeta(html, meta) {
	let out = html;
	out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(meta.title)}</title>`);
	out = replaceNamedMeta(out, 'name', 'description', meta.description);
	out = replaceNamedMeta(out, 'name', 'twitter:title', meta.title);
	out = replaceNamedMeta(out, 'name', 'twitter:description', meta.description);
	out = replaceNamedMeta(out, 'name', 'twitter:image', meta.image);
	out = replaceNamedMeta(out, 'property', 'og:title', meta.title);
	out = replaceNamedMeta(out, 'property', 'og:description', meta.description);
	out = replaceNamedMeta(out, 'property', 'og:url', meta.url);
	out = replaceNamedMeta(out, 'property', 'og:image', meta.image);
	out = replaceNamedMeta(out, 'property', 'og:image:alt', meta.title);
	const canonical = `<link rel="canonical" href="${escapeAttr(meta.url)}">`;
	if (/<link rel="canonical" href="[^"]*">/i.test(out)) {
		out = out.replace(/<link rel="canonical" href="[^"]*">/i, canonical);
	} else {
		out = out.replace(/<\/head>/i, `  ${canonical}\n</head>`);
	}
	return out;
}

function sendAppPage(options) {
	const bracketDir = options.bracketDir;
	const dataDir = options.dataDir;
	const request = options.request;
	const response = options.response;
	const htmlPath = path.join(bracketDir, 'index.html');
	let html;
	try {
		html = fs.readFileSync(htmlPath, 'utf8');
	} catch (_err) {
		response.status(500).type('txt').send('Tourney page missing');
		return;
	}
	const origin = publicOrigin(request);
	const found = shareMetaForSlug(dataDir, slugFromRequest(request));
	const title = found ? found.title : TOOL_TITLE;
	const description = found ? found.description : TOOL_DESCRIPTION;
	const url = found
		? `${origin}/tourney/?t=${encodeURIComponent(found.slug)}`
		: `${origin}/tourney/`;
	html = applyShareMeta(html, {
		title,
		description,
		url,
		image: `${origin}/bracket/og.jpg`,
	});
	response.set({
		'Cache-Control': 'no-store, private',
		'Content-Type': 'text/html; charset=utf-8',
	});
	response.send(html);
}

createRouter.sendAppPage = sendAppPage;
createRouter.TOOL_TITLE = TOOL_TITLE;

module.exports = createRouter;
