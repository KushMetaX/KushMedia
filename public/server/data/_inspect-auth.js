'use strict';
const fs = require('fs');
const path = require('path');
const init = require('sql.js');

(async () => {
	const SQL = await init();
	const file = path.join(__dirname, 'doginaldex.sqlite');
	const db = new SQL.Database(fs.readFileSync(file));
	const schema = db.exec("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index')");
	for (const row of (schema[0] && schema[0].values) || []) {
		const name = String(row[0]);
		if (!/user|oauth|session|ddl/i.test(name)) continue;
		console.log('---', name);
		console.log(row[1]);
	}
	const q = (sql) => {
		const r = db.exec(sql);
		console.log(sql, JSON.stringify(r));
	};
	q("SELECT COUNT(*) FROM users");
	q("SELECT COUNT(*) FROM users WHERE discord_id IS NOT NULL AND discord_id != ''");
	q("SELECT COUNT(*) FROM sessions");
	try { q("SELECT COUNT(*) FROM oauth_states"); } catch (e) { console.log('oauth_states', e.message); }
	try { q("SELECT name FROM sqlite_master WHERE name LIKE 'ddl%'"); } catch (e) { console.log(e.message); }
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
