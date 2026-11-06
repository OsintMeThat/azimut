import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';

import { fileRelPath, fileUrl } from './fileUrl.js';
import { blockSide, readAttrs } from './notes/pictureSize.js';
import { BUILT_IN_ADDRESS, builtInPicture, builtInSrc } from './notes/reportParts.js';

const ENTITY_REF = /\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]/g;
const MEDIA_REF = /\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?/g;
const IMAGE_ATTRS = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)\s*\{([^}\n]+)\}/g;
// a corner of the cover reads as its side here: only the PDF pins it to the page
const ALIGNMENT_BLOCK = /^:::\s*(left|center|right|top-left|top-right|bottom-left|bottom-right)\s*\n([\s\S]*?)^:::\s*$/gm;
const ATTR_PARAM = '__azimut_attrs';
/** Wrapper a ```mermaid fence renders to, and the hook lib/mermaid.js draws into. */
export const MERMAID_CLASS = 'mermaid-diagram';
const purify = typeof window === 'undefined' ? null : DOMPurify(window);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sanitize(rendered) {
  if (purify) return purify.sanitize(rendered, {
    ADD_TAGS: ['video', 'source'],
    ADD_ATTR: ['controls', 'target', 'data-entity-id'],
  });
  // The preview only runs in a browser. This small fallback keeps server-side
  // callers and unit tests safe without requiring a DOM implementation.
  return rendered
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(?:href|src)=(['"]?)javascript:[^\s>]*\1/gi, '');
}

/** Markdown source for a portable, clickable reference to an entity in this case. */
export function entityReference(entity) {
  return `[[entity:${entity.id}|${entity.label.replace(/[\[\]]/g, '')}]]`;
}

export function mediaReference(entity) {
  return `[[media:${entity.id}|${entity.label.replace(/[\[\]]/g, '')}]]`;
}

/** Remote inline images contact their host whenever the preview is rendered. */
export function remoteImageUrls(text = '') {
  const urls = new Set();
  const tokens = marked.lexer(sourceWithCaseReferences(text), { gfm: true });
  marked.walkTokens(tokens, (token) => {
    if (token.type !== 'image') return;
    const href = imageOptions(token.href).href;
    const url = new URL(href, 'https://notebook.invalid');
    if ((url.protocol === 'http:' || url.protocol === 'https:')
        && url.origin !== 'https://notebook.invalid') {
      urls.add(url.toString());
    }
  });
  return [...urls];
}

function withImageAttributes(source) {
  return source.replace(IMAGE_ATTRS, (_match, alt, href, title, attributes) => {
    const separator = href.includes('?') ? '&' : '?';
    const annotated = `${href}${separator}${ATTR_PARAM}=${encodeURIComponent(attributes)}`;
    return `![${alt}](${annotated}${title ? ` "${title}"` : ''})`;
  });
}

function sourceWithCaseReferences(text) {
  return withImageAttributes(String(text))
    .replace(ENTITY_REF, (_match, id, label) => `[${label}](azimut://entity/${id})`)
    .replace(MEDIA_REF, (_match, id, label, attributes) => {
      const query = attributes ? `?${ATTR_PARAM}=${encodeURIComponent(attributes)}` : '';
      return `![${label}](azimut://media/${id}${query})`;
    });
}

function broken(kind, label) {
  return `<span class="broken-ref" title="Deleted from this case">${kind}: ${label}</span>`;
}

function imageOptions(href) {
  const url = new URL(href, 'https://notebook.invalid');
  const attributes = url.searchParams.get(ATTR_PARAM) ?? '';
  url.searchParams.delete(ATTR_PARAM);
  const source = url.origin === 'https://notebook.invalid'
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
  const values = readAttrs(attributes);
  const width = /^(?:[1-9]\d?(?:\.\d+)?|100(?:\.0+)?)%$/.test(values.width ?? '')
    || /^(?:[2-9]\d|[1-9]\d{2}|1[0-5]\d{2}|1600)px$/.test(values.width ?? '')
    ? values.width : '';
  const written = ['left', 'center', 'right'].includes(values.align);
  return { href: source, width, align: written ? values.align : 'left', written, caption: values.caption };
}

/**
 * A picture's markup. One whose line writes no place takes its block's (`::: center`
 * centres it, as the PDF does), which `data-unaligned` lets the page draw.
 */
function imageMarkup({ href, alt, title, width, align, written = true }) {
  const attrs = `${title ? ` title="${title}"` : ''}${width ? ` style="width: ${width}"` : ''}${written ? '' : ' data-unaligned="true"'}`;
  return { attrs, className: `markdown-image align-${align}` };
}

/** The line the PDF prints under a picture: its caption, else its title. */
function captionMarkup({ caption, align }, title) {
  const words = caption || title;
  return words ? `<span class="markdown-caption align-${align}">${escapeHtml(words)}</span>` : '';
}

function renderer({ entities, caseId, redirects, identity }) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const mediaByPath = new Map(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path)
    .map((entity) => [entity.attrs.path, entity]));
  const value = new Renderer();

  // A ```mermaid fence stays text here. Drawing it means inserting an <svg>,
  // which the sanitizer below would strip, so the diagram is drawn later
  // against the live preview DOM — see lib/mermaid.js.
  value.code = function code(token) {
    if (String(token.lang ?? '').trim().split(/\s+/)[0] === 'mermaid') {
      return `<div class="${MERMAID_CLASS}"><pre class="mermaid-source">${escapeHtml(token.text)}</pre></div>`;
    }
    return Renderer.prototype.code.call(this, token);
  };

  value.link = function link(token) {
    const body = this.parser.parseInline(token.tokens);
    const entityMatch = /^azimut:\/\/entity\/([A-Za-z0-9_-]+)$/.exec(token.href);
    if (entityMatch) {
      const id = redirects[entityMatch[1]]?.id ?? entityMatch[1];
      const entity = byId.get(id);
      const title = id !== entityMatch[1] && entity ? ` title="Merged into ${escapeHtml(entity.label)}"` : '';
      return entity
        ? `<a href="#" data-entity-id="${escapeHtml(id)}" class="entity-ref"${title}>${body}</a>`
        : broken('Reference unavailable', body);
    }
    const mediaMatch = /^azimut:\/\/media\/([A-Za-z0-9_-]+)$/.exec(token.href);
    if (mediaMatch) {
      const entity = byId.get(mediaMatch[1]);
      if (!entity?.attrs?.path) return broken('Media unavailable', body);
      const url = fileUrl(caseId, entity.attrs.path);
      return entity.attrs.kind === 'video'
        ? `<video controls src="${url}">${body}</video>`
        : `<img src="${url}" alt="${entity.label}">`;
    }
    const title = token.title ? ` title="${token.title}"` : '';
    return `<a href="${token.href}"${title} target="_blank" rel="noreferrer">${body}</a>`;
  };

  value.image = (token) => {
    const options = imageOptions(token.href);
    // the app's logo, the analyst's and their signature: read from this computer, or said missing
    const builtIn = BUILT_IN_ADDRESS.exec(options.href)?.[1];
    if (builtIn) {
      const src = builtInSrc(builtIn, identity);
      if (!src) return `<span class="builtin-unset align-${options.align}">${escapeHtml(builtInPicture(builtIn).unset)}</span>`;
      const markup = imageMarkup({ href: src, alt: token.text, title: token.title, ...options });
      return `<img src="${src}" alt="${escapeHtml(token.text)}" class="${markup.className} builtin-${builtIn}"${markup.attrs}>${captionMarkup(options, token.title)}`;
    }
    const path = fileRelPath(options.href, caseId);
    if (path && !mediaByPath.has(path)) return broken('Media unavailable', token.text);
    // Rebuilt rather than reused, so a case file whose name needs encoding
    // resolves even in notes written before it was encoded.
    if (path) options.href = fileUrl(caseId, path);
    const mediaUrl = new URL(options.href, 'https://notebook.invalid');
    if (mediaUrl.protocol === 'azimut:' && mediaUrl.hostname === 'media') {
      const entity = byId.get(mediaUrl.pathname.slice(1));
      if (!entity?.attrs?.path) return broken('Media unavailable', token.text);
      const url = fileUrl(caseId, entity.attrs.path);
      const markup = imageMarkup({ href: url, alt: entity.label, title: token.title, ...options });
      return entity.attrs.kind === 'video'
        ? `<video controls src="${url}" class="${markup.className}"${markup.attrs}>${token.text}</video>${captionMarkup(options, token.title)}`
        : `<img src="${url}" alt="${entity.label}" class="${markup.className}"${markup.attrs}>${captionMarkup(options, token.title)}`;
    }
    const markup = imageMarkup({ href: options.href, alt: token.text, title: token.title, ...options });
    return `<img src="${options.href}" alt="${token.text}" class="${markup.className}"${markup.attrs}>${captionMarkup(options, token.title)}`;
  };
  return value;
}

function renderAlignmentBlocks(source, options) {
  const blocks = [];
  const main = source.replace(ALIGNMENT_BLOCK, (_match, align, contents) => {
    const token = `AZIMUT_ALIGNMENT_BLOCK_${blocks.length}`;
    blocks.push({ token, align: blockSide(align), contents });
    return token;
  });
  const rendered = marked.parse(main, options);
  return blocks.reduce((html, block) => html.replace(
    `<p>${block.token}</p>`,
    `<div class="markdown-align align-${block.align}">${marked.parse(block.contents, options)}</div>`,
  ), rendered);
}

/** Render GitHub-flavored Markdown, then remove unsafe HTML before previewing it. */
export function markdownHtml(text = '', { entities = [], caseId = '', redirects = {}, identity } = {}) {
  const options = {
    gfm: true,
    breaks: false,
    renderer: renderer({ entities, caseId, redirects, identity }),
  };
  const rendered = renderAlignmentBlocks(sourceWithCaseReferences(text), options);
  return sanitize(rendered);
}
