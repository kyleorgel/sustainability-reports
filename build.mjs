// build.mjs - builds the published site into ./dist (Cloudflare Pages runs it on every deploy).
//
// The repository holds the hand-written pages and the data files that n8n commits (data.json,
// changes.json, ...). This script copies them and adds what is worked out from the data:
//   /                   the index page with its rows already in the HTML (and a link on each company)
//   /company/<name>     one page per company
//   /sector/<name>      one page per sector
//   /new                the reports added lately
//   /sitemap.xml, /data.csv, /build.json
// No packages are needed: Node's own modules only.

// ---------- names ----------
// The index files names for sorting: "Coca-Cola Company (The)", "Lilly (Eli)". On a page of its
// own the company is called by its ordinary name. A share class in brackets stays where it is.
export function displayName(name) {
  const s = String(name == null ? '' : name).trim();
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(s);
  if (!m || /^class\b/i.test(m[2])) return s;
  return m[2].trim() + ' ' + m[1].trim();
}

// ---------- web addresses ----------
// "Coca-Cola Company (The)" -> coca-cola-company, "Apple Inc." -> apple. Empty when the name has no
// letters or digits. A legal ending (Inc., Corp., Ltd., plc, LLC) is left off; "Corp" without its
// full stop is kept, because it is part of a name such as News Corp.
export function slugOf(name) {
  const shown = displayName(name);
  const m = /^(.*\S),?\s+(?:Inc\.?|Corp\.|Ltd\.?|plc|LLC)(\s*\(Class [A-Z]\))?$/.exec(shown);
  return (m ? m[1] + (m[2] || '') : shown)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // Estee, not Est-e
    .replace(/['\u2018\u2019]/g, '')                        // Lowe's -> lowes
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ticker -> address. Two names that would share an address both get their ticker added, so the
// result does not depend on the order of the rows.
export function assignSlugs(rows) {
  const base = rows.map(r => slugOf(r.company));
  const seen = new Map();
  base.forEach(s => seen.set(s, (seen.get(s) || 0) + 1));
  const out = new Map();
  rows.forEach((r, i) => {
    const t = slugOf(r.ticker);
    let s = base[i];
    if (!s) s = t;
    else if (seen.get(s) > 1) s = s + '-' + t;
    out.set(r.ticker, s);
  });
  return out;
}

// ---------- one company record (the same rules as _worker.js, so the pages and the API agree) ----------
function unusable(v) { if (v == null) return true; const s = String(v).trim().toLowerCase(); return s === '' || s === 'none published'; }
function cleanUrl(v) { if (unusable(v)) return null; const s = String(v).trim(); return /^https?:\/\//i.test(s) ? s : null; }
export function normalize(r) {
  const f = (r && r.fields) || r || {};
  const reportUrl = cleanUrl(f['Report URL']);
  const landingPageUrl = cleanUrl(f['Landing Page URL'] != null ? f['Landing Page URL'] : f['Landing Page']);
  const yearNum = parseInt(String(f['Report Year'] || ''), 10);
  return {
    company: String(f['Company Name'] || '').trim(),
    ticker: String(f['Ticker'] || '').trim(),
    sector: String(f['Sector / Industry'] || '').trim(),
    reportName: unusable(f['Report Name']) ? null : String(f['Report Name']).trim(),
    reportYear: isFinite(yearNum) ? yearNum : null,
    status: (reportUrl || landingPageUrl) ? 'Active' : 'None',
    reportUrl,
    landingPageUrl
  };
}

// ---------- html helpers ----------
// esc: the same four characters the index page's own script escapes. attr adds the single quote.
export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ---------- the index page ----------
// One table row, cell for cell what renderTable() in index.html draws from the same record, so
// nothing moves when the page's script takes over. The one addition: the company name links to
// the company's own page (href), and carries its ticker so the script can keep the link.
const FILE_ICON = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
function rawLink(f) {
  const report = f['Report URL'], landing = f['Landing Page URL'] != null ? f['Landing Page URL'] : f['Landing Page'];
  if (!unusable(report)) return String(report).trim();
  if (!unusable(landing)) return String(landing).trim();
  return null;
}
export function rowHtml(f, href) {
  const link = rawLink(f), status = link ? 'Active' : 'None';
  const name = esc(f['Company Name'] || '');
  return '<tr>'
    + '<td>' + (href ? '<a class="company-name" data-t="' + esc(f['Ticker'] || '') + '" href="' + esc(href) + '">' + name + '</a>' : '<span class="company-name">' + name + '</span>') + '</td>'
    + '<td><span class="ticker">' + esc(f['Ticker'] || '') + '</span></td>'
    + '<td><span class="sector-tag">' + esc(f['Sector / Industry'] || '') + '</span></td>'
    + '<td><span class="report-name">' + esc(f['Report Name'] || '') + '</span></td>'
    + '<td><span class="year-chip">' + esc(String(f['Report Year'] || '')) + '</span></td>'
    + '<td><span class="status-badge status-' + status.toLowerCase() + '">' + status + '</span></td>'
    + '<td>' + (link ? '<a class="report-link" href="' + esc(link) + '" target="_blank" rel="noopener">' + FILE_ICON + ' View</a>' : '<span style="color:#aaa;font-size:0.8rem">\u2014</span>') + '</td>'
    + '</tr>';
}

// Puts the rows into <tbody id="table-body">, in place of the "Loading reports" row.
export function injectRows(indexHtml, rowsHtml) {
  const re = /(<tbody id="table-body">)[\s\S]*?(<\/tbody>)/g;
  const found = indexHtml.match(re);
  if (!found || found.length !== 1) throw new Error('index.html: expected exactly one table body, found ' + (found ? found.length : 0));
  return indexHtml.replace(re, (m, open, close) => open + '\n' + rowsHtml + '\n    ' + close);
}

// ---------- shared by every built page ----------
export const SITE = 'https://reports.orgel.us';
const HOME = 'https://www.orgel.us';
const kebab = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const httpOnly = u => (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : null;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(iso) {                       // 2026-11-22 -> Nov 22, 2026
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m && MONTHS[Number(m[2]) - 1] ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
}
// JSON for a <script type="application/ld+json"> block: "<" is written as < so no text can close the block.
const ldScript = obj => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';

// Everything the pages need to know about each other: each company's address, the sectors, the changes.
export function makeContext(rows, events) {
  const slugs = assignSlugs(rows);
  const sectors = new Map();
  rows.forEach(r => {
    const name = r.sector || 'Other';
    if (!sectors.has(name)) sectors.set(name, { name, slug: kebab(name), rows: [] });
    sectors.get(name).rows.push(r);
  });
  const evs = (Array.isArray(events) ? events : []).filter(e => e && e.ticker && /^\d{4}-\d{2}-\d{2}/.test(String(e.date || '')))
    .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const byTicker = new Map();
  evs.forEach(e => { if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []); byTicker.get(e.ticker).push(e); });
  return { rows, slugs, sectors, events: evs, byTicker, total: rows.length,
    pathOf: r => '/company/' + slugs.get(r.ticker), sectorPath: name => '/sector/' + kebab(name || 'Other') };
}

// The frame of a page: the same header as the index, a title band, the page's own part, a footer.
function shell(p) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '  <meta charset="UTF-8"/>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n'
    + '  <title>' + esc(p.title) + '</title>\n'
    + '  <meta name="description" content="' + esc(p.description) + '"/>\n'
    + (p.noindex ? '  <meta name="robots" content="noindex"/>\n' : '  <link rel="canonical" href="' + esc(SITE + p.path) + '"/>\n')
    + '  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Poppins:wght@400;600&family=Wix+Madefor+Text:wght@400;500&display=swap" rel="stylesheet"/>\n'
    + '  <link rel="stylesheet" href="/site.css"/>\n'
    + '  <link rel="alternate" type="application/atom+xml" title="New sustainability reports (S&amp;P 500)" href="' + SITE + '/feed.xml"/>\n'
    + '  <meta property="og:type" content="website"/>\n  <meta property="og:url" content="' + esc(SITE + p.path) + '"/>\n'
    + '  <meta property="og:title" content="' + esc(p.title) + '"/>\n  <meta property="og:description" content="' + esc(p.description) + '"/>\n'
    + '  <meta property="og:image" content="' + SITE + '/og-image.png"/>\n  <meta name="twitter:card" content="summary"/>\n'
    + '  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>\n  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png"/>\n  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>\n'
    + (p.jsonld ? '  ' + ldScript(p.jsonld) + '\n' : '')
    + '</head>\n<body class="pg">\n'
    + '<header class="orgel-bar"><div class="ob-inner"><a class="ob-brand" href="' + HOME + '" aria-label="ORGEL home"><img src="/logo.png" alt="ORGEL" width="525" height="108"></a>'
    + '<nav class="ob-nav"><a href="' + HOME + '">Home</a> <a href="' + HOME + '/blog">BLOG</a> <a href="/">Report Index</a> <a href="' + HOME + '">Contact Us</a></nav></div></header>\n'
    + '<section class="orgel-band"><div class="ob-inner">' + (p.crumbs ? '<p class="pg-crumbs">' + p.crumbs + '</p>' : '') + '<h1>' + esc(p.h1) + '</h1><p>' + p.lead + '</p></div></section>\n'
    + '<main class="pg-main">\n' + p.body + '\n</main>\n'
    + '<footer><a href="/">ORGEL Sustainability Report Index</a> &middot; <a href="/new">New reports</a> &middot; <a href="/developers">Data &amp; API</a> &middot; <a href="' + HOME + '">orgel.us</a><br>Free for any use with credit (<a href="/developers#terms">CC BY 4.0</a>): Source: ORGEL Sustainability Report Index, reports.orgel.us</footer>\n'
    + '<script>(function(){var b=document.querySelector("header.orgel-bar");if(!b)return;var f=function(){b.classList.toggle("stuck",(window.scrollY||window.pageYOffset||0)>2)};window.addEventListener("scroll",f,{passive:true});f()})();</script>\n'
    + '</body>\n</html>\n';
}
const outLink = (url, label, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(url) + '" target="_blank" rel="noopener">' + label + '</a>';
const CHECKS = 'Every link on the index is traced to the company&rsquo;s own disclosure page. Automated readers recheck every entry twice a week, and a person confirms each new report before it is published.';

// ---------- a company's own page ----------
export function companyPage(r, ctx) {
  const name = displayName(r.company), who = name + (r.ticker ? ' (' + r.ticker + ')' : '');
  const report = httpOnly(r.reportUrl), landing = httpOnly(r.landingPageUrl);
  const path = ctx.pathOf(r), sector = r.sector || 'Other', sectorPath = ctx.sectorPath(sector);
  const hist = ctx.byTicker.get(r.ticker) || [];
  const year = r.reportYear ? String(r.reportYear) : '';
  let lead, description;
  if (report && r.reportName) {
    lead = 'The latest sustainability report from ' + esc(who) + ' is the <b>' + esc(r.reportName) + '</b>' + (year ? ', report year ' + year : '') + '. The link below is the one the company itself publishes.';
    description = 'Latest sustainability report from ' + who + ': ' + r.reportName + '. Direct link to the report as the company publishes it, rechecked twice a week.';
  } else if (report) {
    lead = 'The latest sustainability report from ' + esc(who) + (year ? ' is for report year ' + year : ' is linked below') + '. The link is the one the company itself publishes.';
    description = 'Latest sustainability report from ' + who + '. Direct link to the report as the company publishes it, rechecked twice a week.';
  } else if (landing) {
    lead = 'The index has no report file for ' + esc(who) + '. ' + (r.reportName ? 'What the company publishes, <b>' + esc(r.reportName) + '</b>, is on its sustainability page, linked below.' : 'Its sustainability page is linked below.');
    description = 'Sustainability page of ' + who + '. The index has no report file for this company; it is rechecked twice a week.';
  } else {
    lead = 'ORGEL has not found a published sustainability report from ' + esc(who) + '. The company is rechecked twice a week, and this page changes when a report appears.';
    description = 'ORGEL has not found a published sustainability report from ' + who + '. The company is rechecked twice a week.';
  }
  const fact = (k, v) => '<tr><th scope="row">' + k + '</th><td>' + v + '</td></tr>';
  const none = '<span class="pg-none">\u2014</span>';
  let body = '<table class="pg-facts"><tbody>'
    + fact('Company', esc(name))
    + fact('Ticker', r.ticker ? '<span class="ticker">' + esc(r.ticker) + '</span>' : none)
    + fact('Sector', '<a href="' + esc(sectorPath) + '">' + esc(sector) + '</a>')
    + fact('Latest report', r.reportName ? esc(r.reportName) : none)
    + fact('Report year', year || none)
    + fact('Report', report ? outLink(report, esc(hostOf(report) || 'Open')) : none)
    + fact('Sustainability page', landing ? outLink(landing, esc(hostOf(landing) || 'Open')) : none)
    + fact('Status', '<span class="status-badge status-' + (r.status === 'Active' ? 'active' : 'none') + '">' + (r.status === 'Active' ? 'Active' : 'None') + '</span>')
    + '</tbody></table>\n';
  if (report || landing) body += '<p class="pg-actions">' + [report ? outLink(report, 'Open the report', 'pg-btn') : '', landing ? outLink(landing, 'Sustainability page', 'pg-btn pg-btn-line') : ''].filter(Boolean).join(' ') + '</p>\n';
  if (hist.length) {
    body += '<h2>Changes on the index</h2>\n<ul class="pg-list">'
      + hist.map(e => '<li><span class="pg-date">' + esc(prettyDate(e.date)) + '</span> ' + (e.type === 'company-added' ? 'Added to the index when the company joined the S&amp;P&nbsp;500.'
        : esc(e.reportName || (e.reportYear ? e.reportYear + ' report' : 'A report')) + ' added' + (e.previousYear ? '; it replaced the ' + esc(e.previousYear) + ' report.' : ', the first report listed for this company.')) + '</li>').join('') + '</ul>\n';
  }
  body += '<h2>How this page is kept right</h2>\n<p>' + CHECKS + (report ? ' The report itself stays where the company published it; ORGEL does not host it.' : '') + '</p>\n';
  const peers = (ctx.sectors.get(sector) || { rows: [] }).rows.length;
  body += '<p class="pg-more"><a href="' + esc(sectorPath) + '">All ' + peers + ' ' + esc(sector) + ' compan' + (peers === 1 ? 'y' : 'ies') + '</a> <a href="/">All ' + ctx.total + ' companies</a> <a href="/new">New reports</a> <a href="/#alerts">New reports by email on Mondays</a></p>';
  const corp = { '@type': 'Corporation', name: name, ...(r.ticker ? { tickerSymbol: r.ticker } : {}) };
  const title = who + ' sustainability report' + (report && year ? ' ' + year : '') + ' | ORGEL';
  const page = { '@type': 'WebPage', '@id': SITE + path, url: SITE + path, name: title.replace(/ \| ORGEL$/, ''), description,
    isPartOf: { '@type': 'WebSite', name: 'ORGEL Sustainability Report Index', url: SITE + '/' },
    publisher: { '@type': 'Organization', name: 'ORGEL', url: HOME }, about: corp };
  if (report) page.mainEntity = { '@type': 'Report', name: r.reportName || (name + ' sustainability report'), url: report, publisher: corp };
  if (hist.length) page.dateModified = String(hist[0].date).slice(0, 10);
  const crumbs = { '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Sustainability Report Index', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: sector, item: SITE + sectorPath },
    { '@type': 'ListItem', position: 3, name: name }] };
  return shell({ title, description, path, h1: name + ' sustainability report', lead, body,
    crumbs: '<a href="/">Report Index</a> <span>\u203a</span> <a href="' + esc(sectorPath) + '">' + esc(sector) + '</a>',
    jsonld: { '@context': 'https://schema.org', '@graph': [crumbs, page] } });
}

const byName = (a, b) => String(a.company || '').toLowerCase().localeCompare(String(b.company || '').toLowerCase(), 'en');
const viewLink = r => { const u = httpOnly(r.reportUrl) || httpOnly(r.landingPageUrl); return u ? outLink(u, FILE_ICON + ' View', 'report-link') : '<span class="pg-none">\u2014</span>'; };

// ---------- a sector's page ----------
export function sectorPage(name, ctx) {
  const sec = ctx.sectors.get(name), rows = sec.rows.slice().sort(byName), path = ctx.sectorPath(name);
  const active = rows.filter(r => r.status === 'Active').length;
  const title = name + ' sustainability reports (S&P 500) | ORGEL';
  const description = 'The latest sustainability report from each of the ' + rows.length + ' ' + name + ' companies on the ORGEL index of the S&P 500, with a direct link to every report.';
  let body = '<p class="pg-count">' + rows.length + ' compan' + (rows.length === 1 ? 'y' : 'ies') + ' &middot; ' + active + ' with a report or a sustainability page</p>\n'
    + '<div class="pg-table"><table><thead><tr><th>Company</th><th>Ticker</th><th>Report Name</th><th>Report Year</th><th>Report Link</th></tr></thead><tbody>\n'
    + rows.map(r => '<tr><td><a class="company-name" href="' + esc(ctx.pathOf(r)) + '">' + esc(r.company) + '</a></td><td><span class="ticker">' + esc(r.ticker) + '</span></td>'
      + '<td><span class="report-name">' + esc(r.reportName || '') + '</span></td><td><span class="year-chip">' + esc(r.reportYear || '') + '</span></td><td>' + viewLink(r) + '</td></tr>').join('\n')
    + '\n</tbody></table></div>\n<h2>Other sectors</h2>\n<p class="pg-more">'
    + [...ctx.sectors.values()].filter(x => x.name !== name).sort((a, b) => a.name.localeCompare(b.name, 'en')).map(x => '<a href="/sector/' + esc(x.slug) + '">' + esc(x.name) + ' (' + x.rows.length + ')</a>').join(' ')
    + ' <a href="/">All ' + ctx.total + ' companies</a></p>';
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Sustainability Report Index', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: name }] },
    { '@type': 'CollectionPage', '@id': SITE + path, url: SITE + path, name: title.replace(/ \| ORGEL$/, ''), description,
      isPartOf: { '@type': 'WebSite', name: 'ORGEL Sustainability Report Index', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'ORGEL', url: HOME } }] };
  return shell({ title, description, path, h1: name + ' sustainability reports', body, jsonld,
    lead: 'The latest sustainability report from each ' + esc(name) + ' company on the index: S&amp;P&nbsp;500 members, and companies that have left it since the index began.',
    crumbs: '<a href="/">Report Index</a> <span>\u203a</span> Sectors' });
}

// ---------- the new-reports page ----------
export function newPage(ctx) {
  // The change log also notes when a company joins the index; this page lists the reports only.
  const SHOW = 200, all = ctx.events.filter(e => e.type !== 'company-added'), evs = all.slice(0, SHOW), byT = new Map(ctx.rows.map(r => [r.ticker, r]));
  const title = 'New sustainability reports from S&P 500 companies | ORGEL';
  const description = 'Sustainability reports newly published by S&P 500 companies, newest first, each with a direct link to the report as the company publishes it.';
  let body;
  if (!evs.length) body = '<p>No reports have been added yet.</p>';
  else {
    const oldest = all[all.length - 1];
    body = '<p class="pg-count">' + all.length + ' report' + (all.length === 1 ? '' : 's') + ' added since ' + esc(prettyDate(oldest.date)) + (all.length > SHOW ? ' &middot; the newest ' + SHOW + ' are listed' : '') + '</p>\n<ul class="pg-list pg-new">\n'
      + evs.map(e => {
        const r = byT.get(e.ticker), u = httpOnly(e.reportUrl);
        const who = r ? '<a href="' + esc(ctx.pathOf(r)) + '">' + esc(displayName(r.company)) + '</a>' : esc(displayName(e.company || e.ticker));
        const what = esc(e.reportName || ((e.reportYear || '') + ' report').trim());
        return '<li><span class="pg-date">' + esc(prettyDate(e.date)) + '</span> ' + who + ' <span class="ticker">' + esc(e.ticker) + '</span> ' + (u ? outLink(u, what) : what)
          + (e.previousYear ? ' <span class="pg-note">replaced the ' + esc(e.previousYear) + ' report</span>' : ' <span class="pg-note">first report listed</span>') + '</li>';
      }).join('\n') + '\n</ul>';
  }
  body += '\n<p class="pg-more"><a href="/#alerts">Get these by email on Mondays</a> <a href="/feed.xml">Feed</a> <a href="/">All ' + ctx.total + ' companies</a></p>';
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Sustainability Report Index', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'New reports' }] },
    { '@type': 'CollectionPage', '@id': SITE + '/new', url: SITE + '/new', name: title.replace(/ \| ORGEL$/, ''), description,
      isPartOf: { '@type': 'WebSite', name: 'ORGEL Sustainability Report Index', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'ORGEL', url: HOME },
      ...(evs.length ? { dateModified: String(evs[0].date).slice(0, 10) } : {}) }] };
  return shell({ title, description, path: '/new', h1: 'New sustainability reports', body, jsonld,
    lead: 'Reports added to the index, newest first. Each one was found on the company&rsquo;s own website and confirmed by a person before it was listed.',
    crumbs: '<a href="/">Report Index</a>' });
}

// ---------- sitemap.xml, data.csv, site.css ----------
export function sitemap(ctx, today) {
  const u = (p, lastmod) => '  <url><loc>' + esc(SITE + p) + '</loc>' + (lastmod ? '<lastmod>' + esc(lastmod) + '</lastmod>' : '') + '</url>';
  const newest = ctx.events.length ? String(ctx.events[0].date).slice(0, 10) : today;
  const lines = [u('/', today), u('/developers'), u('/new', newest)];
  [...ctx.sectors.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')).forEach(s => lines.push(u('/sector/' + s.slug)));
  ctx.rows.slice().sort(byName).forEach(r => { const h = ctx.byTicker.get(r.ticker); lines.push(u(ctx.pathOf(r), h ? String(h[0].date).slice(0, 10) : '')); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + lines.join('\n') + '\n</urlset>\n';
}
const CSV_COLS = [['company', 'Company'], ['ticker', 'Ticker'], ['sector', 'Sector'], ['reportName', 'Report Name'], ['reportYear', 'Report Year'], ['status', 'Status'], ['reportUrl', 'Report URL'], ['landingPageUrl', 'Landing Page URL']];
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // never let a cell execute as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// The same columns as /api/v1/reports?format=csv, as a plain file: no byte-order mark, \n line ends.
export function csv(rows) { return [CSV_COLS.map(c => c[1]).join(',')].concat(rows.map(r => CSV_COLS.map(c => csvCell(r[c[0]])).join(','))).join('\n') + '\n'; }
// The index page's own styles (its first <style> block) with the built pages' rules after them.
export function siteCss(indexHtml, extra) {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/.exec(indexHtml);
  if (!m) throw new Error('index.html: no <style> block');
  return m[1].replace(/^\n+/, '') + '\n' + extra.trim() + '\n';
}
// The index page with its rows already in the table, in the order the page sorts them (company, A to Z).
export function indexPage(indexHtml, records, ctx) {
  const sorted = records.slice().sort((a, b) => String((a.fields || {})['Company Name'] || '').toLowerCase().localeCompare(String((b.fields || {})['Company Name'] || '').toLowerCase(), 'en'));
  return injectRows(indexHtml, sorted.map(rec => { const f = rec.fields || {}; const slug = ctx.slugs.get(String(f['Ticker'] || '').trim()); return rowHtml(f, slug ? '/company/' + slug : ''); }).join('\n'));
}

// ---------- the "not found" page ----------
export function notFoundPage(ctx) {
  return shell({ title: 'Page not found | ORGEL', description: 'This page is not on the ORGEL Sustainability Report Index.', path: '/404', h1: 'Page not found', noindex: true,
    lead: 'There is nothing at this address. The company may be listed under another name.',
    body: '<p class="pg-actions"><a class="pg-btn" href="/">Open the Report Index</a> <a class="pg-btn pg-btn-line" href="/new">New reports</a></p>' });
}

// ---------- the build ----------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Not published: anything hidden, the output itself, and what is only for building.
const NOT_PUBLISHED = new Set(['dist', 'test', 'node_modules', 'build.mjs', 'pages.css', 'README.md']);
function copyTree(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (skip(e.name, from)) continue;
    if (e.isDirectory()) copyTree(from, to, () => false);
    else if (e.isFile()) fs.copyFileSync(from, to);
  }
}

// Builds the site from `root` into `out` and returns what it did (the same object is written to build.json).
// The repository is copied first, exactly as it is. If anything after that goes wrong, that copy is
// what gets published - the index page then draws its table with its own script, as it always did -
// and build.json says ok: false with the reason. The build itself never fails a deploy.
export function build({ root, out, now = new Date() }) {
  const summary = { ok: false, builtAt: now.toISOString(), companies: 0, companyPages: 0, sectorPages: 0, problems: [] };
  const outAbs = path.resolve(out);
  fs.rmSync(outAbs, { recursive: true, force: true });
  copyTree(root, outAbs, (name, full) => name.startsWith('.') || NOT_PUBLISHED.has(name) || path.resolve(full) === outAbs);
  try {
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    let records;
    try { records = JSON.parse(read('data.json')); } catch (e) { throw new Error('data.json could not be read: ' + e.message); }
    if (!Array.isArray(records)) throw new Error('data.json is not a list of companies');
    records = records.filter(rec => String(((rec && rec.fields) || {})['Company Name'] || '').trim());
    const rows = records.map(normalize);
    if (!rows.length) throw new Error('data.json has no companies');
    let events = [];
    try { events = JSON.parse(read('changes.json')).events || []; } catch (e) { summary.problems.push('changes.json could not be read, pages built without the list of changes: ' + e.message); }
    const ctx = makeContext(rows, events), indexHtml = read('index.html');
    // Everything is worked out before anything is written, so a failure leaves the plain copy whole.
    const files = new Map();
    files.set('index.html', indexPage(indexHtml, records, ctx));
    files.set('site.css', siteCss(indexHtml, read('pages.css')));
    for (const r of rows) {
      try { files.set('company/' + ctx.slugs.get(r.ticker) + '.html', companyPage(r, ctx)); summary.companyPages++; }
      catch (e) { summary.problems.push('no page for ' + r.company + ': ' + e.message); }
    }
    for (const s of ctx.sectors.values()) { files.set('sector/' + s.slug + '.html', sectorPage(s.name, ctx)); summary.sectorPages++; }
    files.set('new.html', newPage(ctx));
    files.set('404.html', notFoundPage(ctx));
    files.set('sitemap.xml', sitemap(ctx, now.toISOString().slice(0, 10)));
    files.set('data.csv', csv(rows));
    for (const [f, text] of files) { const to = path.join(outAbs, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text, 'utf8'); }
    summary.companies = rows.length;
    summary.ok = true;
  } catch (e) {
    summary.problems.push(String((e && e.message) || e));
  }
  fs.writeFileSync(path.join(outAbs, 'build.json'), JSON.stringify(summary, null, 1) + '\n', 'utf8');
  return summary;
}

// Run as a program (Cloudflare Pages: build command "node build.mjs", output directory "dist").
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const s = build({ root: here, out: path.join(here, 'dist') });
  console.log((s.ok ? 'Built ' : 'NOT built (the repository was published as it is): ') + JSON.stringify(s));
}
