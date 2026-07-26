import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Inspector.svelte', import.meta.url), 'utf8');

describe('Inspect sessions', () => {
  it('opens saved workspaces under an explicit label', () => {
    expect(source).toContain('<Icon name="folderOpen" size={14} /> Open session');
    expect(source).toContain('title="Reopen a saved session"');
  });

  it('uses the same non-gold colored save action as Proof', () => {
    expect(source).toContain('class="btn btn-ok btn-sm"');
    expect(source).toContain('onclick={saveSession}');
    expect(source).not.toContain('class="btn btn-primary btn-sm"\n        disabled={!session.source}');
  });

  it('names the session in the header, and saves under that name', () => {
    // Same affordance as the Proof Composer: the name is edited at the top of
    // the tool, and Save writes under it — there is no "name this" dialog.
    expect(source).toContain('<input class="input title-input" bind:value={sessionName}');
    expect(source).toContain('aria-label="Session name"');
    expect(source).toContain('rename_from: openedSession?.name ?? null, title, spec: sessionSpec()');
    expect(source).not.toContain("sessionModal.mode = 'save'");
    expect(source).not.toContain('placeholder="Session name"');
  });

  it('numbers a fresh session past the ones already in the case', () => {
    expect(source).toContain("nextName('session', savedTitles(sessionEntities, 'session'))");
  });

  it('flags unsaved work against the last save rather than a hand-set flag', () => {
    expect(source).toContain('{#if sessionDirty}<span class="badge">unsaved</span>{/if}');
    expect(source).toContain("const signature = () => JSON.stringify([sessionName.trim(), sessionSpec()]);");
  });

  it('asks before an unbound workspace takes a name another session holds', () => {
    expect(source).toContain('if (!openedSession && takenSlugs().has(slug))');
    expect(source).toContain('title="Overwrite this session?"');
  });

  it('starts new workspaces from a searchable image/video picker', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain("m.kind === 'image' || m.kind === 'video'");
    expect(source).toContain('<Icon name="plus" size={14} /> New session');
    expect(source).toContain('<h3 id="new-session-title">New session</h3>');
    expect(source).toContain('bind:value={sourceQuery}');
    expect(source).toContain('filteredSourceMedia.filter((m) => matchesSourceName(m, sourceQuery))');
    expect(source).toContain('{#each pickableMedia as m (m.path)}');
    expect(source).toContain('placeholder="Search names…"');
    expect(source).toContain('function matchesSourceName(item, query)');
    expect(source).toContain("matchesTerms(item.title || item.filename || '', query)");
    expect(source).toContain('label={(m) => m.title || m.filename}');
    expect(source).not.toContain('class="input source-select"');
    expect(source).not.toContain('Choose a media…');
  });

  it('offers New session from the centered empty state', () => {
    expect(source).toContain('<h3>Start a session</h3>');
    expect(source).toContain(`      <p>Start a session to choose media.</p>
      <button class="btn" onclick={startNewSession}>
        <Icon name="plus" size={15} /> New session
      </button>`);
  });

  it('separates images, videos, captures, frames, and collages in the new-session picker', () => {
    expect(source).toContain("{ id: 'all', label: 'All' }");
    expect(source).toContain("{ id: 'capture', label: 'Captures' }");
    expect(source).toContain("{ id: 'frame', label: 'Frames' }");
    expect(source).toContain("{ id: 'collage', label: 'Collages' }");
    expect(source).toContain("source.type === 'satellite' || source.type === 'screenshot'");
    expect(source).toContain("source.op === 'frame' || source.op === 'adjust'");
    expect(source).toContain("source.op === 'collage'");
  });

  it('adds session search only once the saved-session list has more than six entries', () => {
    expect(source).toContain('{#if sessionModal.list.length > 6}');
    expect(source).toContain('bind:value={sessionQuery}');
    expect(source).toContain('{#each visibleSessions as s (s.name)}');
  });

  it('offers a read-only folder browser with single selection and double-click confirmation', () => {
    expect(source).toContain('title="Browse folders"');
    expect(source).toContain('onconfirm={(m) => selectSourceBrowser(m, true)}');
    expect(source).toContain('onconfirm={(s) => selectSessionBrowser(s, true)}');
    expect(source).toContain('disabled={!sourceBrowseSelection} onclick={confirmSourceBrowser}');
    expect(source).toContain('disabled={!sessionBrowseSelection} onclick={confirmSessionBrowser}');
    expect(source).toContain("fetchAllEntities(caseState.current.id, { types: ['inspect-session'] })");
    expect(source).toContain('function toggleSourceBrowser()');
    expect(source).toContain('function toggleSessionBrowser()');
    expect(source).not.toContain('>Back</button>');
  });

  it('shares one folder-browser helper with the other pickers', () => {
    expect(source).toContain("import FolderBrowser from '../components/FolderBrowser.svelte'");
    expect(source).not.toContain('function browserView(');
    expect(source).not.toContain('class="browser-row"');
    expect(source).toContain('white-space: nowrap;');
  });

  it('requires an active workspace to be discarded before starting another', () => {
    expect(source).toContain('openSourceAfterDiscard = true;');
    expect(source).toContain('if (openSourceAfterDiscard) {');
    expect(source).toContain('openSourceDialog();');
  });

  it('keeps the Collage tab for video sessions but hides it for a still image', () => {
    expect(source).toContain(
      "session.source?.kind === 'video' ? ['selection', 'frame', 'collage', 'save'] : ['frame', 'save']"
    );
    expect(source).not.toContain(
      "session.source?.kind === 'video' ? ['selection', 'frame', 'collage', 'save'] : ['frame', 'collage', 'save']"
    );
  });

  it('names each savable after its source instead of Image 1', () => {
    expect(source).toContain('defaultName: `${stem} (enhanced)`');
    expect(source).toContain(
      "defaultName: fr.time == null ? `${frameStem} (edited)` : `${frameStem} ${timecode(fr.time)}`"
    );
    expect(source).not.toContain('label: `Image ${imgN}`');
    expect(source).not.toContain("label: 'Video 1'");
  });

  it('keeps typed names outside the derived list so a slider move cannot wipe them', () => {
    expect(source).toContain(
      "const saveUi = $state({ selected: {}, folder: '', names: {}, touched: {}, baseName: '', note: '' });"
    );
  });

  it('seeds every field with real text and lets the base name refill the untouched ones', () => {
    expect(source).toContain(`    const auto = autoSaveNames(savables, saveUi.baseName);
    savables.forEach((it, i) => {
      if (saveUi.touched[it.key]) return;
      if (it.kind === 'collage') it.collage.name = auto[i];
      else saveUi.names[it.key] = auto[i];
    });`);
  });

  it('gives a collage one name, shared by the Collage tab and the Save tab', () => {
    expect(source).toContain(
      "const saveName = (it) => (it.kind === 'collage' ? (it.collage.name ?? '') : (saveUi.names[it.key] ?? ''));"
    );
    expect(source).toContain(`    if (it.kind === 'collage') it.collage.name = value;
    else saveUi.names[it.key] = value;`);
    expect(source).toContain('<SaveGallery {savables} {saveUi} {saveName} {setSaveName} />');
  });

  it('protects a hand-renamed collage from being refilled by a base name', () => {
    expect(source).toContain('onRename={(cl) => (saveUi.touched[`collage:${cl.id}`] = true)}');
  });

  it('files every kind under its resolved name, with the batch note', () => {
    expect(source).toContain('const nameOf = (item) => saveNameOf(item, saveName(item));');
    expect(source).toContain('items: frameItems, folder, notes: note,');
    expect(source).toContain('label: nameOf(videoItem), notes: note,');
    expect(source).toContain('label: nameOf(it), notes: note,');
    expect(source).toContain('ops: buildFrameOps(filters, it.frame),\n          label: nameOf(it),');
  });

  it('says when a save landed on media the case already held', () => {
    expect(source).toContain("dupes += (res?.saved ?? []).filter((r) => r.duplicate).length;");
    expect(source).toContain("matched existing media and ${dupes === 1 ? 'was' : 'were'} renamed");
  });

  it('clears the naming fields when the workspace resets', () => {
    expect(source).toContain(`    saveUi.names = {};
    saveUi.touched = {};
    saveUi.baseName = '';
    saveUi.note = '';`);
  });
});
