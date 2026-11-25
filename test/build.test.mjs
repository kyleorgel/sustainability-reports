// Tests for build.mjs - run with:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../build.mjs';

// ---------- names ----------
test('displayName moves a trailing "(The)" to the front', () => {
  assert.equal(B.displayName('Coca-Cola Company (The)'), 'The Coca-Cola Company');
  assert.equal(B.displayName('Hartford (The)'), 'The Hartford');
});
test('displayName moves a first name in brackets to the front', () => {
  assert.equal(B.displayName('Lilly (Eli)'), 'Eli Lilly');
});
test('displayName keeps share classes and plain names as they are', () => {
  assert.equal(B.displayName('Alphabet Inc. (Class A)'), 'Alphabet Inc. (Class A)');
  assert.equal(B.displayName('3M'), '3M');
  assert.equal(B.displayName('  Apple Inc. '), 'Apple Inc.');
});

// ---------- web addresses ----------
test('slugOf makes a lower-case address from the name', () => {
  assert.equal(B.slugOf('Apple'), 'apple');
  assert.equal(B.slugOf('3M'), '3m');
  assert.equal(B.slugOf('A. O. Smith'), 'a-o-smith');
});
test('slugOf drops "The", keeps share classes, handles & and apostrophes and accents', () => {
  assert.equal(B.slugOf('Coca-Cola Company (The)'), 'coca-cola-company');
  assert.equal(B.slugOf('Lilly (Eli)'), 'eli-lilly');
  assert.equal(B.slugOf('Fox Corporation (Class A)'), 'fox-corporation-class-a');
  assert.equal(B.slugOf('AT&T'), 'at-t');
  assert.equal(B.slugOf("Lowe's"), 'lowes');
  assert.equal(B.slugOf('Lowe’s'), 'lowes');
  assert.equal(B.slugOf('Estée Lauder Companies (The)'), 'estee-lauder-companies');
  assert.equal(B.slugOf('J.M. Smucker Company (The)'), 'j-m-smucker-company');
});
test('slugOf leaves off a legal ending such as Inc., Corp., Ltd. or plc', () => {
  assert.equal(B.slugOf('Apple Inc.'), 'apple');
  assert.equal(B.slugOf('Block, Inc.'), 'block');
  assert.equal(B.slugOf('Coherent Corp.'), 'coherent');
  assert.equal(B.slugOf('Flex Ltd.'), 'flex');
  assert.equal(B.slugOf('Aon plc'), 'aon');
  assert.equal(B.slugOf('Alphabet Inc. (Class A)'), 'alphabet-class-a');
});
test('slugOf keeps those letters when they are part of the name', () => {
  assert.equal(B.slugOf('Incyte'), 'incyte');
  assert.equal(B.slugOf('Arthur J. Gallagher & Co.'), 'arthur-j-gallagher-co');
  assert.equal(B.slugOf('Deere & Company'), 'deere-company');
  assert.equal(B.slugOf('Inc.'), 'inc');                // nothing would be left
});
test('slugOf never returns an empty address', () => {
  assert.equal(B.slugOf('***'), '');           // the caller falls back to the ticker
});
test('assignSlugs gives every company its own address, by ticker', () => {
  const rows = [{ company: 'Apple Inc.', ticker: 'AAPL' }, { company: 'News Corp (Class A)', ticker: 'NWSA' }, { company: 'News Corp (Class B)', ticker: 'NWS' }];
  const m = B.assignSlugs(rows);
  assert.equal(m.get('AAPL'), 'apple');
  assert.equal(m.get('NWSA'), 'news-corp-class-a');
  assert.equal(m.get('NWS'), 'news-corp-class-b');
});
test('assignSlugs adds the ticker when two names would share an address, the same way whatever the order', () => {
  const a = B.assignSlugs([{ company: 'Acme', ticker: 'ACM' }, { company: 'ACME!', ticker: 'ACX' }]);
  const b = B.assignSlugs([{ company: 'ACME!', ticker: 'ACX' }, { company: 'Acme', ticker: 'ACM' }]);
  assert.equal(a.get('ACM'), 'acme-acm'); assert.equal(a.get('ACX'), 'acme-acx');
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.equal(new Set(a.values()).size, 2);
});
test('assignSlugs uses the ticker when the name gives no address', () => {
  assert.equal(B.assignSlugs([{ company: '***', ticker: 'BRK.B' }]).get('BRK.B'), 'brk-b');
});

// ---------- one company record ----------
test('normalize reads a data.json record the way the API does', () => {
  const r = B.normalize({ fields: { 'Company Name': ' 3M ', 'Ticker': 'MMM', 'Sector / Industry': 'Industrials', 'Report Name': '2026 Global Impact Report', 'Report Year': '2026', 'Report URL': 'https://x.example/r.pdf', 'Landing Page URL': 'https://x.example/s', 'Status': 'Active' } });
  assert.deepEqual(r, { company: '3M', ticker: 'MMM', sector: 'Industrials', reportName: '2026 Global Impact Report', reportYear: 2026, status: 'Active', reportUrl: 'https://x.example/r.pdf', landingPageUrl: 'https://x.example/s' });
});
test('normalize treats "None Published", blanks and non-links as nothing', () => {
  const r = B.normalize({ fields: { 'Company Name': 'Reddit', 'Ticker': 'RDDT', 'Sector / Industry': 'Communication Services', 'Report Name': 'None Published', 'Report Year': '', 'Report URL': 'None Published', 'Landing Page URL': 'javascript:alert(1)' } });
  assert.equal(r.reportName, null); assert.equal(r.reportYear, null); assert.equal(r.reportUrl, null); assert.equal(r.landingPageUrl, null); assert.equal(r.status, 'None');
});
test('normalize: a landing page alone still counts as Active', () => {
  const r = B.normalize({ fields: { 'Company Name': 'Vylor', 'Ticker': 'VYLR', 'Landing Page URL': 'https://v.example/esg' } });
  assert.equal(r.status, 'Active'); assert.equal(r.reportUrl, null);
});

// ---------- the index page: one table row, as the page's own script draws it ----------
const F = { 'Company Name': '3M', 'Ticker': 'MMM', 'Sector / Industry': 'Industrials', 'Report Name': '2026 Global Impact Report', 'Report Year': '2026', 'Report URL': 'https://multimedia.3m.com/r.pdf?a=1&b=2', 'Landing Page URL': 'https://www.3m.com/s', 'Status': 'Active' };
const cells = html => [...html.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
test('rowHtml: seven cells with the company, ticker, sector, report, year, status and the View link', () => {
  const h = B.rowHtml(F, '/company/3m');
  assert.deepEqual(cells(h), ['3M', 'MMM', 'Industrials', '2026 Global Impact Report', '2026', 'Active', 'View']);
  assert.match(h, /<a class="report-link" href="https:\/\/multimedia\.3m\.com\/r\.pdf\?a=1&amp;b=2" target="_blank" rel="noopener">/);
  assert.match(h, /<span class="status-badge status-active">Active<\/span>/);
});
test('rowHtml: the company name is a link to its page and carries the ticker', () => {
  assert.match(B.rowHtml(F, '/company/3m'), /<td><a class="company-name" data-t="MMM" href="\/company\/3m">3M<\/a><\/td>/);
});
test('rowHtml: without a page address the name is plain text, as before', () => {
  assert.match(B.rowHtml(F, ''), /<td><span class="company-name">3M<\/span><\/td>/);
});
test('rowHtml: falls back to the landing page, and shows a dash and None when there is no link at all', () => {
  const lp = B.rowHtml({ ...F, 'Report URL': 'None Published' }, '/company/3m');
  assert.match(lp, /href="https:\/\/www\.3m\.com\/s"/); assert.match(lp, /status-active/);
  const none = B.rowHtml({ ...F, 'Report URL': '', 'Landing Page URL': 'None Published', 'Report Name': '', 'Report Year': '' }, '/company/3m');
  assert.deepEqual(cells(none), ['3M', 'MMM', 'Industrials', '', '', 'None', '—']);
  assert.match(none, /<span class="status-badge status-none">None<\/span>/);
});
test('rowHtml: text from the sheet cannot break out of the page', () => {
  const h = B.rowHtml({ ...F, 'Company Name': 'A <b>&</b> "Co"', 'Report Name': '<script>x</script>' }, '/company/a');
  assert.ok(!/<script>|<b>/.test(h));
  assert.match(h, /A &lt;b&gt;&amp;&lt;\/b&gt; &quot;Co&quot;/);
});

const INDEX_STUB = '<html><body><table id="main-table"><thead><tr><th>Company</th></tr></thead>\n    <tbody id="table-body">\n      <tr class="state-row">\n        <td colspan="7"><span class="spinner"></span> Loading reports…</td>\n      </tr>\n    </tbody>\n  </table><script>var a = 1;</script></body></html>';
test('injectRows puts the rows inside the table body and takes the "Loading" row out', () => {
  const out = B.injectRows(INDEX_STUB, '<tr><td>ROW1</td></tr><tr><td>ROW2</td></tr>');
  assert.match(out, /<tbody id="table-body">\s*<tr><td>ROW1<\/td><\/tr><tr><td>ROW2<\/td><\/tr>\s*<\/tbody>/);
  assert.ok(!/Loading reports/.test(out));
  assert.ok(out.startsWith('<html><body><table id="main-table"><thead>') && out.endsWith('</table><script>var a = 1;</script></body></html>'));
});
test('injectRows refuses a page whose table body it cannot find exactly once', () => {
  assert.throws(() => B.injectRows('<html><body>no table</body></html>', '<tr></tr>'), /table body/);
  assert.throws(() => B.injectRows(INDEX_STUB + INDEX_STUB, '<tr></tr>'), /table body/);
});
test('injectRows leaves a "$" in the rows alone', () => {
  assert.match(B.injectRows(INDEX_STUB, '<tr><td>$1 and $& and $`</td></tr>'), /<td>\$1 and \$& and \$`<\/td>/);
});

// ---------- a company's own page ----------
const ROWS = [
  { company: 'Apple Inc.', ticker: 'AAPL', sector: 'Information Technology', reportName: '2026 Environmental Progress Report', reportYear: 2026, status: 'Active', reportUrl: 'https://www.apple.com/environment/pdf/Apple_Environmental_Progress_Report_2026.pdf', landingPageUrl: 'https://www.apple.com/environment/' },
  { company: 'Coca-Cola Company (The)', ticker: 'KO', sector: 'Consumer Staples', reportName: '2025 Environmental Update', reportYear: 2025, status: 'Active', reportUrl: 'https://www.coca-colacompany.com/r.pdf', landingPageUrl: 'https://www.coca-colacompany.com/sustainability' },
  { company: 'Fair Isaac', ticker: 'FICO', sector: 'Information Technology', reportName: 'Corporate Sustainability', reportYear: null, status: 'Active', reportUrl: null, landingPageUrl: 'https://www.fico.com/en/corporate-sustainability' },
  { company: 'Reddit', ticker: 'RDDT', sector: 'Communication Services', reportName: null, reportYear: null, status: 'None', reportUrl: null, landingPageUrl: null }
];
const EVENTS = [
  { date: '2026-11-22', type: 'new-report', company: 'Apple Inc.', ticker: 'AAPL', sector: 'Information Technology', reportYear: 2026, previousYear: 2025, reportName: '2026 Environmental Progress Report', reportUrl: 'https://www.apple.com/environment/pdf/Apple_Environmental_Progress_Report_2026.pdf' },
  { date: '2026-09-10', type: 'new-report', company: 'Apple Inc.', ticker: 'AAPL', sector: 'Information Technology', reportYear: 2025, previousYear: 2024, reportName: '2025 Environmental Progress Report', reportUrl: 'https://www.apple.com/old.pdf' },
  { date: '2026-10-01', type: 'new-report', company: 'Coca-Cola Company (The)', ticker: 'KO', sector: 'Consumer Staples', reportYear: 2025, previousYear: null, reportName: '2025 Environmental Update', reportUrl: 'https://www.coca-colacompany.com/r.pdf' }
];
const CTX = B.makeContext(ROWS, EVENTS);
const text = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<\/?(b|a|span|strong|em)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ld = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const graph = html => ld(html).flatMap(j => j['@graph'] || [j]);

test('company page: the title, the address and the heading name the company', () => {
  const h = B.companyPage(ROWS[0], CTX);
  assert.match(h, /<title>Apple Inc\. \(AAPL\) sustainability report 2026 \| ORGEL<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/reports\.orgel\.us\/company\/apple"\/>/);
  assert.match(h, /<h1>Apple Inc\. sustainability report<\/h1>/);
});
test('company page: says in one plain sentence which report is the latest, with its year', () => {
  assert.ok(text(B.companyPage(ROWS[0], CTX)).includes('The latest sustainability report from Apple Inc. (AAPL) is the 2026 Environmental Progress Report, report year 2026.'));
});
test('company page: links straight to the report and to the sustainability page on the company’s own site', () => {
  const h = B.companyPage(ROWS[0], CTX);
  assert.match(h, /<a class="pg-btn" href="https:\/\/www\.apple\.com\/environment\/pdf\/Apple_Environmental_Progress_Report_2026\.pdf" target="_blank" rel="noopener">Open the report<\/a>/);
  assert.match(h, /href="https:\/\/www\.apple\.com\/environment\/" target="_blank" rel="noopener"/);
});
test('company page: shows ticker, sector (linked to the sector page) and status', () => {
  const h = B.companyPage(ROWS[0], CTX);
  assert.match(h, /<a href="\/sector\/information-technology">Information Technology<\/a>/);
  assert.ok(text(h).includes('Ticker AAPL'));
  assert.ok(text(h).includes('Status Active'));
});
test('company page: uses the ordinary name for a company filed as "(The)"', () => {
  const h = B.companyPage(ROWS[1], CTX);
  assert.match(h, /<h1>The Coca-Cola Company sustainability report<\/h1>/);
  assert.match(h, /href="https:\/\/reports\.orgel\.us\/company\/coca-cola-company"/);
  assert.ok(text(h).includes('The latest sustainability report from The Coca-Cola Company (KO) is the 2025 Environmental Update, report year 2025.'));
});
test('company page: a company with a sustainability page but no report file says so and links the page', () => {
  const h = B.companyPage(ROWS[2], CTX), t = text(h);
  assert.ok(t.includes('The index has no report file for Fair Isaac (FICO).'), t.slice(0, 600));
  assert.ok(!/class="pg-btn" href=[^>]*>Open the report/.test(h));
  assert.match(h, /href="https:\/\/www\.fico\.com\/en\/corporate-sustainability" target="_blank" rel="noopener"/);
  assert.match(h, /<title>Fair Isaac \(FICO\) sustainability report \| ORGEL<\/title>/);
});
test('company page: a company with nothing published says so and has no outside link', () => {
  const h = B.companyPage(ROWS[3], CTX), t = text(h);
  assert.ok(t.includes('ORGEL has not found a published sustainability report from Reddit (RDDT).'), t.slice(0, 600));
  assert.ok(t.includes('Status None'));
  assert.equal((h.match(/target="_blank"/g) || []).length, 0);
});
test('company page: lists what changed on the index for this company, newest first', () => {
  const t = text(B.companyPage(ROWS[0], CTX));
  const a = t.indexOf('Nov 22, 2026'), b = t.indexOf('Sep 10, 2026');
  assert.ok(a > 0 && b > a, t);
  assert.ok(t.includes('2026 Environmental Progress Report added; it replaced the 2025 report.'));
  assert.ok(!text(B.companyPage(ROWS[3], CTX)).includes('Changes on the index'));
});
test('company page: the structured data says the same as the page', () => {
  const g = graph(B.companyPage(ROWS[0], CTX));
  const page = g.find(x => x['@type'] === 'WebPage'), crumbs = g.find(x => x['@type'] === 'BreadcrumbList');
  assert.equal(page.url, 'https://reports.orgel.us/company/apple');
  assert.deepEqual(page.about, { '@type': 'Corporation', name: 'Apple Inc.', tickerSymbol: 'AAPL' });
  assert.equal(page.mainEntity['@type'], 'Report');
  assert.equal(page.mainEntity.name, '2026 Environmental Progress Report');
  assert.equal(page.mainEntity.url, ROWS[0].reportUrl);
  assert.deepEqual(crumbs.itemListElement.map(x => x.name), ['Sustainability Report Index', 'Information Technology', 'Apple Inc.']);
  assert.equal(page.dateModified, '2026-11-22');
});
test('company page: no report, no Report in the structured data', () => {
  const page = graph(B.companyPage(ROWS[3], CTX)).find(x => x['@type'] === 'WebPage');
  assert.equal(page.mainEntity, undefined); assert.equal(page.dateModified, undefined);
});
test('company page: text from the sheet cannot break out of the page or of the structured data', () => {
  const evil = { ...ROWS[0], company: 'A <b>&</b> Co', reportName: 'x</script><script>alert(1)</script>' };
  const h = B.companyPage(evil, B.makeContext([evil], []));
  assert.ok(!/<script>alert/.test(h)); assert.ok(!h.includes('A <b>&</b> Co')); assert.ok(h.includes('A &lt;b&gt;&amp;&lt;/b&gt; Co'));
  assert.equal(graph(h).find(x => x['@type'] === 'WebPage').mainEntity.name, 'x</script><script>alert(1)</script>');
});
test('company page: a link that is not http(s) is never written into the page', () => {
  const h = B.companyPage({ ...ROWS[0], reportUrl: 'javascript:alert(1)', landingPageUrl: 'data:text/html,x' }, CTX);
  assert.ok(!/javascript:|data:text/.test(h));
});
test('company page: says the link is the one the company publishes, not where the file is kept', () => {
  const t = text(B.companyPage(ROWS[0], CTX));
  assert.ok(t.includes('The link below is the one the company itself publishes.'), t.slice(0, 500));
  assert.ok(!/on the company\u2019s own website/.test(t));          // some companies keep their files with a provider
  assert.ok(t.includes('ORGEL does not host it'));
});
test('company page: says nothing about a report file when there is none', () => {
  assert.ok(!text(B.companyPage(ROWS[2], CTX)).includes('does not host'));
  assert.ok(!text(B.companyPage(ROWS[3], CTX)).includes('does not host'));
});
test('company page: the trail above the title reads properly as plain text', () => {
  assert.ok(text(B.companyPage(ROWS[0], CTX)).includes('Report Index \u203a Information Technology'));
});
test('company page: carries the site header with its four links and nothing unfinished', () => {
  for (const r of ROWS) {
    const h = B.companyPage(r, CTX);
    assert.match(h, /<header class="orgel-bar">[\s\S]*<a href="https:\/\/www\.orgel\.us">Home<\/a> <a href="https:\/\/www\.orgel\.us\/blog">BLOG<\/a> <a href="\/">Report Index<\/a> <a href="https:\/\/www\.orgel\.us">Contact Us<\/a>/);
    assert.ok(text(h).includes('Home BLOG Report Index Contact Us'));
    assert.ok(!/[a-z](All \d+|New reports|Feed)\b/.test(text(h)), 'link texts run together: ' + text(h).slice(-400));
    assert.match(h, /<link rel="stylesheet" href="\/site\.css"\/>/);
    assert.ok(!/undefined|\bnull\b|NaN|\[object/.test(text(h)), r.company);
    assert.ok(h.startsWith('<!DOCTYPE html>') && h.trimEnd().endsWith('</html>'));
  }
});

// ---------- a sector's page ----------
test('sector page: lists every company of the sector with a link to its page, by name', () => {
  const h = B.sectorPage('Information Technology', CTX);
  assert.match(h, /<title>Information Technology sustainability reports \(S&amp;P 500\) \| ORGEL<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/reports\.orgel\.us\/sector\/information-technology"\/>/);
  const a = h.indexOf('href="/company/apple"'), f = h.indexOf('href="/company/fair-isaac"');
  assert.ok(a > 0 && f > a);
  assert.ok(!h.includes('/company/reddit'));
  assert.ok(text(h).includes('2 companies'));
});
test('sector page: each row carries the report name, the year and the link, or a dash', () => {
  const h = B.sectorPage('Information Technology', CTX);
  assert.ok(text(h).includes('Apple Inc. AAPL 2026 Environmental Progress Report 2026'));
  assert.match(h, /<a class="report-link" href="https:\/\/www\.apple\.com\/environment\/pdf\/Apple_Environmental_Progress_Report_2026\.pdf" target="_blank" rel="noopener">/);
  assert.match(h, /<a class="report-link" href="https:\/\/www\.fico\.com\/en\/corporate-sustainability"/);      // no report file: the sustainability page
});
test('sector page: links to the other sectors and back to the index', () => {
  const h = B.sectorPage('Information Technology', CTX);
  assert.match(h, /href="\/sector\/consumer-staples"/); assert.match(h, /href="\/sector\/communication-services"/);
  assert.ok(!/<a href="\/sector\/information-technology">Information Technology<\/a>/.test(h.split('<main')[1]));   // not to itself
  assert.ok(!/undefined|\bnull\b|NaN/.test(text(h)));
});

// ---------- the new-reports page ----------
test('new-reports page: newest first, each with its date, company page, report and link', () => {
  const h = B.newPage(CTX), t = text(h);
  assert.match(h, /<link rel="canonical" href="https:\/\/reports\.orgel\.us\/new"\/>/);
  const a = t.indexOf('Nov 22, 2026'), b = t.indexOf('Oct 1, 2026'), c = t.lastIndexOf('Sep 10, 2026');      // the first "Sep 10" is in the count line
  assert.ok(a > 0 && b > a && c > b, t);
  assert.match(h, /<a href="\/company\/coca-cola-company">The Coca-Cola Company<\/a>/);
  assert.match(h, /href="https:\/\/www\.coca-colacompany\.com\/r\.pdf" target="_blank" rel="noopener"/);
  assert.ok(t.includes('3 reports added since Sep 10, 2026'));
});
test('new-reports page: a change for a company that is no longer in the data is shown without a link', () => {
  const ctx = B.makeContext(ROWS, [{ date: '2026-11-01', type: 'new-report', company: 'Gone Corp', ticker: 'GONE', reportYear: 2026, reportName: 'R', reportUrl: 'https://g.example/r.pdf' }]);
  const h = B.newPage(ctx);
  assert.ok(text(h).includes('Gone Corp')); assert.ok(!h.includes('/company/undefined'));
});
test('new-reports page: with no changes it says so', () => {
  assert.ok(text(B.newPage(B.makeContext(ROWS, []))).includes('No reports have been added yet.'));
});

// ---------- sitemap, CSV, styles, the index page ----------
test('sitemap lists the index, the data page, the new-reports page, every sector and every company', () => {
  const x = B.sitemap(CTX, '2026-11-25');
  const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs.slice(0, 3), ['https://reports.orgel.us/', 'https://reports.orgel.us/developers', 'https://reports.orgel.us/new']);
  assert.equal(locs.length, 3 + 3 + 4);
  assert.ok(locs.includes('https://reports.orgel.us/sector/consumer-staples') && locs.includes('https://reports.orgel.us/company/eli-lilly') === false);
  assert.ok(locs.includes('https://reports.orgel.us/company/coca-cola-company'));
  assert.equal(new Set(locs).size, locs.length);
  assert.match(x, /<loc>https:\/\/reports\.orgel\.us\/company\/apple<\/loc><lastmod>2026-11-22<\/lastmod>/);
  assert.match(x, /<loc>https:\/\/reports\.orgel\.us\/<\/loc><lastmod>2026-11-25<\/lastmod>/);
  assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});
test('csv has the API’s columns, one line per company, quoted where needed', () => {
  const c = B.csv([ROWS[0], { ...ROWS[3], company: 'Block, Inc.', reportName: 'He said "hi"' }]);
  const lines = c.trimEnd().split('\n');
  assert.equal(lines[0], 'Company,Ticker,Sector,Report Name,Report Year,Status,Report URL,Landing Page URL');
  assert.equal(lines[1], 'Apple Inc.,AAPL,Information Technology,2026 Environmental Progress Report,2026,Active,https://www.apple.com/environment/pdf/Apple_Environmental_Progress_Report_2026.pdf,https://www.apple.com/environment/');
  assert.equal(lines[2], '"Block, Inc.",RDDT,Communication Services,"He said ""hi""",,None,,');
  assert.equal(lines.length, 3); assert.ok(c.charCodeAt(0) !== 0xFEFF);
});
test('csv never lets a cell start a spreadsheet formula', () => {
  assert.match(B.csv([{ ...ROWS[0], reportName: '=HYPERLINK("x")' }]), /,"'=HYPERLINK\(""x""\)",/);
});
const INDEX_FULL = '<html><head><style>\n  body { color: red; }\n</style><style>.second{}</style></head><body><table id="main-table">\n    <tbody id="table-body">\n      <tr class="state-row"><td colspan="7">Loading reports…</td></tr>\n    </tbody>\n  </table></body></html>';
test('siteCss is the index page’s own first style block followed by the pages’ rules', () => {
  const c = B.siteCss(INDEX_FULL, '.pg-main { margin: 0; }');
  assert.ok(c.includes('body { color: red; }')); assert.ok(c.trimEnd().endsWith('.pg-main { margin: 0; }'));
  assert.ok(c.indexOf('body { color: red; }') < c.indexOf('.pg-main')); assert.ok(!c.includes('.second')); assert.ok(!/<\/?style/.test(c));
});
test('indexPage writes one row per record into the table, by company name as the page sorts them, each linked to its page', () => {
  const recs = [
    { fields: { 'Company Name': 'Reddit', 'Ticker': 'RDDT', 'Sector / Industry': 'Communication Services', 'Report Name': 'None Published', 'Report Year': '', 'Report URL': 'None Published', 'Landing Page URL': 'None Published' } },
    { fields: { 'Company Name': 'apple Inc.', 'Ticker': 'AAPL', 'Sector / Industry': 'Information Technology', 'Report Name': 'R', 'Report Year': '2026', 'Report URL': 'https://a.example/r.pdf', 'Landing Page URL': 'https://a.example/' } },
    { fields: { 'Company Name': 'Coca-Cola Company (The)', 'Ticker': 'KO', 'Sector / Industry': 'Consumer Staples', 'Report Name': 'U', 'Report Year': '2025', 'Report URL': 'https://k.example/r.pdf', 'Landing Page URL': '' } }
  ];
  const ctx = B.makeContext(recs.map(B.normalize), []);
  const h = B.indexPage(INDEX_FULL, recs, ctx);
  const names = [...h.matchAll(/class="company-name" data-t="([^"]+)" href="([^"]+)">([^<]+)</g)].map(m => m.slice(1).join('|'));
  assert.deepEqual(names, ['AAPL|/company/apple|apple Inc.', 'KO|/company/coca-cola-company|Coca-Cola Company (The)', 'RDDT|/company/reddit|Reddit']);
  assert.equal((h.match(/<tr>/g) || []).length, 3); assert.ok(!/Loading reports/.test(h));
  assert.ok(text(h).includes('None Published'));        // the cell shows what the page's script would show
});

// ---------- the whole build, on this repository ----------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), 'orgel-' + name + '-'));
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]);
const NOT_PUBLISHED = /^(\.|dist\/|test\/|node_modules\/|build\.mjs$|pages\.css$|README\.md$)/;
let OUT = null, SUMMARY = null;
const built = () => { if (!OUT) { OUT = tmp('dist'); SUMMARY = B.build({ root: ROOT, out: OUT, now: new Date('2026-11-25T16:00:00Z') }); } return OUT; };
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));

test('build: reports a good build and how much it made', () => {
  built();
  assert.equal(SUMMARY.ok, true, JSON.stringify(SUMMARY));
  assert.equal(SUMMARY.companies, DATA.length); assert.equal(SUMMARY.companyPages, DATA.length); assert.equal(SUMMARY.sectorPages, 11); assert.deepEqual(SUMMARY.problems, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(OUT, 'build.json'), 'utf8')), SUMMARY);
});
test('build: every published file of the repository is in the output, unchanged', () => {
  const out = built(), GENERATED = new Set(['index.html', 'sitemap.xml']);
  const src = walk(ROOT).filter(f => !NOT_PUBLISHED.test(f));
  assert.ok(src.includes('_worker.js') && src.includes('ticker.html') && src.includes('data.json') && src.includes('developers.html') && src.includes('logo.png'));
  for (const f of src) {
    assert.ok(fs.existsSync(path.join(out, f)), 'missing in the output: ' + f);
    if (!GENERATED.has(f)) assert.ok(fs.readFileSync(path.join(ROOT, f)).equals(fs.readFileSync(path.join(out, f))), 'changed by the build: ' + f);
  }
});
test('build: nothing that is only for building is published', () => {
  const files = walk(built());
  for (const f of files) assert.ok(!/^(build\.mjs|pages\.css|README\.md|test\/|\.git)/.test(f), f);
});
test('build: one page per company, one per sector, the new-reports page, sitemap, csv and styles', () => {
  const out = built(), files = walk(out);
  assert.equal(files.filter(f => /^company\/[a-z0-9-]+\.html$/.test(f)).length, DATA.length);
  assert.equal(files.filter(f => /^sector\/[a-z0-9-]+\.html$/.test(f)).length, 11);
  for (const f of ['new.html', 'sitemap.xml', 'data.csv', 'site.css', 'build.json', '404.html', 'llms.txt', 'index.html']) assert.ok(files.includes(f), f);
  assert.equal(fs.readFileSync(path.join(out, 'data.csv'), 'utf8').trimEnd().split('\n').length, DATA.length + 1);
  assert.equal((fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8').match(/<loc>/g) || []).length, 3 + 11 + DATA.length);
  assert.ok(fs.readFileSync(path.join(out, 'site.css'), 'utf8').includes('.pg-main'));
});
test('build: the index page has every company in the table, linked, and keeps its own script', () => {
  const h = fs.readFileSync(path.join(built(), 'index.html'), 'utf8'), src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const body = /<tbody id="table-body">([\s\S]*?)<\/tbody>/.exec(h)[1];
  assert.equal((body.match(/<tr>/g) || []).length, DATA.length);
  assert.equal((body.match(/<a class="company-name" data-t="[^"]+" href="\/company\/[a-z0-9-]+">/g) || []).length, DATA.length);
  assert.ok(!/Loading reports/.test(h));
  for (const name of ['3M', 'Apple Inc.', 'Microsoft', 'Walmart', 'Zoetis']) assert.ok(body.includes('>' + name + '</a>'), name);
  assert.equal(h.replace(/<tbody id="table-body">[\s\S]*?<\/tbody>/, ''), src.replace(/<tbody id="table-body">[\s\S]*?<\/tbody>/, ''));    // nothing else touched
});
test('build: every link inside the site leads to a file that exists', () => {
  const out = built(), files = new Set(walk(out));
  const exists = href => { const p = href.replace(/[#?].*$/, ''); if (p === '/' || p === '') return files.has('index.html'); const f = p.replace(/^\//, ''); return files.has(f) || files.has(f + '.html'); };
  let checked = 0;
  for (const f of [...files].filter(f => f.endsWith('.html') && !['ticker.html', 'hold.html'].includes(f))) {
    const h = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of h.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      if (/^\/(api|relay)(\/|$)/.test(m[1])) continue;            // answered by _worker.js, not by a file
      checked++; assert.ok(exists(m[1]), f + ' links to ' + m[1]);
    }
  }
  assert.ok(checked > DATA.length * 8, 'links checked: ' + checked);
});
test('build: every built page is whole, says nothing unfinished, and its structured data can be read', () => {
  const out = built();
  for (const f of walk(out).filter(f => /^(company|sector)\//.test(f) || f === 'new.html' || f === '404.html')) {
    const h = fs.readFileSync(path.join(out, f), 'utf8');
    assert.ok(h.startsWith('<!DOCTYPE html>') && h.trimEnd().endsWith('</html>'), f);
    assert.ok(!/undefined|\bnull\b|NaN|\[object/.test(text(h)), f + ': ' + (text(h).match(/.{40}(undefined|\bnull\b|NaN|\[object).{40}/) || [''])[0]);
    assert.equal((h.match(/<h1>/g) || []).length, 1, f);
    if (f !== '404.html') { assert.ok(ld(h).length >= 1, f); assert.match(h, /<link rel="canonical" href="https:\/\/reports\.orgel\.us\/[^"]*"\/>/); }
  }
});
test('build: each company page says what the index says about that company', () => {
  const out = built(), rows = DATA.map(B.normalize), ctx = B.makeContext(rows, []);
  for (const r of rows) {
    const h = fs.readFileSync(path.join(out, 'company', ctx.slugs.get(r.ticker) + '.html'), 'utf8'), t = text(h);
    assert.ok(t.includes(B.displayName(r.company)), r.company);
    if (r.reportName) assert.ok(h.includes(B.esc(r.reportName)), r.company + ': report name');
    if (r.reportUrl) assert.ok(h.includes('href="' + B.esc(r.reportUrl) + '"'), r.company + ': report link');
    if (r.landingPageUrl) assert.ok(h.includes('href="' + B.esc(r.landingPageUrl) + '"'), r.company + ': landing link');
    assert.ok(t.includes('Status ' + r.status), r.company + ': status');
  }
});
test('build: the 404 page is a real "not found" page with a way back', () => {
  const h = fs.readFileSync(path.join(built(), '404.html'), 'utf8');
  assert.match(h, /<meta name="robots" content="noindex"\/>/); assert.match(h, /<a[^>]* href="\/"/); assert.ok(text(h).includes('Page not found'));
});
test('build: a second build clears what the first one left', () => {
  const out = tmp('twice');
  fs.mkdirSync(path.join(out, 'company'), { recursive: true }); fs.writeFileSync(path.join(out, 'company', 'gone-company.html'), 'old');
  B.build({ root: ROOT, out, now: new Date('2026-11-25T16:00:00Z') });
  assert.ok(!fs.existsSync(path.join(out, 'company', 'gone-company.html')));
});
test('build: if the data cannot be read, the site is still published as it is in the repository, and the build says what went wrong', () => {
  const root = tmp('broken'), out = tmp('broken-out');
  for (const f of ['index.html', 'developers.html', '_worker.js', '_routes.json', 'logo.png', 'changes.json', 'pages.css', 'llms.txt', '404.html']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(root, f));
  fs.writeFileSync(path.join(root, 'data.json'), '{ not json');
  const s = B.build({ root, out, now: new Date('2026-11-25T16:00:00Z') });
  assert.equal(s.ok, false); assert.match(s.problems.join(' '), /data\.json/);
  assert.ok(fs.readFileSync(path.join(root, 'index.html')).equals(fs.readFileSync(path.join(out, 'index.html'))));       // the page as written by hand: its script still draws the table
  assert.ok(fs.existsSync(path.join(out, '_worker.js')) && fs.existsSync(path.join(out, 'data.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')).ok, false);
  assert.ok(!fs.existsSync(path.join(out, 'company')));
});
test('build: a record without a company name is left out, as the API leaves it out', () => {
  const root = tmp('no-name'), out = tmp('no-name-out');
  for (const f of ['index.html', 'pages.css', 'changes.json']) fs.copyFileSync(path.join(ROOT, f), path.join(root, f));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify(DATA.slice(0, 3).concat([{ fields: { 'Company Name': '', 'Ticker': 'NONAME' } }])));
  const s = B.build({ root, out, now: new Date('2026-11-25T16:00:00Z') });
  assert.equal(s.ok, true); assert.equal(s.companies, 3); assert.equal(s.companyPages, 3);
  const tbody = /<tbody id="table-body">([\s\S]*?)<\/tbody>/.exec(fs.readFileSync(path.join(out, 'index.html'), 'utf8'))[1];
  assert.equal((tbody.match(/data-t="/g) || []).length, 3); assert.ok(!tbody.includes('NONAME'));
});

// ---------- terms: credit is required (Kyle, 2026-11-25) ----------
test('terms: the data page says credit is required, names the licence, and its structured data points to it', () => {
  const h = fs.readFileSync(path.join(ROOT, 'developers.html'), 'utf8'), t = text(h);
  assert.ok(!/appreciated/i.test(h));
  assert.ok(t.includes('Creative Commons Attribution 4.0'), 'licence named');
  assert.ok(t.includes('Credit is required'), 'credit required');
  assert.ok(t.includes('Source: ORGEL Sustainability Report Index, reports.orgel.us'));
  assert.match(h, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  assert.equal(ld(h).find(x => x['@type'] === 'Dataset').license, 'https://creativecommons.org/licenses/by/4.0/');
});
test('terms: every built page and the summary file say the same', () => {
  const out = built();
  for (const f of ['company/3m.html', 'sector/energy.html', 'new.html']) {
    const t = text(fs.readFileSync(path.join(out, f), 'utf8'));
    assert.ok(!/appreciated/i.test(t), f); assert.ok(t.includes('Free for any use with credit (CC BY 4.0): Source: ORGEL Sustainability Report Index, reports.orgel.us'), f);
  }
  const l = fs.readFileSync(path.join(out, 'llms.txt'), 'utf8');
  assert.ok(!/appreciated/i.test(l)); assert.ok(l.includes('CC BY 4.0') && l.includes('Credit is required'));
});

// ---------- the change log's other kind of entry: a company added to the index ----------
const ADDED = [
  { date: '2026-11-20', type: 'company-added', company: 'Reddit', ticker: 'RDDT', sector: 'Communication Services', reportYear: null, previousYear: null, reportName: '', reportUrl: '' },
  { date: '2026-11-21', type: 'new-report', company: 'Apple Inc.', ticker: 'AAPL', sector: 'Information Technology', reportYear: 2026, previousYear: 2025, reportName: '2026 Environmental Progress Report', reportUrl: 'https://www.apple.com/r.pdf' }
];
test('new-reports page: a company joining the index is not listed as a report', () => {
  const t = text(B.newPage(B.makeContext(ROWS, ADDED)));
  assert.ok(!t.includes('Reddit'), t); assert.ok(t.includes('1 report added since Nov 21, 2026'));
});
test('company page: says when the company was added to the index', () => {
  const t = text(B.companyPage(ROWS[3], B.makeContext(ROWS, ADDED)));
  assert.ok(t.includes('Changes on the index'));
  assert.ok(t.includes('Nov 20, 2026 Added to the index when the company joined the S&P 500.'), t);
  assert.ok(!t.includes('first report listed')); assert.ok(!/\breport added\b/.test(t));
});
