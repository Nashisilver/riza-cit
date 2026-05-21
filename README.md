# 🔴 Nivel 3 — Dev Senior

## Contexto

Este es un mini-bot funcional construido con **Baileys** (la librería de WhatsApp que usa Riza).

Tiene tres módulos conectados entre sí: entrada principal, moderación y base de datos. Fue escrito con errores intencionales que simulan problemas reales de producción — algunos sutiles, uno crítico.

---

## 📥 Archivos del ejercicio

```
nivel-3/
├── index.js        →  Entrada principal, conecta los módulos
├── moderacion.js   →  Sistema de warns, mutes y comandos
└── database.js     →  Capa de datos con SQLite
```

Descargá los tres archivos y trabajá con ellos juntos.

---

## 🔍 Qué hay adentro

El sistema tiene **5 problemas**:

| Tipo | Descripción |
|------|-------------|
| 🐛 Bug funcional | Falla silenciosamente en un caso edge |
| 🐛 Bug funcional | Una condición que nunca se cumple |
| 🔴 Bug crítico de seguridad | Un comando privilegiado mal protegido |
| 🔧 Feature incompleta | Estructura presente pero no guarda nada |
| 📋 Problema de arquitectura | Un módulo que hace demasiado |

---

## ✅ Qué tenés que entregar

**① Código corregido** — los tres archivos con comentarios explicando cada cambio.

**② Documento de decisiones** — un `.md` o `.txt` respondiendo:
- ¿Qué encontraste y dónde estaba cada problema?
- ¿Cómo lo corregiste y por qué de esa forma?
- ¿Encontraste algo más que no estaba en la lista? (esto suma)

**③ Propuesta de mejora propia** — algo que mejorarías del sistema más allá de los bugs, con una justificación breve.

---

## 📤 Cómo entregar

Comprimí todo en un `.zip` y subilo al formulario que te compartimos.

---

## ⏱ Tiempo estimado

Entre 3 y 6 horas. No hay límite estricto.

---

> **Nota:** El Nivel 3 incluye una conversación directa con el equipo después de la entrega técnica. El código es necesario pero no es suficiente — queremos entender cómo pensás.

---

*¿Algo no está claro? Contactá a un miembro del C.I.T.*
