// Browser checks of the built site (needs Playwright; not run by Cloudflare):  node --test test/browser.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as B from '../build.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.xml': 'application/xml', '.js': 'text/javascript', '.txt': 'text/plain', '.csv': 'text/csv', '.ico': 'image/x-icon' };
// A static server that answers the way Cloudflare Pages does: /x is x.html, unknown addresses get 404.html.
function serve(dir) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let f = path.join(dir, p);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { const nf = path.join(dir, '404.html'); res.writeHead(404, { 'Content-Type': TYPES['.html'] }); res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}
let browser, built, plain;
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
before(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orgel-browser-'));
  B.build({ root: ROOT, out, now: new Date('2026-11-25T16:00:00Z') });
  built = await serve(out); plain = await serve(ROOT);
  browser = await chromium.launch();
});
after(async () => { await browser.close(); built.srv.close(); plain.srv.close(); });
const rowsText = page => page.evaluate(() => [...document.querySelectorAll('#table-body tr')].map(tr => [...tr.children].map(td => td.innerText.trim()).join(' | ')));
const loaded = page => page.waitForFunction(() => document.querySelector('th[data-col="Company Name"]').classList.contains('sort-asc'));

test('built index: with scripts off the table is already there, every company linked', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false }), page = await ctx.newPage();
  await page.goto(built.url + '/');
  assert.equal(await page.locator('#table-body tr').count(), DATA.length);
  assert.equal(await page.locator('#table-body a.company-name').count(), DATA.length);
  await ctx.close();
});
test('built index: after the page’s script has run, the table reads exactly the same and the names are still links', async () => {
  const off = await browser.newContext({ javaScriptEnabled: false }), p0 = await off.newPage();
  await p0.goto(built.url + '/'); const before = await rowsText(p0); const links0 = await p0.evaluate(() => [...document.querySelectorAll('#table-body a.company-name')].map(a => a.getAttribute('data-t') + ' ' + a.getAttribute('href'))); await off.close();
  const page = await browser.newPage(); await page.goto(built.url + '/'); await loaded(page);
  assert.deepEqual(await rowsText(page), before);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#table-body a.company-name')].map(a => a.getAttribute('data-t') + ' ' + a.getAttribute('href'))), links0);
  await page.close();
});
test('built index: nothing moves when the script takes over', async () => {
  const box = async (js) => { const c = await browser.newContext({ javaScriptEnabled: js, viewport: { width: 1280, height: 900 } }), p = await c.newPage(); await p.goto(built.url + '/'); if (js) await loaded(p);
    const r = await p.evaluate(() => [...document.querySelectorAll('#table-body tr')].slice(0, 40).map(tr => { const b = tr.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height), ...[...tr.children].map(td => Math.round(td.getBoundingClientRect().width))].join(','); })); await c.close(); return r; };
  assert.deepEqual(await box(true), await box(false));
});
test('built index: searching and sorting keep the links', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/'); await loaded(page);
  await page.fill('#search', 'google');
  const hit = await page.evaluate(() => [...document.querySelectorAll('#table-body tr')].map(tr => tr.querySelector('a.company-name') && tr.querySelector('a.company-name').getAttribute('href')));
  assert.ok(hit.length >= 1 && hit.every(h => /^\/company\/alphabet/.test(h || '')), JSON.stringify(hit));
  await page.fill('#search', ''); await page.click('th[data-col="Report Year"]');
  assert.equal(await page.locator('#table-body a.company-name').count(), DATA.length);
  await page.close();
});
test('built index: a company name opens that company’s page', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/'); await loaded(page);
  await page.click('#table-body a.company-name[data-t="MMM"]');
  await page.waitForURL('**/company/3m');
  assert.equal(await page.locator('h1').innerText(), '3M Sustainability Report');
  await page.close();
});
test('built index: if the data cannot be fetched, the table that came with the page stays', async () => {
  const page = await browser.newPage();
  await page.route('**/data.json', r => r.abort());
  await page.goto(built.url + '/'); await page.waitForTimeout(600);
  assert.equal(await page.locator('#table-body a.company-name').count(), DATA.length);
  await page.close();
});
test('plain index (no build): the table is drawn by the script, names are plain text, as today', async () => {
  const page = await browser.newPage(); await page.goto(plain.url + '/'); await loaded(page);
  assert.equal(await page.locator('#table-body tr').count(), DATA.length);
  assert.equal(await page.locator('#table-body a.company-name').count(), 0);
  assert.equal(await page.locator('#table-body span.company-name').count(), DATA.length);
  await page.close();
});
test('built pages: no page spills sideways on a phone, and an unknown address gets the not-found page', async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } }), page = await ctx.newPage();
  for (const p of ['/company/3m', '/company/coca-cola-company', '/company/reddit', '/new', '/sector/energy', '/company/no-such-company']) {
    const res = await page.goto(built.url + p);
    assert.equal(res.status(), /no-such|\/sector\//.test(p) ? 404 : 200, p);          // sectors have no pages of their own (Kyle, 2026-11-26); on Cloudflare the worker answers these itself
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'sideways scroll on ' + p);
  }
  assert.equal(await page.locator('h1').innerText(), 'Page not found');
  await ctx.close();
});

// ---------- Kyle's changes, 2026-11-26 ----------
const SECTOR = name => DATA.filter(r => r.fields['Sector / Industry'] === name).length;
test('built index: /?sector=Energy opens the table with that sector chosen', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/?sector=Energy'); await loaded(page);
  assert.equal(await page.inputValue('#sector-filter'), 'Energy');
  assert.equal(await page.locator('#table-body tr').count(), SECTOR('Energy'));
  assert.deepEqual([...new Set(await page.evaluate(() => [...document.querySelectorAll('#table-body .sector-tag')].map(x => x.innerText.trim())))], ['Energy']);
  await page.close();
});
test('built index: the sector in the address may be in any letter case, and an unknown one shows every company', async () => {
  const page = await browser.newPage();
  await page.goto(built.url + '/?sector=information%20technology'); await loaded(page);
  assert.equal(await page.inputValue('#sector-filter'), 'Information Technology');
  assert.equal(await page.locator('#table-body tr').count(), SECTOR('Information Technology'));
  await page.goto(built.url + '/?sector=Nonsense'); await loaded(page);
  assert.equal(await page.inputValue('#sector-filter'), '');
  assert.equal(await page.locator('#table-body tr').count(), DATA.length);
  await page.close();
});
test('built index: a company name looks like a link (the site\u2019s red, underlined)', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/'); await loaded(page);
  const st = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#table-body a.company-name')); return { color: c.color, line: c.textDecorationLine }; });
  assert.deepEqual(st, { color: 'rgb(196, 32, 44)', line: 'underline' });
  await page.close();
});
test('company page: the second button opens the index with that sector chosen', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/company/3m');
  assert.equal(await page.locator('.pg-actions a.pg-btn-line').innerText(), 'All ' + SECTOR('Industrials') + ' Industrials companies');
  await page.click('.pg-actions a.pg-btn-line'); await loaded(page);
  assert.equal(new URL(page.url()).search, '?sector=Industrials');
  assert.equal(await page.locator('#table-body tr').count(), SECTOR('Industrials'));
  await page.close();
});
test('company page: the title sits clear of the trail above it', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await page.goto(built.url + '/company/3m');
  const gap = await page.evaluate(() => document.querySelector('.orgel-band h1').getBoundingClientRect().top - document.querySelector('.pg-crumbs').getBoundingClientRect().bottom);
  assert.ok(gap >= 20, 'gap between the trail and the title: ' + gap + 'px');
  await page.close();
});

// ---------- Kyle, 2026-11-26 (second round): no Status, no footer, New Reports linked from the index only ----------
test('built index: six columns, no Status, no status filter', async () => {
  const page = await browser.newPage(); await page.goto(built.url + '/'); await loaded(page);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#main-table thead th')].map(th => th.textContent.trim())), ['Company', 'Ticker', 'Sector', 'Report Name', 'Report Year', 'Report Link']);
  assert.equal(await page.evaluate(() => Math.max(...[...document.querySelectorAll('#table-body tr')].map(tr => tr.children.length))), 6);
  assert.equal(await page.locator('#status-filter').count(), 0);
  assert.equal(await page.locator('.status-badge').count(), 0);
  await page.fill('#search', 'active');          // used to match 500 rows through a status nobody could see
  assert.ok(await page.locator('#table-body tr').count() < 60, 'rows for "active": ' + await page.locator('#table-body tr').count());
  await page.close();
});
test('built index: New Reports sits between the sector filter and Download, looks like the other buttons, and opens the new-reports page', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await page.goto(built.url + '/'); await loaded(page);
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('.controls').children].map(el => el.id || el.getAttribute('href') || el.className)), ['search-wrap', 'sector-filter', '/new', 'download-xlsx', '/developers']);
  const look = await page.evaluate(() => { const css = el => { const c = getComputedStyle(el), r = el.getBoundingClientRect(); return [c.backgroundColor, c.color, Math.round(r.height), Math.round(r.top)].join(' '); }; return [css(document.querySelector('.controls a[href="/new"]')), css(document.querySelector('.controls a[href="/developers"]'))]; });
  assert.equal(look[0], look[1], 'same colours, height and line as Data & API');
  assert.equal(await page.locator('.controls a[href="/new"]').innerText(), 'New Reports');
  await page.click('.controls a[href="/new"]'); await page.waitForURL('**/new');
  assert.equal(await page.locator('h1').innerText(), 'New sustainability reports');
  await page.close();
});
test('built pages: no footer, and no link to the new-reports page except on the index', async () => {
  const page = await browser.newPage();
  for (const p of ['/company/3m', '/company/reddit', '/company/fair-isaac', '/new', '/company/no-such-company']) {
    await page.goto(built.url + p);
    assert.equal(await page.locator('footer').count(), 0, p);
    assert.equal(await page.locator('a[href="/new"]').count(), 0, p);
  }
  await page.goto(built.url + '/company/3m');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.pg-facts th')].map(th => th.textContent)), ['Company', 'Ticker', 'Sector', 'Latest Report', 'Report Year', 'Sustainability Page']);
  await page.close();
});
