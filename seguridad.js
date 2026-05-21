// ─── MÓDULO DE SEGURIDAD — Riza Hawkeye ──────────────────────────────────────
// Sistema de administración y protección de grupos WhatsApp
// Este módulo ha presentado comportamiento inestable en producción.
// Revísalo, corrígelo y documenta todo lo que encuentres.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const MAX_WARNS     = 3;
const MUTE_DURACION = 10; // minutos
const FLOOD_MAX     = 5;  // mensajes
const FLOOD_SEG     = 10; // ventana en segundos

// ─── ESTADO INTERNO ───────────────────────────────────────────────────────────
let sock         = null;
const warns      = new Map(); // 'numero:groupJid' -> cantidad
const muteados   = new Map(); // 'numero:groupJid' -> timestamp hasta cuando
const baneados   = new Map(); // groupJid -> Set de números
const floodTracker = new Map(); // 'numero:groupJid' -> { count, since }

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init(socketActivo) {
    sock = socketActivo;
    console.log('[SEGURIDAD] Módulo iniciado ✅');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function numeroAJid(numero) {
    return numero + '@s.whatsapp.net';
}

function obtenerNumero(jid) {
    return jid.replace('@s.whatsapp.net', '').replace('@lid', '');
}

async function enviarMensaje(jid, texto) {
    await sock.sendMessage(jid, { text: texto });
}

async function responderMensaje(msg, texto) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: texto,
        quoted: msg
    });
}

// ─── VERIFICAR SI EL BOT ES ADMIN ────────────────────────────────────────────
async function botEsAdmin(groupJid) {
    try {
        const meta   = await sock.groupMetadata(groupJid);
        const botJid = sock.user.id;
        const bot    = meta.participants.find(p => p.id === botJid);
        return bot && (bot.admin === 'admin' || bot.admin === 'superadmin');
    } catch(e) {
        return false;
    }
}

// ─── VERIFICAR SI UN NÚMERO ES ADMIN ─────────────────────────────────────────
async function esAdminDeGrupo(groupJid, numero) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const part = meta.participants.find(p =>
            obtenerNumero(p.id) === numero
        );
        // BUG #1: Esta condición tiene un error lógico.
        // En ciertos casos permite que usuarios normales pasen como admins.
        return part || (part.admin === 'admin' || part.admin === 'superadmin');
    } catch(e) {
        return false;
    }
}

// ─── VERIFICAR MUTE ───────────────────────────────────────────────────────────
function estaMuteado(numero, groupJid) {
    const key   = numero + ':' + groupJid;
    const hasta = muteados.get(key);
    if (!hasta) return false;
    if (Date.now() > hasta) {
        muteados.delete(key);
        return false;
    }
    return true;
}

// ─── VERIFICAR BAN ────────────────────────────────────────────────────────────
function estaBaneado(numero, groupJid) {
    const grupo = baneados.get(groupJid);
    return grupo ? grupo.has(numero) : false;
}

// ─── SISTEMA DE WARNS ─────────────────────────────────────────────────────────
function addWarn(numero, groupJid) {
    const key     = numero + ':' + groupJid;
    const actual  = warns.get(key) || 0;
    const nuevo   = actual + 1;
    warns.set(key, nuevo);
    return nuevo;
}

function getWarn(numero, groupJid) {
    return warns.get(numero + ':' + groupJid) || 0;
}

function resetWarn(numero, groupJid) {
    warns.delete(numero + ':' + groupJid);
}

// ─── COMANDO WARN ─────────────────────────────────────────────────────────────
async function cmdWarn(msg, groupJid, adminNombre, objetivoNum, motivo = 'Sin motivo') {
    const esAdmin = await esAdminDeGrupo(groupJid, obtenerNumero(msg.key.participant));
    if (!esAdmin) {
        await responderMensaje(msg, '❌ No tienes permisos para advertir usuarios.');
        return;
    }

    const total = addWarn(objetivoNum, groupJid);

    if (total >= MAX_WARNS) {
        await enviarMensaje(groupJid,
            `⊛ *EXPULSIÓN AUTOMÁTICA*\n` +
            `卍 Usuario: @${objetivoNum}\n` +
            `◈ Motivo: ${MAX_WARNS} advertencias acumuladas\n` +
            `↯ Admin: ${adminNombre}`
        );
        try {
            await sock.groupParticipantsUpdate(groupJid, [numeroAJid(objetivoNum)], 'remove');
        } catch(e) {
            console.error('[WARN-KICK]', e.message);
        }
        resetWarn(objetivoNum, groupJid);
    } else {
        await enviarMensaje(groupJid,
            `⊛ *ADVERTENCIA ${total}/${MAX_WARNS}*\n` +
            `卍 Usuario: @${objetivoNum}\n` +
            `◈ Motivo: ${motivo}\n` +
            `↯ Admin: ${adminNombre}`
        );
    }
}

// ─── COMANDO KICK ─────────────────────────────────────────────────────────────
async function cmdKick(msg, groupJid, adminNombre, objetivoNum, motivo = 'Sin motivo') {
    if (!(await botEsAdmin(groupJid))) {
        await responderMensaje(msg, '❌ El bot necesita ser administrador para expulsar.');
        return;
    }

    await enviarMensaje(groupJid,
        `⊛ *EXPULSIÓN*\n` +
        `卍 Usuario: @${objetivoNum}\n` +
        `◈ Motivo: ${motivo}\n` +
        `↯ Admin: ${adminNombre}`
    );

    // BUG #2: Se notifica al usuario DESPUÉS de expulsarlo.
    // WhatsApp no puede enviar mensajes a alguien que ya no está en el grupo.
    try {
        await sock.groupParticipantsUpdate(groupJid, [numeroAJid(objetivoNum)], 'remove');
    } catch(e) {
        await responderMensaje(msg, '❌ Error al expulsar: ' + e.message);
    }

    await enviarMensaje(numeroAJid(objetivoNum),
        `⊛ Fuiste expulsado del grupo.\n◈ Motivo: ${motivo}`
    );
}

// ─── COMANDO BAN ──────────────────────────────────────────────────────────────
async function cmdBan(msg, groupJid, adminNombre, objetivoNum, motivo = 'Sin motivo') {
    if (!(await botEsAdmin(groupJid))) {
        await responderMensaje(msg, '❌ El bot necesita ser administrador para banear.');
        return;
    }

    if (!baneados.has(groupJid)) {
        baneados.set(groupJid, new Set());
    }
    baneados.get(groupJid).add(objetivoNum);

    await enviarMensaje(groupJid,
        `⛔ *BANEO PERMANENTE*\n` +
        `卍 Usuario: @${objetivoNum}\n` +
        `◈ Motivo: ${motivo}\n` +
        `↯ Admin: ${adminNombre}`
    );

    try {
        await sock.groupParticipantsUpdate(groupJid, [numeroAJid(objetivoNum)], 'remove');
    } catch(e) {
        await responderMensaje(msg, '❌ Error al banear: ' + e.message);
    }
}

// ─── COMANDO UNBAN ────────────────────────────────────────────────────────────
async function cmdUnban(msg, groupJid, objetivoNum) {
    const grupo = baneados.get(groupJid);
    if (!grupo || !grupo.has(objetivoNum)) {
        await responderMensaje(msg, `◈ @${objetivoNum} no está baneado.`);
        return;
    }
    grupo.delete(objetivoNum);
    await responderMensaje(msg, `✅ @${objetivoNum} fue desbaneado.`);
}

// ─── COMANDO MUTE ─────────────────────────────────────────────────────────────
async function cmdMute(msg, groupJid, adminNombre, objetivoNum, minutos = MUTE_DURACION) {
    // VULNERABILIDAD: No se verifica si quien ejecuta el comando es admin.
    // Cualquier usuario del grupo puede silenciar a otro.
    const key  = objetivoNum + ':' + groupJid;
    const hasta = Date.now() + minutos * 60 * 1000;
    muteados.set(key, hasta);

    await enviarMensaje(groupJid,
        `🔇 *SILENCIADO*\n` +
        `卍 Usuario: @${objetivoNum}\n` +
        `⏱ Duración: ${minutos} minuto(s)\n` +
        `↯ Admin: ${adminNombre}`
    );

    await enviarMensaje(numeroAJid(objetivoNum),
        `🔇 Fuiste silenciado por ${minutos} minuto(s).`
    );
}

// ─── COMANDO UNMUTE ───────────────────────────────────────────────────────────
async function cmdUnmute(msg, groupJid, objetivoNum) {
    muteados.delete(objetivoNum + ':' + groupJid);
    await responderMensaje(msg, `🔊 @${objetivoNum} fue desilenciado.`);
}

// ─── ANTI-FLOOD ───────────────────────────────────────────────────────────────
// FUNCIÓN INCOMPLETA: El sistema detecta flood pero no aplica ningún castigo.
// Debe advertir al usuario, y al tercer flood en la misma sesión, expulsarlo.
async function verificarFlood(msg, numero, groupJid) {
    const esAdmin = await esAdminDeGrupo(groupJid, numero);
    if (esAdmin) return false;

    const key    = numero + ':' + groupJid;
    const ahora  = Date.now();
    const ventana = FLOOD_SEG * 1000;

    if (!floodTracker.has(key)) {
        floodTracker.set(key, { count: 1, since: ahora });
        return false;
    }

    const tracker = floodTracker.get(key);

    if (ahora - tracker.since > ventana) {
        tracker.count = 1;
        tracker.since = ahora;
        return false;
    }

    tracker.count++;

    if (tracker.count < FLOOD_MAX) return false;

    floodTracker.delete(key);

    // TODO: implementar castigo aquí
    return true;
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
async function manejarMensaje(msg) {
    try {
        const jid    = msg.key.remoteJid;
        const numero = obtenerNumero(msg.key.participant || jid);
        const texto  = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text || ''
        ).trim().toLowerCase();

        // Bloquear baneados
        if (estaBaneado(numero, jid)) {
            try {
                await sock.groupParticipantsUpdate(jid, [numeroAJid(numero)], 'remove');
            } catch(e) {}
            return true;
        }

        // Bloquear muteados
        if (estaMuteado(numero, jid)) {
            try { await sock.sendMessage(jid, { delete: msg.key }); } catch(e) {}
            return true;
        }

        // Anti-flood
        const esFlood = await verificarFlood(msg, numero, jid);
        if (esFlood) return true;

        return false;
    } catch(e) {
        console.error('[SEGURIDAD][HANDLER]', e);
        return false;
    }
}

module.exports = {
    init,
    manejarMensaje,
    cmdWarn,
    cmdKick,
    cmdBan,
    cmdUnban,
    cmdMute,
    cmdUnmute,
    estaMuteado,
    estaBaneado,
    esAdminDeGrupo,
};
