import { describe, expect, it } from 'vitest';
import { caseTab, closeNotebookTab, openNotebookTab } from './notebookTabs.js';

describe('Notebook tabs', () => {
  it('opens a filed note once and focuses its tab', () => {
    const first = openNotebookTab([caseTab()], 'e_lead');
    const second = openNotebookTab(first.tabs, 'e_lead');
    expect(second.tabs).toHaveLength(2);
    expect(second.activeId).toBe('e_lead');
  });

  it('keeps case notes pinned and focuses the previous tab when closing', () => {
    const tabs = [caseTab(), { id: 'e_lead', noteId: 'e_lead' }, { id: 'e_time', noteId: 'e_time' }];
    expect(closeNotebookTab(tabs, 'e_time', 'e_time')).toEqual({
      tabs: [caseTab(), { id: 'e_lead', noteId: 'e_lead' }], activeId: 'e_lead',
    });
    expect(closeNotebookTab(tabs, 'case', 'case')).toEqual({ tabs, activeId: 'case' });
  });
});
