import { readdir, readFile, writeFile } from 'node:fs/promises';
async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? list(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  return nested.flat();
}
const files = (await list('dist')).map(file => `./${file.slice(5)}`).filter(file => file !== './sw.js');
// Version changes with each production build; old cache survives until the new app is complete.
const version = `run-for-life-${Date.now()}`;
const template = await readFile('scripts/sw-template.js', 'utf8');
await writeFile('dist/sw.js', template.replace('__VERSION__', JSON.stringify(version)).replace('__SHELL__', JSON.stringify(files.filter(file => !file.startsWith('./ocr/')))));
console.log('PWA app shell generated; OCR assets cached on first use.');
