import { mount } from 'svelte';
import '@fontsource/oxanium/400.css';
import '@fontsource/oxanium/600.css';
import '@fontsource/oxanium/700.css';
import './app.css';
import App from './App.svelte';
import GuidePage from './components/GuidePage.svelte';
import { watchDrags } from './lib/drag.js';
import { isGuideTab } from './lib/guideWindow.js';

watchDrags();
// the guide opened in a tab of its own is the guide alone, without the app around it
const target = document.getElementById('app');
const app = isGuideTab(location.hash) ? mount(GuidePage, { target }) : mount(App, { target });

export default app;
