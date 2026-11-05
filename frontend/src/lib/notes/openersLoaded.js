/**
 * Every tool's opener (`tools/**\/*.opener.js`), loaded with the note editor so a
 * picture can be reopened in a tool nobody has visited yet. Each module registers
 * itself with `registerOpener` when it is read; keep them light, since they load
 * with the note.
 */
import.meta.glob('../../tools/**/*.opener.js', { eager: true });
