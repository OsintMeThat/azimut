import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { caseState, uiState } from '../lib/state.svelte.js';
import PostComposer from './PostComposer.svelte';

const source = readFileSync(new URL('./PostComposer.svelte', import.meta.url), 'utf8');

describe('Post media picker search', () => {
  it('shows a search box only once the picker holds more than six items', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('{#if pickerItems().length > 6}');
    expect(source).toContain('bind:value={pickerQuery}');
  });

  it('renders the filtered items and resets the query when the picker opens', () => {
    expect(source).toContain("import { matchesQuery } from '../lib/mediaFilter.js'");
    expect(source).toContain('items.filter((m) => matchesQuery(m, q))');
    expect(source).toContain('{#each (caseState.current ? visiblePickerItems() : []) as item (item.path)}');
    expect(source).toContain('pickerQuery = \'\';');
  });
});

afterEach(() => {
  caseState.current = null;
  uiState.postProof = null;
});

describe('Geo Report actions', () => {
  it('offers Save report and removes the old Copy report action', () => {
    caseState.current = { id: 'case-1', folders: [], entities: [] };

    const { body } = render(PostComposer);

    expect(body).toContain('Save report');
    expect(body).toContain('Publish on');
    expect(body).not.toContain('Copy report');
  });

  it('files the report note against what it was written from', () => {
    // the note embeds the proof and its media, so the graph has to say which case
    // files it depends on — otherwise deleting a proof leaves a dead image link
    // nothing accounted for, and the note sits in the case with no chain at all
    expect(source).toContain('...reportAttachmentPaths(),');
    expect(source).toContain("...(draftName ? [specPath('draft', draftName)] : []),");
  });

  it('checks the current hidden draft path before claiming a saved draft was deleted', () => {
    expect(source).toContain("lookupEntity(id, specAttr('draft'), specPath('draft', draft))");
  });
});

describe('Proof handoff', () => {
  it('files the current thread and starts a fresh one when a new proof arrives', () => {
    expect(source).toContain("import { filingName, planProofHandoff } from './post/handoff.js';");
    expect(source).toContain(
      'const plan = planProofHandoff({ incomingPng: p.png, currentPng: proofPng, hasContent });'
    );
    expect(source).toContain("if (plan === 'file-then-apply') {");
    expect(source).toContain('if (!(await fileCurrentDraft())) return;');
    expect(source).toContain('resetDraft();\n    }\n    applyProof(p);');
  });

  it('keeps the outgoing thread when its save fails, rather than losing it', () => {
    expect(source).toContain('const saved = await performDraftSave(`Post saved: ${postName.trim()}`);');
    expect(source).toContain('if (!saved) return false;');
  });
});

describe('Post naming', () => {
  it('names the draft in the header, like Inspect and the Proof Composer', () => {
    expect(source).toContain('<input class="input title-input" bind:value={postName}');
    expect(source).toContain('aria-label="Post name"');
  });

  it('names a fresh draft "Post N" instead of deriving it from the place field', () => {
    expect(source).toContain("const freshPostName = () => nextName('draft', savedTitles(draftEntities, 'draft'));");
    expect(source).not.toContain("place.trim() || description.trim() || 'Untitled post'");
  });

  it('renames in place: saving sends the bound slug so the backend moves the file', () => {
    expect(source).toContain('rename_from: draftName,');
    expect(source).toContain('title: postName.trim(),');
    expect(source).toContain('postName = r.title;');
  });

  it('asks before an unbound draft takes a name another draft holds', () => {
    expect(source).toContain("if (!draftName && savedSlugs(draftEntities, 'draft').has(slugify(title, 'draft')))");
    expect(source).toContain('title="Overwrite this draft?"');
  });

  it('does not carry an auto-assigned proof name into the post text', () => {
    expect(source).toContain("isDefaultName(p.title, 'proof') ? '' : (p.title ?? '')");
    expect(source).toContain("!isDefaultName(item.title, 'proof')");
  });
});

describe('Post Composer — coordinates that no longer parse', () => {
  const composer = readFileSync(new URL('./PostComposer.svelte', import.meta.url), 'utf8');

  it('stops publishing the old point when a re-parse fails', () => {
    // The facts card, the tweet text, the copy buttons and the saved report all
    // read `geo`. Leaving the previous one in place kept every one of them
    // stating a location the input no longer showed.
    expect(composer).toMatch(
      /\} catch \{[\s\S]*?geo = null;\s*\n\s*regenerate\(\);\s*\n\s*toast\('Could not parse coordinates'/
    );
  });
});

describe('the attached proof', () => {
  const card = source.slice(
    source.indexOf('<!-- Post 1: geolocation -->'),
    source.indexOf('<!-- Post 2: media (Video / Image) -->'),
  );

  it('rides on the geolocation post, which is the post that carries it', () => {
    // It used to sit in the field column, a screen away from the text it is
    // published with, and reading the thread said nothing about the picture.
    expect(card).toContain('onclick={openProofPicker}');
    expect(card).toContain('<img class="proof-preview card" src={proofHref} alt="proof" />');
    expect(source).not.toContain('class="proof-head"');
    expect(source).not.toContain('Attached proof');
  });

  it('carries it the way every other post carries its media', () => {
    expect(card).toContain('<div class="media-attach">');
    expect(card).toContain('<span class="attach-chip">');
    expect(card).toContain('onclick={clearProof}');
  });
});

describe('handing the thread to the extension', () => {
  const publish = source.slice(source.indexOf('function handoffPayload'), source.indexOf('<div class="tool">'));

  it('sends paths, never files: the extension reads the bytes from the app itself', () => {
    expect(publish).toContain('files: proofPng ? [proofPng] : []');
    expect(publish).toContain('files: mediaPaths');
    expect(publish).toContain('files: tweet.mediaPaths');
    expect(publish).toContain('caseId: caseState.current.id');
    expect(publish).not.toContain('base64');
  });

  it('falls back to the page it always opened, for every way the hand-off can fail', () => {
    // absent, off, not permitted, a target it cannot fill: one answer, one path
    expect(publish).toContain('|| !extensionVersion()) return false;');
    expect(publish).toContain('if (!url || !caseState.current) return false;');
    expect(publish).toMatch(/catch \(e\) \{[\s\S]*?return false;/);
    expect(publish).toContain('if (await tryHandOff()) return;');
    expect(publish).toContain('window.open(url, \'_blank\', \'noopener,noreferrer\')');
  });

  it('copies the thread before handing it over, so a short fill is never a loss', () => {
    const body = source.slice(source.indexOf('async function publish()'), source.indexOf('</script>'));
    expect(body.indexOf('await copyAll(false);')).toBeLessThan(body.indexOf('tryHandOff()'));
  });

  it('says nothing was posted, because nothing was', () => {
    expect(publish).toContain('Nothing was posted.');
  });
});

describe('the Settings switch for filling the composer', () => {
  it('is what Publish asks first, so turning it off is the end of it', () => {
    expect(source).toContain('if (!prefs.postPrefill || !extensionVersion()) return false;');
  });

  it('claims only what is true when it says it: the fill is still running', () => {
    expect(source).toContain('is opening with the thread.');
    expect(source).not.toContain('Filled ${filled}');
  });
});

describe('when the extension does not take the thread', () => {
  const excuse = source.slice(source.indexOf('function handOffExcuse'), source.indexOf('* Let the extension open'));

  it('names the one reason the analyst can act on: an extension older than the app', () => {
    // A build that predates the feature has no route for the message and says
    // nothing at all, so Publish quietly did the old thing and read as broken.
    expect(excuse).toContain('extensionOutdated(installed, updatesState.extensionBundled)');
    expect(excuse).toContain('Reinstall it from Settings → Capture extension');
  });

  it('passes on the extension\'s own answer when pairing is what is missing', () => {
    expect(excuse).toContain('/paired/.test(error.message)');
    expect(excuse).toContain('Composer not filled:');
  });

  it('stays quiet otherwise, since the fallback is the behaviour they know', () => {
    expect(excuse).toContain(': null;');
    expect(source).toContain('if (excuse) toast(excuse, \'warn\', 6000);');
  });
});
