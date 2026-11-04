/**
 * A Notebook template as a file, to hand to a colleague: its name, its body and
 * how it prints. The importing app checks it again (`api/templates.py`, kind `note`).
 */
import { templateLook } from './look.js';

export const NOTE_TEMPLATE_FILE_VERSION = 1;
const NOT_ONE = 'That file is not a Notebook template';

export function noteTemplateFile(record) {
  const data = record.data ?? {};
  const body = {
    azimut_note_template: NOTE_TEMPLATE_FILE_VERSION,
    name: record.name,
    data: { body: String(data.body ?? ''), folder: String(data.folder ?? ''), look: templateLook(data.look) },
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}

/** The file name a template is saved under. */
export function noteTemplateFileName(name) {
  return `${String(name ?? 'Template').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.azimut-note.json`;
}

/** The name and data a file holds, or an error saying what it is not. */
export function readNoteTemplateFile(text) {
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(NOT_ONE); }
  const data = body?.data;
  if (body?.azimut_note_template !== NOTE_TEMPLATE_FILE_VERSION || !data || typeof data !== 'object' || typeof data.body !== 'string') {
    throw new Error(NOT_ONE);
  }
  const name = String(body.name ?? '').trim().slice(0, 120) || 'Imported template';
  return { name, data: { body: data.body, folder: String(data.folder ?? ''), look: templateLook(data.look) } };
}
