import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('SUIT is bundled, licensed, preloaded and shared with canvas charts', () => {
  const font = readFileSync(new URL('vendor/fonts/SUIT-Variable.woff2', root));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.equal(createHash('sha256').update(font).digest('hex'), 'aa894a204d5a6fbae259dac6868d350cbd373a390caee0313f92946af741df23');
  assert.match(read('vendor/fonts/SUIT-LICENSE.txt'), /SIL OPEN FONT LICENSE/);
  assert.match(read('index.html'), /rel="preload"[^>]+SUIT-Variable\.woff2/);
  assert.match(read('notebook.css'), /font-family: SUIT/);
  assert.match(read('src/lib/chart.js'), /fontFamily: "SUIT/);
  assert.doesNotMatch(read('notebook.css'), /https?:\/\//);
});

test('interface assets contain no emoji and retain Korean word wrapping', () => {
  const files = ['index.html', 'styles.css', 'notebook.css'];
  for (const dir of ['src/views', 'src/content']) {
    files.push(...readdirSync(new URL(dir, root)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`));
  }
  for (const file of files) assert.doesNotMatch(read(file), /\p{Emoji_Presentation}|\uFE0F|\u200D/u, file);
  assert.match(read('styles.css'), /word-break: keep-all/);
  assert.doesNotMatch(read('notebook.css'), /word-break:\s*(normal|break-all)/);
  assert.match(read('index.html'), /assets\/chart-mark\.svg/);
});

test('all actual-chart exercises keep the shared chart and note layout', () => {
  for (const view of ['chart-course', 'assessment', 'review']) {
    assert.match(read(`src/views/${view}.js`), /arrangeStudyDesk\(area, chartBox, panelWrap\)/);
  }
  assert.match(read('src/views/real-study.js'), /div\.study-desk/);
  assert.match(read('notebook.css'), /max-width: 1000px/);
});
