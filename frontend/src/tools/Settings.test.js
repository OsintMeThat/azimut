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
    expect(source).toContain("if (tab === 'about' && !report) loadReport()");
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
    expect(source).toContain('settings, keys, templates and signature');
    expect(source).toContain('login session stays on this machine');
    expect(source).toContain('Export backup');
    expect(source).toContain('Import backup');
  });
});
