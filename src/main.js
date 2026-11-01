// Entry: the chosen language's texts are loaded first, so the app draws its first screen already translated.
import { loadLang } from './i18n.js';
loadLang().finally(() => import('./app.js'));
