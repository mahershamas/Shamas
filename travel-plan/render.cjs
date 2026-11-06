#!/usr/bin/env node
// Renders travel-plan/plan.json into a printable HTML page and an A4 PDF.
// Usage: node travel-plan/render.cjs [plan.json] [out.pdf]
// Needs Playwright with Chromium (require('playwright')). Fonts: Inter (local), Noto Color Emoji.
"use strict";
const fs = require("fs");
const path = require("path");

const here = __dirname;
const planPath = process.argv[2] || path.join(here, "plan.json");
const outPdf = process.argv[3] || path.join(here, "5-lakh-travel-plan.pdf");
const outHtml = outPdf.replace(/\.pdf$/, ".html");

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

/* ---------- helpers ---------- */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline markup: **bold**, [label](https://url), and bare https:// links.
function inline(s) {
  let h = esc(s).replace(/&lt;br&gt;/g, "<br>");
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s)<]+[^\s)<.,;:])/g, '$1<a href="$2">$2</a>');
  return h;
}
const lines = (arr, cls = "") => `<ul class="${cls}">${(arr || []).map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
const cell = (c) => (c && typeof c === "object" ? `<${c.h ? "th" : "td"} class="${esc(c.cls || "")}" ${c.span ? `colspan="${c.span}"` : ""}>${inline(c.t)}</${c.h ? "th" : "td"}>` : `<td>${inline(c)}</td>`);

/* ---------- blocks ---------- */

const R = {
  h2: (b) => `<h2 id="${esc(b.id || "")}" class="${b.newPage ? "new-page" : ""}"><span class="h2__num">${esc(b.num || "")}</span>${inline(b.text)}</h2>${b.sub ? `<p class="h2__sub">${inline(b.sub)}</p>` : ""}`,
  h3: (b) => `<h3>${inline(b.text)}</h3>`,
  p: (b) => `<p class="${esc(b.cls || "")}">${inline(b.text)}</p>`,
  list: (b) => lines(b.items, "bullets " + (b.cls || "")),
  callout: (b) => `<div class="callout callout--${esc(b.tone || "info")}">${b.title ? `<div class="callout__t">${inline(b.title)}</div>` : ""}${b.text ? `<p>${inline(b.text)}</p>` : ""}${b.items ? lines(b.items, "bullets") : ""}</div>`,
  table: (b) => `<div class="tbl ${esc(b.cls || "")}">${b.caption ? `<div class="tbl__cap">${inline(b.caption)}</div>` : ""}<table>
    ${b.widths ? `<colgroup>${b.widths.map((w) => `<col style="width:${w}">`).join("")}</colgroup>` : ""}
    ${b.head ? `<thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` : ""}
    <tbody>${b.rows.map((r) => `<tr class="${r.cls ? esc(r.cls) : ""}">${(r.cells || r).map(cell).join("")}</tr>`).join("")}</tbody>
    ${b.foot ? `<tfoot><tr>${b.foot.map((f) => `<td>${inline(f)}</td>`).join("")}</tr></tfoot>` : ""}
  </table>${b.note ? `<p class="tbl__note">${inline(b.note)}</p>` : ""}</div>`,
  steps: (b) => `<ol class="steps">${b.items.map((s, i) => `<li class="step">
      <div class="step__n">${esc(s.n || i + 1)}</div>
      <div class="step__body">
        <div class="step__head"><span class="step__t">${inline(s.title)}</span>${s.when ? `<span class="step__when">${inline(s.when)}</span>` : ""}</div>
        ${s.text ? `<p>${inline(s.text)}</p>` : ""}
        ${s.items ? lines(s.items, "bullets") : ""}
      </div></li>`).join("")}</ol>`,
  checklist: (b) => `<div class="check ${esc(b.cls || "")}">${b.title ? `<div class="check__t">${inline(b.title)}</div>` : ""}<ul>${b.items.map((x) => `<li><span class="box"></span><span>${inline(x)}</span></li>`).join("")}</ul></div>`,
  cols: (b) => `<div class="cols cols--${(b.cols || []).length}">${b.cols.map((c) => `<div class="col">${c.map(block).join("")}</div>`).join("")}</div>`,
  route: (b) => `<div class="route">${b.stops.map((s, i) => `${i ? `<div class="route__leg">${inline(s.leg || "")}</div>` : ""}<div class="route__stop"><div class="route__flag">${esc(s.flag || "")}</div><div class="route__name">${inline(s.name)}</div><div class="route__days">${inline(s.days || "")}</div></div>`).join("")}</div>`,
  stats: (b) => `<div class="stats">${b.items.map((s) => `<div class="stat"><div class="stat__v">${inline(s.v)}</div><div class="stat__l">${inline(s.l)}</div></div>`).join("")}</div>`,
  days: (b) => `<div class="days">${b.items.map((d) => `<div class="day">
      <div class="day__d">${inline(d.day)}</div>
      <div class="day__b"><div class="day__place">${inline(d.place)}</div><p>${inline(d.plan)}</p>${d.cost ? `<div class="day__cost">${inline(d.cost)}</div>` : ""}</div></div>`).join("")}</div>`,
  country: (b) => `<div class="country">
      <div class="country__head"><span class="country__flag">${esc(b.flag || "")}</span><span class="country__name">${inline(b.name)}</span><span class="country__tag">${inline(b.tag || "")}</span></div>
      ${b.facts ? `<dl class="facts">${b.facts.map(([k, v]) => `<div><dt>${inline(k)}</dt><dd>${inline(v)}</dd></div>`).join("")}</dl>` : ""}
      ${b.steps ? `<div class="country__sub">How to apply</div>${R.steps({ items: b.steps.map((t) => (typeof t === "string" ? { title: t } : t)) })}` : ""}
      ${b.docs ? R.checklist({ title: "Upload / carry", items: b.docs, cls: "check--tight" }) : ""}
      ${b.warn ? R.callout({ tone: "warn", text: b.warn }) : ""}
    </div>`,
  letter: (b) => `<div class="letter">${b.paras.map((p) => `<p>${inline(p)}</p>`).join("")}</div>`,
  sources: (b) => `<ol class="sources">${b.items.map((s) => `<li>${inline(s)}</li>`).join("")}</ol>`,
  spacer: () => `<div class="spacer"></div>`,
  pagebreak: () => `<div class="new-page"></div>`,
};
function block(b) {
  const f = R[b.type];
  if (!f) throw new Error("Unknown block type: " + b.type);
  return f(b);
}

/* ---------- document ---------- */

const cover = plan.cover;
const coverHtml = `<section class="cover">
  <div class="cover__kicker">${inline(cover.kicker)}</div>
  <h1>${inline(cover.title)}</h1>
  <p class="cover__sub">${inline(cover.sub)}</p>
  ${R.route({ stops: cover.route })}
  ${R.stats({ items: cover.stats })}
  ${(cover.blocks || []).map(block).join("")}
  <div class="cover__foot">${inline(cover.foot)}</div>
</section>`;

const toc = plan.toc ? `<nav class="toc"><div class="toc__t">Inside this plan</div><ol>${plan.toc.map((t) => `<li><span>${inline(t.n)}</span>${inline(t.t)}</li>`).join("")}</ol>${(plan.tocBlocks || []).map(block).join("")}</nav>` : "";

const body = plan.blocks.map(block).join("\n");
const css = fs.readFileSync(path.join(here, "plan.css"), "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plan.title)}</title>
<style>${css}</style></head>
<body>${coverHtml}${toc}<main>${body}</main></body></html>`;
fs.writeFileSync(outHtml, html);

(async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  await pg.goto("file://" + path.resolve(outHtml), { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  const footer = `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:7.5pt;color:#5d6670;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>${esc(plan.footer || plan.title)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  await pg.pdf({
    path: outPdf, format: "A4", printBackground: true,
    displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer,
    preferCSSPageSize: true,
  });
  await browser.close();
  console.log(`wrote ${outPdf}`);
})().catch((e) => { console.error(e); process.exit(1); });
