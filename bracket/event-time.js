'use strict';

/**
 * Naive startAt values (datetime-local) are wall clocks in the arena timezone,
 * not the viewer's clock and not UTC. Date.parse() would use the machine zone
 * and shift Atlantic vs Eastern by an hour.
 *
 * Public UI always formats the instant in the viewer's zone with a UTC offset.
 * Hosts pick a zone so the wall clock they type is unambiguous.
 *
 * Keep this file in an IIFE. Top-level `const api` would collide with app.js
 * and blank the arenas SPA.
 */
(function (root) {
	const DEFAULT_TIMEZONE = 'America/New_York';

	function normalizeTimeZone(tz) {
		const raw = String(tz || '').trim();
		if (!raw) return '';
		return raw.replace(/\s+/g, '_');
	}

	function viewerTimeZone() {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
		} catch (_err) {
			return DEFAULT_TIMEZONE;
		}
	}

	function hostDefaultTimeZone() {
		const viewer = viewerTimeZone();
		if (viewer === 'UTC' || viewer === 'Europe/London') return viewer;
		if (String(viewer).indexOf('America/') === 0) return viewer;
		return DEFAULT_TIMEZONE;
	}

	function zoneOffsetMs(date, timeZone) {
		const tz = normalizeTimeZone(timeZone);
		if (!tz) return 0;
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			timeZoneName: 'longOffset',
		}).formatToParts(date);
		const name = String((parts.find((p) => p.type === 'timeZoneName') || {}).value || '').toUpperCase();
		if (name === 'GMT' || name === 'UTC') return 0;
		const match = name.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/);
		if (match) {
			const sign = match[1] === '-' ? -1 : 1;
			return sign * ((Number(match[2]) * 60 + Number(match[3] || 0)) * 60 * 1000);
		}
		const map = {};
		new Intl.DateTimeFormat('sv-SE', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		}).formatToParts(date).forEach((part) => {
			if (part.type !== 'literal') map[part.type] = part.value;
		});
		const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
		return asUtc - date.getTime();
	}

	function eventStartMs(startAt, timeZone) {
		const raw = String(startAt || '').trim();
		if (!raw) return NaN;
		const tz = normalizeTimeZone(timeZone) || DEFAULT_TIMEZONE;
		if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
			const ms = Date.parse(raw);
			return Number.isFinite(ms) ? ms : NaN;
		}
		const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
		if (!match) {
			const ms = Date.parse(raw);
			return Number.isFinite(ms) ? ms : NaN;
		}
		const year = +match[1];
		const month = +match[2];
		const day = +match[3];
		const hour = +match[4];
		const minute = +match[5];
		const second = +(match[6] || 0);
		const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
		let instant = asUtc;
		try {
			for (let i = 0; i < 4; i += 1) {
				instant = asUtc - zoneOffsetMs(new Date(instant), tz);
			}
			return instant;
		} catch (_err) {
			return asUtc;
		}
	}

	function zoneAbbr(date, timeZone) {
		try {
			const opts = { timeZoneName: 'short' };
			const tz = normalizeTimeZone(timeZone);
			if (tz) opts.timeZone = tz;
			const parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(date);
			return String((parts.find((p) => p.type === 'timeZoneName') || {}).value || '').replace(/^GMT/, 'UTC');
		} catch (_err) {
			return '';
		}
	}

	function utcOffsetLabel(date, timeZone) {
		const when = date instanceof Date ? date : new Date(date);
		if (Number.isNaN(when.getTime())) return '';
		const tz = normalizeTimeZone(timeZone) || viewerTimeZone();
		let offset = 0;
		try {
			offset = zoneOffsetMs(when, tz);
		} catch (_err) {
			offset = -when.getTimezoneOffset() * 60000;
		}
		const totalMin = Math.round(offset / 60000);
		const sign = totalMin >= 0 ? '+' : '\u2212';
		const abs = Math.abs(totalMin);
		const h = Math.floor(abs / 60);
		const m = abs % 60;
		return m ? `UTC${sign}${h}:${String(m).padStart(2, '0')}` : `UTC${sign}${h}`;
	}

	function formatViewerParts(ms) {
		if (!Number.isFinite(ms)) {
			return { date: '', time: '', offset: '', abbr: '', line: 'TBD' };
		}
		const d = new Date(ms);
		const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
		const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		const offset = utcOffsetLabel(d);
		const abbr = zoneAbbr(d);
		return {
			date,
			time,
			offset,
			abbr,
			line: [date, time, offset].filter(Boolean).join(' \u00b7 '),
		};
	}

	function offsetsMatch(eventTz, date) {
		const tz = normalizeTimeZone(eventTz);
		if (!tz) return true;
		try {
			const viewer = viewerTimeZone();
			const when = date || new Date();
			return zoneOffsetMs(when, tz) === zoneOffsetMs(when, viewer);
		} catch (_err) {
			return false;
		}
	}

	const lbEventTime = {
		DEFAULT_TIMEZONE,
		normalizeTimeZone,
		viewerTimeZone,
		hostDefaultTimeZone,
		zoneOffsetMs,
		eventStartMs,
		zoneAbbr,
		utcOffsetLabel,
		formatViewerParts,
		offsetsMatch,
	};
	if (typeof module === 'object' && module.exports) module.exports = lbEventTime;
	if (root) root.LBEventTime = lbEventTime;
})(typeof globalThis !== 'undefined' ? globalThis : this);
