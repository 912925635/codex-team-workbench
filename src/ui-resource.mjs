import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../ui/${name}`, import.meta.url), 'utf8');
export function appHtml(preview = false) {
  return read('index.html').replace('/* APP_CSS */', () => read('style.css') + '\n' + read('browse.css'))
    .replace('/* APP_JS */', () => read('bridge.js') + '\n' + read('browser.js') + '\n' + read('app.js'))
    .replace('data-preview="false"', `data-preview="${preview}"`);
}
export const resourceMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false },
  'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' }
};
