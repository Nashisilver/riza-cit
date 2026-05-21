// database.js — Capa de datos SQLite
// Mini-bot de práctica · Nivel 3
//
// Expone tres namespaces:
//   database.warns   → sistema de advertencias
//   database.mutes   → usuarios silenciados
//   database.modlog  → registro de acciones de moderación  ← FEATURE INCOMPLETA

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bot_practica.db');
const db = new Database(DB_PATH);

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS warns (
        numero      TEXT NOT NULL,
        group_jid   TEXT NOT NULL,
        cantidad    INTEGER DEFAULT 0,
        PRIMARY KEY (numero, group_jid)
    );

    CREATE TABLE IF NOT EXISTS mutes (
        numero      TEXT NOT NULL,
        group_jid   TEXT NOT NULL,
        hasta       INTEGER NOT NULL,
        PRIMARY KEY (numero, group_jid)
    );

    CREATE TABLE IF NOT EXISTS modlog (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        group_jid   TEXT NOT NULL,
        numero      TEXT NOT NULL,
        accion      TEXT NOT NULL,
        motivo      TEXT,
        admin       TEXT,
        timestamp   INTEGER NOT NULL
    );
`);

// ─── WARNS ────────────────────────────────────────────────────────────────────
const warns = {

    /**
     * Suma 1 warn al usuario y retorna el total actual.
     * 🐛 BUG FUNCIONAL #1 — edge case silencioso:
     *    Si `numero` llega como undefined o vacío string, la operación
     *    INSERT OR REPLACE crea una fila con PRIMARY KEY ('', group_jid).
     *    El método retorna 1 (como si fuera el primer warn de un usuario válido)
     *    y la llamada no lanza error. El warn se pierde en una fila huérfana.
     *    El admin cree que dio el warn correctamente.
     */
    add(numero, groupJid) {
        db.prepare(`
            INSERT INTO warns (numero, group_jid, cantidad)
            VALUES (?, ?, 1)
            ON CONFLICT(numero, group_jid)
            DO UPDATE SET cantidad = cantidad + 1
        `).run(numero, groupJid);

        const row = db.prepare(
            'SELECT cantidad FROM warns WHERE numero = ? AND group_jid = ?'
        ).get(numero, groupJid);

        return row?.cantidad ?? 1;
    },

    get(numero, groupJid) {
        const row = db.prepare(
            'SELECT cantidad FROM warns WHERE numero = ? AND group_jid = ?'
        ).get(numero, groupJid);
        return row?.cantidad ?? 0;
    },

    reset(numero, groupJid) {
        db.prepare(
            'DELETE FROM warns WHERE numero = ? AND group_jid = ?'
        ).run(numero, groupJid);
    },

    sub(numero, groupJid) {
        db.prepare(`
            UPDATE warns SET cantidad = MAX(0, cantidad - 1)
            WHERE numero = ? AND group_jid = ?
        `).run(numero, groupJid);
        return this.get(numero, groupJid);
    }
};

// ─── MUTES ────────────────────────────────────────────────────────────────────
const mutes = {

    set(numero, groupJid, hastaTimestamp) {
        db.prepare(`
            INSERT INTO mutes (numero, group_jid, hasta)
            VALUES (?, ?, ?)
            ON CONFLICT(numero, group_jid)
            DO UPDATE SET hasta = excluded.hasta
        `).run(numero, groupJid, hastaTimestamp);
    },

    getHasta(numero, groupJid) {
        const row = db.prepare(
            'SELECT hasta FROM mutes WHERE numero = ? AND group_jid = ?'
        ).get(numero, groupJid);
        return row?.hasta ?? null;
    },

    remove(numero, groupJid) {
        db.prepare(
            'DELETE FROM mutes WHERE numero = ? AND group_jid = ?'
        ).run(numero, groupJid);
    }
};

// ─── MODLOG ───────────────────────────────────────────────────────────────────
// 🔧 FEATURE INCOMPLETA:
//    La estructura está definida (tabla modlog en el schema, objeto exportado,
//    método `registrar` con firma correcta), pero el cuerpo de `registrar`
//    no ejecuta ninguna operación sobre la DB. Todos los llamados en
//    moderacion.js invocan esta función creyendo que guarda el log,
//    pero la tabla queda siempre vacía.
//    `getLog` sí funciona — simplemente nunca devuelve nada porque no hay datos.
const modlog = {

    registrar(groupJid, numero, accion, motivo = '', admin = '') {
        // TODO: persistir en tabla modlog
        // (el método existe y se llama correctamente desde moderacion.js,
        //  pero aún no implementa el INSERT)
    },

    getLog(groupJid, limite = 20) {
        return db.prepare(`
            SELECT * FROM modlog
            WHERE group_jid = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(groupJid, limite);
    },

    getLogUsuario(groupJid, numero, limite = 10) {
        return db.prepare(`
            SELECT * FROM modlog
            WHERE group_jid = ? AND numero = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(groupJid, numero, limite);
    }
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = { warns, mutes, modlog };
