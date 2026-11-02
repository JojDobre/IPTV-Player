import './styles.css';   // in the entry, so the page is styled from the first frame (not after the language loads)
import { loadLang } from './i18n.js';
// The page stays hidden (index.html) until the app has translated and drawn it: no flash of raw markup.
const show = () => requestAnimationFrame(() => document.body.classList.add('ready'));
loadLang().finally(() => import('./app.js').finally(show));
setTimeout(show, 4000);   // never stay hidden if something above failed
