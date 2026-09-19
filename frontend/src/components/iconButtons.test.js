import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every button that shows only an icon says what it does on hover. An
// aria-label names it for a screen reader, but a sighted analyst never sees
// one, so the rule is walked over every component rather than trusted to review.

const SRC = fileURLToPath(new URL('..', import.meta.url));

function svelteFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith('.svelte') ? [path] : [];
  });
}

// An opening tag's attributes may hold `{…}` expressions, one level of nesting deep.
const CONTROL = /<(button|a)\b((?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*)>([\s\S]*?)<\/\1>/g;

function iconOnly(body) {
  if (!/<Icon\b|Glyph\b/.test(body)) return false;
  const text = body
    .replace(/<Icon\b[^>]*\/>/g, '')
    .replace(/<(ProofGlyph|MoonGlyph)\b[^>]*\/>/g, '')
    .replace(/\{#if[^}]*\}|\{:else[^}]*\}|\{\/if\}/g, '');
  return !text.trim();
}

describe('icon-only buttons', () => {
  it('all carry a hover tooltip', () => {
    const missing = [];
    for (const file of svelteFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(CONTROL)) {
        const [, , attrs, body] = match;
        if (!iconOnly(body) || /\btitle=/.test(attrs)) continue;
        const line = source.slice(0, match.index).split('\n').length;
        missing.push(`${relative(SRC, file)}:${line}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
