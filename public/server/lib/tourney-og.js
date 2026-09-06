'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CARD_W = 1200;
const CARD_H = 630;
const CREST_SIZE = 268;
const GAP = 36;
const TEXT_MAX = 720;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i += 1) {
		crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const typeBuf = Buffer.from(type, 'ascii');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const crcSrc = Buffer.concat([typeBuf, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(crcSrc), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
	const stride = 1 + width * 4;
	const raw = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y += 1) {
		const dst = y * stride;
		raw[dst] = 0;
		rgba.copy(raw, dst + 1, y * width * 4, (y + 1) * width * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

function loadRgbaGz(filePath) {
	return zlib.gunzipSync(fs.readFileSync(filePath));
}

function blit(dst, dw, dh, src, sw, sh, dx, dy) {
	for (let y = 0; y < sh; y += 1) {
		const ty = dy + y;
		if (ty < 0 || ty >= dh) continue;
		for (let x = 0; x < sw; x += 1) {
			const tx = dx + x;
			if (tx < 0 || tx >= dw) continue;
			const si = (y * sw + x) * 4;
			const a = src[si + 3];
			if (!a) continue;
			const di = (ty * dw + tx) * 4;
			if (a === 255) {
				src.copy(dst, di, si, si + 4);
				continue;
			}
			const inv = 255 - a;
			dst[di] = (src[si] * a + dst[di] * inv + 127) / 255;
			dst[di + 1] = (src[si + 1] * a + dst[di + 1] * inv + 127) / 255;
			dst[di + 2] = (src[si + 2] * a + dst[di + 2] * inv + 127) / 255;
			dst[di + 3] = 255;
		}
	}
}

function blitScaled(dst, dw, dh, src, sw, sh, dx, dy, scale, tint) {
	if (scale === 1 && !tint) {
		blit(dst, dw, dh, src, sw, sh, dx, dy);
		return { w: sw, h: sh };
	}
	const tw = Math.max(1, Math.round(sw * scale));
	const th = Math.max(1, Math.round(sh * scale));
	for (let y = 0; y < th; y += 1) {
		const sy = Math.min(sh - 1, Math.floor(y / scale));
		const ty = dy + y;
		if (ty < 0 || ty >= dh) continue;
		for (let x = 0; x < tw; x += 1) {
			const sx = Math.min(sw - 1, Math.floor(x / scale));
			const tx = dx + x;
			if (tx < 0 || tx >= dw) continue;
			const si = (sy * sw + sx) * 4;
			const a = src[si + 3];
			if (!a) continue;
			const di = (ty * dw + tx) * 4;
			const sr = tint ? tint[0] : src[si];
			const sg = tint ? tint[1] : src[si + 1];
			const sb = tint ? tint[2] : src[si + 2];
			if (a === 255) {
				dst[di] = sr;
				dst[di + 1] = sg;
				dst[di + 2] = sb;
				dst[di + 3] = 255;
			} else {
				const inv = 255 - a;
				dst[di] = (sr * a + dst[di] * inv + 127) / 255;
				dst[di + 1] = (sg * a + dst[di + 1] * inv + 127) / 255;
				dst[di + 2] = (sb * a + dst[di + 2] * inv + 127) / 255;
				dst[di + 3] = 255;
			}
		}
	}
	return { w: tw, h: th };
}

let cachedAssets = null;

function loadAssets(assetsDir) {
	if (cachedAssets && cachedAssets.dir === assetsDir) return cachedAssets;
	const glyphs = JSON.parse(fs.readFileSync(path.join(assetsDir, 'glyphs.json'), 'utf8'));
	const crestMeta = JSON.parse(fs.readFileSync(path.join(assetsDir, 'crest.json'), 'utf8'));
	cachedAssets = {
		dir: assetsDir,
		base: loadRgbaGz(path.join(assetsDir, 'base.rgba.gz')),
		crest: loadRgbaGz(path.join(assetsDir, 'crest.rgba.gz')),
		atlas: loadRgbaGz(path.join(assetsDir, 'glyphs.rgba.gz')),
		glyphs,
		crestMeta,
	};
	return cachedAssets;
}

function glyphFor(assets, ch) {
	return assets.glyphs.glyphs[ch] || assets.glyphs.glyphs['?'] || null;
}

function measureLine(assets, text, scale) {
	let w = 0;
	let h = 0;
	for (const ch of String(text || '')) {
		const g = glyphFor(assets, ch);
		if (!g) continue;
		w += g.advance * scale;
		h = Math.max(h, g.h * scale);
	}
	return { w, h };
}

function fitScale(assets, text, maxWidth, start, floor) {
	let scale = start;
	while (scale > floor) {
		if (measureLine(assets, text, scale).w <= maxWidth) return scale;
		scale -= 0.02;
	}
	return floor;
}

function wrapLine(assets, text, scale, maxWidth) {
	const words = String(text || '').trim().split(/\s+/).filter(Boolean);
	if (!words.length) return [''];
	const lines = [];
	let current = words[0];
	for (let i = 1; i < words.length; i += 1) {
		const trial = `${current} ${words[i]}`;
		if (measureLine(assets, trial, scale).w <= maxWidth) current = trial;
		else {
			lines.push(current);
			current = words[i];
		}
	}
	lines.push(current);
	return lines.slice(0, 3);
}

function drawLine(dst, assets, text, x, y, scale, tint) {
	let cx = x;
	const atlas = assets.atlas;
	const aw = assets.glyphs.width;
	for (const ch of String(text || '')) {
		const g = glyphFor(assets, ch);
		if (!g) continue;
		const tile = Buffer.alloc(g.w * g.h * 4);
		for (let row = 0; row < g.h; row += 1) {
			const srcStart = (row * aw + g.x) * 4;
			atlas.copy(tile, row * g.w * 4, srcStart, srcStart + g.w * 4);
		}
		blitScaled(dst, CARD_W, CARD_H, tile, g.w, g.h, Math.round(cx), Math.round(y), scale, tint);
		cx += g.advance * scale;
	}
	return measureLine(assets, text, scale);
}

function encodeImage(width, height, rgba) {
	try {
		const jpeg = require('jpeg-js');
		return { buffer: jpeg.encode({ data: rgba, width, height }, 88).data, type: 'image/jpeg' };
	} catch (_err) {
		return { buffer: encodePng(width, height, rgba), type: 'image/png' };
	}
}

function renderCard(options) {
	const assets = loadAssets(options.assetsDir);
	const dst = Buffer.from(assets.base);
	const kicker = String(options.kicker || 'DDL Tourney').toUpperCase();
	const title = String(options.title || 'Legends Bracket').toUpperCase();
	let titleScale = fitScale(assets, title, TEXT_MAX, 0.78, 0.34);
	let lines = wrapLine(assets, title, titleScale, TEXT_MAX);
	if (lines.length > 1) {
		const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b));
		titleScale = fitScale(assets, longest, TEXT_MAX, Math.min(0.64, titleScale), 0.32);
		lines = wrapLine(assets, title, titleScale, TEXT_MAX);
	}
	const kickerScale = 0.3;
	const kickerSize = kicker ? measureLine(assets, kicker, kickerScale) : { w: 0, h: 0 };
	const lineSizes = lines.map((line) => measureLine(assets, line, titleScale));
	const textW = Math.max(kickerSize.w, ...lineSizes.map((s) => s.w));
	const textH = (kicker ? kickerSize.h + 14 : 0)
		+ lineSizes.reduce((sum, s) => sum + s.h, 0)
		+ Math.max(0, lines.length - 1) * 8;
	const lockupW = CREST_SIZE + GAP + textW;
	const lockupH = Math.max(CREST_SIZE, textH);
	const x0 = Math.round((CARD_W - lockupW) / 2);
	const y0 = Math.round((CARD_H - lockupH) / 2);
	blit(
		dst,
		CARD_W,
		CARD_H,
		assets.crest,
		assets.crestMeta.width || CREST_SIZE,
		assets.crestMeta.height || CREST_SIZE,
		x0,
		y0 + Math.round((lockupH - CREST_SIZE) / 2)
	);
	let tx = x0 + CREST_SIZE + GAP;
	let ty = y0 + Math.round((lockupH - textH) / 2);
	if (kicker) {
		drawLine(dst, assets, kicker, tx, ty, kickerScale, [232, 163, 23]);
		ty += kickerSize.h + 14;
	}
	for (let i = 0; i < lines.length; i += 1) {
		const size = drawLine(dst, assets, lines[i], tx, ty, titleScale);
		ty += size.h + 8;
	}
	return encodeImage(CARD_W, CARD_H, dst);
}

function cacheKey(slug, title) {
	return `${String(slug || 'home').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}-${Buffer.from(String(title || '')).toString('hex').slice(0, 16)}`;
}

function render(options) {
	const image = renderCard(options);
	const cacheDir = options.cacheDir;
	if (cacheDir && image && image.buffer) {
		try {
			fs.mkdirSync(cacheDir, { recursive: true });
			const ext = image.type === 'image/jpeg' ? 'jpg' : 'png';
			fs.writeFileSync(path.join(cacheDir, `${cacheKey(options.slug, options.title)}.${ext}`), image.buffer);
		} catch (_err) { /* cache is optional */ }
	}
	return image;
}

function tryRender(options) {
	try {
		return render(options);
	} catch (_err) {
		return null;
	}
}

module.exports = {
	render,
	tryRender,
	CARD_W,
	CARD_H,
};
