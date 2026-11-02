import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const output = resolve('public/ocr');
await mkdir(output, { recursive: true });
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
await copyFile(resolve(tesseract, 'dist/worker.min.js'), resolve(output, 'worker.min.js'));
for (const file of await readdir(core)) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)) await copyFile(resolve(core, file), resolve(output, file));
}
for (const language of ['eng', 'chi_sim']) {
  const root = dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
  await copyFile(resolve(root, `4.0.0_best_int/${language}.traineddata.gz`), resolve(output, `${language}.traineddata.gz`));
}
console.log('OCR worker、WebAssembly 和中英文语言包已准备完毕（全部同源）。');
