#!/usr/bin/env node
// Renders lunch-plan/plan.json into a printable HTML page and a PDF (US Letter).
// Usage: node lunch-plan/render.cjs [plan.json] [out.pdf]
// Needs Playwright with Chromium (require('playwright')).
"use strict";
const fs = require("fs");
const path = require("path");

const here = __dirname;
const planPath = process.argv[2] || path.join(here, "plan.json");
const outPdf = process.argv[3] || path.join(here, "30-day-lunch-plan.pdf");
const outHtml = outPdf.replace(/\.pdf$/, ".html");
const menuPath = path.join(here, "..", "data", "menu.json");

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const menu = JSON.parse(fs.readFileSync(menuPath, "utf8"));

/* ---------- helpers ---------- */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mid = (r) => (Array.isArray(r) && r.length === 2 ? Math.round((r[0] + r[1]) / 2) : null);
const round5 = (n) => Math.round(n / 5) * 5;

const THEMES = {
  chicken:      { label: "Chicken",     icon: "🍗", color: "#C9761A", tint: "#FFF1DE" },
  fish:         { label: "Fish",        icon: "🐟", color: "#2569A6", tint: "#E5F0FA" },
  seafood:      { label: "Shrimp",      icon: "🦐", color: "#C4553A", tint: "#FCE9E3" },
  vegetarian:   { label: "Vegetarian",  icon: "🥦", color: "#2E8B57", tint: "#E3F4EA" },
  lamb:         { label: "Lamb",        icon: "🍖", color: "#8A5236", tint: "#F5E9E2" },
  goat:         { label: "Goat",        icon: "🍖", color: "#8A5236", tint: "#F5E9E2" },
  "free-choice":{ label: "Your choice", icon: "⭐", color: "#6B4FD8", tint: "#EFEBFF" },
};
const theme = (t) => THEMES[t] || THEMES.vegetarian;

function sideIcon(item) {
  if (/soup/i.test(item)) return "🥣";
  if (/kumbh|mushroom/i.test(item)) return "🍄";
  if (/^none$/i.test(item)) return "—";
  return "🥗";
}
function carbIcon(item, portion) {
  const s = `${item} ${portion}`;
  if (/rice/i.test(s)) return "🍚";
  if (/dosa|idly|uttapam/i.test(s)) return "🫓";
  if (/^none$/i.test(item)) return "—";
  return "🫓";
}
function drinkIcon(d) {
  if (/chai|tea/i.test(d)) return "☕";
  if (/shikanji|lemon/i.test(d)) return "🍋";
  return "💧";
}

// Returns escaped HTML for a plan part: "Tandoori Roti" + "1 piece" -> "1 Tandoori Roti";
// a rice portion like "half of the included rice" is shown as-is; otherwise "Item · portion".
function partHtml(p) {
  if (!p || !p.item || /^none$/i.test(p.item)) return "";
  const portion = (p.portion || "").trim();
  if (!portion) return esc(p.item);
  if (/^(1|one) (piece|pc)$/i.test(portion)) return `1 ${esc(p.item)}`;
  if (/rice/i.test(portion) && /rice/i.test(p.item)) return esc(portion.charAt(0).toUpperCase() + portion.slice(1));
  return `${esc(p.item)} <span class="portion">· ${esc(portion)}</span>`;
}

/* ---------- page builders ---------- */

const pages = [];
let pageNo = 0;
function page(cls, inner) {
  pageNo += 1;
  pages.push(`<section class="page pg-${cls}">${inner}<footer class="pfoot"><span>30-Day Lunch Plan · ${esc(menu.restaurant && menu.restaurant.name || "")}</span><span>${pageNo}</span></footer></section>`);
}

// 1. Cover
page("cover", `
  <div class="cover__top">
    <p class="eyebrow">${esc(menu.restaurant && menu.restaurant.name || "")} · Lunch</p>
    <h1>${esc(plan.title)}</h1>
    <p class="cover__sub">${esc(plan.subtitle)}</p>
  </div>
  <div class="cover__body">
    <div class="plate">
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r="106" fill="#fff" stroke="#E6DFD0" stroke-width="4"/>
        <path d="M110 110 L110 14 A96 96 0 0 0 110 206 Z" fill="#CDEBD6"/>
        <path d="M110 110 L110 14 A96 96 0 0 1 206 110 Z" fill="#FFE2B8"/>
        <path d="M110 110 L206 110 A96 96 0 0 1 110 206 Z" fill="#F3E3C3"/>
        <line x1="110" y1="14" x2="110" y2="206" stroke="#fff" stroke-width="4"/>
        <line x1="110" y1="110" x2="206" y2="110" stroke="#fff" stroke-width="4"/>
        <text x="58" y="104" class="pl-ic">🥣</text><text x="58" y="132" class="pl-t">Vegetables</text><text x="58" y="148" class="pl-s">soup · sabzi</text>
        <text x="152" y="62" class="pl-ic">🍗</text><text x="152" y="88" class="pl-t">Protein</text>
        <text x="152" y="148" class="pl-ic">🫓</text><text x="152" y="172" class="pl-t">1 roti</text><text x="152" y="187" class="pl-s">or ½ rice</text>
      </svg>
    </div>
    <div class="cover__how">
      <p class="formula">${esc(plan.plate_formula)}</p>
      <ol class="steps">
        <li><b>1</b><span>Find today's <strong>Day</strong> number.</span></li>
        <li><b>2</b><span>Eat that lunch.</span></li>
        <li><b>3</b><span>Tick the box ✓</span></li>
        <li><b>↻</b><span>After Day 30, start again at Day 1.</span></li>
      </ol>
    </div>
  </div>
  <div class="cover__note">
    <span class="cover__note-ic">💚</span>
    <p><strong>Low fat, not zero fat.</strong> Your body needs a little healthy fat. This plan cuts the <em>extra</em> fat: butter, cream, ghee and fried food.</p>
  </div>
`);

// 2. Golden rules + kitchen phrases
const asks = [];
for (const d of plan.days) {
  const a = (d.ask_kitchen || "").trim();
  if (a && !asks.some((x) => x.toLowerCase() === a.toLowerCase())) asks.push(a);
}
page("rules", `
  <header class="phead"><p class="eyebrow">Remember these</p><h2>Golden rules</h2></header>
  <ol class="rules">
    ${plan.golden_rules.map((r, i) => `<li class="rule"><span class="rule__n">${i + 1}</span><div><p class="rule__t">${esc(r.rule)}</p><p class="rule__w">${esc(r.why)}</p></div></li>`).join("")}
  </ol>
  <div class="asks">
    <h3>👨‍🍳 Say to the kitchen</h3>
    <ul>${asks.slice(0, 8).map((a) => `<li>“${esc(a)}”</li>`).join("")}</ul>
  </div>
`);

// 3. Month at a glance (also a tracker)
const legendThemes = [...new Set(plan.days.map((d) => d.theme))];
page("glance", `
  <header class="phead"><p class="eyebrow">Month at a glance</p><h2>30 lunches</h2>
    <ul class="legend">${legendThemes.map((t) => `<li style="--c:${theme(t).color};--t:${theme(t).tint}"><span>${theme(t).icon}</span>${esc(theme(t).label)}</li>`).join("")}</ul>
  </header>
  <ol class="grid30">
    ${plan.days.map((d) => {
      const th = theme(d.theme);
      return `<li class="tile" style="--c:${th.color};--t:${th.tint}">
        <div class="tile__top"><span class="tile__n">${d.day}</span><span class="tile__ic">${th.icon}</span></div>
        <p class="tile__main">${esc(d.main.item)}</p>
        <span class="box" aria-hidden="true"></span>
      </li>`;
    }).join("")}
  </ol>
`);

// 4-8. Day cards, 6 per page
for (let i = 0; i < plan.days.length; i += 6) {
  const chunk = plan.days.slice(i, i + 6);
  const first = chunk[0].day, last = chunk[chunk.length - 1].day;
  const prog = Array.from({ length: 5 }, (_, k) => `<span class="${k <= i / 6 ? "on" : ""}"></span>`).join("");
  page("days", `
    <header class="phead phead--row"><div><p class="eyebrow">Week-by-week</p><h2>Days ${first}–${last}</h2></div><div class="prog">${prog}</div></header>
    <ol class="cards">
      ${chunk.map((d) => {
        const th = theme(d.theme);
        const kcal = mid(d.est_kcal), fat = mid(d.est_fat_g), pro = mid(d.est_protein_g);
        const side = partHtml(d.side) ? `<li><span class="ic">${sideIcon(d.side.item)}</span><span>${partHtml(d.side)}</span></li>` : "";
        const carb = partHtml(d.carb) ? `<li><span class="ic">${carbIcon(d.carb.item, d.carb.portion)}</span><span>${partHtml(d.carb)}</span></li>` : "";
        return `<li class="card" style="--c:${th.color};--t:${th.tint}">
          <div class="card__head"><span class="card__day">Day <b>${d.day}</b></span><span class="card__theme">${th.icon} ${esc(th.label)}</span></div>
          <p class="card__main">${esc(d.main.item)}${d.main.portion && !/full|1 plate|one plate/i.test(d.main.portion) ? `<span class="portion"> · ${esc(d.main.portion)}</span>` : ""}</p>
          <ul class="card__rows">${side}${carb}<li><span class="ic">${drinkIcon(d.drink)}</span><span>${esc(d.drink)}</span></li></ul>
          <p class="card__ask">👨‍🍳 ${esc(d.ask_kitchen)}</p>
          <div class="card__foot"><span class="stats">≈ ${round5(kcal)} kcal · ${fat} g fat · ${pro} g protein</span><span class="box" aria-hidden="true"></span></div>
        </li>`;
      }).join("")}
    </ol>
  `);
}

// 9. Menu guide: green / yellow / red, grouped by menu section
const sectionOf = new Map();
for (const s of menu.sections) for (const it of s.items) sectionOf.set(it.name.toLowerCase(), s);
function grouped(list) {
  const bySec = new Map();
  for (const x of list) {
    const s = sectionOf.get(String(x.item).toLowerCase());
    const key = s ? s.name : "Other";
    if (!bySec.has(key)) bySec.set(key, []);
    bySec.get(key).push(x);
  }
  const order = menu.sections.map((s) => s.name).concat(["Other"]);
  return order.filter((k) => bySec.has(k)).map((k) => ({ section: k, items: bySec.get(k) }));
}
const tl = plan.traffic_light;
const col = (cls, title, sub, list, withWhy) => `
  <div class="tl tl--${cls}">
    <h3>${title}</h3><p class="tl__sub">${sub}</p>
    ${grouped(list).map((g) => `<div class="tl__grp"><p class="tl__sec">${esc(g.section)}</p>${withWhy
      ? `<ul>${g.items.map((x) => `<li>${esc(x.item)}</li>`).join("")}</ul>`
      : `<p class="tl__inline">${g.items.map((x) => esc(x.item)).join(" · ")}</p>`}</div>`).join("")}
  </div>`;
page("guide", `
  <header class="phead"><p class="eyebrow">The whole menu</p><h2>What to choose</h2></header>
  <div class="tls">
    ${col("green", "✅ Eat often", "Your everyday food", tl.green, true)}
    ${col("yellow", "🟡 Sometimes", "Once a week, ask for less oil", tl.yellow, true)}
    ${col("red", "⛔ Not now", "Fried, creamy, buttery or sweet", tl.red, false)}
  </div>
`);

// 10. Swaps, every-day habits, important notes
page("swaps", `
  <header class="phead"><p class="eyebrow">Easy changes</p><h2>Smart swaps</h2></header>
  <ul class="swaps">
    ${plan.swaps.map((s) => `<li><span class="swaps__from">${esc(s.instead_of)}</span><span class="swaps__arrow">→</span><span class="swaps__to">${esc(s.choose)}</span></li>`).join("")}
  </ul>
  <div class="two">
    <div class="basics">
      <h3>☀️ Every day</h3>
      <ul>${plan.daily_basics.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    </div>
    <div class="important">
      <h3>❗ Important</h3>
      <ul>${plan.safety_notes.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    </div>
  </div>
`);

// 11. Progress tracker (12 months)
page("tracker", `
  <header class="phead"><p class="eyebrow">For the long run</p><h2>My progress</h2><p class="phead__sub">Weigh yourself once a month, same day, in the morning.</p></header>
  <table class="track">
    <thead><tr><th>Month</th><th>Date</th><th>Weight</th><th>Waist</th><th>How I feel</th></tr></thead>
    <tbody>${Array.from({ length: 12 }, (_, i) => `<tr><td>${i + 1}</td><td></td><td></td><td></td><td></td></tr>`).join("")}</tbody>
  </table>
  <p class="track__note">Slow is good: about ½–1 kg (1–2 lb) a week. Keep going! 💪</p>
`);

/* ---------- document ---------- */

const css = fs.readFileSync(path.join(here, "plan.css"), "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(plan.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style></head>
<body>${pages.join("\n")}</body></html>`;
fs.writeFileSync(outHtml, html);

(async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  await pg.goto("file://" + path.resolve(outHtml), { waitUntil: "networkidle" });
  await pg.evaluate(() => document.fonts.ready);
  // Fail loudly if any page's content overflows its sheet.
  const overflow = await pg.evaluate(() => [...document.querySelectorAll(".page")]
    .map((p, i) => ({ i: i + 1, over: p.scrollHeight - p.clientHeight }))
    .filter((x) => x.over > 1));
  if (overflow.length) console.warn("OVERFLOW:", JSON.stringify(overflow));
  await pg.pdf({ path: outPdf, format: "Letter", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`wrote ${outPdf} (${pages.length} pages)`);
})().catch((e) => { console.error(e); process.exit(1); });
