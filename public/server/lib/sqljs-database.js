'use strict';

const fs = require('fs');
const path = require('path');

function atomicWrite(filePath, buffer) {
	const dir = path.dirname(filePath);
	const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
	fs.writeFileSync(tmp, buffer);
	try {
		fs.renameSync(tmp, filePath);
	} catch (_err) {
		fs.copyFileSync(tmp, filePath);
		try { fs.unlinkSync(tmp); } catch (_e) {}
	}
}

function sqliteHeaderOk(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 16 && buf.slice(0, 15).toString('utf8') === 'SQLite format 3';
}

function bindValues(params) {
	return (params || []).map((value) => (value === undefined ? null : value));
}

class SqlJsStatement {
	constructor(database, sql) {
		this._database = database;
		this._sql = sql;
	}

	get(...params) {
		const stmt = this._database.db.prepare(this._sql);
		try {
			const values = bindValues(params);
			if (values.length) stmt.bind(values);
			if (!stmt.step()) return undefined;
			return stmt.getAsObject();
		} finally {
			stmt.free();
		}
	}

	all(...params) {
		const stmt = this._database.db.prepare(this._sql);
		const rows = [];
		try {
			const values = bindValues(params);
			if (values.length) stmt.bind(values);
			while (stmt.step()) rows.push(stmt.getAsObject());
			return rows;
		} finally {
			stmt.free();
		}
	}

	run(...params) {
		const values = bindValues(params);
		if (values.length) this._database.db.run(this._sql, values);
		else this._database.db.run(this._sql);
		const changes = this._database.db.getRowsModified();
		const lastInsertRowid = this._database.lastInsertRowid();
		this._database.afterWrite();
		return { lastInsertRowid, changes };
	}
}

class SqlJsDatabase {
	constructor(db, filePath) {
		this.db = db;
		this.filePath = filePath;
		this._engine = 'sql.js';
		this._inTx = 0;
		this._dirty = false;
	}

	prepare(sql) {
		return new SqlJsStatement(this, sql);
	}

	exec(sql) {
		this.db.exec(sql);
		this.afterWrite();
		return this;
	}

	pragma(src) {
		try {
			this.db.exec(`PRAGMA ${src}`);
		} catch (_err) {}
		return this;
	}

	transaction(fn) {
		const self = this;
		return function runTx(...args) {
			self.db.run('BEGIN');
			self._inTx += 1;
			try {
				const result = fn.apply(this, args);
				self.db.run('COMMIT');
				self._inTx -= 1;
				self.afterWrite();
				return result;
			} catch (err) {
				try { self.db.run('ROLLBACK'); } catch (_e) {}
				self._inTx = Math.max(0, self._inTx - 1);
				throw err;
			}
		};
	}

	lastInsertRowid() {
		const result = this.db.exec('SELECT last_insert_rowid() AS id');
		if (!result.length || !result[0].values.length) return 0;
		return result[0].values[0][0];
	}

	afterWrite() {
		this._dirty = true;
		if (this._inTx) return;
		this.persist();
	}

	persist() {
		if (!this._dirty || !this.filePath) return;
		atomicWrite(this.filePath, Buffer.from(this.db.export()));
		this._dirty = false;
	}

	close() {
		this.persist();
		this.db.close();
	}
}

async function loadSqlEngine() {
	const distDir = path.dirname(require.resolve('sql.js'));
	try {
		const initSqlJs = require('sql.js');
		return await initSqlJs({
			locateFile: (file) => path.join(distDir, file),
		});
	} catch (wasmErr) {
		let initAsm;
		try {
			initAsm = require('sql.js/dist/sql-asm.js');
		} catch (_e) {
			throw wasmErr;
		}
		return await initAsm();
	}
}

async function openSqlJsDatabase(dbPath) {
	const SQL = await loadSqlEngine();
	let db;
	if (fs.existsSync(dbPath)) {
		const buf = fs.readFileSync(dbPath);
		if (sqliteHeaderOk(buf)) {
			try {
				db = new SQL.Database(buf);
			} catch (err) {
				console.warn('[auth-dex] sqlite file unreadable, starting empty:', err && err.message ? err.message : err);
				db = new SQL.Database();
			}
		} else {
			db = new SQL.Database();
		}
	} else {
		db = new SQL.Database();
	}
	const wrapped = new SqlJsDatabase(db, dbPath);
	wrapped.persist();
	return wrapped;
}

module.exports = {
	SqlJsDatabase,
	openSqlJsDatabase,
};
