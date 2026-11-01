# Jalsa — digital menu

A fast, mobile-first web menu built from photos of the printed menu
(`source-photos/`). It's a plain static site with no build step and no dependencies, and
it works on any static host (GitHub Pages, Netlify, S3, …).

- **Search** dishes by name, description or section
- **Filter** by Vegan / Vegetarian / Gluten-free (combinable), with shareable links,
  e.g. `?diet=vegan,glutenFree` or `?q=dosa`
- **Section navigation** with a sticky bar that tracks the section you're reading
- Light and dark mode, print-friendly, keyboard and screen-reader accessible

Also in this repo: **[`lunch-plan/`](lunch-plan/)**, a researched and audited 30-day low-fat lunch plan
made only from dishes on this menu, as a printable PDF
([`lunch-plan/30-day-lunch-plan.pdf`](lunch-plan/30-day-lunch-plan.pdf)).

## Run locally

The page loads `data/menu.json` with `fetch`, so it must be served over HTTP
(opening `index.html` straight from disk will show an error).

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Editing the menu

All menu content lives in **`data/menu.json`**. You never need to touch the HTML or JS
to change a dish or a price.

```jsonc
{
  "id": "masala-dosa",              // unique, lowercase-with-dashes
  "name": "Masala Dosa",
  "description": "",                // "" when the menu has none
  "price": 16,                      // number, or null to show "Ask your server"
  "dietary": { "vegan": true, "vegetarian": true, "glutenFree": true },
  "containsGluten": false,          // true shows a "Contains gluten" badge
  "printedTag": "(V & GF)"          // optional: the tag exactly as printed
}
```

Rules (checked automatically):

- `vegan: true` requires `vegetarian: true`.
- `glutenFree` and `containsGluten` can't both be true.
- Item ids must be unique across the whole menu.

After editing, validate:

```sh
node scripts/validate-menu.mjs
```

The same check runs in GitHub Actions on every push or pull request that changes the data.

### How dietary marks were derived

Only what the printed menu states is used. Nothing is inferred from ingredients:

- **Item tags** such as `(V&GF)`, `(V/Veg&GF)`, `(Veg)` → vegan / vegetarian / gluten-free.
  Vegan items are also counted as vegetarian.
- **Section headings and subtitles**, e.g. *Vegan Curry*, *Vegetarian Curry*, and
  "All items are gluten-free (except for Pav Bhaji)" on the tandoor, curry and biryani
  sections.
- **Item names** that say "Vegan" (vegan biryanis, vegan steamed rice).
- "Contains gluten" in a description → `containsGluten: true`.

Items without any printed mark, such as drinks, desserts and Goat Korma, are left
unmarked rather than guessed.

## Deploy on GitHub Pages

1. In the repository go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, then select
   `main` and `/ (root)`.
3. The menu will be served at `https://<user>.github.io/<repo>/`.

## How the data was produced

The three photos in `source-photos/` (EXIF metadata removed) were transcribed
independently several times, and every disagreement was resolved by zooming into and
contrast-enhancing the photo. On several sections (tandoor, sides, drinks, desserts)
the price column is printed out of line with the item names. Those prices were mapped
by counting names and prices in order, and the mapping was anchored on rows where name
and price share a line.

## Please confirm with the restaurant

These could not be read with certainty from the photos, or look like errors on the
printed menu:

| Item | Issue | Currently shown |
| --- | --- | --- |
| Vada Pav (Appetizers) | Price completely hidden by glare in the photo | "Ask your server" (`price: null`) |
| Papadum (Appetizers) | Only the `$` is clear; the digit looks like a 4 | $4 |
| Mirchi Pakoda (Appetizers) | One word is hidden by glare; measuring the gap fits "stuffed with **a** cheese mix" | "with a cheese mix" |
| Goat Korma (Goat Curry) | Only "G… Korma" is visible; "Goat" and the first word of the description are inferred | "Goat Korma" |
| Chingri Malaikari (Seafood Curry) | First letter hidden by glare ("_hingri"); "Chingri" is the standard dish name | "Chingri Malaikari" |
| Shahi Yellow Rice (Sides) | The word after "Yellow" is hidden by glare | "Shahi Yellow Rice" |
| Paneer Tikka Masala (Vegetarian Curry) | Printed description "Peas with homemade cottage Cheese" duplicates Matar Paneer's (likely a print error) | as printed |
| Tandoori Chicken Leg (Tandoor) | $22, more than Chicken Tikka ($18); the price column is offset, but the order mapping is consistent | $22 |
| Restaurant name | "Jalsa" is taken from dish names (Jalsa Kathi Rolls, Jalsa Garden Dosa, …) | "Jalsa" (`restaurant.name`) |
