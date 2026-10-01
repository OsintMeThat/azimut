/**
 * The tools a picture or a video can be taken on to, as one list for every menu
 * that offers them: the Media Library's "Open in…" door and Files' right-click.
 * Labels come from `TOOL_LABELS`, keyed by the option's id.
 */
import { uiState } from './state.svelte.js';
import { openInReverseSearch } from './navigate.js';

/** `file` is `{ path, kind, label }`. Anything but a picture or a video has none. */
export function openInOptions(file) {
  if (!file?.path || (file.kind !== 'image' && file.kind !== 'video')) return [];
  return [
    {
      id: 'inspect',
      icon: 'inspect',
      run: () => {
        uiState.inspectPath = file.path;
        uiState.tool = 'inspect';
      },
    },
    { id: 'reverse', icon: 'search', run: () => openInReverseSearch(file) },
    ...(file.kind === 'image'
      ? [
          {
            id: 'proof',
            icon: 'proof',
            run: () => {
              if (!uiState.composeQueue.includes(file.path)) uiState.composeQueue.push(file.path);
              uiState.tool = 'proof';
            },
          },
        ]
      : []),
  ];
}
