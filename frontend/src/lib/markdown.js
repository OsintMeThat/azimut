import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';

const ENTITY_REF = /\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]/g;
const MEDIA_REF = /\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?/g;
const IMAGE_ATTRS = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)\s*\{([^}\n]+)\}/g;
const ALIGNMENT_BLOCK = /^:::\s*(left|center|right)\s*\n([\s\S]*?)^:::\s*$/gm;
const ATTR_PARAM = '__azimut_attrs';
const purify = typeof window === 'undefined' ? null : DOMPurify(window);

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

function localMediaPath(href, caseId) {
  const prefix = `/files/${caseId}/`;
  return caseId && href.startsWith(prefix) ? href.slice(prefix.length) : null;
}

function imageOptions(href) {
  const url = new URL(href, 'https://notebook.invalid');
  const attributes = url.searchParams.get(ATTR_PARAM) ?? '';
  url.searchParams.delete(ATTR_PARAM);
  const source = url.origin === 'https://notebook.invalid'
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
  const values = Object.fromEntries([...attributes.matchAll(/\b(width|align)\s*=\s*([\w.%+-]+)/g)]
    .map(([, key, value]) => [key, value]));
  const width = /^(?:[1-9]\d?(?:\.\d+)?|100(?:\.0+)?)%$/.test(values.width ?? '')
    || /^(?:[2-9]\d|[1-9]\d{2}|1[0-5]\d{2}|1600)px$/.test(values.width ?? '')
    ? values.width : '';
  const align = ['left', 'center', 'right'].includes(values.align) ? values.align : 'left';
  return { href: source, width, align };
}

function imageMarkup({ href, alt, title, width, align }) {
  const attrs = `${title ? ` title="${title}"` : ''}${width ? ` style="width: ${width}"` : ''}`;
  return { attrs, className: `markdown-image align-${align}` };
}

function renderer({ entities, caseId }) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const mediaByPath = new Map(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path)
    .map((entity) => [entity.attrs.path, entity]));
  const value = new Renderer();

  value.link = function link(token) {
    const body = this.parser.parseInline(token.tokens);
    const entityMatch = /^azimut:\/\/entity\/([A-Za-z0-9_-]+)$/.exec(token.href);
    if (entityMatch) {
      return byId.has(entityMatch[1])
        ? `<a href="#" data-entity-id="${entityMatch[1]}" class="entity-ref">${body}</a>`
        : broken('Reference unavailable', body);
    }
    const mediaMatch = /^azimut:\/\/media\/([A-Za-z0-9_-]+)$/.exec(token.href);
    if (mediaMatch) {
      const entity = byId.get(mediaMatch[1]);
      if (!entity?.attrs?.path) return broken('Media unavailable', body);
      const url = `/files/${caseId}/${entity.attrs.path}`;
      return entity.attrs.kind === 'video'
        ? `<video controls src="${url}">${body}</video>`
        : `<img src="${url}" alt="${entity.label}">`;
    }
    const title = token.title ? ` title="${token.title}"` : '';
    return `<a href="${token.href}"${title} target="_blank" rel="noreferrer">${body}</a>`;
  };

  value.image = (token) => {
    const options = imageOptions(token.href);
    const path = localMediaPath(options.href, caseId);
    if (path && !mediaByPath.has(path)) return broken('Media unavailable', token.text);
    const mediaUrl = new URL(options.href, 'https://notebook.invalid');
    if (mediaUrl.protocol === 'azimut:' && mediaUrl.hostname === 'media') {
      const entity = byId.get(mediaUrl.pathname.slice(1));
      if (!entity?.attrs?.path) return broken('Media unavailable', token.text);
      const url = `/files/${caseId}/${entity.attrs.path}`;
      const markup = imageMarkup({ href: url, alt: entity.label, title: token.title, ...options });
      return entity.attrs.kind === 'video'
        ? `<video controls src="${url}" class="${markup.className}"${markup.attrs}>${token.text}</video>`
        : `<img src="${url}" alt="${entity.label}" class="${markup.className}"${markup.attrs}>`;
    }
    const markup = imageMarkup({ href: options.href, alt: token.text, title: token.title, ...options });
    return `<img src="${options.href}" alt="${token.text}" class="${markup.className}"${markup.attrs}>`;
  };
  return value;
}

function renderAlignmentBlocks(source, options) {
  const blocks = [];
  const main = source.replace(ALIGNMENT_BLOCK, (_match, align, contents) => {
    const token = `AZIMUT_ALIGNMENT_BLOCK_${blocks.length}`;
    blocks.push({ token, align, contents });
    return token;
  });
  const rendered = marked.parse(main, options);
  return blocks.reduce((html, block) => html.replace(
    `<p>${block.token}</p>`,
    `<div class="markdown-align align-${block.align}">${marked.parse(block.contents, options)}</div>`,
  ), rendered);
}

/** Render GitHub-flavored Markdown, then remove unsafe HTML before previewing it. */
export function markdownHtml(text = '', { entities = [], caseId = '' } = {}) {
  const options = {
    gfm: true,
    breaks: false,
    renderer: renderer({ entities, caseId }),
  };
  const rendered = renderAlignmentBlocks(sourceWithCaseReferences(text), options);
  return sanitize(rendered);
}
