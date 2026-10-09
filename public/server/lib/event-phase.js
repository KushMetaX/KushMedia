'use strict';

/**
 * Display phase for an arena. Stored status stays registration | in_progress | completed.
 * Phase is what the lobby shows: Registration → Check-in → Live → Complete.
 */

const { eventStartMs, DEFAULT_TIMEZONE } = require('../../../bracket/event-time');

function nowMs(now) {
	if (now instanceof Date) return now.getTime();
	if (typeof now === 'number' && Number.isFinite(now)) return now;
	return Date.now();
}

/** Scrim marker for badges / copy. List visibility uses official flag only. */
function isTestOrScrim(tournament) {
	if (!tournament) return false;
	if (tournament.official === false) return true;
	const kind = String(tournament.eventKind || tournament.kind || '').toLowerCase();
	return kind === 'test' || kind === 'scrim';
}

function parseStartMs(tournament) {
	return eventStartMs(tournament && tournament.startAt, tournament && tournament.timezone);
}

function phaseOf(tournament, now) {
	const t = tournament || {};
	const clock = nowMs(now);
	if (t.status === 'completed') return 'complete';
	if (t.status === 'in_progress') return 'live';
	if (t.status === 'registration' && t.requireCheckIn) {
		const start = parseStartMs(t);
		if (Number.isFinite(start) && clock >= start) return 'check_in';
	}
	return 'registration';
}

function listsDueMs(tournament) {
	const raw = tournament && tournament.listsDueAt;
	if (!raw) return NaN;
	return eventStartMs(raw, tournament && tournament.timezone);
}

function listsLocked(tournament, now) {
	const t = tournament || {};
	if (t.status === 'completed' || t.status === 'in_progress') return true;
	const due = listsDueMs(t);
	if (Number.isFinite(due) && nowMs(now) >= due) return true;
	return false;
}

function listsPublic(tournament) {
	const t = tournament || {};
	if (t.listsPublicReveal) return true;
	if (t.status === 'completed' && (t.listsRevealOnComplete || t.listsPublicReveal)) return true;
	return false;
}

function scheduleView(tournament, now) {
	const t = tournament || {};
	const tz = String(t.timezone || DEFAULT_TIMEZONE);
	const clock = nowMs(now);
	const start = parseStartMs(t);
	const phase = phaseOf(t, clock);
	let when = 'TBD';
	let relative = '';
	if (Number.isFinite(start)) {
		try {
			when = new Intl.DateTimeFormat('en-US', {
				timeZone: tz,
				dateStyle: 'medium',
				timeStyle: 'short',
			}).format(new Date(start));
		} catch (_err) {
			when = new Date(start).toISOString();
		}
		if (t.startTentative) when += ' (tentative)';
		if (phase === 'complete') relative = 'ended';
		else if (phase === 'live') relative = 'started';
		else if (clock >= start) relative = 'started';
		else {
			const mins = Math.max(1, Math.round((start - clock) / 60000));
			if (mins < 60) relative = `starts in ${mins} min`;
			else if (mins < 60 * 48) relative = `starts in ${Math.round(mins / 60)} hr`;
			else relative = `starts in ${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'}`;
		}
	} else if (phase === 'complete') {
		relative = 'ended';
	} else if (phase === 'live') {
		relative = 'started';
	}
	return {
		timezone: tz,
		startAt: t.startAt || null,
		startLabel: when,
		relative,
		tentative: Boolean(t.startTentative),
		phase,
	};
}

function nextPowerOfTwo(n) {
	const count = Math.max(0, Number(n) || 0);
	if (count < 2) return 2;
	return 2 ** Math.ceil(Math.log2(count));
}

function treeSizeForField(playerCount) {
	return nextPowerOfTwo(Math.max(2, Number(playerCount) || 0));
}

function sanitizeUserIdList(raw) {
	const src = Array.isArray(raw) ? raw : [];
	const out = [];
	const seen = new Set();
	for (const item of src) {
		const id = Number(item);
		if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function sanitizeFeeMode(value, usd) {
	if (value === 'charity') return Number(usd) > 0 ? 'charity' : 'free';
	if (value === 'free' || !(Number(usd) > 0)) return 'free';
	return 'paid';
}

module.exports = {
	isTestOrScrim,
	parseStartMs,
	phaseOf,
	listsDueMs,
	listsLocked,
	listsPublic,
	scheduleView,
	nextPowerOfTwo,
	treeSizeForField,
	sanitizeUserIdList,
	sanitizeFeeMode,
};
