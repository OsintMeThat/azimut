import { mount } from 'svelte';
import '@fontsource/oxanium/400.css';
import '@fontsource/oxanium/600.css';
import '@fontsource/oxanium/700.css';
import './app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app') });

export default app;
