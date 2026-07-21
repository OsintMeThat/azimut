export function caseTab() {
  return { id: 'case', noteId: null };
}

export function openNotebookTab(tabs, noteId = null) {
  const id = noteId ?? 'case';
  return {
    tabs: tabs.some((tab) => tab.id === id) ? tabs : [...tabs, { id, noteId }],
    activeId: id,
  };
}

export function closeNotebookTab(tabs, activeId, id) {
  if (id === 'case') return { tabs, activeId };
  const index = tabs.findIndex((tab) => tab.id === id);
  const nextTabs = tabs.filter((tab) => tab.id !== id);
  if (activeId !== id) return { tabs: nextTabs, activeId };
  return { tabs: nextTabs, activeId: (nextTabs[Math.max(0, index - 1)] ?? caseTab()).id };
}
