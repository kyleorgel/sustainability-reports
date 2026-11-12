// reports.orgel.us - public read-only API (Cloudflare Pages advanced-mode worker, 2026-11-12)
//
// Only /api/* reaches this code (see _routes.json); every other path is a plain static
// file served by Pages. The API has no credentials, no storage and no write path: it
// reads the site's own data.json and meta.json, filters, and answers as JSON or CSV.
//
//   GET /api/v1/reports            all companies            (?format=json|csv)
//     ?sector=Energy               exact sector, case-insensitive
//     ?year=2026  ?year_min=2025   report year filters        (?year_max=...)
//     ?ticker=AAPL,MSFT            one or more tickers
//     ?status=active|none          has a published report link, or not
//     ?q=water                     substring search over company / ticker / sector / report name
//     ?download=1                  with format=csv, send as an attachment
//   GET /api/v1/meta               last update time, counts, endpoint list
//   OPTIONS                        CORS preflight
//
// Responses carry Access-Control-Allow-Origin: * and are cached at the edge for five
// minutes, so repeated identical calls never run this code twice. Data refreshes within
// an hour of a change to the index (SR13 republishes data.json; meta.json carries the time).

const DOCS = 'https://reports.orgel.us/developers';
const SOURCE = 'https://reports.orgel.us/';
const CACHE_SECONDS = 300;
const MAX_Q = 80;
const MAX_TICKERS = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400'
};
const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'public, max-age=' + CACHE_SECONDS + ', s-maxage=' + CACHE_SECONDS,
  'Vary': 'Accept-Encoding'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Cache-Control': 'public, max-age=86400' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Use GET.' }, 405, { 'Allow': 'GET, HEAD, OPTIONS' });

    // Edge cache: same URL within five minutes never recomputes.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return request.method === 'HEAD' ? new Response(null, hit) : hit;

    let res;
    try {
      const path = url.pathname.replace(/\/+$/, '');
      if (path === '/api/v1/reports') res = await reports(url, env);
      else if (path === '/api/v1/meta') res = await meta(env);
      else if (path === '/api' || path === '/api/v1') res = json({ docs: DOCS, endpoints: ['/api/v1/reports', '/api/v1/meta'] }, 200);
      else res = json({ error: 'No such endpoint. See ' + DOCS }, 404);
    } catch (e) {
      res = json({ error: 'The index could not be read right now. Try again in a minute, or fetch ' + SOURCE + 'data.json directly.' }, 503, { 'Cache-Control': 'no-store' });
    }
    if (res.status === 200) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return request.method === 'HEAD' ? new Response(null, res) : res;
  }
};

// ---------- data

let memo = { etag: null, rows: null };   // per-isolate; re-parsed only when data.json changes

async function loadRows(env) {
  const r = await env.ASSETS.fetch(new Request(SOURCE + 'data.json'));
  if (!r.ok) throw new Error('data.json ' + r.status);
  const etag = r.headers.get('etag') || '';
  if (memo.rows && etag && memo.etag === etag) { await r.body.cancel(); return memo.rows; }
  const raw = await r.json();
  const list = Array.isArray(raw) ? raw : (raw.rows || raw.data || raw.companies || []);
  const rows = list.map(normalize).filter(x => x.company);
  memo = { etag, rows };
  return rows;
}

async function loadMeta(env) {
  try {
    const r = await env.ASSETS.fetch(new Request(SOURCE + 'meta.json'));
    if (!r.ok) return {};
    return await r.json();
  } catch (e) { return {}; }
}

function unusable(v) { if (v == null) return true; const s = String(v).trim().toLowerCase(); return s === '' || s === 'none published'; }
function cleanUrl(v) { if (unusable(v)) return null; const s = String(v).trim(); return /^https?:\/\//i.test(s) ? s : null; }

function normalize(r) {
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
    status: (reportUrl || landingPageUrl) ? 'Active' : 'None',   // same rule as the page: a usable link = Active
    reportUrl,
    landingPageUrl
  };
}

// ---------- endpoints

async function reports(url, env) {
  const p = url.searchParams;
  const format = (p.get('format') || 'json').toLowerCase();
  if (format !== 'json' && format !== 'csv') return json({ error: 'format must be json or csv' }, 400);

  const filters = {};
  const sector = (p.get('sector') || '').trim().slice(0, 60);
  const status = (p.get('status') || '').trim().toLowerCase();
  const q = (p.get('q') || '').trim().slice(0, MAX_Q).toLowerCase();
  const year = intParam(p.get('year')), yearMin = intParam(p.get('year_min')), yearMax = intParam(p.get('year_max'));
  if (status && status !== 'active' && status !== 'none') return json({ error: 'status must be active or none' }, 400);
  for (const [k, v] of [['year', year], ['year_min', yearMin], ['year_max', yearMax]]) if (v === false) return json({ error: k + ' must be a four-digit year' }, 400);
  const tickers = (p.get('ticker') || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS);
  if (sector) filters.sector = sector;
  if (status) filters.status = status;
  if (q) filters.q = q;
  if (year) filters.year = year;
  if (yearMin) filters.year_min = yearMin;
  if (yearMax) filters.year_max = yearMax;
  if (tickers.length) filters.ticker = tickers;

  const all = await loadRows(env);
  const sectorLc = sector.toLowerCase();
  const tickerSet = new Set(tickers);
  const out = all.filter(x =>
    (!sector || x.sector.toLowerCase() === sectorLc) &&
    (!status || x.status.toLowerCase() === status) &&
    (!year || x.reportYear === year) &&
    (!yearMin || (x.reportYear != null && x.reportYear >= yearMin)) &&
    (!yearMax || (x.reportYear != null && x.reportYear <= yearMax)) &&
    (!tickers.length || tickerSet.has(x.ticker.toUpperCase())) &&
    (!q || (x.company + ' ' + x.ticker + ' ' + x.sector + ' ' + x.reportName).toLowerCase().includes(q))
  );

  if (format === 'csv') {
    const name = 'sustainability-reports' + (Object.keys(filters).length ? '-filtered' : '') + '.csv';
    return new Response('﻿' + toCsv(out), { status: 200, headers: {
      ...CORS, ...COMMON,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': (p.get('download') === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"'
    } });
  }
  const m = await loadMeta(env);
  return json({
    meta: {
      source: SOURCE, docs: DOCS,
      updatedAt: m.updatedAt || null,
      total: all.length, count: out.length,
      filters,
      note: 'Status Active means a report or disclosure page link is published. Every entry is rechecked twice a week.'
    },
    reports: out
  }, 200);
}

async function meta(env) {
  const m = await loadMeta(env);
  const all = await loadRows(env);
  return json({
    source: SOURCE, docs: DOCS,
    updatedAt: m.updatedAt || null,
    lastChange: m.lastChange || null,
    companies: all.length,
    withReport: all.filter(x => x.status === 'Active').length,
    schemaVersion: 1,
    endpoints: {
      reports: SOURCE + 'api/v1/reports',
      reportsCsv: SOURCE + 'api/v1/reports?format=csv',
      raw: SOURCE + 'data.json',
      changes: SOURCE + 'changes.json',
      feed: SOURCE + 'feed.xml'
    }
  }, 200);
}

// ---------- helpers

function intParam(v) {
  if (v == null || v === '') return null;
  return /^\d{4}$/.test(String(v).trim()) ? parseInt(v, 10) : false;
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...CORS, ...COMMON, 'Content-Type': 'application/json; charset=utf-8', ...(status >= 400 ? { 'Cache-Control': 'no-store' } : {}), ...(extra || {}) } });
}

const CSV_COLS = [['company', 'Company'], ['ticker', 'Ticker'], ['sector', 'Sector'], ['reportName', 'Report Name'], ['reportYear', 'Report Year'], ['status', 'Status'], ['reportUrl', 'Report URL'], ['landingPageUrl', 'Landing Page URL']];
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // never let a cell execute as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  const lines = [CSV_COLS.map(c => c[1]).join(',')];
  for (const r of rows) lines.push(CSV_COLS.map(c => csvCell(r[c[0]])).join(','));
  return lines.join('\r\n') + '\r\n';
}
