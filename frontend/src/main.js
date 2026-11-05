import { mount } from 'svelte';
import '@fontsource/oxanium/400.css';
import '@fontsource/oxanium/600.css';
import '@fontsource/oxanium/700.css';
import './app.css';
import App from './App.svelte';
import GuidePage from './components/GuidePage.svelte';
import { watchDrags } from './lib/drag.js';
import { isGuideTab } from './lib/guideWindow.js';
import { inNotePanel } from './lib/notes/panel.js';

watchDrags();
// the guide opened in a tab of its own is the guide alone, without the app around it
const target = document.getElementById('app');
let app = null;
if (isGuideTab(location.hash)) app = mount(GuidePage, { target });
// the note in the extension's side panel is the note alone, loaded with its editor
else if (inNotePanel(location.hash)) import('./components/NotePanel.svelte').then(({ default: NotePanel }) => mount(NotePanel, { target }));
else app = mount(App, { target });

export default app;
