'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { timingSafeEqualString } = require('../security-utils');
const engine = require('../lib/bracket-engine');
const {
	nextPowerOfTwo,
	generateSingleElim,
	generateDoubleElim,
	generateRoundRobin,
	pairSwissRound,
	defaultSwissRounds,
} = engine;
const eventPhase = require('../lib/event-phase');
const {
	restackElimTree,
	reseatCompletePair,
	repairKnownBracketHistory,
} = require('../lib/bracket-layout');
const {
	restoreMissingArenasFromRecords,
	parseRecord,
} = require('../lib/arena-archive');
let records = require('../lib/tourney-records');
const persist = require('../lib/tourney-persist');
const playDecks = require('../lib/play-decks');
const classQuota = require('../lib/ddl-class-quota');
const authDex = require('./auth-dex');
const tourneyOg = require('../lib/tourney-og');
const { sanitizeKickStream } = require('../../../bracket/kick-url');
const dogePayWatch = require('../lib/doge-pay-watch');
const arenaChat = require('../lib/arena-chat');

const FORMATS = ['single_elim', 'double_elim', 'round_robin', 'swiss'];
const BEST_OF = [1, 3, 5];
const PAY_ASSETS = ['DOGE', 'XMONEY', 'USDC_SOL'];
const DEFAULT_DOGE_PAY_TO = 'D92759tetUUkf6Hn6Gk9mVKZqST32fN9iT';
const DEFAULT_SOLANA_PAY_TO = '3tNZfWyvPBhx6KsaTuCBoChajrK7fbLME2eC4mKwrWgW';
function dogePayTo() {
	const fromEnv = String(process.env.DOGE_PAY_TO || process.env.TOURNEY_DOGE_ADDRESS || '').trim();
	return fromEnv || DEFAULT_DOGE_PAY_TO;
}
function solanaPayTo() {
	const fromEnv = String(process.env.USDC_SOL_PAY_TO || process.env.TOURNEY_SOLANA_ADDRESS || '').trim();
	return fromEnv || DEFAULT_SOLANA_PAY_TO;
}
const PAY_TO = {
	DOGE: dogePayTo(),
	USDC_SOL: solanaPayTo(),
};
/** Dogecoin P2PKH (mainnet) — starts with D, Base58, no 0/O/I/l. */
const DOGE_ADDRESS_RE = /^D[1-9A-HJ-NP-Za-km-z]{25,39}$/;
/** Solana pubkey — Base58, typically 32–44 chars. */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
/** Official Circle USDC mint on Solana mainnet. */
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Kept so older SOL invoices still display the wallet they were quoted against. */
const LEGACY_PAY_TO = {
	SOL: DEFAULT_SOLANA_PAY_TO,
	DOGE: PAY_TO.DOGE,
};
const KNOWN_PAY_ASSETS = ['DOGE', 'SOL', 'XMONEY', 'USDC_SOL'];
const HOST_CONFIRM_ASSETS = ['XMONEY', 'USDC_SOL'];
function isHostConfirmAsset(asset) {
	return HOST_CONFIRM_ASSETS.includes(String(asset || '').toUpperCase());
}
/** Share of paid entry fees redistributed as the pot. The rest is retained. */
const PRIZE_POOL_PERCENT = 65;
const HOUSE_RETAIN_PERCENT = 35;
/** One-shot: move these arenas onto a Discord account, then leave hostUserId frozen. */
const PENDING_ARENA_HOSTS = [
	{ slug: 'wyd-showdown-1', handle: 'Home' },
];
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
		if (!/^(winners|losers|grand|group|placement|title):\d+$/.test(String(key))) continue;
		out[key] = normalizeBestOf(value, 3);
	}
	return out;
}

function sanitizeFinalsBestOf(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	return BEST_OF.includes(n) ? n : null;
}

function champEntryId(tournament) {
	if (!tournament || !tournament.reigningChamp) return 0;
	const id = Number(tournament.reigningChampEntryId);
	return Number.isFinite(id) && id > 0 ? id : 0;
}

function wantsReigningChamp(tournament) {
	return Boolean(champEntryId(tournament));
}

function isFinalsMatch(match, tournament) {
	if (!match) return false;
	if (match.side === 'title') return true;
	if (wantsReigningChamp(tournament)) return false;
	if (match.side === 'grand') return true;
	if (match.side === 'placement' || match.side === 'losers' || match.side === 'group') return false;
	return match.side === 'winners' && !match.winnerGoesTo;
}

function bestOfFor(tournament, side, round, match) {
	const rules = (tournament && tournament.roundBestOf) || {};
	const keyed = rules[roundKey(side, round)];
	if (keyed) return normalizeBestOf(keyed, tournament && tournament.bestOf);
	const finals = sanitizeFinalsBestOf(tournament && tournament.finalsBestOf);
	if (finals && isFinalsMatch(match || { side, round, winnerGoesTo: true }, tournament)) return finals;
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

const ELIM_SIDES = ['winners', 'losers', 'grand', 'placement'];

function hasElimTree(store, tournament) {
	return (store.matches || []).some((m) => (
		m.tournamentId === tournament.id
		&& (ELIM_SIDES.includes(m.side) || m.side === 'title')
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
		const addedUsd = sanitizeHostPotUsd(row.addedUsd, 0);
		if (percent <= 0 && !prize && !(addedUsd > 0)) continue;
		seen.add(place);
		out.push({ place, percent, prize, addedUsd });
	}
	return out.sort((a, b) => a.place - b.place);
}

function looksLikeGrandTournament(name) {
	const n = String(name || '');
	return /\bddnyc\b/i.test(n) && /\b2026\b/.test(n) && /\birl\b/i.test(n);
}

function sanitizeEventKind(value, name) {
	if (value === 'duel') return 'duel';
	if (value === 'grand' || looksLikeGrandTournament(name)) return 'grand';
	return 'tournament';
}

function normalizeTournament(tournament) {
	if (!tournament || typeof tournament !== 'object') return tournament;
	tournament.bestOf = normalizeBestOf(tournament.bestOf, 3);
	tournament.roundBestOf = sanitizeRoundBestOf(tournament.roundBestOf);
	tournament.finalsBestOf = sanitizeFinalsBestOf(tournament.finalsBestOf);
	tournament.hostName = String(tournament.hostName || 'KushMetaX').trim() || 'KushMetaX';
	try {
		tournament.streamUrl = sanitizeKickStream(tournament.streamUrl);
	} catch (_err) {
		tournament.streamUrl = '';
	}
	tournament.rewardMode = tournament.rewardMode === 'prize' ? 'prize' : 'pot';
	tournament.hostPotUsd = sanitizeHostPotUsd(tournament.hostPotUsd, 0);
	tournament.addedPotUsd = sanitizeHostPotUsd(tournament.addedPotUsd, 0);
	tournament.payouts = sanitizePayouts(tournament.payouts);
	const hostUserId = tournament.hostUserId != null ? Number(tournament.hostUserId) : 0;
	tournament.hostUserId = Number.isFinite(hostUserId) && hostUserId > 0 ? hostUserId : null;
	const treasury = sanitizeDogeAddress(tournament.treasury, { soft: true });
	tournament.treasury = treasury || '';
	tournament.game = String(tournament.game || 'Doginal Dogs Legends TCG').trim() || 'Doginal Dogs Legends TCG';
	tournament.stageType = tournament.stageType === 'two' ? 'two' : 'single';
	tournament.stage = tournament.stage === 'playoff' ? 'playoff' : (tournament.stageType === 'two' ? (tournament.stage || 'groups') : 'main');
	tournament.breakTies = Boolean(tournament.breakTies);
	const wasWhitelistMode = tournament.registrationMode === 'whitelist';
	tournament.registrationMode = sanitizeRegistrationMode(tournament.registrationMode);
	if (wasWhitelistMode && !(Number(tournament.whitelistSpots) > 0)) tournament.whitelistSpots = 2;
	tournament.whitelistSpots = sanitizeWhitelistSpots(tournament.whitelistSpots, 0);
	tournament.feeMode = eventPhase.sanitizeFeeMode(tournament.feeMode, tournament.entryFeeUsd);
	tournament.charityName = String(tournament.charityName || '').trim().slice(0, 80);
	if (tournament.feeMode !== 'charity') tournament.charityName = tournament.charityName || '';
	tournament.xHandle = sanitizeXHandle(tournament.xHandle);
	tournament.acceptDoge = tournament.acceptDoge !== false;
	tournament.acceptUsdcSol = Boolean(tournament.acceptUsdcSol);
	tournament.solanaTreasury = sanitizeSolanaAddress(tournament.solanaTreasury, { soft: true });
	if (tournament.acceptUsdcSol && !tournament.solanaTreasury) {
		tournament.solanaTreasury = solanaPayTo();
	}
	if (tournament.feeMode === 'free') {
		tournament.xHandle = tournament.xHandle || '';
	} else if (!tournament.xHandle && tournament.acceptDoge === false && !tournament.acceptUsdcSol) {
		tournament.acceptDoge = true;
	}
	tournament.potFundMode = sanitizePotFundMode(tournament.potFundMode, tournament);
	tournament.requireTeams = Boolean(tournament.requireTeams);
	tournament.capPlayers = tournament.capPlayers !== false;
	tournament.startAt = tournament.startAt || null;
	tournament.startTentative = Boolean(tournament.startTentative);
	tournament.timezone = String(tournament.timezone || 'America/New_York');
	tournament.requireCheckIn = Boolean(tournament.requireCheckIn);
	tournament.checkInOpensAt = tournament.checkInOpensAt ? String(tournament.checkInOpensAt) : null;
	tournament.listsDueAt = tournament.listsDueAt ? String(tournament.listsDueAt) : null;
	tournament.listsPublicReveal = Boolean(tournament.listsPublicReveal);
	tournament.listsRevealOnMatchComplete = tournament.listsRevealOnMatchComplete !== false;
	tournament.judgeUserIds = eventPhase.sanitizeUserIdList(tournament.judgeUserIds);
	tournament.streamUserIds = eventPhase.sanitizeUserIdList(tournament.streamUserIds);
	const storedTree = Math.max(0, Number(tournament.bracketSize) || 0);
	tournament.bracketSize = storedTree >= 2 ? storedTree : 0;
	tournament.votingEnabled = Boolean(tournament.votingEnabled);
	tournament.predictionsEnabled = Boolean(tournament.predictionsEnabled);
	tournament.shareImages = Boolean(tournament.shareImages);
	tournament.requireVerifiedEmail = Boolean(tournament.requireVerifiedEmail);
	tournament.countryLock = Boolean(tournament.countryLock);
	tournament.allowedCountries = String(tournament.allowedCountries || '');
	tournament.predictionCustomFields = Boolean(tournament.predictionCustomFields);
	tournament.requireAccount = tournament.requireAccount !== false;
	tournament.official = tournament.official !== false;
	tournament.semiIrl = Boolean(tournament.semiIrl);
	tournament.requireRegisteredDeck = Boolean(tournament.requireRegisteredDeck);
	tournament.deckClassQuota = classQuota.sanitizeQuota(tournament.deckClassQuota);
	if (tournament.deckClassQuota) tournament.requireRegisteredDeck = true;
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
	tournament.eventKind = sanitizeEventKind(tournament.eventKind, tournament.name);
	tournament.reigningChamp = Boolean(tournament.reigningChamp);
	const champId = Number(tournament.reigningChampEntryId);
	tournament.reigningChampEntryId = Number.isFinite(champId) && champId > 0 ? champId : null;
	if (!tournament.reigningChamp) tournament.reigningChampEntryId = null;
	if (tournament.eventKind === 'duel') {
		tournament.capPlayers = true;
		tournament.maxPlayers = 2;
		tournament.stageType = 'single';
		tournament.stage = 'main';
		tournament.losersBracket = false;
		tournament.breakTies = false;
		tournament.playoffFormat = 'single_elim';
		tournament.reigningChamp = false;
		tournament.reigningChampEntryId = null;
		if (tournament.format === 'double_elim') tournament.format = 'single_elim';
	}
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
	if (src.feeMode) t.feeMode = src.feeMode === 'charity' ? 'charity' : (src.feeMode === 'free' ? 'free' : 'paid');
	if (src.charityName != null) t.charityName = String(src.charityName).trim().slice(0, 80);
	if (src.xHandle != null) t.xHandle = sanitizeXHandle(src.xHandle);
	if (src.acceptDoge != null) t.acceptDoge = Boolean(src.acceptDoge);
	if (src.acceptUsdcSol != null) t.acceptUsdcSol = Boolean(src.acceptUsdcSol);
	if (src.solanaTreasury != null) {
		t.solanaTreasury = sanitizeSolanaAddress(src.solanaTreasury, t.acceptUsdcSol ? undefined : { soft: true });
	}
	if (src.requireTeams != null) t.requireTeams = Boolean(src.requireTeams);
	if (src.capPlayers != null) t.capPlayers = Boolean(src.capPlayers);
	if (src.maxPlayers != null) t.maxPlayers = Math.min(64, Math.max(2, Number(src.maxPlayers) || 16));
	if (src.entryFeeUsd != null) t.entryFeeUsd = Math.max(0, Number(src.entryFeeUsd) || 0);
	if (src.startAt !== undefined) t.startAt = src.startAt ? String(src.startAt) : null;
	if (src.startTentative != null) t.startTentative = Boolean(src.startTentative);
	if (src.timezone != null) t.timezone = String(src.timezone || 'America/New_York');
	if (src.requireCheckIn != null) t.requireCheckIn = Boolean(src.requireCheckIn);
	if (src.checkInOpensAt !== undefined) t.checkInOpensAt = src.checkInOpensAt ? String(src.checkInOpensAt) : null;
	if (src.listsDueAt !== undefined) t.listsDueAt = src.listsDueAt ? String(src.listsDueAt) : null;
	if (src.listsPublicReveal != null) t.listsPublicReveal = Boolean(src.listsPublicReveal);
	if (src.listsRevealOnMatchComplete != null) t.listsRevealOnMatchComplete = Boolean(src.listsRevealOnMatchComplete);
	if (src.judgeUserIds != null) t.judgeUserIds = eventPhase.sanitizeUserIdList(src.judgeUserIds);
	if (src.streamUserIds != null) t.streamUserIds = eventPhase.sanitizeUserIdList(src.streamUserIds);
	if (src.votingEnabled != null) t.votingEnabled = Boolean(src.votingEnabled);
	if (src.predictionsEnabled != null) t.predictionsEnabled = Boolean(src.predictionsEnabled);
	if (src.shareImages != null) t.shareImages = Boolean(src.shareImages);
	if (src.requireVerifiedEmail != null) t.requireVerifiedEmail = Boolean(src.requireVerifiedEmail);
	if (src.countryLock != null) t.countryLock = Boolean(src.countryLock);
	if (src.allowedCountries != null) t.allowedCountries = String(src.allowedCountries || '').slice(0, 400);
	if (src.predictionCustomFields != null) t.predictionCustomFields = Boolean(src.predictionCustomFields);
	if (src.requireAccount != null) t.requireAccount = Boolean(src.requireAccount);
	if (src.official != null) t.official = Boolean(src.official);
	if (src.semiIrl != null) t.semiIrl = Boolean(src.semiIrl);
	if (src.requireRegisteredDeck != null) t.requireRegisteredDeck = Boolean(src.requireRegisteredDeck);
	if (Object.prototype.hasOwnProperty.call(src, 'deckClassQuota')
		|| src.requireDeckClassQuota != null
		|| src.deckClass != null
		|| src.deckClassPercent != null) {
		if (src.requireDeckClassQuota === false || src.deckClassQuota === null) {
			t.deckClassQuota = null;
		} else {
			const raw = src.deckClassQuota && typeof src.deckClassQuota === 'object' ? src.deckClassQuota : src;
			t.deckClassQuota = classQuota.sanitizeQuota({
				class: src.deckClass || raw.class,
				percent: src.deckClassPercent != null ? src.deckClassPercent : raw.percent,
			});
		}
	}
	if (src.groupSize != null) t.groupSize = Math.min(16, Math.max(2, Number(src.groupSize) || 4));
	if (src.advancePerGroup != null) t.advancePerGroup = Math.min(8, Math.max(1, Number(src.advancePerGroup) || 2));
	if (src.bestOf != null) t.bestOf = normalizeBestOf(src.bestOf, t.bestOf);
	if (src.roundBestOf) t.roundBestOf = sanitizeRoundBestOf(src.roundBestOf);
	if (Object.prototype.hasOwnProperty.call(src, 'finalsBestOf')) t.finalsBestOf = sanitizeFinalsBestOf(src.finalsBestOf);
	if (src.swissRounds != null) t.swissRounds = Math.min(12, Math.max(3, Number(src.swissRounds) || 3));
	if (src.rewardMode != null) t.rewardMode = src.rewardMode === 'prize' ? 'prize' : 'pot';
	if (src.hostPotUsd != null) t.hostPotUsd = sanitizeHostPotUsd(src.hostPotUsd, t.hostPotUsd);
	if (src.addedPotUsd != null) t.addedPotUsd = sanitizeHostPotUsd(src.addedPotUsd, t.addedPotUsd);
	if (src.potFundMode != null) t.potFundMode = src.potFundMode === 'percent' ? 'percent' : 'usd';
	if (src.payouts != null) t.payouts = sanitizePayouts(src.payouts);
	if (src.eventKind != null) t.eventKind = src.eventKind;
	if (src.reigningChamp != null) t.reigningChamp = Boolean(src.reigningChamp);
	if (Object.prototype.hasOwnProperty.call(src, 'reigningChampEntryId')) {
		const champId = Number(src.reigningChampEntryId);
		t.reigningChampEntryId = Number.isFinite(champId) && champId > 0 ? champId : null;
	}
	if (src.treasury != null || src.dogeAddress != null) {
		const raw = src.treasury != null ? src.treasury : src.dogeAddress;
		if (t.acceptDoge === false && !String(raw || '').trim()) t.treasury = '';
		else t.treasury = sanitizeDogeAddress(raw, t.acceptDoge === false ? { soft: true } : undefined);
	}
	if (t.feeMode === 'free') t.entryFeeUsd = 0;
	return normalizeTournament(t);
}

function normalizeMatch(match, tournament) {
	if (!match || typeof match !== 'object') return match;
	match.bestOf = normalizeBestOf(match.bestOf, bestOfFor(tournament, match.side, match.round, match));
	match.games = Array.isArray(match.games) ? match.games : [];
	if (match.reportProposal && typeof match.reportProposal === 'object') {
		const by = Number(match.reportProposal.byEntryId);
		match.reportProposal = {
			byEntryId: Number.isFinite(by) && by > 0 ? by : 0,
			score1: Number(match.reportProposal.score1),
			score2: Number(match.reportProposal.score2),
			games: Array.isArray(match.reportProposal.games) ? match.reportProposal.games : [],
			reason: String(match.reportProposal.reason || '').trim().slice(0, 160),
			at: String(match.reportProposal.at || ''),
		};
		if (!match.reportProposal.byEntryId) match.reportProposal = null;
	} else {
		match.reportProposal = null;
	}
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

function sanitizeHostPotUsd(value, fallback = 0) {
	const n = Number(value);
	const base = Number.isFinite(n) && n >= 0 ? n : Number(fallback);
	if (!Number.isFinite(base) || base < 0) return 0;
	return Math.round(Math.min(1_000_000, base) * 100) / 100;
}

function sanitizePotFundMode(value, tournament) {
	if (value === 'percent' || value === 'usd') return value;
	if (sanitizeHostPotUsd(tournament && tournament.hostPotUsd, 0) > 0) return 'usd';
	if (tournament && (tournament.feeMode === 'free' || !(Number(tournament.entryFeeUsd) > 0))) return 'usd';
	return 'percent';
}

function feeEntries(entries) {
	return (entries || []).filter((e) => e.paid && (!e.whitelist || e.subbedIn));
}

function feeTotalUsd(entries) {
	return roundCrypto(feeEntries(entries).reduce((sum, e) => sum + paidUsd(e), 0), 2);
}

function computePrizePool(tournament, entries) {
	const fees = feeTotalUsd(entries);
	if (sanitizePotFundMode(tournament && tournament.potFundMode, tournament) === 'percent') {
		const fromFees = roundCrypto(fees * PRIZE_POOL_PERCENT / 100, 2);
		const added = sanitizeHostPotUsd(tournament && tournament.addedPotUsd, 0);
		return roundCrypto(fromFees + added, 2);
	}
	return sanitizeHostPotUsd(tournament && tournament.hostPotUsd, 0);
}

function matchHasReportedPlay(match) {
	if (!match || match.status === 'bye') return false;
	if (match.status === 'complete') return true;
	if (Array.isArray(match.games) && match.games.length) return true;
	if (Number(match.score1) > 0 || Number(match.score2) > 0) return true;
	return false;
}

function reshuffleBlockReason(store, tournament, action) {
	const word = action === 'swap' ? 'swap' : 'shuffle';
	const gerund = action === 'swap' ? 'swapping' : 'shuffling';
	if (!tournament || tournament.status !== 'in_progress') {
		return `Lock the bracket first, then ${word}.`;
	}
	if (tournament.stageType === 'two' && tournament.stage === 'playoff') {
		return `The playoff has already started — ${gerund} would wipe group results.`;
	}
	const matches = (store.matches || []).filter((m) => m.tournamentId === tournament.id);
	if (matches.some(matchHasReportedPlay)) {
		return `Cannot ${word} after a series has been reported.`;
	}
	return null;
}

function swapBlockReason(tournament) {
	if (!tournament || tournament.status === 'registration') {
		return 'Lock the bracket first, then swap.';
	}
	return null;
}

function markBracketOpen(tournament) {
	if (tournament && tournament.status === 'completed') tournament.status = 'in_progress';
}

function matchRosterLocked(match) {
	return Boolean(match && match.status === 'complete');
}

function slotEntry(match, slot) {
	if (!match) return null;
	return Number(slot) === 2 ? match.entry2Id : match.entry1Id;
}

function setSlotEntry(match, slot, entryId) {
	if (!match) return;
	const value = entryId == null || entryId === '' ? null : entryId;
	if (Number(slot) === 2) match.entry2Id = value;
	else match.entry1Id = value;
}

function clearMatchVotes(store, tournament, matchIds) {
	const hit = new Set((matchIds || []).filter(Boolean));
	if (!hit.size) return;
	store.votes = (store.votes || []).filter((v) => v.tournamentId !== tournament.id || !hit.has(v.matchId));
}

function applyByeAdvance(store, match) {
	const byeId = match.entry1Id || match.entry2Id;
	if (!byeId || (match.entry1Id && match.entry2Id)) return;
	if (!match.entry1Id && match.entry2Id) {
		match.entry1Id = match.entry2Id;
		match.entry2Id = null;
	}
	match.status = 'bye';
	match.winnerId = match.entry1Id;
	match.games = [];
	match.score1 = null;
	match.score2 = null;
	const dest = findMatch(store, match.winnerGoesTo, match.tournamentId);
	const slot = match.winnerGoesTo && Number(match.winnerGoesTo.slot);
	if (dest && slot && !slotEntry(dest, slot) && !destHasProgress(dest)) {
		seat(dest, slot, match.entry1Id);
	}
}

function matchClosed(match) {
	return Boolean(match && (match.status === 'complete' || match.status === 'bye' || match.status === 'vacant'));
}

/** A bye counts as decided: the lone player still advanced out of that slot. */
function decidedWinnerId(match) {
	if (!match) return 0;
	if (match.status !== 'complete' && match.status !== 'bye') return 0;
	return Number(match.winnerId) || 0;
}

function deepestDecidedWinnerId(matches, sides) {
	const decided = (matches || []).filter((m) => sides.includes(m.side) && decidedWinnerId(m));
	if (!decided.length) return 0;
	const deepest = decided.sort((a, b) => (
		(Number(b.round) || 0) - (Number(a.round) || 0)
		|| (Number(a.position) || 0) - (Number(b.position) || 0)
	))[0];
	return decidedWinnerId(deepest);
}

function feedsSlot(src, dest, slot) {
	if (!src || !dest) return false;
	const want = Number(slot);
	for (const key of ['winnerGoesTo', 'loserGoesTo']) {
		const d = src[key];
		if (
			d
			&& d.side === dest.side
			&& Number(d.round) === Number(dest.round)
			&& Number(d.position) === Number(dest.position)
			&& Number(d.slot) === want
		) {
			return true;
		}
	}
	return false;
}

function slotWaiting(store, tournament, match, slot) {
	if (slotEntry(match, slot)) return false;
	return tournamentMatches(store, tournament).some((src) => {
		if (!src || src.id === match.id) return false;
		if (src.status === 'vacant') return false;
		if (src.status === 'complete' || src.status === 'bye') return false;
		return feedsSlot(src, match, slot);
	});
}

/**
 * A player the host already moved elsewhere is not missing, so the match that sent them
 * on must not drag them back to its own `winnerGoesTo` seat.
 */
function seatedAhead(store, tournament, from, entryId) {
	const id = Number(entryId);
	if (!id) return false;
	const after = Number(from.round) || 0;
	return tournamentMatches(store, tournament).some((m) => (
		m.id !== from.id
		&& (Number(m.entry1Id) === id || Number(m.entry2Id) === id)
		&& (m.side === 'title' || (Number(m.round) || 0) >= after)
	));
}

function reseatClosedWinners(store, tournament) {
	let changed = false;
	for (const match of tournamentMatches(store, tournament)) {
		if (match.status !== 'complete' && match.status !== 'bye') continue;
		const winnerId = match.winnerId || match.entry1Id || match.entry2Id;
		if (winnerId && match.winnerGoesTo && !seatedAhead(store, tournament, match, winnerId)) {
			const dest = findMatch(store, match.winnerGoesTo, tournament.id);
			const slot = Number(match.winnerGoesTo.slot) || 0;
			if (dest && dest.status !== 'complete' && slot && !slotEntry(dest, slot) && !destHasProgress(dest)) {
				if (dest.status === 'vacant') dest.status = 'pending';
				seat(dest, slot, winnerId);
				changed = true;
			}
		}
		if (match.status !== 'complete' || !match.loserGoesTo) continue;
		const loserId = Number(match.winnerId) === Number(match.entry1Id) ? match.entry2Id : match.entry1Id;
		if (seatedAhead(store, tournament, match, loserId)) continue;
		const loseDest = findMatch(store, match.loserGoesTo, tournament.id);
		const loseSlot = Number(match.loserGoesTo.slot) || 0;
		if (loseDest && loseDest.status !== 'complete' && loserId && loseSlot && !slotEntry(loseDest, loseSlot) && !destHasProgress(loseDest)) {
			if (loseDest.status === 'vacant') loseDest.status = 'pending';
			seat(loseDest, loseSlot, loserId);
			changed = true;
		}
	}
	return changed;
}

function collapseVacantMatches(store, tournament) {
	let changed = false;
	for (let guard = 0; guard < 64; guard += 1) {
		let step = reseatClosedWinners(store, tournament);
		for (const match of tournamentMatches(store, tournament)) {
			if (matchClosed(match) || match.side === 'title') continue;
			const a = match.entry1Id;
			const b = match.entry2Id;
			if (a && b) {
				if (match.status === 'pending') {
					match.status = 'ready';
					match.winnerId = null;
					step = true;
				}
				continue;
			}
			const wait1 = slotWaiting(store, tournament, match, 1);
			const wait2 = slotWaiting(store, tournament, match, 2);
			if (!a && !b && !wait1 && !wait2) {
				match.status = 'vacant';
				match.winnerId = null;
				match.games = [];
				match.score1 = null;
				match.score2 = null;
				step = true;
				continue;
			}
			if ((a || b) && !wait1 && !wait2) {
				applyByeAdvance(store, match);
				step = true;
			}
		}
		if (!step) break;
		changed = true;
	}
	return changed;
}

/**
 * Hand edits can leave one player sitting in two open matches at once, which keeps both
 * of them un-closable. Keep the deepest seat and free the rest.
 */
function dropDuplicateSeats(store, tournament) {
	const open = tournamentMatches(store, tournament)
		.filter((m) => m.status !== 'complete' && m.status !== 'bye')
		.sort((a, b) => (Number(b.round) || 0) - (Number(a.round) || 0)
			|| (Number(a.position) || 0) - (Number(b.position) || 0));
	const seen = new Set();
	const touched = [];
	for (const match of open) {
		for (const slot of [1, 2]) {
			const id = Number(slotEntry(match, slot));
			if (!id) continue;
			if (seen.has(id)) {
				setSlotEntry(match, slot, null);
				touched.push(match);
				continue;
			}
			seen.add(id);
		}
	}
	for (const match of touched) refreshEditedMatch(store, tournament, match);
	return touched.length > 0;
}

/**
 * Re-settle a bracket that host edits pushed out of shape: free duplicate seats, collapse
 * empty slots into byes or vacancies, then advance or close. `force` also walks any match
 * that can never be played (nobody in it, or a lone player with no opponent left) to a
 * result, so an arena whose rounds are all recorded stops hanging in progress.
 */
function repairBracket(store, tournament, opts) {
	const force = Boolean(opts && opts.force);
	dropDuplicateSeats(store, tournament);
	collapseVacantMatches(store, tournament);
	maybeFinishOrAdvance(store, tournament);
	if (!force) return { closed: tournament.status === 'completed', resolved: [] };
	const resolved = [];
	for (let guard = 0; guard < 64; guard += 1) {
		const stuck = anyOpenMatches(store, tournament)
			.filter((m) => !(m.entry1Id && m.entry2Id))
			.sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0)
				|| (Number(a.position) || 0) - (Number(b.position) || 0))[0];
		if (!stuck) break;
		if (stuck.side === 'title') defendTitleByWalkover(store, tournament, stuck);
		else if (stuck.entry1Id || stuck.entry2Id) applyByeAdvance(store, stuck);
		else {
			stuck.status = 'vacant';
			stuck.winnerId = null;
			stuck.games = [];
			stuck.score1 = null;
			stuck.score2 = null;
		}
		resolved.push(stuck.id);
		collapseVacantMatches(store, tournament);
		maybeFinishOrAdvance(store, tournament);
	}
	return { closed: tournament.status === 'completed', resolved };
}

function playOpenMatches(store, tournament) {
	return tournamentMatches(store, tournament).filter((m) => m.side !== 'title' && !matchClosed(m));
}

function anyOpenMatches(store, tournament) {
	return tournamentMatches(store, tournament).filter((m) => !matchClosed(m));
}

function fieldTerminalMatch(store, tournament) {
	const matches = tournamentMatches(store, tournament).filter((m) => m.side !== 'title');
	const grand = matches.find((m) => m.side === 'grand');
	if (grand) return grand;
	const winners = matches.filter((m) => m.side === 'winners');
	if (!winners.length) return null;
	const maxR = winners.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
	return winners.find((m) => Number(m.round) === maxR && Number(m.position) === 1) || winners[0];
}

function attachTitleDraft(drafts, champId, challengerId) {
	const list = Array.isArray(drafts) ? drafts : [];
	const title = {
		side: 'title',
		round: 1,
		position: 1,
		entry1Id: champId,
		entry2Id: challengerId || null,
	};
	const grand = list.find((d) => d.side === 'grand');
	const winners = list.filter((d) => d.side === 'winners');
	const maxR = winners.reduce((n, d) => Math.max(n, Number(d.round) || 0), 0);
	const terminal = grand || winners.find((d) => Number(d.round) === maxR && Number(d.position) === 1) || winners[0];
	if (terminal) terminal.winnerGoesTo = { side: 'title', round: 1, position: 1, slot: 2 };
	list.push(title);
	return list;
}

function fieldChampion(store, tournament) {
	return championFor(store, tournament, { fieldOnly: true });
}

/**
 * Reigning Champ mode: the champ sits out the field bracket and meets whoever wins it.
 * Once the field is done this seats the challenger. If the field collapsed to nobody —
 * every slot vacated, or the only entrant was the champ — the champ keeps the belt by
 * walkover, otherwise the title match stays open forever and the arena never closes.
 */
function seatTitleChallenger(store, tournament) {
	if (!wantsReigningChamp(tournament)) return false;
	const title = tournamentMatches(store, tournament).find((m) => m.side === 'title');
	if (!title || title.status === 'complete') return false;
	const champId = champEntryId(tournament);
	if (champId && Number(title.entry1Id) !== champId && Number(title.entry2Id) !== champId) {
		if (!title.entry1Id) title.entry1Id = champId;
		else if (!title.entry2Id) title.entry2Id = champId;
	}
	if (playOpenMatches(store, tournament).length) return false;
	if (title.entry1Id && title.entry2Id) {
		if (title.status !== 'ready') {
			title.status = 'ready';
			title.winnerId = null;
			return true;
		}
		return false;
	}
	const challenger = fieldChampion(store, tournament);
	if (challenger && Number(challenger.id) !== Number(champId)) {
		if (!title.entry2Id) title.entry2Id = challenger.id;
		else if (!title.entry1Id) title.entry1Id = challenger.id;
		title.status = 'ready';
		title.winnerId = null;
		return true;
	}
	return defendTitleByWalkover(store, tournament, title);
}

function defendTitleByWalkover(store, tournament, title) {
	const champId = champEntryId(tournament);
	const seated = Number(title.entry1Id) || Number(title.entry2Id) || champId;
	if (!seated) {
		title.status = 'vacant';
		title.winnerId = null;
		title.games = [];
		title.score1 = null;
		title.score2 = null;
		return true;
	}
	title.entry1Id = seated;
	title.entry2Id = null;
	title.status = 'bye';
	title.winnerId = seated;
	title.games = [];
	title.score1 = null;
	title.score2 = null;
	return true;
}

/** A title match left behind after Reigning Champ mode is switched off would block the close. */
function dropOrphanTitleMatch(store, tournament) {
	if (wantsReigningChamp(tournament)) return false;
	const title = tournamentMatches(store, tournament).find((m) => m.side === 'title');
	if (!title || title.status === 'complete') return false;
	removeTitleMatch(store, tournament);
	return true;
}

function removeTitleMatch(store, tournament) {
	const title = tournamentMatches(store, tournament).find((m) => m.side === 'title');
	if (!title) return false;
	store.matches = store.matches.filter((m) => m !== title);
	store.votes = (store.votes || []).filter((v) => v.tournamentId !== tournament.id || v.matchId !== title.id);
	for (const match of tournamentMatches(store, tournament)) {
		const dest = match.winnerGoesTo;
		if (dest && dest.side === 'title') match.winnerGoesTo = null;
		const lose = match.loserGoesTo;
		if (lose && lose.side === 'title') match.loserGoesTo = null;
	}
	return true;
}

function ensureReigningChamp(store, tournament, entryId) {
	const id = Number(entryId);
	const entry = store.entries.find((e) => (
		e.tournamentId === tournament.id
		&& e.id === id
		&& e.paid
		&& !e.noShow
		&& (!e.whitelist || e.subbedIn)
	));
	if (!entry) {
		throw Object.assign(new Error('Pick a confirmed player as the Reigning Champ'), { status: 400 });
	}
	tournament.reigningChamp = true;
	tournament.reigningChampEntryId = entry.id;
	if (tournament.status === 'registration') return entry;
	for (const match of tournamentMatches(store, tournament)) {
		if (match.side === 'title' || match.status === 'complete') continue;
		if (Number(match.entry1Id) !== entry.id && Number(match.entry2Id) !== entry.id) continue;
		prepareMatchForRosterEdit(store, match);
		if (Number(match.entry1Id) === entry.id) match.entry1Id = null;
		if (Number(match.entry2Id) === entry.id) match.entry2Id = null;
		refreshEditedMatch(store, tournament, match);
	}
	let title = tournamentMatches(store, tournament).find((m) => m.side === 'title');
	if (!title) {
		store.matches.push(...draftsToMatches(store, tournament, [{
			side: 'title',
			round: 1,
			position: 1,
			entry1Id: entry.id,
			entry2Id: null,
		}]));
		title = tournamentMatches(store, tournament).find((m) => m.side === 'title');
	} else {
		if (Number(title.entry2Id) === entry.id) title.entry2Id = title.entry1Id === entry.id ? null : title.entry1Id;
		title.entry1Id = entry.id;
		if (Number(title.entry2Id) === entry.id) title.entry2Id = null;
		title.status = (title.entry1Id && title.entry2Id) ? 'ready' : 'pending';
		title.winnerId = null;
	}
	const terminal = fieldTerminalMatch(store, tournament);
	if (terminal && terminal.side !== 'title') {
		terminal.winnerGoesTo = { side: 'title', round: 1, position: 1, slot: 2 };
	}
	markBracketOpen(tournament);
	collapseVacantMatches(store, tournament);
	maybeFinishOrAdvance(store, tournament);
	return entry;
}

function refreshEditedMatch(store, tournament, match) {
	if (!match) return;
	match.games = [];
	match.score1 = null;
	match.score2 = null;
	if (match.entry1Id && match.entry2Id) {
		match.status = 'ready';
		match.winnerId = null;
		return;
	}
	if (match.side === 'title') {
		match.status = 'pending';
		match.winnerId = null;
		return;
	}
	if ((match.entry1Id || match.entry2Id) && !slotWaiting(store, tournament, match, 1) && !slotWaiting(store, tournament, match, 2)) {
		applyByeAdvance(store, match);
		return;
	}
	match.status = 'pending';
	match.winnerId = null;
}

function prepareMatchForRosterEdit(store, match) {
	if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
	if (matchRosterLocked(match)) {
		throw Object.assign(new Error('Unlock that series first, then move people.'), { status: 400 });
	}
	if (match.status === 'bye') {
		if (!canReverseBye(store, match)) {
			throw Object.assign(new Error('That bye already advanced too far to edit. Unlock the next match first.'), { status: 400 });
		}
		reverseByeAdvance(store, match);
	}
}

/**
 * A player on a bye sits in two places: the bye itself and the round it was pushed into.
 * The bye is the one the host drew them into, so that is the seat we hand back — moving
 * them from the pushed-forward copy would leave the bye still pointing at them.
 */
function liveSeatFor(matches, entryId) {
	const id = Number(entryId);
	const seats = [];
	for (const match of matches || []) {
		if (matchRosterLocked(match)) continue;
		if (Number(match.entry1Id) === id) seats.push({ match, slot: 1 });
		if (Number(match.entry2Id) === id) seats.push({ match, slot: 2 });
	}
	if (!seats.length) return null;
	seats.sort((a, b) => (
		(b.match.status === 'bye' ? 1 : 0) - (a.match.status === 'bye' ? 1 : 0)
		|| (a.match.status === 'bye'
			? (Number(a.match.round) || 0) - (Number(b.match.round) || 0)
			: (Number(b.match.round) || 0) - (Number(a.match.round) || 0))
	));
	return seats[0];
}

function parseSeat(body, suffix) {
	const key = suffix || '';
	const matchId = Number(body && (body[`matchId${key}`] ?? body.matchId));
	const slotRaw = Number(body && (body[`slot${key}`] ?? body.slot));
	const slot = slotRaw === 2 ? 2 : slotRaw === 1 ? 1 : 0;
	if (!Number.isFinite(matchId) || matchId <= 0 || !slot) return null;
	return { matchId, slot };
}

function retractPlayerFromDest(dest, destRef, entryId) {
	if (!dest || entryId == null || entryId === '') return;
	const slot = destRef && Number(destRef.slot);
	if (slot === 1 && Number(dest.entry1Id) === Number(entryId)) dest.entry1Id = null;
	else if (slot === 2 && Number(dest.entry2Id) === Number(entryId)) dest.entry2Id = null;
	else {
		if (Number(dest.entry1Id) === Number(entryId)) dest.entry1Id = null;
		if (Number(dest.entry2Id) === Number(entryId)) dest.entry2Id = null;
	}
}

function resetMatchOnce(store, tournament, match) {
	if (!match) return;
	if (match.status === 'bye') {
		reverseByeAdvance(store, match);
		return;
	}
	const winnerId = match.winnerId;
	const loserId = Number(winnerId) === Number(match.entry1Id) ? match.entry2Id : match.entry1Id;
	if (match.status === 'complete') {
		retractPlayerFromDest(findMatch(store, match.winnerGoesTo, tournament.id), match.winnerGoesTo, winnerId);
		retractPlayerFromDest(findMatch(store, match.loserGoesTo, tournament.id), match.loserGoesTo, loserId);
	}
	match.games = [];
	match.score1 = null;
	match.score2 = null;
	match.winnerId = null;
	match.status = (match.entry1Id && match.entry2Id) ? 'ready' : 'pending';
	for (const destRef of [match.winnerGoesTo, match.loserGoesTo]) {
		const dest = findMatch(store, destRef, tournament.id);
		if (!dest || dest.status === 'complete') continue;
		dest.games = [];
		dest.score1 = null;
		dest.score2 = null;
		if (dest.status !== 'bye') {
			dest.winnerId = null;
			dest.status = (dest.entry1Id && dest.entry2Id) ? 'ready' : 'pending';
		}
	}
}

function resetMatchTree(store, tournament, match) {
	const seen = new Set();
	const walk = (row) => {
		if (!row || seen.has(row.id)) return;
		seen.add(row.id);
		walk(findMatch(store, row.winnerGoesTo, tournament.id));
		walk(findMatch(store, row.loserGoesTo, tournament.id));
		resetMatchOnce(store, tournament, row);
	};
	walk(match);
	markBracketOpen(tournament);
	clearMatchVotes(store, tournament, [...seen]);
}

/** Trade two seats in any unlocked round. Does not redraw or wipe other series. */
function swapSlots(store, tournament, seatA, seatB) {
	if (!seatA || !seatB) {
		throw Object.assign(new Error('Pick two seats'), { status: 400 });
	}
	if (seatA.matchId === seatB.matchId && seatA.slot === seatB.slot) {
		throw Object.assign(new Error('Pick two different seats'), { status: 400 });
	}
	const matches = (store.matches || []).filter((m) => m.tournamentId === tournament.id);
	const matchA = matches.find((m) => m.id === seatA.matchId);
	const matchB = matches.find((m) => m.id === seatB.matchId);
	if (!matchA || !matchB) throw Object.assign(new Error('Match not found'), { status: 404 });
	prepareMatchForRosterEdit(store, matchA);
	if (matchB !== matchA) prepareMatchForRosterEdit(store, matchB);
	const idA = slotEntry(matchA, seatA.slot);
	const idB = slotEntry(matchB, seatB.slot);
	if (idA == null && idB == null) {
		throw Object.assign(new Error('Both seats are empty'), { status: 400 });
	}
	setSlotEntry(matchA, seatA.slot, idB);
	setSlotEntry(matchB, seatB.slot, idA);
	refreshEditedMatch(store, tournament, matchA);
	if (matchB !== matchA) refreshEditedMatch(store, tournament, matchB);
	clearMatchVotes(store, tournament, [matchA.id, matchB.id]);
	markBracketOpen(tournament);
	alignTournamentTree(store, tournament);
	collapseVacantMatches(store, tournament);
	maybeFinishOrAdvance(store, tournament);
}

function placeEntryInSlot(store, tournament, entry, seat) {
	if (!seat) throw Object.assign(new Error('Pick a seat'), { status: 400 });
	const matches = (store.matches || []).filter((m) => m.tournamentId === tournament.id);
	const match = matches.find((m) => m.id === seat.matchId);
	if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
	const from = liveSeatFor(matches, entry.id);
	if (from && from.match.id === match.id && from.slot === seat.slot) return;
	if (from) {
		swapSlots(store, tournament, { matchId: from.match.id, slot: from.slot }, seat);
		return;
	}
	prepareMatchForRosterEdit(store, match);
	setSlotEntry(match, seat.slot, entry.id);
	refreshEditedMatch(store, tournament, match);
	clearMatchVotes(store, tournament, [match.id]);
	markBracketOpen(tournament);
	alignTournamentTree(store, tournament);
	collapseVacantMatches(store, tournament);
	maybeFinishOrAdvance(store, tournament);
}

function tournamentMatches(store, tournament) {
	return (store.matches || []).filter((m) => m.tournamentId === tournament.id);
}

function roundMatchesOf(matches, side, round) {
	return (matches || []).filter((m) => m.side === side && Number(m.round) === Number(round))
		.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
}

function matchHasEntry(match, entryId) {
	const id = Number(entryId);
	return Number(match.entry1Id) === id || Number(match.entry2Id) === id;
}

function uniqueEntryIds(ids) {
	const seen = new Set();
	const out = [];
	for (const raw of ids || []) {
		const id = Number(raw);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/** Highest winners round that already has people in it. Ignores empty Finals TBD so semis stay editable. */
function defaultPlayRound(matches) {
	const winners = (matches || []).filter((m) => m.side === 'winners');
	const maxRound = winners.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
	for (let round = maxRound; round >= 1; round -= 1) {
		const rows = winners.filter((m) => Number(m.round) === round);
		const seatedOpen = rows.some((m) => m.status !== 'complete' && (m.entry1Id || m.entry2Id));
		if (seatedOpen) return { side: 'winners', round };
	}
	const open = winners.filter((m) => m.status !== 'complete');
	if (open.length) {
		return { side: 'winners', round: open.reduce((n, m) => Math.max(n, Number(m.round) || 0), 1) };
	}
	return { side: 'winners', round: Math.max(1, maxRound > 1 ? maxRound - 1 : 1) };
}

function unlockMatchTree(store, tournament, match) {
	if (match && match.status === 'complete') resetMatchTree(store, tournament, match);
}

function alignTournamentTree(store, tournament) {
	const matches = tournamentMatches(store, tournament);
	if (!matches.length) return;
	if (tournament && (tournament.format === 'double_elim' || tournament.losersBracket)) return;
	restackElimTree(matches);
}

function pairPlayersTogether(store, tournament, a, b, opts) {
	if (!a || !b || a.id === b.id) {
		throw Object.assign(new Error('Pick two different players'), { status: 400 });
	}
	const wantedA = Number(a.id);
	const wantedB = Number(b.id);
	let matches = tournamentMatches(store, tournament);
	const homeHint = Number(opts && (opts.matchId || opts.homeId)) || 0;
	const hinted = homeHint ? matches.find((m) => m.id === homeHint) : null;
	const fallback = defaultPlayRound(matches);
	const side = hinted ? hinted.side : (opts && opts.side) || fallback.side;
	const round = hinted ? Number(hinted.round) : (Number(opts && opts.round) || fallback.round);

	let roundRows = roundMatchesOf(matches, side, round);
	if (!roundRows.length) {
		throw Object.assign(new Error('That round has no matches to edit.'), { status: 400 });
	}
	if (roundRows.some((m) => matchHasEntry(m, wantedA) && matchHasEntry(m, wantedB))) {
		alignTournamentTree(store, tournament);
		return;
	}
	const lockedRound = roundRows.every((m) => m.status === 'complete');
	if (lockedRound) {
		if (roundRows.length === 2 && reseatCompletePair(roundRows, wantedA, wantedB)) {
			alignTournamentTree(store, tournament);
			return;
		}
		throw Object.assign(new Error('Unlock those series first to rewrite a locked round.'), { status: 400 });
	}

	let home = hinted && hinted.side === side && Number(hinted.round) === Number(round)
		? hinted
		: (roundRows.find((m) => matchHasEntry(m, wantedA)) || roundRows.find((m) => matchHasEntry(m, wantedB)) || roundRows[0]);

	unlockMatchTree(store, tournament, home);
	for (const row of roundRows) {
		if (row.id !== home.id && (matchHasEntry(row, wantedA) || matchHasEntry(row, wantedB))) {
			unlockMatchTree(store, tournament, row);
		}
	}

	matches = tournamentMatches(store, tournament);
	roundRows = roundMatchesOf(matches, side, round);
	home = roundRows.find((m) => m.id === home.id) || roundRows[0];
	if (roundRows.some((m) => matchHasEntry(m, wantedA) && matchHasEntry(m, wantedB))) return;

	const displaced = uniqueEntryIds([home.entry1Id, home.entry2Id])
		.filter((id) => id !== wantedA && id !== wantedB);

	for (const row of roundRows) {
		if (Number(row.entry1Id) === wantedA || Number(row.entry1Id) === wantedB) row.entry1Id = null;
		if (Number(row.entry2Id) === wantedA || Number(row.entry2Id) === wantedB) row.entry2Id = null;
	}
	home.entry1Id = wantedA;
	home.entry2Id = wantedB;

	const holes = [];
	for (const row of roundRows) {
		if (row.id === home.id) continue;
		if (!row.entry1Id) holes.push({ match: row, slot: 1 });
		if (!row.entry2Id) holes.push({ match: row, slot: 2 });
	}
	let holeAt = 0;
	for (const id of displaced) {
		if (roundRows.some((m) => matchHasEntry(m, id))) continue;
		while (holeAt < holes.length && slotEntry(holes[holeAt].match, holes[holeAt].slot)) holeAt += 1;
		if (holeAt >= holes.length) break;
		setSlotEntry(holes[holeAt].match, holes[holeAt].slot, id);
		holeAt += 1;
	}

	for (const row of matches) {
		if (row.status === 'complete') continue;
		if (!(row.side === side && Number(row.round) > Number(round))) continue;
		let dirty = false;
		if (Number(row.entry1Id) === wantedA || Number(row.entry1Id) === wantedB) {
			row.entry1Id = null;
			dirty = true;
		}
		if (Number(row.entry2Id) === wantedA || Number(row.entry2Id) === wantedB) {
			row.entry2Id = null;
			dirty = true;
		}
		if (dirty) refreshEditedMatch(store, tournament, row);
	}

	for (const row of roundRows) refreshEditedMatch(store, tournament, row);
	clearMatchVotes(store, tournament, roundRows.map((m) => m.id));
	markBracketOpen(tournament);
	alignTournamentTree(store, tournament);
	collapseVacantMatches(store, tournament);
	maybeFinishOrAdvance(store, tournament);
}

function swapPlayersInBracket(store, tournament, a, b) {
	const matches = (store.matches || []).filter((m) => m.tournamentId === tournament.id);
	const seatA = liveSeatFor(matches, a.id);
	const seatB = liveSeatFor(matches, b.id);
	if (!seatA && !seatB) {
		throw Object.assign(new Error('Those players are not in an open match. Pick a seat on the tree and put them there.'), { status: 400 });
	}
	if (!seatA || !seatB) {
		const missing = seatA ? b : a;
		const open = seatA || seatB;
		placeEntryInSlot(store, tournament, missing, { matchId: open.match.id, slot: open.slot });
		return;
	}
	swapSlots(store, tournament, { matchId: seatA.match.id, slot: seatA.slot }, { matchId: seatB.match.id, slot: seatB.slot });
}

function rewardView(tournament, prizePool, feesCollected) {
	const mode = tournament && tournament.rewardMode === 'prize' ? 'prize' : 'pot';
	const pool = Math.max(0, Number(prizePool) || 0);
	const fees = Math.max(0, Number(feesCollected) || 0);
	const potFundMode = sanitizePotFundMode(tournament && tournament.potFundMode, tournament);
	const addedPotUsd = potFundMode === 'percent' ? sanitizeHostPotUsd(tournament && tournament.addedPotUsd, 0) : 0;
	const feePoolUsd = potFundMode === 'percent' ? roundCrypto(fees * PRIZE_POOL_PERCENT / 100, 2) : 0;
	const payouts = Array.isArray(tournament && tournament.payouts) ? tournament.payouts : [];
	const rows = [];
	for (const p of payouts) {
		if (mode === 'prize') {
			if (!p.prize) continue;
			rows.push({
				place: p.place,
				label: placeLabel(p.place),
				text: p.prize,
				prize: p.prize,
				amountUsd: null,
				addedUsd: 0,
				totalUsd: null,
				percent: null,
			});
			continue;
		}
		const percent = Number(p.percent) || 0;
		const addedUsd = sanitizeHostPotUsd(p.addedUsd, 0);
		const prize = String(p.prize || '').trim();
		if (!(percent > 0) && !prize && !(addedUsd > 0)) continue;
		const amountUsd = percent > 0 ? roundCrypto(pool * percent / 100, 2) : 0;
		rows.push({
			place: p.place,
			label: placeLabel(p.place),
			text: percent > 0 ? `${percent}%` : (prize || ''),
			prize,
			amountUsd,
			addedUsd,
			totalUsd: roundCrypto(amountUsd + addedUsd, 2),
			percent,
		});
	}
	return {
		mode,
		pool,
		addedPotUsd,
		feePoolUsd,
		potFundMode,
		poolPercent: PRIZE_POOL_PERCENT,
		retainPercent: HOUSE_RETAIN_PERCENT,
		feesCollected: fees,
		houseRetainUsd: potFundMode === 'percent' ? roundCrypto(fees * HOUSE_RETAIN_PERCENT / 100, 2) : 0,
		rows,
	};
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
	const { value: expected } = hostPasswordInfo(dataDir);
	if (!expected) {
		const err = new Error('Hosting isn’t available right now.');
		err.status = 403;
		throw err;
	}
	if (!timingSafeEqualString(expected, cleanSecret(given))) {
		const err = new Error('Wrong password');
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

function sessionOwnsSeat(session, entry) {
	if (!session || !session.discord_id || !entry) return false;
	const uid = Number(session.user_id);
	if (uid && Number(entry.userId) === uid) return true;
	const linked = entryDiscordUser(entry);
	if (linked && linked.discordId && String(session.discord_id) === String(linked.discordId)) return true;
	return false;
}

function sessionMatchesEntry(session, entry) {
	if (!session || !entry) return false;
	const uid = Number(session.user_id);
	if (uid && Number(entry.userId) === uid) return true;
	const aliases = [session.tourney_handle, session.discord_username]
		.filter(Boolean)
		.map((value) => String(value).trim().toLowerCase());
	if (aliases.includes(String(entry.handle || '').trim().toLowerCase())) return true;
	const linked = entryDiscordUser(entry);
	if (linked) {
		if (session.discord_id && linked.discordId && String(session.discord_id) === String(linked.discordId)) return true;
		const names = [linked.tourneyHandle, linked.discordUsername]
			.filter(Boolean)
			.map((value) => String(value).trim().toLowerCase());
		if (names.some((name) => aliases.includes(name))) return true;
	}
	return false;
}

function parseIrlRoom(room) {
	const match = String(room || '').match(/^irla(\d+)m(\d+)$/i);
	if (!match) return null;
	return { tournamentId: Number(match[1]), matchId: Number(match[2]) };
}

function createIrlSeatGuard(dataDir) {
	const storeFile = path.join(dataDir, 'tourney-store.json');
	return function canClaimIrlSeat(request, room, seat) {
		if (seat !== 1 && seat !== 2) return false;
		const parsed = parseIrlRoom(room);
		if (!parsed) return false;
		const session = authDex.getTourneySession(request && request.signedCookies);
		if (!session || !session.discord_id) return false;
		const store = loadStore(storeFile);
		const found = (store.matches || []).find((row) => (
			Number(row.id) === parsed.matchId && Number(row.tournamentId) === parsed.tournamentId
		));
		if (!found) return false;
		const entryId = seat === 2 ? found.entry2Id : found.entry1Id;
		const entry = (store.entries || []).find((row) => Number(row.id) === Number(entryId));
		return sessionOwnsSeat(session, entry);
	};
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

function sanitizeXHandle(value) {
	const raw = String(value == null ? '' : value).trim().replace(/^@+/, '');
	if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) return '';
	return raw;
}

function sanitizeDogeAddress(value, opts) {
	const addr = String(value == null ? '' : value).trim();
	if (!addr) return '';
	if (!DOGE_ADDRESS_RE.test(addr)) {
		if (opts && opts.soft) return '';
		throw Object.assign(new Error('Enter a valid DOGE address (starts with D).'), { status: 400 });
	}
	return addr;
}

function looksLikeSolanaAddress(value) {
	const addr = String(value == null ? '' : value).trim();
	if (!SOLANA_ADDRESS_RE.test(addr)) return false;
	if (DOGE_ADDRESS_RE.test(addr)) return false;
	if (addr === USDC_SOL_MINT) return false;
	return true;
}

function looksLikeSolanaSig(value) {
	return SOLANA_SIG_RE.test(String(value == null ? '' : value).trim());
}

function sanitizeSolanaAddress(value, opts) {
	const addr = String(value == null ? '' : value).trim();
	if (!addr) return '';
	if (!looksLikeSolanaAddress(addr)) {
		if (opts && opts.soft) return '';
		throw Object.assign(new Error('Enter a valid Solana wallet address for USDC.'), { status: 400 });
	}
	return addr;
}

function treasuryAddress(tournament) {
	return sanitizeDogeAddress(tournament && tournament.treasury, { soft: true }) || PAY_TO.DOGE;
}

function dogePayToFor(tournament) {
	if (tournament && tournament.acceptDoge === false) return '';
	return treasuryAddress(tournament);
}

function xHandleOf(tournament) {
	return sanitizeXHandle(tournament && tournament.xHandle);
}

function solanaTreasuryOf(tournament) {
	return sanitizeSolanaAddress(tournament && tournament.solanaTreasury, { soft: true }) || (tournament && tournament.acceptUsdcSol ? solanaPayTo() : '');
}

function usdcSolPayToFor(tournament) {
	if (!(tournament && tournament.acceptUsdcSol)) return '';
	return solanaTreasuryOf(tournament);
}

function payToFor(tournament) {
	return {
		DOGE: dogePayToFor(tournament),
		xHandle: xHandleOf(tournament),
		USDC_SOL: usdcSolPayToFor(tournament),
		usdcMint: USDC_SOL_MINT,
	};
}

function pendingWatchEntries(store, tournament) {
	return (store.entries || []).filter((entry) => {
		if (!entry || entry.paid || entry.noShow) return false;
		if (isHostConfirmAsset(entry.payAsset)) return false;
		if (!(Number(entry.amountCrypto) > 0)) return false;
		if (!dogePayWatch.looksLikeDogeAddress(entry.fromWallet) && !dogePayWatch.looksLikeTxid(entry.payTxid)) return false;
		const t = tournament || (store.tournaments || []).find((row) => row.id === entry.tournamentId);
		if (!t || t.feeMode !== 'paid') return false;
		if (tournament && entry.tournamentId !== tournament.id) return false;
		return t.status === 'registration';
	});
}

function adminSecretFrom(request) {
	const header = typeof request.get === 'function' ? request.get('x-tourney-admin') : '';
	const body = request.body && (request.body.adminPassword || request.body.hostPassword);
	return cleanSecret(header || body || '');
}

function isAdminRequest(dataDir, request) {
	const expected = cleanSecret(resolveAdminPassword(dataDir));
	if (!expected) return false;
	return timingSafeEqualString(expected, adminSecretFrom(request));
}

function assertAdminRequest(dataDir, request) {
	if (isAdminRequest(dataDir, request)) return;
	assertAdminPassword(dataDir, adminSecretFrom(request));
}

function hostingProductEnabled(dataDir) {
	return Boolean(resolveHostPassword(dataDir));
}

function hostingLockedError() {
	const err = new Error('Hosting isn’t available right now.');
	err.status = 403;
	return err;
}

function sessionFrom(request) {
	return authDex.getTourneySession(request && request.signedCookies);
}

function discordHostSession(request) {
	const session = sessionFrom(request);
	if (!session || !session.user_id || !session.discord_id) return null;
	if (typeof authDex.userIsTourneyHost === 'function' && !authDex.userIsTourneyHost(session)) return null;
	return session;
}

function staffRoleOf(dataDir, request, tournament) {
	if (isAdminRequest(dataDir, request)) return 'admin';
	if (!tournament) return null;
	const session = sessionFrom(request);
	if (!session || !session.user_id) return null;
	const uid = Number(session.user_id);
	if (Number(tournament.hostUserId) === uid) return 'owner';
	if ((tournament.judgeUserIds || []).some((id) => Number(id) === uid)) return 'judge';
	if ((tournament.streamUserIds || []).some((id) => Number(id) === uid)) return 'stream';
	return null;
}

function canManageArena(dataDir, request, tournament) {
	const role = staffRoleOf(dataDir, request, tournament);
	return role === 'admin' || role === 'owner' || role === 'judge';
}

function canEditStream(dataDir, request, tournament) {
	if (canManageArena(dataDir, request, tournament)) return true;
	return staffRoleOf(dataDir, request, tournament) === 'stream';
}

function assertCanManageArena(dataDir, request, tournament) {
	if (isAdminRequest(dataDir, request)) return { role: 'admin', session: sessionFrom(request) };
	if (!hostingProductEnabled(dataDir)) throw hostingLockedError();
	const session = sessionFrom(request);
	if (!session || !session.user_id) {
		throw Object.assign(new Error('Sign in with Discord to host this arena, or sign in as admin.'), { status: 401 });
	}
	if (!session.discord_id) {
		throw Object.assign(new Error('Link Discord to this account before hosting.'), { status: 403 });
	}
	if (typeof authDex.userIsTourneyHost === 'function' && !authDex.userIsTourneyHost(session)) {
		throw Object.assign(new Error('Hosting isn’t enabled on this account.'), { status: 403 });
	}
	if (!tournament || (Number(tournament.hostUserId) !== Number(session.user_id)
		&& !(tournament.judgeUserIds || []).some((id) => Number(id) === Number(session.user_id)))) {
		throw Object.assign(new Error('You can only change tournaments you created.'), { status: 403 });
	}
	const role = Number(tournament.hostUserId) === Number(session.user_id) ? 'host' : 'judge';
	return { role, session };
}

function assertCanCreateArena(dataDir, request) {
	if (isAdminRequest(dataDir, request)) return { role: 'admin', session: sessionFrom(request) };
	if (!hostingProductEnabled(dataDir)) throw hostingLockedError();
	const session = sessionFrom(request);
	if (!session || !session.user_id) {
		throw Object.assign(new Error('Sign in with Discord to create an arena, or sign in as admin.'), { status: 401 });
	}
	if (!session.discord_id) {
		throw Object.assign(new Error('Link Discord to this account before hosting.'), { status: 403 });
	}
	if (typeof authDex.userIsTourneyHost === 'function' && !authDex.userIsTourneyHost(session)) {
		throw Object.assign(new Error('Hosting isn’t enabled on this account.'), { status: 403 });
	}
	return { role: 'host', session };
}

function assertGrantedHostOrAdmin(dataDir, request) {
	if (isAdminRequest(dataDir, request)) return { role: 'admin', session: sessionFrom(request) };
	if (!hostingProductEnabled(dataDir)) throw hostingLockedError();
	const session = discordHostSession(request);
	if (session) return { role: 'host', session };
	throw Object.assign(new Error('Sign in with Discord as a host, or sign in as admin.'), { status: 403 });
}

function viewerPayload(dataDir, request) {
	const session = sessionFrom(request);
	const admin = isAdminRequest(dataDir, request);
	const hostingEnabled = hostingProductEnabled(dataDir);
	const tourneyHost = typeof authDex.userIsTourneyHost === 'function' && authDex.userIsTourneyHost(session);
	return {
		signedIn: Boolean(session && session.user_id),
		discordId: session && session.discord_id ? session.discord_id : null,
		tourneyHost,
		canCreate: admin || (tourneyHost && hostingEnabled),
		admin,
	};
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

function makeTreasury(raw) {
	return sanitizeDogeAddress(raw, { soft: true }) || PAY_TO.DOGE;
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
	entry.xPayerHandle = sanitizeXHandle(entry.xPayerHandle);
	const storedPayTo = String(entry.payTo || '').trim();
	if (storedPayTo) {
		entry.payTo = storedPayTo;
	} else if (entry.payAsset === 'SOL') {
		entry.payTo = LEGACY_PAY_TO.SOL;
	} else if (entry.payAsset === 'XMONEY') {
		entry.payTo = entry.payTo || '';
	} else if (entry.payAsset === 'USDC_SOL') {
		entry.payTo = storedPayTo || '';
	} else {
		entry.payTo = PAY_TO.DOGE;
	}
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
	entry.playName = playDecks.sanitizePlayName(entry.playName) || String(entry.playName || '').trim();
	entry.registeredDeck = playDecks.sanitizeSnapshot(entry.registeredDeck);
	if (entry.registeredDeck && !entry.playName) entry.playName = entry.registeredDeck.playName || '';
	entry.payTxid = dogePayWatch.looksLikeTxid(entry.payTxid) ? String(entry.payTxid).trim().toLowerCase() : '';
	entry.payConfirmations = Math.max(0, Number(entry.payConfirmations) || 0);
	const watchStates = ['confirmed', 'seen', 'watching', 'mismatch'];
	if (!watchStates.includes(entry.payWatchStatus)) {
		entry.payWatchStatus = entry.paid
			? 'confirmed'
			: (entry.fromWallet && Number(entry.amountCrypto) > 0 ? 'watching' : '');
	}
	entry.payNote = String(entry.payNote || '').trim().slice(0, 160);
	entry.payVerifiedAt = entry.payVerifiedAt || null;
	return entry;
}

function attachRegisteredDeck(entry, body, tournament, opts) {
	const required = Boolean(opts && opts.required);
	const src = body && typeof body === 'object' ? body : {};
	const text = String(src.deckText || src.listText || src.deckList || src.playList || '').trim();
	const playName = playDecks.sanitizePlayName(src.playName || src.ddlPlayName || src.heroName);
	const deckName = String(src.deckName || src.listName || '').trim().slice(0, 48);
	let snap = null;
	if (text) {
		snap = playDecks.lockFromText(text, { playName, name: deckName });
	} else if (src.counts || src.serials) {
		snap = playDecks.lockFromText(playDecks.formatListText({
			name: deckName || 'Play list',
			counts: src.counts,
			serials: src.serials,
		}), { playName, name: deckName });
	}
	if (!snap) {
		if (required) {
			throw Object.assign(new Error('Paste a 40-card list exported from ddltcg.com/play'), { status: 400 });
		}
		return entry;
	}
	classQuota.assertDeckQuota(snap && snap.counts, tournament && tournament.deckClassQuota);
	entry.playName = snap.playName || playName || entry.playName || '';
	entry.registeredDeck = snap;
	return entry;
}

function assertDeckMutable(tournament, entry, isHost) {
	if (!tournament) throw Object.assign(new Error('Arena not found'), { status: 404 });
	if (tournament.status === 'completed') {
		throw Object.assign(new Error('This arena is finished — registered decks stay locked'), { status: 400 });
	}
	if (isHost) return;
	if (eventPhase.listsLocked(tournament)) {
		throw Object.assign(new Error('Lists are locked for this arena. Ask the host if you need a correction.'), { status: 400 });
	}
}

function deckVisibleTo(tournament, entry, opts) {
	const o = opts || {};
	if (o.isHost || o.isOwner) return true;
	if (eventPhase.listsPublic(tournament)) return true;
	if (o.matchComplete && tournament && tournament.listsRevealOnMatchComplete !== false) return true;
	return false;
}

function publicDeckView(entry, visible) {
	if (!entry) return null;
	if (!visible) return entry.registeredDeck ? { ready: true, cardCount: entry.registeredDeck.cardCount || 0, hidden: true } : null;
	return entry.registeredDeck || null;
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
		payTo: treasuryAddress(tournament),
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

function normalizeStore(parsed) {
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
}

/** In-memory JSON store cache keyed by path + mtime. Avoids re-parse on every GET. */
const storeFileCache = { filePath: '', mtimeMs: NaN, store: null };

function readStoreFromDisk(filePath) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return normalizeStore(JSON.parse(raw));
	} catch (_err) {
		return emptyStore();
	}
}

function loadStore(filePath) {
	let mtimeMs = NaN;
	try {
		mtimeMs = fs.statSync(filePath).mtimeMs;
	} catch (_err) {
		return emptyStore();
	}
	if (
		storeFileCache.store
		&& storeFileCache.filePath === filePath
		&& Number.isFinite(mtimeMs)
		&& storeFileCache.mtimeMs === mtimeMs
	) {
		return storeFileCache.store;
	}
	const store = readStoreFromDisk(filePath);
	if (!storeHasArenas(store) && !fs.existsSync(filePath)) {
		storeFileCache.filePath = filePath;
		storeFileCache.mtimeMs = NaN;
		storeFileCache.store = null;
		return store;
	}
	storeFileCache.filePath = filePath;
	storeFileCache.mtimeMs = mtimeMs;
	storeFileCache.store = store;
	return store;
}

function rememberStoreCache(filePath, store) {
	if (!filePath || !store) return;
	storeFileCache.filePath = filePath;
	storeFileCache.store = store;
	try {
		storeFileCache.mtimeMs = fs.statSync(filePath).mtimeMs;
	} catch (_err) {
		storeFileCache.mtimeMs = NaN;
	}
}

function storeHasArenas(store) {
	return Boolean(store && Array.isArray(store.tournaments) && store.tournaments.length);
}

function saveStore(filePath, store) {
	if (!storeHasArenas(store) && fs.existsSync(filePath)) {
		try {
			const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			if (storeHasArenas(existing)) {
				console.error('[tourney] refused to replace a store that has arenas with an empty store');
				return false;
			}
		} catch (_err) {}
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	if (storeHasArenas(store) && fs.existsSync(filePath)) {
		try {
			persist.rotateLiveBak(filePath);
		} catch (_err) {}
	}
	const tmp = `${filePath}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
	try {
		fs.renameSync(tmp, filePath);
	} catch (_err) {
		fs.copyFileSync(tmp, filePath);
		try { fs.unlinkSync(tmp); } catch (_e2) {}
	}
	rememberStoreCache(filePath, store);
	try {
		persist.afterJsonSave(filePath, store, {
			database: records.getDb && records.getDb(),
			skipTournament: (t) => isDemoTournament(store, t),
		});
	} catch (err) {
		console.error('[tourney] archive:', err && err.message ? err.message : err);
	}
	return true;
}

function isDemoTournament(store, tournament) {
	const slug = String(tournament && tournament.slug || '').toLowerCase();
	const name = String(tournament && tournament.name || '').toLowerCase().trim();
	const demoSlugs = ['rise-of-the-pack-open', 'ember-swiss', 'hearth-round-robin'];
	const demoNames = new Set(['rise of the pack open', 'ember swiss', 'hearth round robin']);
	if (demoNames.has(name)) return true;
	if (demoSlugs.some((base) => slug === base || slug.startsWith(`${base}-`))) return true;
	// Local / QA tables must never land on the public Hall of Fame.
	if (/^irl-local(?:-|$)/.test(slug) || /^test-arena(?:-|$)/.test(slug) || slug.includes('vod-save')) return true;
	if (/^irl local\b/.test(name) || name === 'vod save check' || /^test arena\b/.test(name)) return true;
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
			bestOf: bestOfFor(tournament, d.side, d.round, d),
			games: [],
			status: isBye ? 'bye' : (d.entry1Id && d.entry2Id ? 'ready' : 'pending'),
			winnerGoesTo: d.winnerGoesTo || null,
			loserGoesTo: d.loserGoesTo || null,
		});
	}
	return created;
}

function attachPlacement(drafts) {
	if (typeof engine.attachPlacement === 'function') return engine.attachPlacement(drafts);
	const list = Array.isArray(drafts) ? drafts : [];
	if (list.some((d) => d.side === 'placement')) return list;
	const ids = new Set();
	for (const d of list) {
		if (d.entry1Id) ids.add(d.entry1Id);
		if (d.entry2Id) ids.add(d.entry2Id);
	}
	if (ids.size < 4) return list;
	const winners = list.filter((d) => d.side === 'winners');
	const maxRound = winners.reduce((n, d) => Math.max(n, d.round), 0);
	if (maxRound < 2) return list;
	const semis = winners.filter((d) => d.round === maxRound - 1).sort((a, b) => a.position - b.position);
	if (semis.length < 2) return list;
	list.push({ side: 'placement', round: 1, position: 1, entry1Id: null, entry2Id: null });
	semis.forEach((m, i) => {
		m.loserGoesTo = { side: 'placement', round: 1, position: 1, slot: (i % 2) + 1 };
	});
	return list;
}

function titleCountByHandle() {
	const db = records.getDb && records.getDb();
	if (!db) return new Map();
	try {
		const rows = db.prepare(`
			SELECT LOWER(r.handle) AS handle, COUNT(*) AS n
			FROM tourney_results r
			JOIN tourney_events e ON e.tournament_id = r.tournament_id
			WHERE r.placement = 1 AND e.official = 1
			GROUP BY LOWER(r.handle)
		`).all();
		return new Map(rows.map((row) => [String(row.handle || ''), Number(row.n) || 0]));
	} catch (_err) {
		return new Map();
	}
}

function seedFieldByRecords(field) {
	const titles = titleCountByHandle();
	return [...(field || [])].sort((a, b) => {
		const ta = titles.get(String(a.handle || '').trim().toLowerCase()) || 0;
		const tb = titles.get(String(b.handle || '').trim().toLowerCase()) || 0;
		if (tb !== ta) return tb - ta;
		const sa = Number(a.seed) || 9999;
		const sb = Number(b.seed) || 9999;
		if (sa !== sb) return sa - sb;
		return String(a.handle || '').localeCompare(String(b.handle || ''), undefined, { sensitivity: 'base' });
	});
}

function addMatches(store, tournament, paidEntries) {
	const champId = champEntryId(tournament);
	const existingTitle = (store.matches || []).find((m) => m.tournamentId === tournament.id && m.side === 'title');
	const field = champId
		? paidEntries.filter((e) => e.id !== champId)
		: paidEntries;
	if (champId && field.length < 1) {
		throw Object.assign(new Error('Reigning Champ mode needs at least one challenger besides the champ'), { status: 400 });
	}
	const seeded = [...field].sort((a, b) => (a.seed || 99) - (b.seed || 99));
	const bindTitle = (drafts, challengerId) => {
		const list = Array.isArray(drafts) ? drafts : [];
		if (existingTitle) {
			const grand = list.find((d) => d.side === 'grand');
			const winners = list.filter((d) => d.side === 'winners');
			const maxR = winners.reduce((n, d) => Math.max(n, Number(d.round) || 0), 0);
			const terminal = grand || winners.find((d) => Number(d.round) === maxR && Number(d.position) === 1) || winners[0];
			if (terminal) terminal.winnerGoesTo = { side: 'title', round: 1, position: 1, slot: 2 };
			return list;
		}
		if (!list.some((d) => d.side === 'title')) attachTitleDraft(list, champId, challengerId || null);
		return list;
	};
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
		if (champId && !existingTitle) {
			store.matches.push(...draftsToMatches(store, tournament, attachTitleDraft([], champId, field.length === 1 ? field[0].id : null)));
		}
		return;
	}
	const ids = seeded.map((e) => e.id);
	if (ids.length) tournament.bracketSize = eventPhase.treeSizeForField(ids.length);
	let drafts = [];
	const inPlayoff = tournament.stage === 'playoff';
	const format = tournament.format;
	if (ids.length === 1 && champId) {
		if (existingTitle) {
			if (!existingTitle.entry2Id && Number(existingTitle.entry1Id) !== ids[0]) existingTitle.entry2Id = ids[0];
			existingTitle.status = (existingTitle.entry1Id && existingTitle.entry2Id) ? 'ready' : 'pending';
			return;
		}
		drafts = attachTitleDraft([], champId, ids[0]);
		store.matches.push(...draftsToMatches(store, tournament, drafts));
		return;
	} else if (!inPlayoff && format === 'round_robin') drafts = generateRoundRobin(ids);
	else if (!inPlayoff && format === 'swiss') drafts = pairSwissRound(ids.map((id, i) => ({
		id, seed: i + 1, wins: 0, buchholz: 0, played: [],
	})), 1);
	else if (wantsLosersBracket(tournament) || format === 'double_elim') drafts = generateDoubleElim(ids);
	else drafts = generateSingleElim(ids);
	if (tournament.breakTies && !wantsLosersBracket(tournament) && drafts.some((d) => d.side === 'winners')) {
		attachPlacement(drafts);
	}
	if (champId) bindTitle(drafts, ids.length === 1 ? ids[0] : null);
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
	const played = [...byId.values()];
	if (played.some((row) => row.played > 0 || row.wins > 0)) {
		return played.sort((a, b) => b.points - a.points || b.mapDiff - a.mapDiff || (a.seed || 99) - (b.seed || 99));
	}
	if (pool.some((e) => e.record || e.placement)) {
		return pool.map((e) => {
			const rec = parseRecord(e.record);
			const row = byId.get(e.id);
			row.wins = rec.wins;
			row.losses = rec.losses;
			row.played = rec.wins + rec.losses;
			row.points = rec.wins * 3;
			return row;
		}).sort((a, b) => {
			const ea = pool.find((e) => e.id === a.entryId);
			const eb = pool.find((e) => e.id === b.entryId);
			const pa = Number(ea && ea.placement) || 99;
			const pb = Number(eb && eb.placement) || 99;
			return pa - pb || b.points - a.points || String(a.handle).localeCompare(String(b.handle));
		});
	}
	return played.sort((a, b) => b.points - a.points || b.mapDiff - a.mapDiff || (a.seed || 99) - (b.seed || 99));
}

function maybeFinishOrAdvance(store, t) {
	collapseVacantMatches(store, t);
	if (playOpenMatches(store, t).length) return;
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
			const skip = champEntryId(t);
			const table = standingsFor(store, t).filter((s) => Number(s.entryId) !== skip);
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
		const skip = champEntryId(t);
		const table = standingsFor(store, t).filter((s) => Number(s.entryId) !== skip);
		const seeded = table.map((s) => store.entries.find((e) => e.id === s.entryId)).filter(Boolean);
		if (seeded.length >= 2) {
			seeded.forEach((e, i) => { e.seed = i + 1; });
			t.stage = 'playoff';
			addMatches(store, t, seeded);
			return;
		}
	}
	seatTitleChallenger(store, t);
	dropOrphanTitleMatch(store, t);
	const leftover = anyOpenMatches(store, t);
	const blocking = leftover.filter((m) => {
		if (m.side === 'placement') return Boolean(m.entry1Id && m.entry2Id);
		if (m.side === 'title') return Boolean((m.entry1Id && m.entry2Id) || wantsReigningChamp(t));
		return true;
	});
	if (blocking.length) return;
	for (const stuck of leftover) {
		if (stuck.entry1Id || stuck.entry2Id) applyByeAdvance(store, stuck);
		else {
			stuck.status = 'vacant';
			stuck.winnerId = null;
			stuck.games = [];
			stuck.score1 = null;
			stuck.score2 = null;
		}
	}
	if (anyOpenMatches(store, t).length) return;
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
	const deepestDecided = (side) => [...matches]
		.filter((m) => m.side === side && decidedWinnerId(m))
		.sort((a, b) => b.round - a.round || a.position - b.position)[0] || null;
	const final = deepestDecided('title') || deepestDecided('grand') || deepestDecided('winners');
	const secondId = final && champ ? (Number(final.winnerId) === Number(final.entry1Id) ? final.entry2Id : final.entry1Id) : null;
	const place = matches.find((m) => m.side === 'placement' && m.status === 'complete');
	let third = [];
	let fourth = null;
	if (place && place.winnerId) {
		const bronze = byId(place.winnerId);
		if (bronze) third = [bronze];
		const fourthId = place.winnerId === place.entry1Id ? place.entry2Id : place.entry1Id;
		fourth = byId(fourthId);
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
		fourth: fourth ? { ...fourth, record: rec(fourth.id) } : null,
	};
}

function championFor(store, tournament, opts) {
	const fieldOnly = Boolean(opts && opts.fieldOnly);
	const all = tournamentMatches(store, tournament);
	const matches = fieldOnly ? all.filter((m) => m.side !== 'title') : all;
	const asEntry = (id) => {
		const entry = store.entries.find((e) => e.id === Number(id));
		return entry ? { id: entry.id, handle: entry.handle } : null;
	};
	if (!fieldOnly && all.some((m) => m.side === 'title')) {
		const title = all.find((m) => m.side === 'title' && decidedWinnerId(m));
		return title ? asEntry(decidedWinnerId(title)) : null;
	}
	const settled = !playOpenMatches(store, tournament).length;
	if (wantsLosersBracket(tournament) && matches.some((m) => m.side === 'grand')) {
		const grand = deepestDecidedWinnerId(matches, ['grand']);
		if (grand) return asEntry(grand);
		if (!settled) return null;
	}
	if (matches.some((m) => ELIM_SIDES.includes(m.side))) {
		const terminal = decidedWinnerId(fieldTerminalMatch(store, tournament));
		if (terminal) return asEntry(terminal);
		if (!settled) return null;
		// Byes and vacated slots can collapse the tree short of the final. Whoever won
		// the deepest match that did resolve is the last one standing.
		const standing = deepestDecidedWinnerId(matches, ['grand', 'winners']);
		return standing ? asEntry(standing) : null;
	}
	const skip = fieldOnly ? champEntryId(tournament) : 0;
	const table = standingsFor(store, tournament).filter((row) => Number(row.entryId) !== skip);
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
	const session = sessionFrom(request);
	if (session && session.user_id) {
		tournament.hostUserId = Number(session.user_id);
		const fromDiscord = String(session.tourney_handle || session.discord_username || '').trim();
		const typed = String(tournament.hostName || '').trim();
		if (fromDiscord && (!typed || typed === 'KushMetaX')) tournament.hostName = fromDiscord;
	}
	return tournament;
}

function stampCreator(request, tournament, role) {
	const session = sessionFrom(request);
	if (role === 'host') {
		if (!session || !session.user_id) {
			throw Object.assign(new Error('Sign in with Discord to create an arena.'), { status: 401 });
		}
		tournament.hostUserId = Number(session.user_id);
		const fromDiscord = String(session.tourney_handle || session.discord_username || '').trim();
		const typed = String(tournament.hostName || '').trim();
		if (fromDiscord && (!typed || typed === 'KushMetaX')) tournament.hostName = fromDiscord;
		return tournament;
	}
	return attachHostIdentity(request, tournament);
}

function applyArenaHost(tournament, userRow) {
	if (!tournament || !userRow) return tournament;
	const payload = typeof authDex.authUserPayload === 'function' ? authDex.authUserPayload(userRow) : userRow;
	const id = Number(payload && (payload.id != null ? payload.id : payload.user_id));
	if (!(id > 0)) return tournament;
	tournament.hostUserId = id;
	const name = String((payload && (payload.tourneyHandle || payload.discordUsername)) || '').trim();
	if (name) tournament.hostName = name;
	return tournament;
}

function syncHostDisplay(tournament) {
	const user = hostUserFor(tournament);
	if (user) {
		const name = String(user.tourneyHandle || user.discordUsername || '').trim();
		if (name) tournament.hostName = name;
	}
	return tournament;
}

function keepCreator(current, next) {
	if (!current || !next) return next;
	next.hostUserId = current.hostUserId != null ? current.hostUserId : next.hostUserId;
	next.hostName = current.hostName;
	return syncHostDisplay(next);
}

function applyPendingArenaHosts(store, database) {
	const db = database || records.getDb();
	if (!db || typeof authDex.findUserForHostGrant !== 'function') return false;
	store.meta = store.meta && typeof store.meta === 'object' ? store.meta : {};
	store.meta.hostSwaps = store.meta.hostSwaps && typeof store.meta.hostSwaps === 'object' ? store.meta.hostSwaps : {};
	let changed = false;
	for (const swap of PENDING_ARENA_HOSTS) {
		const key = `${swap.slug}:${String(swap.handle || '').toLowerCase()}`;
		if (store.meta.hostSwaps[key]) continue;
		const t = (store.tournaments || []).find((row) => row.slug === swap.slug);
		if (!t) continue;
		const user = authDex.findUserForHostGrant(db, swap);
		if (!user) {
			console.error('[tourney] pending host swap: no Discord user for', swap.handle);
			continue;
		}
		applyArenaHost(t, user);
		if (typeof authDex.setTourneyHost === 'function') {
			try { authDex.setTourneyHost(db, user.user_id, true, null); } catch (_err) { /* display swap still applies */ }
		}
		store.meta.hostSwaps[key] = new Date().toISOString();
		changed = true;
	}
	return changed;
}

function summarize(store, t) {
	const entries = store.entries.filter((e) => e.tournamentId === t.id);
	const paid = entries.filter((e) => e.paid && !e.noShow && (!e.whitelist || e.subbedIn));
	const feesCollected = feeTotalUsd(entries);
	const prizePool = computePrizePool(t, entries);
	const schedule = eventPhase.scheduleView(t);
	return {
		...t,
		hostUser: hostUserFor(t),
		paidCount: paid.length,
		entryCount: entries.length,
		prizePool,
		rewards: rewardView(t, prizePool, feesCollected),
		champion: t.status === 'completed' ? championFor(store, t) : null,
		phase: schedule.phase,
		schedule,
		hiddenFromPublic: eventPhase.isTestOrScrim(t),
		bracketSize: t.bracketSize || (t.status === 'registration' ? 0 : eventPhase.treeSizeForField(paid.length)),
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
	'playName', 'registeredDeck', 'listSubmitted',
];
const OWNER_ENTRY_FIELDS = [
	'fromWallet', 'wallet', 'invoiceCode', 'payTo', 'payTxid',
	'xPayerHandle',
	'payConfirmations', 'payWatchStatus', 'payVerifiedAt', 'usdPerCoin', 'quotedAt',
	'payNote',
];

function publicEntry(entry, revealPay, deckOpts) {
	const out = {};
	for (const key of PUBLIC_ENTRY_FIELDS) out[key] = entry[key];
	if (revealPay) {
		for (const key of OWNER_ENTRY_FIELDS) out[key] = entry[key];
	}
	const showDeck = deckVisibleTo(deckOpts && deckOpts.tournament, entry, deckOpts);
	const showClass = showDeck || (deckOpts && deckOpts.listsLocked);
	out.registeredDeck = publicDeckView(entry, showDeck);
	out.listSubmitted = Boolean(entry.registeredDeck && entry.registeredDeck.cardCount === playDecks.DECK_SIZE);
	if (!showClass) out.ddlClass = '';
	if (!showDeck) out.playName = '';
	return out;
}

function invoiceCodeFrom(request) {
	if (!request) return '';
	const header = typeof request.get === 'function' ? request.get('x-tourney-invoice') : '';
	const query = request.query || {};
	const body = request.body || {};
	return String(header || query.invoice || query.invoiceCode || body.invoiceCode || '').trim();
}

function canRevealPay(isHost, session, entry, invoiceCode) {
	if (isHost) return true;
	if (sessionMatchesEntry(session, entry)) return true;
	if (invoiceCode && entry && entry.invoiceCode && invoiceCode === entry.invoiceCode) return true;
	return false;
}

function detail(store, t, isHost, request) {
	const entries = store.entries.filter((e) => e.tournamentId === t.id);
	const matches = store.matches.filter((m) => m.tournamentId === t.id);
	const paid = entries.filter((e) => e.paid && (!e.whitelist || e.subbedIn));
	const feesCollected = feeTotalUsd(entries);
	const prizePool = computePrizePool(t, entries);
	const session = request ? authDex.getTourneySession(request.signedCookies) : null;
	const invoiceCode = invoiceCodeFrom(request);
	const listsLocked = eventPhase.listsLocked(t);
	const completedEntryIds = new Set();
	for (const m of matches) {
		if (m.status !== 'complete') continue;
		const a = Number(m.entry1Id);
		const b = Number(m.entry2Id);
		if (a > 0) completedEntryIds.add(a);
		if (b > 0) completedEntryIds.add(b);
	}
	const db = records.getDb();
	const discordByEntry = records.publicDiscordUsersForEntries(db, entries);
	const awards = db
		? records.listAwardsForHandles(db, entries.map((e) => e.handle))
		: [];
	const listed = entries.map((entry) => {
		const revealPay = canRevealPay(isHost, session, entry, invoiceCode);
		const isOwner = sessionMatchesEntry(session, entry);
		const matchComplete = completedEntryIds.has(Number(entry.id));
		const row = isHost
			? { ...entry, listSubmitted: Boolean(entry.registeredDeck && entry.registeredDeck.cardCount === playDecks.DECK_SIZE) }
			: publicEntry(entry, revealPay, {
				tournament: t,
				isHost,
				isOwner,
				listsLocked,
				matchComplete,
			});
		row.discordUser = discordByEntry.get(entry.id) || null;
		return row;
	});
	const schedule = eventPhase.scheduleView(t);
	const uid = session && Number(session.user_id);
	const viewerRole = isHost
		? (uid && Number(t.hostUserId) === uid ? 'owner'
			: (uid && (t.judgeUserIds || []).some((id) => Number(id) === uid) ? 'judge' : 'admin'))
		: (uid && (t.streamUserIds || []).some((id) => Number(id) === uid) ? 'stream'
			: (session && entries.some((e) => sessionMatchesEntry(session, e)) ? 'player' : 'public'));
	return {
		tournament: t,
		hostUser: hostUserFor(t),
		viewerIsHost: Boolean(isHost),
		viewerRole,
		phase: schedule.phase,
		schedule,
		listsLocked,
		listsPublic: eventPhase.listsPublic(t),
		entries: records.attachBadges(listed, awards),
		matches: matches.map((m) => {
			const copy = { ...m };
			if (!isHost && copy.reportProposal) {
				const mine = session && entries.some((e) => sessionMatchesEntry(session, e)
					&& (Number(e.id) === Number(m.entry1Id) || Number(e.id) === Number(m.entry2Id)));
				if (!mine) copy.reportProposal = { pending: true };
			}
			return copy;
		}),
		standings: standingsFor(store, t),
		prizePool,
		rewards: rewardView(t, prizePool, feesCollected),
		champion: t.status === 'completed' ? championFor(store, t) : null,
		podium: podiumFor(store, t),
		votes: (store.votes || []).filter((v) => v.tournamentId === t.id),
		predictions: (store.predictions || []).filter((p) => p.tournamentId === t.id),
		payTo: payToFor(t),
		claims: isHost ? records.listClaimsForTournament(records.getDb(), t.id) : [],
	};
}

function createRouter(options) {
	records = require('../lib/tourney-records');
	const dataDir = options.dataDir;
	const storeFile = path.join(dataDir, 'tourney-store.json');
	const bracketDir = options.bracketDir || path.join(__dirname, '..', '..', '..', 'bracket');
	const irlAssets = path.join(bracketDir, 'irl', 'og-assets');
	const assetsDir = fs.existsSync(path.join(irlAssets, 'base.rgba.gz'))
		? irlAssets
		: path.join(bracketDir, 'og-assets');
	const router = express.Router();
	router.use('/rtc', require('./rtc-signaling').createRouter({
		canClaimSeat: createIrlSeatGuard(dataDir),
	}));
	const dogeWatchOpts = options.dogeWatch && typeof options.dogeWatch === 'object' ? options.dogeWatch : {};
	const dogeWatchEnabled = dogeWatchOpts.enabled === true;
	const watchHits = new Map();

	async function incomingFor(address, extra) {
		if (typeof dogeWatchOpts.fetchIncoming === 'function') {
			return dogeWatchOpts.fetchIncoming(address, extra);
		}
		return dogePayWatch.fetchIncoming(address, extra);
	}

	function assertWatchRate(request, tournament) {
		if (canManageArena(dataDir, request, tournament)) return;
		const forwarded = request && request.headers && request.headers['x-forwarded-for'];
		const ip = String((request && request.ip) || forwarded || 'local').split(',')[0].trim();
		const now = Date.now();
		const kept = (watchHits.get(ip) || []).filter((t) => now - t < 30000);
		if (kept.length >= 8) {
			throw Object.assign(new Error('Wait a few seconds before checking the chain again'), { status: 429 });
		}
		kept.push(now);
		watchHits.set(ip, kept);
	}

	async function scanPayments(store, options) {
		const opts = options || {};
		const minConf = dogePayWatch.minConfirmationsFromEnv();
		const focus = opts.entry || null;
		const tournament = opts.tournament || (focus && (store.tournaments || []).find((row) => row.id === focus.tournamentId)) || null;
		const pool = focus
			? [focus]
			: pendingWatchEntries(store, tournament);
		if (focus && isHostConfirmAsset(focus.payAsset)) {
			return { confirmed: 0, seen: 0 };
		}
		if (!pool.length) return { confirmed: 0, seen: 0 };
		const addresses = [...new Set(pool.map((entry) => {
			const t = (store.tournaments || []).find((row) => row.id === entry.tournamentId);
			return entry.payTo || treasuryAddress(t);
		}).filter(Boolean))];
		let txs = [];
		for (const address of addresses) {
			const part = await incomingFor(address, { txid: opts.txid, fetch: dogeWatchOpts.fetch });
			txs = txs.concat(part || []);
		}
		if (opts.txid && focus) {
			const tx = dogePayWatch.findTxById(txs, opts.txid);
			if (!tx) return { confirmed: 0, seen: 0, error: 'Transaction not found on the Dogecoin chain yet' };
			const used = dogePayWatch.usedTxidSet(store.entries);
			const matched = dogePayWatch.matchForcedTxid(focus, tx, { usedTxids: used });
			if (!matched.ok && matched.reason === 'from-mismatch') {
				focus.payWatchStatus = 'mismatch';
				return { confirmed: 0, seen: 0, mismatchFrom: matched.actualFrom };
			}
			if (!matched.ok) {
				const error = matched.reason === 'amount'
					? 'That transaction does not cover the quoted entry amount'
					: 'That transaction is already assigned to another entry';
				return { confirmed: 0, seen: 0, error };
			}
			if (Number(tx.confirmations) >= minConf) {
				dogePayWatch.stampConfirmed(focus, tx);
				return { confirmed: 1, seen: 0 };
			}
			dogePayWatch.stampSeen(focus, tx);
			return { confirmed: 0, seen: 1 };
		}
		const grouped = new Map();
		for (const entry of pool) {
			const t = (store.tournaments || []).find((row) => row.id === entry.tournamentId) || tournament;
			const key = t ? t.id : 0;
			if (!grouped.has(key)) grouped.set(key, { tournament: t, entries: [] });
			grouped.get(key).entries.push(entry);
		}
		let confirmed = 0;
		let seen = 0;
		for (const group of grouped.values()) {
			const result = dogePayWatch.applyIncomingPayments(group.entries, txs, {
				payTo: treasuryAddress(group.tournament),
				minConfirmations: minConf,
				tournament: group.tournament,
			});
			dogePayWatch.applyMatchResult(store.entries, result);
			confirmed += result.confirmed.length;
			seen += result.seen.length;
		}
		return { confirmed, seen };
	}

	function findPayEntry(store, t, request) {
		const host = canManageArena(dataDir, request, t);
		const session = authDex.getTourneySession(request.signedCookies);
		const invoiceCode = invoiceCodeFrom(request);
		const entries = store.entries.filter((e) => e.tournamentId === t.id);
		const askedId = Number(request.body && request.body.entryId);
		if (host && Number.isFinite(askedId) && askedId > 0) {
			return entries.find((e) => e.id === askedId) || null;
		}
		if (session) {
			const mine = entries.find((e) => sessionMatchesEntry(session, e));
			if (mine) return mine;
		}
		if (invoiceCode) {
			return entries.find((e) => e.invoiceCode === invoiceCode) || null;
		}
		return null;
	}

	async function loadLiveStore() {
		// Fresh parse — never mutate the GET cache object in place.
		let store = readStoreFromDisk(storeFile);
		stripDemoTournaments(store);
		let dirty = false;
		let db = null;
		try {
			db = records.getDb();
			if (!db && typeof authDex.openAuthDatabase === 'function') {
				try {
					db = await authDex.openAuthDatabase();
					if (db && typeof records.ensureSchema === 'function') records.ensureSchema(db);
				} catch (err) {
					console.error('[tourney] open records db:', err && err.message ? err.message : err);
				}
			}
		} catch (err) {
			console.error('[tourney] records db:', err && err.message ? err.message : err);
		}
		try {
			if (db && !storeHasArenas(store)) {
				const hydrated = persist.hydrateStore(db);
				if (hydrated && storeHasArenas(hydrated)) {
					store = normalizeStore(hydrated);
					stripDemoTournaments(store);
					dirty = true;
					console.warn('[tourney] rebuilt live store from sqlite archive');
				}
			}
		} catch (err) {
			console.error('[tourney] hydrate:', err && err.message ? err.message : err);
		}
		try {
			const fromSnapshots = restoreMissingArenasFromRecords(store, null);
			if (fromSnapshots && fromSnapshots.snapshots) dirty = true;
			if (db && !storeHasArenas(store)) {
				const fromArchive = persist.restoreMissingFromArchive(store, db);
				if (fromArchive && (fromArchive.restored || fromArchive.upgraded)) dirty = true;
				const recovered = restoreMissingArenasFromRecords(store, db);
				if (recovered && (recovered.restored || recovered.snapshots)) dirty = true;
			}
		} catch (err) {
			console.error('[tourney] restore:', err && err.message ? err.message : err);
		}
		try {
			if (repairKnownBracketHistory(store)) dirty = true;
		} catch (err) {
			console.error('[tourney] repair:', err && err.message ? err.message : err);
		}
		try {
			if (applyPendingArenaHosts(store, db)) dirty = true;
		} catch (err) {
			console.error('[tourney] host swap:', err && err.message ? err.message : err);
		}
		try {
			for (const t of store.tournaments || []) {
				if (t.status !== 'in_progress') continue;
				const sig = () => `${t.status}|${(store.matches || [])
					.filter((m) => m.tournamentId === t.id)
					.map((m) => `${m.id}:${m.status}:${m.entry1Id}:${m.entry2Id}:${m.winnerId}`)
					.join(';')}`;
				const before = sig();
				collapseVacantMatches(store, t);
				maybeFinishOrAdvance(store, t);
				if (sig() !== before) dirty = true;
			}
		} catch (err) {
			console.error('[tourney] collapse:', err && err.message ? err.message : err);
		}
		if (db) {
			try {
				if (typeof records.seedHallIfEmpty === 'function') records.seedHallIfEmpty(db);
			} catch (err) {
				console.error('[tourney] seed hall:', err && err.message ? err.message : err);
			}
			const needsSeal = dirty || (typeof records.needsOfficialBackfill === 'function' && records.needsOfficialBackfill(db, store));
			if (needsSeal) {
				try {
					persist.persistLiveStore(db, store, {
						skipTournament: (t) => isDemoTournament(store, t),
					});
				} catch (err) {
					console.error('[tourney] archive persist:', err && err.message ? err.message : err);
				}
				try {
					const sealed = records.backfillWithFns(db, store, isDemoTournament, podiumFor, standingsFor);
					if (sealed && (sealed.inserted || sealed.updated || sealed.stamped)) dirty = true;
					if (typeof records.scrubPracticeEvents === 'function') {
						records.scrubPracticeEvents(db);
					}
				} catch (err) {
					console.error('[tourney] seal records:', err && err.message ? err.message : err);
				}
			}
		}
		store._persist = dirty;
		return store;
	}

	function persistStore(store) {
		const persist = store && store._persist;
		if (store) delete store._persist;
		if (!persist) return;
		saveStore(storeFile, store);
	}

	function hostedArena(store, request) {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		assertCanManageArena(dataDir, request, t);
		return t;
	}

	function withStore(mutate) {
		return async (request, response) => {
			try {
				const store = await loadLiveStore();
				delete store._persist;
				const result = await mutate(store, request);
				saveStore(storeFile, store);
				response.json(result);
			} catch (err) {
				response.status(err.status || 400).json({ error: err.message || 'Request failed' });
			}
		};
	}

	/** Public GETs: serve the live JSON store only — no archive hydrate/restore/backfill. */
	function readOnly(fn) {
		return (request, response) => {
			try {
				const store = loadStore(storeFile);
				response.set('Cache-Control', 'no-store, private');
				response.json(fn(store, request));
			} catch (err) {
				response.status(err.status || 400).json({ error: err.message || 'Request failed' });
			}
		};
	}

	/** Warm recovery after first requests so /arenas is not stuck behind sqlite. */
	setTimeout(() => {
		loadLiveStore()
			.then((store) => {
				try {
					persistStore(store);
				} catch (err) {
					console.error('[tourney] warm persist:', err && err.message ? err.message : err);
				}
			})
			.catch((err) => {
				console.error('[tourney] warm load:', err && err.message ? err.message : err);
			});
	}, 2500);

	router.get(['/share', '/share.jpg', '/share.png', '/og', '/og.jpg', '/og.png'], (request, response) => {
		const image = tourneyOg.tryRender({
			assetsDir,
			cacheDir: path.join(dataDir, 'og-cache'),
			kicker: 'Doginal Dogs',
			title: 'Legends Brackets',
			slug: 'home',
		});
		if (image && image.buffer) {
			response.set({
				'Content-Type': image.type || 'image/jpeg',
				'Cache-Control': 'public, max-age=3600',
			});
			response.send(image.buffer);
			return;
		}
		const fallback = path.join(bracketDir, 'share.jpg');
		if (fs.existsSync(fallback)) {
			response.set({
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'public, max-age=3600',
			});
			response.sendFile(fallback);
			return;
		}
		response.status(404).type('txt').send('Share image missing');
	});

	router.get('/quote', async (request, response) => {
		try {
			const usd = Math.max(0, Number(request.query.usd) || 0);
			const prices = await fetchUsdPrices();
			response.json(quoteAmounts(usd, prices));
		} catch (err) {
			response.status(err.status || 502).json({ error: err.message || 'Price quote failed' });
		}
	});

	router.get('/status', (request, response) => {
		const stored = loadStore(storeFile);
		const hostingEnabled = hostingProductEnabled(dataDir);
		response.set('Cache-Control', 'no-store, private');
		response.json({
			ok: true,
			mode: 'static',
			rewards: true,
			hostingEnabled,
			hostPasswordSet: hostingEnabled,
			adminPasswordSet: Boolean(resolveAdminPassword(dataDir)),
			control: true,
			payTo: PAY_TO,
			paymentWatch: dogeWatchEnabled,
			discordOAuth: authDex.discordOAuthConfigured(),
			requireAccountDefault: true,
			arenaCount: Array.isArray(stored.tournaments) ? stored.tournaments.length : 0,
			viewer: viewerPayload(dataDir, request),
		});
	});

	router.get('/host-auth', (_request, response) => {
		const info = hostPasswordInfo(dataDir);
		response.json({ configured: Boolean(info.value) });
	});

	router.post('/admin-auth', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message, configured: Boolean(resolveAdminPassword(dataDir)) });
			return;
		}
		response.json({ ok: true, role: 'admin' });
	});

	router.post('/host-unlock', (request, response) => {
		try {
			assertHostPassword(dataDir, request.body && request.body.hostPassword);
			const session = sessionFrom(request);
			if (!session || !session.user_id) {
				throw Object.assign(new Error('Sign in with Discord first, then unlock hosting on this account.'), { status: 401 });
			}
			if (!session.discord_id) {
				throw Object.assign(new Error('Link Discord to this account before unlocking hosting.'), { status: 403 });
			}
			const db = records.getDb();
			if (!db || typeof authDex.setTourneyHost !== 'function') {
				throw Object.assign(new Error('Account database unavailable.'), { status: 503 });
			}
			const row = authDex.setTourneyHost(db, session.user_id, true, null);
			response.json({
				ok: true,
				user: typeof authDex.authUserPayload === 'function' ? authDex.authUserPayload(row) : row,
			});
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
		}
	});

	/** Legacy path: host password no longer unlocks every arena. Discord hosts unlock their own account. */
	router.post('/host-auth', (request, response) => {
		const info = hostPasswordInfo(dataDir);
		try {
			assertHostPassword(dataDir, request.body && request.body.hostPassword);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message, configured: Boolean(info.value) });
			return;
		}
		const session = sessionFrom(request);
		if (session && session.discord_id && typeof authDex.setTourneyHost === 'function') {
			try {
				const db = records.getDb();
				if (db) authDex.setTourneyHost(db, session.user_id, true, null);
			} catch (_err) { /* grant is best-effort on this legacy path */ }
		}
		response.json({
			ok: true,
			legacy: true,
			message: 'Host password accepted. Hosting is tied to your Discord account — you can only change arenas you create. Use admin sign-in to manage every arena.',
		});
	});

	router.get('/hosts', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
			return;
		}
		const db = records.getDb();
		if (!db || typeof authDex.listTourneyHosts !== 'function') {
			response.json({ ok: true, hosts: [] });
			return;
		}
		response.json({ ok: true, hosts: authDex.listTourneyHosts(db) });
	});

	router.post('/hosts', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
			const db = records.getDb();
			if (!db || typeof authDex.findUserForHostGrant !== 'function') {
				throw Object.assign(new Error('Account database unavailable.'), { status: 503 });
			}
			const body = request.body || {};
			const row = authDex.findUserForHostGrant(db, body);
			if (!row) throw Object.assign(new Error('Pick a Discord-linked account'), { status: 404 });
			const enabled = body.host !== false && body.enabled !== false;
			const until = body.until != null ? body.until : body.tourneyHostUntil;
			const next = authDex.setTourneyHost(db, row.user_id, enabled, until);
			response.json({
				ok: true,
				user: authDex.authUserPayload(next),
				hosts: authDex.listTourneyHosts(db),
			});
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message });
		}
	});

	router.get('/play/search', async (request, response) => {
		try {
			playDecks.assertRateLimit(request);
			const q = request.query && (request.query.q || request.query.name);
			const pack = await playDecks.searchHeroes(q);
			response.set('Cache-Control', 'no-store, private');
			response.json(pack);
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Play search failed' });
		}
	});

	router.get('/arenas', readOnly((store, request) => {
		const admin = isAdminRequest(dataDir, request);
		return store.tournaments
			.map((t) => ({ ...summarize(store, t), viewerIsHost: canManageArena(dataDir, request, t) }))
			// Public lobby: only unofficial scrims stay hidden. Hosts/admins still see their own.
			// Do not sniff name/slug/description for "test" — renamed nights keep old slugs.
			.filter((t) => admin || t.viewerIsHost || t.official !== false)
			.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
	}));

	router.get('/arenas/featured', readOnly((store, request) => {
		const admin = isAdminRequest(dataDir, request);
		const arenas = store.tournaments
			.map((t) => ({ ...summarize(store, t), viewerIsHost: canManageArena(dataDir, request, t) }))
			.filter((t) => admin || t.viewerIsHost || t.official !== false);
		const hot = arenas.find((t) => t.phase === 'live' && t.streamUrl);
		if (hot) return { ok: true, mode: 'live', arena: hot };
		const upcoming = arenas
			.filter((t) => t.official !== false && (t.phase === 'registration' || t.phase === 'check_in'))
			.sort((a, b) => {
				const am = Date.parse((a.startAt) || (a.schedule && a.schedule.startAt) || '') || Number.MAX_SAFE_INTEGER;
				const bm = Date.parse((b.startAt) || (b.schedule && b.schedule.startAt) || '') || Number.MAX_SAFE_INTEGER;
				return am - bm;
			});
		if (upcoming[0]) return { ok: true, mode: 'next', arena: upcoming[0] };
		const live = arenas.find((t) => t.phase === 'live');
		if (live) return { ok: true, mode: 'live', arena: live };
		return { ok: true, mode: null, arena: null };
	}));

	router.get('/arenas/:slug', readOnly((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		return detail(store, t, canManageArena(dataDir, request, t), request);
	}));

	function chatIdentity(store, tournament, request) {
		const session = sessionFrom(request);
		const signedIn = Boolean(session && session.user_id);
		const handle = arenaChat.sanitizeHandle(
			(session && (session.tourney_handle || session.discord_username)) || ''
		);
		const canModerate = canManageArena(dataDir, request, tournament);
		let role = 'viewer';
		if (canModerate) role = 'host';
		else if (signedIn && (store.entries || []).some((entry) => (
			entry.tournamentId === tournament.id && sessionMatchesEntry(session, entry)
		))) role = 'player';
		const payload = signedIn && typeof authDex.authUserPayload === 'function'
			? authDex.authUserPayload(session)
			: null;
		return {
			session,
			signedIn,
			canPost: Boolean(signedIn && handle.length >= 2),
			canModerate,
			role,
			handle,
			userId: signedIn ? Number(session.user_id) : 0,
			avatarUrl: (payload && payload.avatarUrl) || (session && session.avatar_url) || '',
		};
	}

	function chatPack(store, tournament, request, extra) {
		const ident = chatIdentity(store, tournament, request);
		const sinceRev = extra && extra.rev != null
			? extra.rev
			: Number(request.query && (request.query.rev || request.query.after));
		const watching = arenaChat.heartbeat(tournament.slug, {
			userId: ident.userId,
			viewer: (request.query && request.query.viewer) || (request.body && request.body.viewer),
		});
		const snapshot = extra && extra.snapshot
			? extra.snapshot
			: arenaChat.readRoom(dataDir, tournament.slug, Number.isFinite(sinceRev) ? sinceRev : 0);
		return {
			rev: snapshot.rev,
			unchanged: Boolean(snapshot.unchanged) && !extra,
			messages: snapshot.unchanged && !extra ? [] : snapshot.messages,
			watching,
			signedIn: ident.signedIn,
			canPost: ident.canPost,
			canModerate: ident.canModerate,
			viewerId: ident.userId,
			handle: ident.handle,
			...(extra && extra.message ? { message: extra.message } : {}),
		};
	}

	function loadArenaOr404(request) {
		const store = loadStore(storeFile);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		return { store, t };
	}

	router.get('/arenas/:slug/chat', (request, response) => {
		try {
			const { store, t } = loadArenaOr404(request);
			response.set('Cache-Control', 'no-store, private');
			response.json(chatPack(store, t, request));
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Chat failed' });
		}
	});

	router.post('/arenas/:slug/chat', (request, response) => {
		try {
			const { store, t } = loadArenaOr404(request);
			const ident = chatIdentity(store, t, request);
			if (!ident.signedIn) {
				throw Object.assign(new Error('Sign in with Discord to chat.'), { status: 401 });
			}
			if (!ident.canPost) {
				throw Object.assign(new Error('Set a tourney handle on your account before chatting.'), { status: 400 });
			}
			const message = arenaChat.addMessage(dataDir, t.slug, {
				userId: ident.userId,
				handle: ident.handle,
				avatarUrl: ident.avatarUrl,
				role: ident.role,
				body: request.body && request.body.body,
			});
			response.json(chatPack(store, t, request, {
				message,
				snapshot: arenaChat.readRoom(dataDir, t.slug, 0),
			}));
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Chat failed' });
		}
	});

	router.post('/arenas/:slug/chat/delete', (request, response) => {
		try {
			const { store, t } = loadArenaOr404(request);
			const ident = chatIdentity(store, t, request);
			if (!ident.signedIn) {
				throw Object.assign(new Error('Sign in with Discord to moderate chat.'), { status: 401 });
			}
			arenaChat.deleteMessage(dataDir, t.slug, request.body && request.body.id, {
				userId: ident.userId,
				moderate: ident.canModerate,
			});
			response.json(chatPack(store, t, request, {
				snapshot: arenaChat.readRoom(dataDir, t.slug, 0),
			}));
		} catch (err) {
			response.status(err.status || 400).json({ error: err.message || 'Chat failed' });
		}
	});

	router.post('/arenas', withStore((store, request) => {
		const access = assertCanCreateArena(dataDir, request);
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
		if (t.acceptDoge === false) {
			t.treasury = sanitizeDogeAddress(body.treasury || body.dogeAddress || t.treasury, { soft: true }) || '';
			if (!t.xHandle && !t.acceptUsdcSol) {
				throw Object.assign(new Error('Add an XMoney @handle, turn on USDC on Solana, or turn DOGE back on.'), { status: 400 });
			}
		} else {
			t.treasury = makeTreasury(body.treasury || body.dogeAddress || t.treasury);
		}
		if (t.acceptUsdcSol) {
			t.solanaTreasury = sanitizeSolanaAddress(body.solanaTreasury || t.solanaTreasury, { soft: true }) || solanaPayTo();
		}
		stampCreator(request, t, access.role);
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
		const startMs = eventPhase.parseStartMs(t);
		if (t.startAt && !t.startTentative && Number.isFinite(startMs) && Date.now() > startMs + 86400000) {
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
		const xPayerHandle = sanitizeXHandle(request.body && request.body.xPayerHandle);
		const usdBase = entryFeeUsd(t);
		let usd = usdBase;
		if (t.feeMode === 'charity' && usdBase > 0) {
			const donate = Number(request.body && (request.body.donateUsd || request.body.amountUsd));
			if (Number.isFinite(donate) && donate >= usdBase) usd = Math.round(donate * 100) / 100;
		}
		const hostX = xHandleOf(t);
		const dogeOn = t.acceptDoge !== false;
		const usdcOn = Boolean(t.acceptUsdcSol) && Boolean(usdcSolPayToFor(t));
		const requestedAsset = String((request.body && request.body.payAsset) || '').trim().toUpperCase();
		let payAsset = 'DOGE';
		if (usd > 0 && requestedAsset === 'XMONEY') {
			if (!hostX) throw Object.assign(new Error('This arena is not taking XMoney.'), { status: 400 });
			payAsset = 'XMONEY';
		} else if (usd > 0 && (requestedAsset === 'USDC_SOL' || requestedAsset === 'USDC')) {
			if (!usdcOn) throw Object.assign(new Error('This arena is not taking USDC on Solana.'), { status: 400 });
			payAsset = 'USDC_SOL';
		} else if (usd > 0 && !dogeOn) {
			if (usdcOn) payAsset = 'USDC_SOL';
			else if (hostX) payAsset = 'XMONEY';
			else throw Object.assign(new Error('This arena has no payment rail set.'), { status: 400 });
		}
		if (payAsset === 'XMONEY' && !xPayerHandle) {
			throw Object.assign(new Error('Enter the X @handle you will send from.'), { status: 400 });
		}
		const solFrom = payAsset === 'USDC_SOL' ? sanitizeSolanaAddress(fromWallet, { soft: true }) : '';
		if (payAsset === 'USDC_SOL') {
			if (!solFrom) {
				throw Object.assign(new Error('Enter the Solana wallet you will send USDC from.'), { status: 400 });
			}
			if (solFrom === solanaTreasuryOf(t)) {
				throw Object.assign(new Error('Enter the wallet you send FROM, not the tournament pay-to address'), { status: 400 });
			}
			const takenSol = entries.find((e) => !e.noShow && e.payAsset === 'USDC_SOL' && String(e.fromWallet || '') === solFrom);
			if (takenSol) {
				throw Object.assign(new Error('That sending wallet is already registered on this arena'), { status: 400 });
			}
		}
		if (usd > 0 && payAsset === 'DOGE' && fromWallet) {
			if (/^D/i.test(fromWallet) && !dogePayWatch.looksLikeDogeAddress(fromWallet)) {
				throw Object.assign(new Error('Enter a valid DOGE address (starts with D).'), { status: 400 });
			}
			if (fromWallet.length < 8) {
				throw Object.assign(new Error('Sending address looks too short'), { status: 400 });
			}
			if (fromWallet.length > 64) {
				throw Object.assign(new Error('Sending address looks too long'), { status: 400 });
			}
			if (dogePayWatch.addrKey(fromWallet) === dogePayWatch.addrKey(treasuryAddress(t))) {
				throw Object.assign(new Error('Enter the wallet you send FROM, not the tournament pay-to address'), { status: 400 });
			}
			const taken = entries.find((e) => !e.noShow && dogePayWatch.addrKey(e.fromWallet) === dogePayWatch.addrKey(fromWallet));
			if (taken) {
				throw Object.assign(new Error('That sending wallet is already registered on this arena'), { status: 400 });
			}
		}
		if (t.capPlayers !== false && entries.filter((e) => !isWhitelistEntry(e)).length >= t.maxPlayers) {
			throw Object.assign(new Error('This arena is full'), { status: 400 });
		}
		if (entries.some((e) => e.handle.toLowerCase() === handle.toLowerCase())) {
			throw Object.assign(new Error('That handle is already in'), { status: 400 });
		}
		let quote = { usd: 0, DOGE: 0, dogeUsd: 0, quotedAt: new Date().toISOString() };
		if (usd > 0 && payAsset === 'DOGE') {
			const prices = await fetchUsdPrices();
			quote = quoteAmounts(usd, prices);
		} else if (usd > 0) {
			quote = { usd, DOGE: 0, dogeUsd: 0, quotedAt: new Date().toISOString() };
		}
		const amountCrypto = payAsset === 'DOGE' ? quote.DOGE : (payAsset === 'USDC_SOL' ? usd : 0);
		const usdPerCoin = payAsset === 'DOGE' ? quote.dogeUsd : (payAsset === 'USDC_SOL' ? 1 : 0);
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
			fromWallet: payAsset === 'DOGE' ? fromWallet : (payAsset === 'USDC_SOL' ? solFrom : ''),
			wallet: payAsset === 'DOGE' ? fromWallet : (payAsset === 'USDC_SOL' ? solFrom : ''),
			xPayerHandle,
			payAsset,
			payTo: payAsset === 'XMONEY' ? `@${hostX}` : (payAsset === 'USDC_SOL' ? solanaTreasuryOf(t) : treasuryAddress(t)),
			seed: null,
			paid: autoPay,
			status: autoPay ? 'confirmed' : 'pending',
			checkedIn: false,
			invoiceCode: makeInvoiceCode(),
			amountUsd: usd,
			amountCrypto,
			usdPerCoin,
			quotedAt: quote.quotedAt,
			amountDoge: payAsset === 'DOGE' ? amountCrypto : 0,
			payWatchStatus: autoPay ? 'confirmed' : (isHostConfirmAsset(payAsset) ? '' : 'watching'),
			paidAt: autoPay ? new Date().toISOString() : null,
			createdAt: new Date().toISOString(),
		});
		if (t.requireRegisteredDeck || String((request.body && (request.body.deckText || request.body.listText)) || '').trim()) {
			await attachRegisteredDeck(entry, request.body, t, { required: Boolean(t.requireRegisteredDeck) });
		}
		store.entries.push(entry);
		const claimedTxid = String((request.body && request.body.txid) || '').trim();
		if (usd > 0 && payAsset === 'DOGE' && (dogePayWatch.looksLikeDogeAddress(fromWallet) || dogePayWatch.looksLikeTxid(claimedTxid))) {
			try {
				await scanPayments(store, { tournament: t, entry, txid: claimedTxid });
			} catch (err) {
				console.error('[doge-watch] enter', err && err.message ? err.message : err);
			}
		}
		return entry;
	}));

	router.post('/arenas/:slug/check-payment', withStore(async (store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (!(entryFeeUsd(t) > 0)) {
			throw Object.assign(new Error('This arena has no entry fee'), { status: 400 });
		}
		assertWatchRate(request, t);
		const host = canManageArena(dataDir, request, t);
		const session = authDex.getTourneySession(request.signedCookies);
		const invoiceCode = invoiceCodeFrom(request);
		let entry = findPayEntry(store, t, request);
		if (!entry && !host) {
			throw Object.assign(new Error('Register first, then we can watch for your payment'), { status: 400 });
		}
		if (entry && !host && !sessionMatchesEntry(session, entry) && !(invoiceCode && invoiceCode === entry.invoiceCode)) {
			throw Object.assign(new Error('You can only check your own payment'), { status: 403 });
		}
		const body = request.body || {};
		const nextWallet = String(body.fromWallet || body.wallet || '').trim();
		const nextTxid = String(body.txid || '').trim();
		if (entry && !entry.paid && entry.payAsset === 'XMONEY') {
			const nextX = sanitizeXHandle(body.xPayerHandle) || entry.xPayerHandle;
			if (!nextX) throw Object.assign(new Error('Enter the X @handle you sent from.'), { status: 400 });
			entry.xPayerHandle = nextX;
			entry.payWatchStatus = 'seen';
			entry.payNote = String(body.payNote || entry.payNote || 'Sent via XMoney').trim().slice(0, 160);
			return {
				ok: true,
				paid: false,
				payWatchStatus: 'seen',
				xPayerHandle: nextX,
				...detail(store, t, host, request),
			};
		}
		if (entry && !entry.paid && entry.payAsset === 'USDC_SOL') {
			const nextSol = sanitizeSolanaAddress(body.fromWallet || body.wallet || entry.fromWallet, { soft: true });
			if (!nextSol) throw Object.assign(new Error('Enter the Solana wallet you sent USDC from.'), { status: 400 });
			if (nextSol === solanaTreasuryOf(t)) {
				throw Object.assign(new Error('Enter the wallet you send FROM, not the tournament pay-to address'), { status: 400 });
			}
			const takenSol = store.entries.find((row) => (
				row.tournamentId === t.id
				&& row.id !== entry.id
				&& !row.noShow
				&& row.payAsset === 'USDC_SOL'
				&& String(row.fromWallet || '') === nextSol
			));
			if (takenSol) {
				throw Object.assign(new Error('That sending wallet is already registered on this arena'), { status: 400 });
			}
			entry.fromWallet = nextSol;
			entry.wallet = nextSol;
			if (looksLikeSolanaSig(nextTxid)) entry.payTxid = String(nextTxid).trim();
			entry.payWatchStatus = 'seen';
			entry.payNote = String(body.payNote || entry.payNote || 'Sent USDC on Solana').trim().slice(0, 160);
			return {
				ok: true,
				paid: false,
				payWatchStatus: 'seen',
				fromWallet: nextSol,
				payTxid: entry.payTxid || '',
				...detail(store, t, host, request),
			};
		}
		if (entry && !entry.paid) {
			if (nextWallet) {
				if (/^D/i.test(nextWallet) && !dogePayWatch.looksLikeDogeAddress(nextWallet)) {
					throw Object.assign(new Error('Enter a valid DOGE address (starts with D).'), { status: 400 });
				}
				if (dogePayWatch.addrKey(nextWallet) === dogePayWatch.addrKey(treasuryAddress(t))) {
					throw Object.assign(new Error('Enter the wallet you send FROM, not the tournament pay-to address'), { status: 400 });
				}
				const taken = store.entries.find((row) => (
					row.tournamentId === t.id
					&& row.id !== entry.id
					&& !row.noShow
					&& dogePayWatch.addrKey(row.fromWallet) === dogePayWatch.addrKey(nextWallet)
				));
				if (taken) {
					throw Object.assign(new Error('That sending wallet is already registered on this arena'), { status: 400 });
				}
				entry.fromWallet = nextWallet;
				entry.wallet = nextWallet;
			}
			if (nextTxid) {
				if (!dogePayWatch.looksLikeTxid(nextTxid)) {
					throw Object.assign(new Error('Transaction ID should be 64 hex characters'), { status: 400 });
				}
				entry.payTxid = nextTxid.toLowerCase();
			}
			if (!entry.payWatchStatus || entry.payWatchStatus === 'mismatch') entry.payWatchStatus = 'watching';
		}
		let watch;
		try {
			watch = await scanPayments(store, {
				tournament: t,
				entry: host && !entry ? null : entry,
				txid: nextTxid || (entry && entry.payTxid),
			});
		} catch (err) {
			console.error('[doge-watch] check', err && err.message ? err.message : err);
			watch = { confirmed: 0, seen: 0, error: err.message || 'Could not read the Dogecoin chain right now' };
		}
		const live = entry && store.entries.find((row) => row.id === entry.id);
		return {
			ok: true,
			paid: Boolean(live && live.paid),
			payWatchStatus: live ? live.payWatchStatus : '',
			payTxid: live ? live.payTxid : '',
			payConfirmations: live ? live.payConfirmations : 0,
			fromWallet: live ? live.fromWallet : '',
			mismatchFrom: watch.mismatchFrom || '',
			watchError: watch.error || '',
			confirmed: watch.confirmed || 0,
			seen: watch.seen || 0,
			...detail(store, t, host, request),
		};
	}));

	router.post('/arenas/:slug/register-deck', withStore(async (store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const host = canManageArena(dataDir, request, t);
		const session = authDex.getTourneySession(request.signedCookies);
		const entries = store.entries.filter((e) => e.tournamentId === t.id);
		let entry = null;
		const askedId = Number(request.body && request.body.entryId);
		if (host && Number.isFinite(askedId) && askedId > 0) {
			entry = entries.find((e) => e.id === askedId) || null;
		}
		if (!entry && session) {
			entry = entries.find((e) => sessionMatchesEntry(session, e)) || null;
		}
		if (!entry) {
			throw Object.assign(new Error(host ? 'Pick a player to lock a deck for' : 'Register for this arena first'), { status: 400 });
		}
		if (!host && !sessionMatchesEntry(session, entry)) {
			throw Object.assign(new Error('You can only lock a deck on your own entry'), { status: 403 });
		}
		assertDeckMutable(t, entry, host);
		await attachRegisteredDeck(entry, request.body, t, { required: true });
		if (request.body && request.body.ddlClass) {
			entry.ddlClass = readDdlClass(request.body);
		}
		return host ? detail(store, t, true) : entry;
	}));

	router.post('/arenas/:slug/pay', withStore((store, request) => {
		const t = hostedArena(store, request);
		const code = String((request.body && request.body.invoiceCode) || '').trim();
		const entry = store.entries.find((e) => e.tournamentId === t.id && e.invoiceCode === code);
		if (!entry) throw Object.assign(new Error('Invoice not found'), { status: 404 });
		entry.paid = true;
		entry.status = 'confirmed';
		entry.paidAt = new Date().toISOString();
		return entry;
	}));

	router.post('/arenas/:slug/confirm', withStore((store, request) => {
		const t = hostedArena(store, request);
		if (t.status === 'completed') throw Object.assign(new Error('This arena is finished'), { status: 400 });
		const codes = new Set((Array.isArray(request.body && request.body.invoiceCodes) ? request.body.invoiceCodes : [])
			.map((c) => String(c || '').trim())
			.filter(Boolean));
		const ids = new Set((Array.isArray(request.body && request.body.entryIds) ? request.body.entryIds : [])
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id)));
		const confirmAll = Boolean(request.body && request.body.confirmAll);
		/** `paid: false` reverses a mistaken confirm and drops the entry back to pending. */
		const wantPaid = !(request.body && request.body.paid === false);
		const note = String((request.body && (request.body.note || request.body.payNote || request.body.txid)) || '').trim().slice(0, 160);
		const txid = String((request.body && request.body.txid) || '').trim();
		if (!confirmAll && !codes.size && !ids.size) {
			throw Object.assign(new Error('Select at least one participant to confirm'), { status: 400 });
		}
		if (!wantPaid && t.status !== 'registration') {
			throw Object.assign(new Error('Unpaid is only available while registration is open'), { status: 400 });
		}
		let confirmed = 0;
		for (const entry of store.entries.filter((e) => e.tournamentId === t.id)) {
			const hit = confirmAll || codes.has(entry.invoiceCode) || ids.has(entry.id);
			if (!hit || entry.paid === wantPaid) continue;
			entry.paid = wantPaid;
			entry.status = wantPaid ? 'confirmed' : 'pending';
			entry.paidAt = wantPaid ? new Date().toISOString() : null;
			if (wantPaid) {
				entry.payWatchStatus = 'confirmed';
				if (dogePayWatch.looksLikeTxid(txid)) entry.payTxid = txid.toLowerCase();
				else if (entry.payAsset === 'USDC_SOL' && looksLikeSolanaSig(txid)) entry.payTxid = txid.trim();
				if (note) entry.payNote = note;
				entry.payVerifiedAt = entry.paidAt;
			} else {
				entry.checkedIn = false;
				entry.payNote = '';
			}
			confirmed += 1;
		}
		return { ok: true, confirmed, ...detail(store, t, true, request) };
	}));

	/** Host-added player: covers list arenas, walk-ins, live late entries, and whitelist substitutes. */
	router.post('/arenas/:slug/add-entry', withStore(async (store, request) => {
		const t = hostedArena(store, request);
		const whitelist = Boolean(request.body && request.body.whitelist);
		if (t.status === 'completed') {
			throw Object.assign(new Error('This arena is finished — no new entries'), { status: 400 });
		}
		let entry;
		if (t.status !== 'registration') {
			if (whitelist) {
				if (!(wantsWhitelist(t) && t.status === 'in_progress')) {
					throw Object.assign(new Error('The bracket is locked — no new entries'), { status: 400 });
				}
				entry = addHostEntry(store, t, request, { whitelist });
			} else {
				if (t.status !== 'in_progress') {
					throw Object.assign(new Error('The bracket is locked — no new entries'), { status: 400 });
				}
				entry = addLateHostEntry(store, t, request);
			}
		} else {
			entry = addHostEntry(store, t, request, { whitelist });
		}
		await attachRegisteredDeck(entry, request.body, t, { required: false });
		return detail(store, t, true);
	}));

	/** Put a whitelist substitute into a first-round slot: no-show, empty, or bye. */
	router.post('/arenas/:slug/sub-round1', withStore((store, request) => {
		const t = hostedArena(store, request);
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
		const t = hostedArena(store, request);
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
		const t = hostedArena(store, request);
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
		classQuota.assertFieldQuota(paid, t.deckClassQuota);
		t.bestOf = normalizeBestOf(body.bestOf, t.bestOf);
		if (body.roundBestOf) t.roundBestOf = sanitizeRoundBestOf(body.roundBestOf);
		if (Object.prototype.hasOwnProperty.call(body, 'finalsBestOf')) {
			t.finalsBestOf = sanitizeFinalsBestOf(body.finalsBestOf);
		}
		if (body.breakTies != null && !wantsLosersBracket(t) && t.eventKind !== 'duel') {
			t.breakTies = Boolean(body.breakTies);
		}
		if (body.potFundMode != null) t.potFundMode = body.potFundMode === 'percent' ? 'percent' : 'usd';
		if (body.hostPotUsd != null) t.hostPotUsd = sanitizeHostPotUsd(body.hostPotUsd, t.hostPotUsd);
		if (body.addedPotUsd != null) t.addedPotUsd = sanitizeHostPotUsd(body.addedPotUsd, t.addedPotUsd);
		normalizeTournament(t);
		if (body.reigningChamp != null) t.reigningChamp = Boolean(body.reigningChamp);
		if (body.shuffle || body.seedBy === 'random') paid = shuffleList(paid);
		else paid = seedFieldByRecords(paid);
		paid.forEach((e, i) => { e.seed = i + 1; });
		if (t.reigningChamp) {
			const asked = Number(body.reigningChampEntryId != null ? body.reigningChampEntryId : t.reigningChampEntryId);
			const champ = paid.find((e) => e.id === asked) || paid.find((e) => String(e.handle || '').toLowerCase() === String(body.reigningChampHandle || '').trim().toLowerCase());
			if (!champ) {
				throw Object.assign(new Error('Pick the Reigning Champ from the confirmed players'), { status: 400 });
			}
			t.reigningChamp = true;
			t.reigningChampEntryId = champ.id;
		} else {
			t.reigningChampEntryId = null;
		}
		store.matches = store.matches.filter((m) => m.tournamentId !== t.id);
		try {
			addMatches(store, t, paid);
		} catch (err) {
			throw Object.assign(
				new Error(err && err.message ? err.message : 'Could not build the bracket'),
				{ status: err && err.status ? err.status : 500 },
			);
		}
		t.status = 'in_progress';
		collapseVacantMatches(store, t);
		maybeFinishOrAdvance(store, t);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/reigning-champ', withStore((store, request) => {
		const t = hostedArena(store, request);
		if (t.eventKind === 'duel') {
			throw Object.assign(new Error('Duels cannot use Reigning Champ mode'), { status: 400 });
		}
		const body = request.body || {};
		if (body.reigningChamp === false || body.clear) {
			t.reigningChamp = false;
			t.reigningChampEntryId = null;
			removeTitleMatch(store, t);
			if (t.status !== 'registration') {
				collapseVacantMatches(store, t);
				maybeFinishOrAdvance(store, t);
			}
			return detail(store, t, true);
		}
		const asked = Number(body.entryId != null ? body.entryId : body.reigningChampEntryId);
		ensureReigningChamp(store, t, asked);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/repair-bracket', withStore((store, request) => {
		const t = hostedArena(store, request);
		if (t.status === 'registration') {
			throw Object.assign(new Error('Lock the bracket first, then fix it.'), { status: 400 });
		}
		const force = Boolean(request.body && (request.body.force || request.body.close));
		repairBracket(store, t, { force });
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/reshuffle', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = reshuffleBlockReason(store, t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const field = store.entries.filter((e) => (
			e.tournamentId === t.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
		));
		if (field.length < 2) {
			throw Object.assign(new Error('Need at least 2 confirmed players to shuffle'), { status: 400 });
		}
		const seedBy = String((request.body && request.body.seedBy) || (request.body && request.body.shuffle === false ? 'records' : 'random'));
		const ordered = seedBy === 'records' ? seedFieldByRecords(field) : shuffleList(field);
		ordered.forEach((e, i) => { e.seed = i + 1; });
		store.matches = store.matches.filter((m) => m.tournamentId !== t.id);
		store.votes = (store.votes || []).filter((v) => v.tournamentId !== t.id);
		addMatches(store, t, ordered);
		collapseVacantMatches(store, t);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/swap-seeds', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const idA = Number(request.body && request.body.entryIdA);
		const idB = Number(request.body && request.body.entryIdB);
		if (!Number.isFinite(idA) || !Number.isFinite(idB) || idA === idB) {
			throw Object.assign(new Error('Pick two different players to swap'), { status: 400 });
		}
		const field = store.entries.filter((e) => (
			e.tournamentId === t.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
		));
		const a = field.find((e) => e.id === idA);
		const b = field.find((e) => e.id === idB);
		if (!a || !b) {
			throw Object.assign(new Error('Those players are not in this bracket'), { status: 400 });
		}
		swapPlayersInBracket(store, t, a, b);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/pair-players', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const idA = Number(request.body && request.body.entryIdA);
		const idB = Number(request.body && request.body.entryIdB);
		if (!Number.isFinite(idA) || !Number.isFinite(idB) || idA === idB) {
			throw Object.assign(new Error('Pick two different players'), { status: 400 });
		}
		const field = store.entries.filter((e) => (
			e.tournamentId === t.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
		));
		const a = field.find((e) => e.id === idA);
		const b = field.find((e) => e.id === idB);
		if (!a || !b) {
			throw Object.assign(new Error('Those players are not in this bracket'), { status: 400 });
		}
		const body = request.body || {};
		pairPlayersTogether(store, t, a, b, {
			matchId: Number(body.matchId) || 0,
			side: body.side,
			round: Number(body.round) || 0,
		});
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/they-play', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const idA = Number(request.body && request.body.entryIdA);
		const idB = Number(request.body && request.body.entryIdB);
		if (!Number.isFinite(idA) || !Number.isFinite(idB) || idA === idB) {
			throw Object.assign(new Error('Pick two different players'), { status: 400 });
		}
		const field = store.entries.filter((e) => (
			e.tournamentId === t.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
		));
		const a = field.find((e) => e.id === idA);
		const b = field.find((e) => e.id === idB);
		if (!a || !b) {
			throw Object.assign(new Error('Those players are not in this bracket'), { status: 400 });
		}
		const body = request.body || {};
		pairPlayersTogether(store, t, a, b, {
			matchId: Number(body.matchId) || 0,
			side: body.side,
			round: Number(body.round) || 0,
		});
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/swap-slots', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const body = request.body || {};
		const seatA = parseSeat(body, 'A') || parseSeat({ matchId: body.matchIdA, slot: body.slotA }, '');
		const seatB = parseSeat(body, 'B') || parseSeat({ matchId: body.matchIdB, slot: body.slotB }, '');
		swapSlots(store, t, seatA, seatB);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/place-entry', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const body = request.body || {};
		const seat = parseSeat(body, '') || parseSeat(body, 'A');
		if (!seat) throw Object.assign(new Error('Pick a seat'), { status: 400 });
		const rawId = body.entryId;
		const clear = rawId == null || rawId === '' || Number(rawId) === 0;
		if (clear) {
			const match = store.matches.find((m) => m.tournamentId === t.id && m.id === seat.matchId);
			if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
			prepareMatchForRosterEdit(store, match);
			setSlotEntry(match, seat.slot, null);
			refreshEditedMatch(store, t, match);
			clearMatchVotes(store, t, [match.id]);
			markBracketOpen(t);
			collapseVacantMatches(store, t);
			maybeFinishOrAdvance(store, t);
			return detail(store, t, true);
		}
		const entryId = Number(rawId);
		const field = store.entries.filter((e) => (
			e.tournamentId === t.id && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)
		));
		const entry = field.find((e) => e.id === entryId);
		if (!entry) throw Object.assign(new Error('That player is not in this bracket'), { status: 400 });
		placeEntryInSlot(store, t, entry, seat);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/reset-match', withStore((store, request) => {
		const t = hostedArena(store, request);
		const blocked = swapBlockReason(t);
		if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		resetMatchTree(store, t, match);
		collapseVacantMatches(store, t);
		maybeFinishOrAdvance(store, t);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/round-rules', withStore((store, request) => {
		const t = hostedArena(store, request);
		const body = request.body || {};
		if (body.bestOf != null) t.bestOf = normalizeBestOf(body.bestOf, t.bestOf);
		if (body.roundBestOf) t.roundBestOf = { ...t.roundBestOf, ...sanitizeRoundBestOf(body.roundBestOf) };
		if (Object.prototype.hasOwnProperty.call(body, 'finalsBestOf')) {
			t.finalsBestOf = sanitizeFinalsBestOf(body.finalsBestOf);
		}
		for (const match of store.matches.filter((m) => m.tournamentId === t.id)) {
			if (match.status === 'complete' || match.status === 'bye') continue;
			match.bestOf = bestOfFor(t, match.side, match.round, match);
		}
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/games', withStore((store, request) => {
		const t = hostedArena(store, request);
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		saveGames(store, match, request.body && request.body.games, request.body && request.body.bestOf);
		return detail(store, t, true);
	}));

	router.post('/arenas/:slug/report', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const asHost = canManageArena(dataDir, request, t);
		const session = sessionFrom(request);
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		if (request.body && request.body.bestOf && match.status !== 'complete' && match.status !== 'bye') {
			match.bestOf = normalizeBestOf(request.body.bestOf, match.bestOf);
		}
		const games = request.body && request.body.games;
		let score1 = Number(request.body && request.body.score1);
		let score2 = Number(request.body && request.body.score2);
		if (Array.isArray(games) && games.length && (!Number.isFinite(score1) || !Number.isFinite(score2))) {
			const tally = tallyGames(games.map((game) => ({ winnerSlot: Number(game && game.winnerSlot) === 2 ? 2 : 1 })));
			score1 = tally.s1;
			score2 = tally.s2;
		}
		if (asHost) {
			match.reportProposal = null;
			reportMatch(store, match, score1, score2, games);
			if (request.body && request.body.reason) match.reportReason = String(request.body.reason).trim().slice(0, 160);
			maybeFinishOrAdvance(store, t);
			return detail(store, t, true, request);
		}
		if (!session) throw Object.assign(new Error('Sign in with Discord to report this match'), { status: 401 });
		const seated = store.entries.find((e) => (
			e.tournamentId === t.id
			&& sessionOwnsSeat(session, e)
			&& (Number(e.id) === Number(match.entry1Id) || Number(e.id) === Number(match.entry2Id))
		));
		if (!seated) throw Object.assign(new Error('Only the seated players or the host can report this match'), { status: 403 });
		const proposal = match.reportProposal;
		const sameScore = proposal
			&& Number(proposal.score1) === score1
			&& Number(proposal.score2) === score2;
		if (proposal && Number(proposal.byEntryId) !== Number(seated.id) && sameScore) {
			match.reportProposal = null;
			reportMatch(store, match, score1, score2, games || proposal.games);
			maybeFinishOrAdvance(store, t);
			return detail(store, t, false, request);
		}
		match.reportProposal = {
			byEntryId: seated.id,
			score1,
			score2,
			games: Array.isArray(games) ? games : [],
			at: new Date().toISOString(),
		};
		return detail(store, t, false, request);
	}));

	router.post('/arenas/:slug/table-lock', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const asHost = canManageArena(dataDir, request, t);
		const matchId = Number(request.body && request.body.matchId);
		const match = store.matches.find((m) => m.tournamentId === t.id && m.id === matchId);
		if (!match) throw Object.assign(new Error('Match not found'), { status: 404 });
		const body = request.body || {};
		const s1 = Number(body.score1);
		const s2 = Number(body.score2);
		if (body.bestOf && match.status !== 'complete' && match.status !== 'bye') {
			match.bestOf = normalizeBestOf(body.bestOf, match.bestOf);
		}
		if (!asHost) {
			request.body = { ...body, score1: s1, score2: s2 };
			const session = sessionFrom(request);
			const seated = store.entries.find((e) => (
				e.tournamentId === t.id
				&& sessionOwnsSeat(session, e)
				&& (Number(e.id) === Number(match.entry1Id) || Number(e.id) === Number(match.entry2Id))
			));
			if (!seated) throw Object.assign(new Error('Only the seated players or the host can lock this table'), { status: 403 });
			if (!(Number.isFinite(s1) && Number.isFinite(s2))) {
				throw Object.assign(new Error('Enter both game scores'), { status: 400 });
			}
			const proposal = match.reportProposal;
			const sameScore = proposal && Number(proposal.score1) === s1 && Number(proposal.score2) === s2;
			if (proposal && Number(proposal.byEntryId) !== Number(seated.id) && sameScore) {
				match.reportProposal = null;
				reportMatch(store, match, s1, s2, body.games || proposal.games);
				maybeFinishOrAdvance(store, t);
				return detail(store, t, false, request);
			}
			match.reportProposal = {
				byEntryId: seated.id,
				score1: s1,
				score2: s2,
				games: Array.isArray(body.games) ? body.games : [],
				at: new Date().toISOString(),
			};
			return detail(store, t, false, request);
		}
		if (Number.isFinite(s1) && Number.isFinite(s2)) {
			match.reportProposal = null;
			reportMatch(store, match, s1, s2, body.games);
			maybeFinishOrAdvance(store, t);
			return detail(store, t, true, request);
		}
		const winnerId = Number(body.winnerId);
		if (winnerId !== match.entry1Id && winnerId !== match.entry2Id) {
			throw Object.assign(new Error('Pick a player in this match'), { status: 400 });
		}
		const need = winsNeeded(match.bestOf);
		const winnerSlot = winnerId === match.entry1Id ? 1 : 2;
		const games = Array.from({ length: need }, () => ({ winnerSlot }));
		match.reportProposal = null;
		reportMatch(store, match, winnerSlot === 1 ? need : 0, winnerSlot === 2 ? need : 0, games);
		maybeFinishOrAdvance(store, t);
		return detail(store, t, true, request);
	}));

	router.post('/arenas/:slug/settings', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		if (!canManageArena(dataDir, request, t)) {
			if (!canEditStream(dataDir, request, t)) {
				throw Object.assign(new Error('You can only change tournaments you created.'), { status: 403 });
			}
			if (request.body && request.body.streamUrl != null) {
				t.streamUrl = sanitizeKickStream(request.body.streamUrl);
			}
			return detail(store, t, false, request);
		}
		const next = keepCreator(t, readSettings(request.body, t));
		Object.assign(t, next);
		t.slug = request.params.slug;
		t.id = next.id;
		return detail(store, t, true, request);
	}));

	router.post('/arenas/:slug/staff', withStore((store, request) => {
		const t = hostedArena(store, request);
		const access = assertCanManageArena(dataDir, request, t);
		if (access.role === 'judge') {
			throw Object.assign(new Error('Only the owner can assign judge and stream roles'), { status: 403 });
		}
		const body = request.body || {};
		const role = body.role === 'stream' ? 'stream' : 'judge';
		const key = role === 'stream' ? 'streamUserIds' : 'judgeUserIds';
		const ids = eventPhase.sanitizeUserIdList(t[key]);
		const db = records.getDb();
		let userId = Number(body.userId);
		if (!(userId > 0) && db && typeof authDex.findUserForHostGrant === 'function') {
			const row = authDex.findUserForHostGrant(db, body);
			userId = row ? Number(row.user_id) : 0;
		}
		if (!(userId > 0)) throw Object.assign(new Error('Pick a Discord-linked account'), { status: 404 });
		if (body.remove) t[key] = ids.filter((id) => id !== userId);
		else if (!ids.includes(userId)) t[key] = ids.concat([userId]);
		else t[key] = ids;
		return detail(store, t, true, request);
	}));

	router.post('/arenas/:slug/assign-host', withStore((store, request) => {
		assertAdminRequest(dataDir, request);
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const db = records.getDb();
		if (!db || typeof authDex.findUserForHostGrant !== 'function') {
			throw Object.assign(new Error('Account database unavailable.'), { status: 503 });
		}
		const row = authDex.findUserForHostGrant(db, request.body || {});
		if (!row) throw Object.assign(new Error('Pick a Discord-linked account'), { status: 404 });
		applyArenaHost(t, row);
		if (typeof authDex.setTourneyHost === 'function') {
			try { authDex.setTourneyHost(db, row.user_id, true, null); } catch (_err) { /* ownership still moves */ }
		}
		return detail(store, t, true, request);
	}));

	router.post('/arenas/:slug/check-in', withStore((store, request) => {
		const t = store.tournaments.find((row) => row.slug === request.params.slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		const body = request.body || {};
		const asHost = canManageArena(dataDir, request, t);
		const session = sessionFrom(request);
		const ids = Array.isArray(body.entryIds) ? body.entryIds.map(Number) : [];
		const handle = String(body.handle || '').trim().toLowerCase();
		let n = 0;
		for (const entry of store.entries.filter((e) => e.tournamentId === t.id)) {
			const hit = ids.includes(entry.id) || (handle && entry.handle.toLowerCase() === handle);
			if (!hit) continue;
			if (!asHost && !sessionMatchesEntry(session, entry)) {
				throw Object.assign(new Error('You can only check yourself in'), { status: 403 });
			}
			if (asHost && body.noShow) {
				entry.noShow = true;
				entry.checkedIn = false;
				entry.status = 'no_show';
			} else {
				entry.checkedIn = body.checkedIn !== false;
				if (entry.checkedIn && entry.noShow) {
					entry.noShow = false;
					entry.status = entryStatus(entry);
				}
			}
			n += 1;
		}
		if (!n) throw Object.assign(new Error('No matching participants to check in'), { status: 400 });
		return detail(store, t, asHost);
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
		return detail(store, t, canManageArena(dataDir, request, t));
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
		return detail(store, t, canManageArena(dataDir, request, t));
	}));

	const removeArena = withStore((store, request) => {
		assertAdminRequest(dataDir, request);
		const slug = String((request.body && request.body.slug) || request.body.arena || '').trim();
		const t = store.tournaments.find((row) => row.slug === slug);
		if (!t) throw Object.assign(new Error('Arena not found'), { status: 404 });
		removeTournament(store, t);
		arenaChat.removeRoom(dataDir, t.slug);
		return { ok: true, removed: slug };
	});
	const purgeDemos = withStore((store, request) => {
		assertAdminRequest(dataDir, request);
		const before = new Set(store.tournaments.map((row) => row.slug));
		stripDemoTournaments(store);
		for (const slug of before) {
			if (!store.tournaments.some((row) => row.slug === slug)) arenaChat.removeRoom(dataDir, slug);
		}
		return { ok: true, removed: before.size - store.tournaments.length };
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
			duelists: [],
			mentions: [],
			ledgers: [],
			badges: [],
			awards: [],
			stats: { total: 0, duels: 0, tournaments: 0, official: 0 },
			warning: 'The records ledger is offline right now.',
		};
	}

	router.get('/players/search', (request, response) => {
		try {
			assertGrantedHostOrAdmin(dataDir, request);
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

	router.get('/records', async (_request, response) => {
		let db = records.getDb();
		if (!db && typeof authDex.openAuthDatabase === 'function') {
			try {
				db = await authDex.openAuthDatabase();
				if (db && typeof records.ensureSchemaOnce === 'function') records.ensureSchemaOnce(db);
				else if (db && typeof records.ensureSchema === 'function') records.ensureSchema(db);
			} catch (err) {
				console.error('[tourney] records open:', err && err.message ? err.message : err);
			}
		}
		if (db) {
			try {
				if (typeof records.seedHallIfEmpty === 'function') records.seedHallIfEmpty(db);
			} catch (err) {
				console.error('[tourney] records seed:', err && err.message ? err.message : err);
			}
			setImmediate(() => {
				loadLiveStore()
					.then((store) => {
						try { persistStore(store); } catch (_err) {}
					})
					.catch((err) => {
						console.error('[tourney] records seal:', err && err.message ? err.message : err);
					});
			});
			response.set('Cache-Control', 'no-store, private');
			response.json({ ok: true, ...records.hallOfFame(db, 80) });
			return;
		}
		const seeded = typeof records.hallFromSeed === 'function' ? records.hallFromSeed() : null;
		if (seeded) {
			response.set('Cache-Control', 'no-store, private');
			response.json({ ok: true, ...seeded });
			return;
		}
		response.json(emptyHall());
	});

	router.get('/records/awards', (_request, response) => {
		const db = records.getDb();
		if (!db) {
			response.json({ ok: true, awards: [] });
			return;
		}
		response.json({ ok: true, awards: records.listAwards(db) });
	});

	router.post('/records/restore-arenas', withStore((store, request) => {
		assertAdminRequest(dataDir, request);
		const db = records.getDb();
		if (!db) {
			throw Object.assign(new Error('Records database unavailable'), { status: 503 });
		}
		const fromArchive = persist.restoreMissingFromArchive(store, db, { includeIdle: true });
		const recovered = restoreMissingArenasFromRecords(store, db);
		repairKnownBracketHistory(store);
		persist.persistLiveStore(db, store, {
			skipTournament: (t) => isDemoTournament(store, t),
		});
		const sealed = records.backfillWithFns(db, store, isDemoTournament, podiumFor, standingsFor);
		return {
			ok: true,
			restored: Number(fromArchive && fromArchive.restored) + Number(recovered && recovered.restored),
			upgraded: Number(fromArchive && fromArchive.upgraded) || 0,
			snapshots: recovered.snapshots || 0,
			sealed: Number(sealed && (sealed.inserted || 0)) + Number(sealed && (sealed.updated || 0)),
			arenas: (store.tournaments || []).length,
			archive: persist.stats(db),
		};
	}));

	router.post('/records/host', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
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
		const t = hostedArena(store, request);
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

	router.get('/records/health', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
		} catch (err) {
			response.status(err.status || 403).json({ error: err.message });
			return;
		}
		const db = records.getDb();
		const store = loadStore(storeFile);
		const richness = persist.storeRichness(store);
		const archive = persist.stats(db);
		const backups = persist.backupInventory(storeFile);
		const gaps = persist.sealGaps(db, store);
		let hydratedRichness = null;
		if (db) {
			try {
				const hydrated = persist.hydrateStore(db);
				if (hydrated) hydratedRichness = persist.storeRichness(hydrated);
			} catch (_err) {}
		}
		response.json({
			ok: true,
			sqliteReady: Boolean(db),
			live: richness,
			blob: hydratedRichness,
			archive,
			backups,
			sealGaps: gaps,
			tight: gaps.length === 0 && archive.blob && archive.events >= richness.completed,
		});
	});

	router.post('/control/backfill-results', (request, response) => {
		try {
			assertAdminRequest(dataDir, request);
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
		persist.persistLiveStore(db, store, {
			skipTournament: (t) => isDemoTournament(store, t),
		});
		const backups = persist.rotateTimestampedBackups(storeFile, {
			force: true,
			sqlitePath: persist.sqlitePathNear(storeFile),
			database: db,
		});
		const sealed = records.backfillWithFns(db, store, isDemoTournament, podiumFor, standingsFor);
		if (sealed && sealed.stamped) saveStore(storeFile, store);
		response.json({
			...sealed,
			archive: persist.stats(db),
			backups,
			sealGaps: persist.sealGaps(db, store),
			inventory: persist.backupInventory(storeFile),
		});
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

	if (dogeWatchEnabled) {
		const ms = Math.max(8000, Number(dogeWatchOpts.intervalMs) || 30000);
		let watchBusy = false;
		const tick = async () => {
			if (watchBusy) return;
			watchBusy = true;
			try {
				const snapshot = loadStore(storeFile);
				if (!pendingWatchEntries(snapshot).length) return;
				const addresses = [...new Set(pendingWatchEntries(snapshot).map((entry) => {
					const t = (snapshot.tournaments || []).find((row) => row.id === entry.tournamentId);
					return entry.payTo || treasuryAddress(t);
				}).filter(Boolean))];
				let txs = [];
				for (const address of addresses) {
					txs = txs.concat(await incomingFor(address, {}) || []);
				}
				const live = loadStore(storeFile);
				const grouped = new Map();
				for (const entry of pendingWatchEntries(live)) {
					const t = (live.tournaments || []).find((row) => row.id === entry.tournamentId);
					const key = t ? t.id : 0;
					if (!grouped.has(key)) grouped.set(key, { tournament: t, entries: [] });
					grouped.get(key).entries.push(entry);
				}
				let changed = 0;
				const minConf = dogePayWatch.minConfirmationsFromEnv();
				for (const group of grouped.values()) {
					const result = dogePayWatch.applyIncomingPayments(group.entries, txs, {
						payTo: treasuryAddress(group.tournament),
						minConfirmations: minConf,
						tournament: group.tournament,
					});
					changed += dogePayWatch.applyMatchResult(live.entries, result);
					if (result.confirmed.length) {
						console.log('[doge-watch] confirmed', result.confirmed.map((row) => row.entry.handle).join(', '));
					}
				}
				if (changed) saveStore(storeFile, live);
			} catch (err) {
				console.error('[doge-watch]', err && err.message ? err.message : err);
			} finally {
				watchBusy = false;
			}
		};
		router._dogeWatchTimer = setInterval(() => { tick(); }, ms);
		if (typeof router._dogeWatchTimer.unref === 'function') router._dogeWatchTimer.unref();
		const starter = setTimeout(() => { tick(); }, 8000);
		if (starter && typeof starter.unref === 'function') starter.unref();
	}

	return router;
}

const TOOL_TITLE = 'Legends Brackets — DDL fight night';
const TOOL_DESCRIPTION = 'Official DDL nights. Discord seats, DOGE entry, live brackets, IRL table.';

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
		|| 'legendsbrackets.com'
	).split(',')[0].trim() || 'legendsbrackets.com';
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
	const kind = sanitizeEventKind(tournament.eventKind, tournament.name);
	const extra = String(tournament.description || '').trim()
		|| (kind === 'grand'
			? (looksLikeGrandTournament(tournament.name)
				? `${name} — inaugural Grand Tournament and first official IRL event for Doginal Dogs Legends TCG.`
				: `${name} — Grand Tournament on ${TOOL_TITLE}.`)
			: `${name} — ${tournament.game || 'Doginal Dogs Legends TCG'} on ${TOOL_TITLE}.`);
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
	out = replaceNamedMeta(out, 'property', 'og:image:alt', meta.imageAlt || 'Doginal Dogs Legends Brackets');
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
	const title = found ? found.title : 'Doginal Dogs Legends Brackets';
	const description = found ? found.description : TOOL_DESCRIPTION;
	const url = found
		? `${origin}/tourney/?t=${encodeURIComponent(found.slug)}`
		: `${origin}/tourney/`;
	const image = `${origin}/tourney-api/share.jpg?v=3`;
	html = applyShareMeta(html, {
		title,
		description,
		url,
		image,
		imageAlt: 'Doginal Dogs Legends Brackets',
	});
	response.set({
		'Cache-Control': 'no-store, private',
		'Content-Type': 'text/html; charset=utf-8',
	});
	response.send(html);
}

createRouter.sendAppPage = sendAppPage;
createRouter.TOOL_TITLE = TOOL_TITLE;
createRouter.createIrlSeatGuard = createIrlSeatGuard;
createRouter.loadStore = loadStore;
createRouter.normalizeStore = normalizeStore;
createRouter.standingsFor = standingsFor;
createRouter.podiumFor = podiumFor;
createRouter.isDemoTournament = isDemoTournament;
createRouter.storeHasArenas = storeHasArenas;

module.exports = createRouter;
