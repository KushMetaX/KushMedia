'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walkJs(dir, acc = []) {
	for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, name.name);
		if (name.isDirectory()) {
			walkJs(p, acc);
		} else if (name.isFile() && p.endsWith('.js')) {
			acc.push(p);
		}
	}
	return acc;
}

const serverRoot = path.join(__dirname, '..', 'public', 'server');
const files = walkJs(serverRoot).sort();
for (const f of files) {
	execSync(`node --check "${f}"`, { stdio: 'inherit' });
}
process.stdout.write(`syntax ok: ${files.length} server file(s)\n`);
