# ORGEL Sustainability Report Index

The site behind **[reports.orgel.us](https://reports.orgel.us/)**: the latest sustainability report (also called an ESG, impact or corporate responsibility report) from every S&P 500 company, with a direct link to each report.

Published by [ORGEL](https://www.orgel.us), a Dallas-based sustainability research and advisory firm.

## The data

| | |
|---|---|
| Searchable table | https://reports.orgel.us/ |
| One page per company | `https://reports.orgel.us/company/<name>`, for example [/company/3m](https://reports.orgel.us/company/3m) |
| CSV | https://reports.orgel.us/data.csv |
| JSON | https://reports.orgel.us/data.json |
| Newly published reports | https://reports.orgel.us/new and https://reports.orgel.us/feed.xml |
| API and field descriptions | https://reports.orgel.us/developers |

Every link is traced to the company's own disclosure page, every entry is rechecked twice a week, and new reports are confirmed by a person before they are published. A company is added when it joins the S&P 500 and is never removed, so the index lists more than 500 companies.

## Terms

The index itself (company, ticker, sector, report name, year and the links) is free for any use, commercial or not, under the [Creative Commons Attribution 4.0 license](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). Credit is required:

> Source: ORGEL Sustainability Report Index, reports.orgel.us

The reports the links point to belong to the companies that published them.

## How the site is put together

- `data.json`, `changes.json`, `meta.json`, `feed.xml` and `quotes.json` are written by ORGEL's own automation. Do not edit them by hand.
- `index.html`, `developers.html` and the other pages in the top folder are written by hand.
- `build.mjs` builds the published site into `dist/`: it copies everything, writes the table rows into the index page, and makes one page per company, the new-reports page, `sitemap.xml`, `data.csv` and `build.json`. It needs Node only, no packages.
- A sector has no page of its own: `/?sector=Energy` opens the index with that sector chosen (the company pages link there). The addresses `/sector/<name>` existed for a few hours in November 2026; `_worker.js` answers them "not found".
- No page is added to this site without Kyle's explicit approval of that page. The New Reports page (`/new`) is linked from the index page only.
- Every company page and the New Reports page carry the index page's sign-up box for the Monday email. `build.mjs` copies the box (marked `<!-- sign-up box ... -->` in `index.html`) and its script at every build, so it is always the index's own box; if it cannot find them, the pages are built without it and `build.json` says so.
- `b8ac4b05f2d136bd72204a6aca745fb6.txt` is the IndexNow key (a file, not a page). ORGEL's automation (SR29) uses it to tell Bing and the other IndexNow search engines which pages changed. Do not rename, edit or delete it.
- `sitemap.xml` dates the index page by `meta.json`'s `updatedAt` (the last time the data changed), not by the day of the build.
- Cloudflare Pages runs it on every commit. Settings: build command `node build.mjs`, build output directory `dist`.
- If the build cannot read the data, it publishes the top folder as it is and writes `"ok": false` and the reason into `build.json`. A deploy never fails because of the build.

```
node build.mjs                      # build into dist/
node --test test/build.test.mjs     # the builder's tests
node --test test/browser.test.mjs   # the built site in a real browser (needs Playwright)
```
