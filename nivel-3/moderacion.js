// moderacion.js — Módulo de moderación
// Mini-bot de práctica · Nivel 3
//
// Responsabilidades actuales (hace demasiado → ver tarea de arquitectura al final):
//   • Comandos de warns (/warn, /quitar_warn, /warns)
//   • Comandos de mute/unmute (/mute, /unmute)
//   • Comando privilegiado /resetdb
//   • Handler de mensajes silenciados (intercepta antes de procesar)
//   • Verificación de rol admin vía metadata
//   • Registro de acciones en modlog
//
// 📋 TAREA DE ARQUITECTURA (al final del archivo)

const { isJidGroup } = require('@whiskeysockets/baileys');
const database = require('./database');

const MAX_WARNS_DEFAULT = 3;

let sock = null;

function init(socketActivo) {
    sock = socketActivo;
    console.log('[MOD] Módulo de moderación listo ✅');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function obtenerNumero(jid) {
    if (!jid) return '';
    if (typeof jid === 'object') jid = jid.id || '';
    return jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/[^0-9]/g, '');
}

function aJid(numero) {
    return numero.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

async function responder(msg, texto, mentions = []) {
    if (!sock) return;
    await sock.sendMessage(msg.key.remoteJid, { text: texto, quoted: msg, mentions });
}

async function esAdmin(groupJid, numero) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const part = meta.participants.find(
            p => obtenerNumero(p.id) === numero
        );
        return part?.admin === 'admin' || part?.admin === 'superadmin';
    } catch (e) {
        return false;
    }
}

function extraerObjetivo(msg, partes) {
    const menciones =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (menciones.length > 0) return obtenerNumero(menciones[0]);
    if (partes[1]) {
        const n = partes[1].replace(/[^0-9]/g, '');
        if (n.length >= 8) return n;
    }
    const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.remoteJid;
    if (quoted) return obtenerNumero(quoted);
    return null;
}

// ─── COMANDOS DE WARNS ────────────────────────────────────────────────────────

async function cmdWarn(msg, groupJid, senderNum, partes) {
    const objetivo = extraerObjetivo(msg, partes);
    if (!objetivo) {
        await responder(msg, '❌ Uso: /warn @usuario [motivo]');
        return;
    }

    const motivo = partes.slice(2).join(' ') || 'Sin motivo';
    const total  = database.warns.add(objetivo, groupJid);
    const max    = MAX_WARNS_DEFAULT;

    database.modlog.registrar(groupJid, objetivo, 'warn', motivo, senderNum);

    if (total >= max) {
        await sock.sendMessage(groupJid, {
            text:
                `⊛ *EXPULSIÓN AUTOMÁTICA*\n` +
                `卍 Usuario: @${objetivo}\n` +
                `◈ ${max} advertencias acumuladas.`,
            mentions: [aJid(objetivo)]
        });
        try {
            await sock.groupParticipantsUpdate(groupJid, [aJid(objetivo)], 'remove');
        } catch (e) {
            console.error('[MOD][WARN-KICK]', e.message);
        }
        database.warns.reset(objetivo, groupJid);
    } else {
        await sock.sendMessage(groupJid, {
            text:
                `⚠️ *ADVERTENCIA ${total}/${max}*\n` +
                `卍 Usuario: @${objetivo}\n` +
                `◈ Motivo: ${motivo}`,
            mentions: [aJid(objetivo)]
        });
    }
}

async function cmdQuitarWarn(msg, groupJid, partes) {
    const objetivo = extraerObjetivo(msg, partes);
    if (!objetivo) {
        await responder(msg, '❌ Uso: /quitar_warn @usuario');
        return;
    }

    const actual = database.warns.get(objetivo, groupJid);
    if (actual === 0) {
        await responder(msg, `◈ @${objetivo} no tiene advertencias.`);
        return;
    }

    const nuevo = database.warns.sub(objetivo, groupJid);
    await sock.sendMessage(groupJid, {
        text: `✅ Warn quitado. @${objetivo} ahora tiene ${nuevo}/${MAX_WARNS_DEFAULT}.`,
        mentions: [aJid(objetivo)]
    });
}

async function cmdVerWarns(msg, groupJid, partes) {
    const objetivo = extraerObjetivo(msg, partes);
    if (!objetivo) {
        await responder(msg, '❌ Uso: /warns @usuario');
        return;
    }

    const total = database.warns.get(objetivo, groupJid);
    await sock.sendMessage(groupJid, {
        text: `📊 @${objetivo} tiene ${total}/${MAX_WARNS_DEFAULT} advertencias.`,
        mentions: [aJid(objetivo)]
    });
}

// ─── COMANDOS DE MUTE ─────────────────────────────────────────────────────────

async function cmdMute(msg, groupJid, senderNum, partes) {
    const objetivo = extraerObjetivo(msg, partes);
    if (!objetivo) {
        await responder(msg, '❌ Uso: /mute @usuario [minutos]');
        return;
    }

    const minutos = parseInt(partes[2]) || 10;
    const hasta   = Date.now() + minutos * 60 * 1000;

    database.mutes.set(objetivo, groupJid, hasta);
    database.modlog.registrar(groupJid, objetivo, 'mute', `${minutos} min`, senderNum);

    await sock.sendMessage(groupJid, {
        text: `🔇 @${objetivo} silenciado por ${minutos} minuto(s).`,
        mentions: [aJid(objetivo)]
    });
}

async function cmdUnmute(msg, groupJid, senderNum, partes) {
    const objetivo = extraerObjetivo(msg, partes);
    if (!objetivo) {
        await responder(msg, '❌ Uso: /unmute @usuario');
        return;
    }

    database.mutes.remove(objetivo, groupJid);
    database.modlog.registrar(groupJid, objetivo, 'unmute', '', senderNum);

    await sock.sendMessage(groupJid, {
        text: `🔊 @${objetivo} fue desilenciado.`,
        mentions: [aJid(objetivo)]
    });
}

// ─── COMANDO PRIVILEGIADO ─────────────────────────────────────────────────────
// 🔴 BUG CRÍTICO DE SEGURIDAD:
//    /resetdb debería ser exclusivo del owner del bot.
//    El guard actual llama a esAdmin() — que solo verifica si el usuario
//    es administrador del grupo de WhatsApp. Cualquier admin del grupo
//    (no solo el dueño del bot) puede ejecutar este comando y borrar
//    todos los warns y mutes del grupo sin restricción adicional.

const OWNER_NUMBER = (process.env.OWNER_ID || '').replace(/[^0-9]/g, '');

async function cmdResetDb(msg, groupJid, senderNum) {
    // ❌ Debería ser: if (senderNum !== OWNER_NUMBER)
    const tienePermiso = await esAdmin(groupJid, senderNum);
    if (!tienePermiso) {
        await responder(msg, '❌ No tienes permiso para usar este comando.');
        return;
    }

    database.warns.reset('__all__', groupJid);  // conceptual — borra todo el grupo
    database.mutes.remove('__all__', groupJid);
    await responder(msg, '✅ Base de datos del grupo reseteada.');
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

async function manejarMensaje(msg) {
    if (!sock) return false;
    if (msg.key.fromMe) return false;

    const groupJid = msg.key.remoteJid;
    if (!isJidGroup(groupJid)) return false;

    const senderJid = msg.key.participant || msg.participant || '';
    const senderNum = obtenerNumero(senderJid);
    if (!senderNum) return false;

    // ── Interceptar usuarios silenciados ──────────────────────────────────────
    const hastaTs = database.mutes.getHasta(senderNum, groupJid);
    if (hastaTs !== null) {
        if (Date.now() < hastaTs) {
            try {
                await sock.sendMessage(groupJid, { delete: msg.key });
            } catch (e) { /* ignorar si no hay permisos */ }
            return true;
        } else {
            database.mutes.remove(senderNum, groupJid);
        }
    }

    // ── Parseo del comando ────────────────────────────────────────────────────
    const cuerpoRaw =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

    // 🐛 BUG FUNCIONAL #2 — condición que nunca se cumple:
    //    La siguiente línea usa `&&` en lugar de `||`.
    //    Para que `esComando` sea true, el mensaje tendría que empezar
    //    SIMULTÁNEAMENTE con '/' Y con '!', lo cual es imposible.
    //    Resultado: todos los comandos (/warn, /mute, /resetdb, etc.)
    //    son ignorados silenciosamente. El handler retorna false siempre
    //    y ningún comando de moderación responde jamás.
    const esComando = cuerpoRaw.startsWith('/') && cuerpoRaw.startsWith('!');

    if (!esComando) return false;

    const cuerpo = cuerpoRaw.slice(1).trim().toLowerCase();
    const partes = cuerpoRaw.trim().split(' ');
    const cmd    = cuerpo.split(' ')[0];

    // ── Guard de admin para comandos protegidos ───────────────────────────────
    const comandosAdmin = ['warn', 'quitar_warn', 'mute', 'unmute', 'resetdb'];
    if (comandosAdmin.includes(cmd)) {
        const esAdminSender = await esAdmin(groupJid, senderNum);
        if (!esAdminSender) {
            await responder(msg, '❌ Solo los administradores pueden usar este comando.');
            return true;
        }
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────
    switch (cmd) {
        case 'warn':
            await cmdWarn(msg, groupJid, senderNum, partes);
            return true;

        case 'quitar_warn':
        case 'unwarn':
            await cmdQuitarWarn(msg, groupJid, partes);
            return true;

        case 'warns':
            await cmdVerWarns(msg, groupJid, partes);
            return true;

        case 'mute':
            await cmdMute(msg, groupJid, senderNum, partes);
            return true;

        case 'unmute':
            await cmdUnmute(msg, groupJid, senderNum, partes);
            return true;

        case 'resetdb':
            await cmdResetDb(msg, groupJid, senderNum);
            return true;

        default:
            return false;
    }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = { init, manejarMensaje };

// ─────────────────────────────────────────────────────────────────────────────
// 📋 TAREA DE ARQUITECTURA — moderacion.js hace demasiado
// ─────────────────────────────────────────────────────────────────────────────
//
// Este archivo mezcla cuatro responsabilidades distintas:
//
//   1. COMANDOS DE WARNS       → debería vivir en módulo propio (warns.js)
//   2. COMANDOS DE MUTE        → módulo propio (mutes.js)
//   3. COMANDO PRIVILEGIADO    → podría ir en admin.js o owner.js
//   4. INTERCEPTOR DE MUTES    → pertenece al pipeline de mensajes (index.js o
//                                un middleware separado)
//
// El problema concreto:
//   - `manejarMensaje` hace tanto la intercepción de usuarios silenciados
//     como el dispatch de comandos. Si quisieras agregar, por ejemplo,
//     un sistema de kicks o bans, el archivo crecería indefinidamente.
//   - La lógica de "quién puede hacer qué" está mezclada con los comandos.
//
// División sugerida:
//
//   ├── middleware/
//   │   └── muteInterceptor.js   → solo verifica si el sender está silenciado
//   ├── commands/
//   │   ├── warns.js             → cmdWarn, cmdQuitarWarn, cmdVerWarns
//   │   ├── mutes.js             → cmdMute, cmdUnmute
//   │   └── owner.js             → cmdResetDb y otros comandos de owner
//   └── moderacion.js            → solo orquesta, delega en los anteriores
//
// ─────────────────────────────────────────────────────────────────────────────
