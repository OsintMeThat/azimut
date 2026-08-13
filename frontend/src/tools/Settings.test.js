import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

const shell = read('./Settings.svelte');
const storage = read('./settings/StorageTab.svelte');
const system = read('./settings/SystemTab.svelte');
const general = read('./settings/GeneralTab.svelte');

// The tabs are seven components rendering into one pane, so an assertion about a
// section reads that section's file. Assertions about the load/save side read the
// shell, which still owns every request.
const family = [shell, storage, system, general].join('\n');

describe('Report an issue', () => {
  it('lets the user say what happened, bug or request', () => {
    expect(shell).toContain("let reportKind = $state('bug')");
    expect(system).toContain('bind:value={reportSummary}');
    expect(system).toContain('maxlength="2000"');
    expect(system).toContain('Something is broken');
    expect(system).toContain('Something is missing');
  });

  it('asks the server for the report and debounces typing', () => {
    expect(shell).toContain("api.get(`/api/settings/diagnostics?${params}`)");
    expect(shell).toContain('clearTimeout(reportTimer)');
    expect(shell).toContain('setTimeout(loadReport, 400)');
    expect(shell).toContain("if (tab === 'system' && !report) loadReport()");
  });

  it('files through a real anchor, so no popup blocker sees a deferred open', () => {
    expect(system).toContain('href={report?.url || `${REPO_URL}/issues/new`}');
    expect(family).not.toContain('window.open(report');
  });

  it('shows the exact report before it is filed, and can copy it whole', () => {
    expect(system).toContain('<summary>What gets sent</summary>');
    expect(system).toContain('<pre class="mono">{report.report}</pre>');
    expect(shell).toContain('navigator.clipboard.writeText(report.report)');
  });

  it('warns that the tracker is public', () => {
    expect(system).toContain('public GitHub tracker; anyone can read it');
  });
});

describe('Backup', () => {
  it('posts the bundle as-is, and wraps a pre-bundle settings file', () => {
    expect(shell).toContain('const bundle = parsed.settings ? parsed : { settings: parsed }');
    expect(shell).toContain("api.post('/api/settings/import', bundle)");
  });

  it('reloads what a restore can change, logo included', () => {
    expect(shell).toContain('await loadTemplates()');
    expect(shell).toContain('sigBust += 1');
  });

  it('says what the file holds, and what it leaves behind', () => {
    expect(storage).toContain('settings, keys, templates and your signature');
    expect(storage).toContain('export folders and');
    expect(storage).toContain('download logins stay here');
    expect(storage).toContain('keep this backup private');
    expect(storage).toContain('Export backup');
    expect(storage).toContain('Import backup');
  });

  it('keeps the download and import controls wired after moving to Storage', () => {
    expect(shell).toContain("{#if tab === 'storage'}");
    expect(storage).toContain('href="/api/settings/export" download');
    expect(storage).toContain('onchange={importSettings}');
  });
});

describe('Workspace folder', () => {
  it('keeps workspace management in Storage', () => {
    expect(shell).toContain("{#if tab === 'storage'}");
    expect(storage).toContain(
      '<WorkspaceFolder onchange={(status) => (about.workspace_root = status.root)} />'
    );
  });
});

describe('Settings sections', () => {
  it('separates workflow preferences from app maintenance', () => {
    for (const id of ['general', 'publishing', 'imagery', 'templates', 'extension', 'storage', 'system']) {
      expect(shell).toContain(`id: '${id}'`);
    }
    expect(shell).toContain("let tab = $state('general')");
  });

  it('gives each section its own file, and renders every one of them', () => {
    for (const [id, component] of [
      ['general', 'GeneralTab'],
      ['publishing', 'PublishingTab'],
      ['imagery', 'ImageryTab'],
      ['templates', 'TemplatesTab'],
      ['extension', 'ExtensionTab'],
      ['storage', 'StorageTab'],
      ['system', 'SystemTab'],
    ]) {
      expect(shell).toContain(`import ${component} from './settings/${component}.svelte'`);
      expect(shell).toContain(`{#if tab === '${id}'}`);
      expect(shell).toContain(`<${component}`);
    }
  });

  it('keeps old direct links useful while callers migrate', () => {
    expect(shell).toContain("const aliases = { preferences: 'general', about: 'system' }");
  });

  it('offers the proof point as save-or-ask, never as a status', () => {
    expect(general).toContain('proof_place_auto: proofPlaceAuto');
    expect(shell).toContain('proofPlaceAuto = s.proof_place_auto ?? true');
    expect(general).toContain('Save the point without asking');
    expect(general).toContain('Off, the composer asks each time.');
  });

  it('manages all three export folders from Storage', () => {
    expect(shell).toContain("{ id: 'notes', label: 'Note PDFs' }");
    expect(shell).toContain("{ id: 'media', label: 'Media copies' }");
    expect(shell).toContain("{ id: 'proofs', label: 'Proof PNGs' }");
    expect(shell).toContain('<ExportFolderPicker');
    expect(shell).toContain("await saveDestination(kind, '')");
  });
});
