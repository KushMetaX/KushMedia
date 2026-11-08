'use strict';

const fs = require('fs');
const path = require('path');

function atomicWrite(filePath, buffer) {
	const dir = path.dirname(filePath);
	const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
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

function generationPath(filePath) {
	return `${filePath}.gen`;
}

function readGeneration(filePath) {
	try {
		const n = Number(String(fs.readFileSync(generationPath(filePath), 'utf8')).trim());
		return Number.isFinite(n) && n > 0 ? n : 0;
	} catch (_err) {
		return 0;
	}
}

function lockPathFor(filePath) {
	return `${filePath}.lock`;
}

function sleepMs(ms) {
	const buf = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buf, 0, 0, ms);
}

/**
 * Passenger can run more than one Node process. sql.js keeps the database in
 * memory, so a session written by the Discord callback is invisible to the
 * next request unless every process reloads the file before it reads or writes.
 */
function acquireLock(filePath) {
	if (!filePath) return;
	const lockPath = lockPathFor(filePath);
	const start = Date.now();
	for (;;) {
		try {
			const fd = fs.openSync(lockPath, 'wx');
			try {
				fs.writeSync(fd, String(process.pid));
			} finally {
				fs.closeSync(fd);
			}
			return;
		} catch (err) {
			if (!err || err.code !== 'EEXIST') throw err;
			try {
				const st = fs.statSync(lockPath);
				if (Date.now() - st.mtimeMs > 8000) fs.unlinkSync(lockPath);
			} catch (_e) { /* lock disappeared */ }
			if (Date.now() - start > 8000) throw new Error('auth database is busy');
			sleepMs(20);
		}
	}
}

function releaseLock(filePath) {
	if (!filePath) return;
	try { fs.unlinkSync(lockPathFor(filePath)); } catch (_err) { /* already released */ }
}

class SqlJsStatement {
	constructor(database, sql) {
		this._database = database;
		this._sql = sql;
	}

	get(...params) {
		return this._database.withLock(() => {
			this._database.reloadIfNewer();
			const stmt = this._database.db.prepare(this._sql);
			try {
				const values = bindValues(params);
				if (values.length) stmt.bind(values);
				if (!stmt.step()) return undefined;
				return stmt.getAsObject();
			} finally {
				stmt.free();
			}
		});
	}

	all(...params) {
		return this._database.withLock(() => {
			this._database.reloadIfNewer();
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
		});
	}

	run(...params) {
		return this._database.withLock(() => {
			this._database.reloadIfNewer();
			const values = bindValues(params);
			if (values.length) this._database.db.run(this._sql, values);
			else this._database.db.run(this._sql);
			const changes = this._database.db.getRowsModified();
			const lastInsertRowid = this._database.lastInsertRowid();
			if (changes) this._database.afterWrite();
			return { lastInsertRowid, changes };
		});
	}
}

class SqlJsDatabase {
	constructor(db, filePath, SQL) {
		this.db = db;
		this.filePath = filePath;
		this._SQL = SQL || null;
		this._engine = 'sql.js';
		this._inTx = 0;
		this._dirty = false;
		this._lockDepth = 0;
		this._generation = filePath ? readGeneration(filePath) : 0;
	}

	prepare(sql) {
		return new SqlJsStatement(this, sql);
	}

	withLock(fn) {
		const outer = this._lockDepth > 0;
		if (!outer) acquireLock(this.filePath);
		this._lockDepth += 1;
		try {
			return fn();
		} finally {
			this._lockDepth -= 1;
			if (!outer) releaseLock(this.filePath);
		}
	}

	/**
	 * Pull the on-disk database when another process has saved a newer copy.
	 * Skipped inside an open transaction so BEGIN/COMMIT stay on one snapshot.
	 */
	reloadIfNewer() {
		if (!this.filePath || this._inTx || !this._SQL || this._dirty) return;
		const gen = readGeneration(this.filePath);
		if (gen === this._generation) return;
		let buf;
		try {
			buf = fs.readFileSync(this.filePath);
		} catch (_err) {
			return;
		}
		if (!sqliteHeaderOk(buf)) return;
		let next;
		try {
			next = new this._SQL.Database(buf);
		} catch (_err) {
			return;
		}
		const prev = this.db;
		this.db = next;
		this._generation = gen;
		this._dirty = false;
		try { prev.close(); } catch (_e) {}
	}

	exec(sql) {
		return this.withLock(() => {
			this.reloadIfNewer();
			this.db.exec(sql);
			this.afterWrite();
			return this;
		});
	}

	pragma(src) {
		try {
			this.withLock(() => {
				this.reloadIfNewer();
				this.db.exec(`PRAGMA ${src}`);
			});
		} catch (_err) {}
		return this;
	}

	transaction(fn) {
		const self = this;
		return function runTx(...args) {
			return self.withLock(() => {
				self.reloadIfNewer();
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
			});
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
		const nextGen = this._generation + 1;
		atomicWrite(this.filePath, Buffer.from(this.db.export()));
		atomicWrite(generationPath(this.filePath), Buffer.from(String(nextGen)));
		this._generation = nextGen;
		this._dirty = false;
	}

	close() {
		this.withLock(() => {
			this.persist();
			try { this.db.close(); } catch (_err) {}
		});
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
	acquireLock(dbPath);
	try {
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
		return new SqlJsDatabase(db, dbPath, SQL);
	} finally {
		releaseLock(dbPath);
	}
}

module.exports = {
	SqlJsDatabase,
	openSqlJsDatabase,
};
