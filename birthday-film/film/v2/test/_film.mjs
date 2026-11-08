/*
  Shared helper for the version-2 tests: opens film/v2/index.html in headless Chromium the way engine/render.js does.
    const f = await openFilm({variant, query, res}); await f.seek(t); const png = await f.capture(); await f.close();
  res (default 1) is the output scale (?res=N). After filmReady the viewport is resized to window.FILM.width x height (the
  physical capture size) at deviceScaleFactor 1, as render.js does; at res 1 it stays 1920x1080 / 1080x1920.
  The result carries film (window.FILM).
*/
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const HTML = path.join(ROOT, 'film', 'v2', 'index.html');

export async function openFilm({ variant = 'landscape', query = '', res = 1 } = {}) {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const portrait = variant === 'portrait';
  const vp = portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
  await page.goto('file://' + HTML + `?render=1${portrait ? '&variant=portrait' : ''}${res !== 1 ? '&res=' + res : ''}${query}`, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const film = await page.evaluate(() => window.FILM);
  if (film.width !== vp.width || film.height !== vp.height) await page.setViewportSize({ width: film.width, height: film.height });
  const cdp = await page.context().newCDPSession(page);
  return {
    browser, page, errors, film,
    seek: t => page.evaluate(t => window.seek(t), t),
    capture: async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true })).data, 'base64'),
    close: () => browser.close(),
  };
}
