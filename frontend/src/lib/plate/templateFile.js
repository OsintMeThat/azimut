/**
 * A map plate template as a file, to hand to a colleague: its name and its layout,
 * which the importing app checks again (`api/templates.py`, kind `map`).
 */
export const TEMPLATE_FILE_VERSION = 1;

export function templateFile(record) {
  const body = { azimut_map_template: TEMPLATE_FILE_VERSION, name: record.name, data: record.data };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}

/** The name and layout a file holds, or an error saying what it is not. */
export function readTemplateFile(text) {
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('That file is not a map template'); }
  if (body?.azimut_map_template !== TEMPLATE_FILE_VERSION || typeof body.data !== 'object' || !body.data) {
    throw new Error('That file is not a map template');
  }
  const name = String(body.name ?? '').trim().slice(0, 120) || 'Imported template';
  return { name, data: body.data };
}
