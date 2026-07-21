export function insertNotebookText(text, value, start = text.length, end = start) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  return { text: `${before}${value}${after}`, cursor: before.length + value.length };
}

import { mediaReference } from './markdown.js';

export function notebookImageMarkdown(_caseId, item, entity) {
  return entity ? mediaReference(entity) : `![${item.filename}](/files/${_caseId}/${item.path})`;
}

export function notebookMediaMarkdown(_caseId, entity) {
  return mediaReference(entity);
}
