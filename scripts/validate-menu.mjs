#!/usr/bin/env node
// Validates data/menu.json. Run: node scripts/validate-menu.mjs
// Exits non-zero on errors; prints warnings (e.g. missing prices) without failing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || join(root, "data", "menu.json");

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

let menu;
try {
  menu = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`✗ Could not read/parse ${file}: ${e.message}`);
  process.exit(1);
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isStr = (v) => typeof v === "string";
const isNonEmpty = (v) => isStr(v) && v.trim().length > 0;

if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
  console.error(`✗ ${file}: root must be a JSON object`);
  process.exit(1);
}
if (!isNonEmpty(menu.restaurant?.name)) err("restaurant.name is required");
if (!isNonEmpty(menu.currency) || !/^[A-Z]{3}$/.test(menu.currency)) err("currency must be a 3-letter ISO code");
if (!Array.isArray(menu.policies) || !menu.policies.every(isNonEmpty)) err("policies must be an array of strings");
if (menu.allergyNotice !== undefined && !isNonEmpty(menu.allergyNotice)) err("allergyNotice must be a non-empty string if present");
if (!Array.isArray(menu.sections) || menu.sections.length === 0) err("sections must be a non-empty array");

const sectionIds = new Set();
const itemIds = new Set();
let itemCount = 0;

for (const [si, s] of (menu.sections || []).entries()) {
  const where = `sections[${si}]${s?.id ? ` (${s.id})` : ""}`;
  if (!SLUG.test(s?.id || "")) err(`${where}: id must be a lowercase slug`);
  else if (sectionIds.has(s.id)) err(`${where}: duplicate section id`);
  else sectionIds.add(s.id);
  if (!isNonEmpty(s?.name)) err(`${where}: name is required`);
  if (s?.notes !== undefined && (!Array.isArray(s.notes) || !s.notes.every(isNonEmpty))) err(`${where}: notes must be an array of strings`);
  if (!Array.isArray(s?.items) || s.items.length === 0) { err(`${where}: items must be a non-empty array`); continue; }

  const names = new Set();
  for (const [ii, it] of s.items.entries()) {
    itemCount++;
    const w = `${where} item[${ii}]${it?.name ? ` "${it.name}"` : ""}`;
    if (!SLUG.test(it?.id || "")) err(`${w}: id must be a lowercase slug`);
    else if (itemIds.has(it.id)) err(`${w}: duplicate item id "${it.id}" (ids must be unique across the whole menu)`);
    else itemIds.add(it.id);
    if (!isNonEmpty(it?.name)) err(`${w}: name is required`);
    else if (names.has(it.name.toLowerCase())) err(`${w}: duplicate item name within section`);
    else names.add(it.name.toLowerCase());
    if (it?.name && it.name !== it.name.trim()) err(`${w}: name has leading/trailing whitespace`);
    if (!isStr(it?.description)) err(`${w}: description must be a string (use "" for none)`);

    if (it?.price === null) warn(`${w}: no price (shown as "Ask your server")`);
    else if (typeof it?.price !== "number" || !Number.isFinite(it.price) || it.price <= 0) err(`${w}: price must be a positive number or null`);
    else if (Math.abs(Math.round(it.price * 100) - it.price * 100) > 1e-6) err(`${w}: price has more than 2 decimals`);
    else if (it.price > 200) warn(`${w}: unusually high price ${it.price}`);

    const d = it?.dietary;
    if (!d || typeof d !== "object") err(`${w}: dietary object is required`);
    else {
      for (const k of ["vegan", "vegetarian", "glutenFree"]) {
        if (typeof d[k] !== "boolean") err(`${w}: dietary.${k} must be boolean`);
      }
      if (d.vegan && !d.vegetarian) err(`${w}: vegan items must also be vegetarian`);
      if (it.containsGluten && d.glutenFree) err(`${w}: cannot be both glutenFree and containsGluten`);
    }
    if (typeof it?.containsGluten !== "boolean") err(`${w}: containsGluten must be boolean`);
    if (it?.printedTag !== undefined && !isStr(it.printedTag)) err(`${w}: printedTag must be a string`);
    else if (isStr(it?.printedTag) && d && typeof d === "object") {
      // A printed tag can only add marks, never contradict them: (V) => vegan, (Veg) => vegetarian, (GF) => gluten-free.
      const toks = new Set(it.printedTag.split(/[^A-Za-z]+/).filter(Boolean));
      if (toks.has("V") && !d.vegan) err(`${w}: printed tag ${it.printedTag} says vegan but dietary.vegan is false`);
      if (toks.has("Veg") && !d.vegetarian) err(`${w}: printed tag ${it.printedTag} says vegetarian but dietary.vegetarian is false`);
      if (toks.has("GF") && !d.glutenFree) err(`${w}: printed tag ${it.printedTag} says gluten-free but dietary.glutenFree is false`);
    }
    if (/contains gluten/i.test(it?.description || "") && !it?.containsGluten) err(`${w}: description says "Contains gluten" but containsGluten is false`);
    const text = `${it?.name} ${it?.description}`;
    if (/\b(chicken|lamb|goat|mutton|beef|pork|shrimps?|prawns?|salmon|fish|eggs?|wings?)\b(?![- ]?(free|less))/i.test(text) && (d?.vegetarian || d?.vegan)) {
      err(`${w}: mentions meat/fish/egg but is marked vegetarian/vegan`);
    }
    if (d?.vegan && /\b(paneer|cheese|ghee|yogurt|dahi|butter|cream|malai|milk|honey|lassi)\b/i.test(text.replace(/coconut milk/gi, ""))) {
      err(`${w}: mentions a dairy/animal ingredient but is marked vegan`);
    }
  }
}

for (const w of warnings) console.warn(`! ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} error(s) in ${file}`);
  process.exit(1);
}
console.log(`✓ ${file}: ${menu.sections.length} sections, ${itemCount} items, ${warnings.length} warning(s)`);
