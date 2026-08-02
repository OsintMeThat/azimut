import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Settings.svelte', import.meta.url), 'utf8');

describe('Report an issue', () => {
  it('lets the user say what happened, bug or request', () => {
    expect(source).toContain("let reportKind = $state('bug')");
    expect(source).toContain('bind:value={reportSummary}');
    expect(source).toContain('maxlength="2000"');
    expect(source).toContain('Something is broken');
    expect(source).toContain('Something is missing');
  });

  it('asks the server for the report and debounces typing', () => {
    expect(source).toContain("api.get(`/api/settings/diagnostics?${params}`)");
    expect(source).toContain('clearTimeout(reportTimer)');
    expect(source).toContain('setTimeout(loadReport, 400)');
    expect(source).toContain("if (tab === 'system' && !report) loadReport()");
  });

  it('files through a real anchor, so no popup blocker sees a deferred open', () => {
    expect(source).toContain('href={report?.url || `${REPO_URL}/issues/new`}');
    expect(source).not.toContain('window.open(report');
  });

  it('shows the exact report before it is filed, and can copy it whole', () => {
    expect(source).toContain('<summary>What gets sent</summary>');
    expect(source).toContain('<pre class="mono">{report.report}</pre>');
    expect(source).toContain('navigator.clipboard.writeText(report.report)');
  });

  it('warns that the tracker is public', () => {
    expect(source).toContain('public GitHub tracker; anyone can read it');
  });
});

describe('Backup', () => {
  it('posts the bundle as-is, and wraps a pre-bundle settings file', () => {
    expect(source).toContain('const bundle = parsed.settings ? parsed : { settings: parsed }');
    expect(source).toContain("api.post('/api/settings/import', bundle)");
  });

  it('reloads what a restore can change, logo included', () => {
    expect(source).toContain('await loadTemplates()');
    expect(source).toContain('sigBust += 1');
  });

  it('says what the file holds, and what it leaves behind', () => {
    expect(source).toContain('settings, keys, templates and your signature');
    expect(source).toContain('export folders and');
    expect(source).toContain('download logins stay here');
    expect(source).toContain('keep this backup private');
    expect(source).toContain('Export backup');
    expect(source).toContain('Import backup');
  });

  it('keeps the download and import controls wired after moving to Storage', () => {
    expect(source).toContain("{#if tab === 'storage'}");
    expect(source).toContain('href="/api/settings/export" download');
    expect(source).toContain('onchange={importSettings}');
  });
});

describe('Workspace folder', () => {
  it('keeps workspace management in Storage', () => {
    expect(source).toContain("{#if tab === 'storage'}");
    expect(source).toContain('<WorkspaceFolder onchange={(status) => (about.workspace_root = status.root)} />');
  });
});

describe('Settings sections', () => {
  it('separates workflow preferences from app maintenance', () => {
    for (const id of ['general', 'publishing', 'imagery', 'templates', 'extension', 'storage', 'system']) {
      expect(source).toContain(`id: '${id}'`);
    }
    expect(source).toContain("let tab = $state('general')");
  });

  it('keeps old direct links useful while callers migrate', () => {
    expect(source).toContain("const aliases = { preferences: 'general', about: 'system' }");
  });

  it('manages all three export folders from Storage', () => {
    expect(source).toContain("{ id: 'notes', label: 'Note PDFs' }");
    expect(source).toContain("{ id: 'media', label: 'Media copies' }");
    expect(source).toContain("{ id: 'proofs', label: 'Proof PNGs' }");
    expect(source).toContain('<ExportFolderPicker');
    expect(source).toContain("await saveDestination(kind, '')");
  });
});
