// index.js — Entrada principal del mini-bot
// Mini-bot de práctica · Nivel 3
//
// Conecta los módulos y expone la interfaz que usa whatsapp.js (o el runner).

const moderacion = require('./moderacion');

// ─── INIT ─────────────────────────────────────────────────────────────────────

function init(sock) {
    moderacion.init(sock);
    console.log('[BOT] Mini-bot de práctica iniciado ✅');
}

// ─── PIPELINE DE MENSAJES ─────────────────────────────────────────────────────

async function manejarMensaje(msg) {
    try {
        // El módulo de moderación intercepta mensajes de usuarios silenciados
        // y procesa comandos de moderación. Retorna true si consumió el mensaje.
        const interceptado = await moderacion.manejarMensaje(msg);
        if (interceptado) return true;

        // Aquí irían otros módulos (juegos, IA, etc.)
        // const interceptadoPorJuego = await juegos.manejarMensaje(msg);
        // if (interceptadoPorJuego) return true;

        return false;
    } catch (e) {
        console.error('[BOT][INDEX]', e);
        return false;
    }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { init, manejarMensaje };
