# 5-lakh travel plan: Sri Lanka → Thailand → Malaysia

A researched, step-by-step travel plan for **one Pakistani passport holder** with a hard budget of
**PKR 5,00,000 all-in** (flights, visas, insurance, hotels, food, transport, sights). It is written
for a gold/jewellery business owner who has personal and business bank accounts and gold statements.

**Read the PDF:** [`5-lakh-travel-plan.pdf`](5-lakh-travel-plan.pdf) (A4, 22 pages, printable).

## The plan in short

| | |
|---|---|
| Route | Lahore/Karachi → **Sri Lanka** (Negombo 1, Kandy 2, Colombo 1) → **Thailand** (Bangkok 4) → **Malaysia** (KL 3) → home |
| Length | 13 days / 12 hotel nights (incl. one Bangkok early check-in night after the ≈ 01:05 flight) |
| Tickets | One SriLankan Airlines multi-city booking + one AirAsia flight (Bangkok → KL) |
| Visas | Sri Lanka ETA **free** · Thailand e-Visa PKR 13,000 · Malaysia eVISA ≈ RM126 |
| Expected cost | ≈ **PKR 4.73 lakh** from Karachi; ≈ **5.02 lakh** from Lahore (just over) |
| Example dates | Tue 23 Mar → Sun 4 Apr 2027 (after Eid, before mid-April New Year holidays) |

**Decision rule:** everything except the SriLankan ticket costs ≈ PKR 2.93–2.97 lakh (AirAsia
included). If the SriLankan multi-city quote is **≤ PKR 1.8 lakh**, do the 3-country plan.
Otherwise do **Plan B**: Sri Lanka + Malaysia, 13 nights, ≈ PKR 4.5–4.6 lakh. Lahore fares
are usually above the line, so Lahore travellers should expect Plan B. A 4th country does not
fit in 5 lakh.

The PDF covers:
- the budget line by line
- a timeline that puts the visas in the right order (Thailand first, then Malaysia, then Sri Lanka)
- a document file for a business owner, including how to present gold holdings
- step-by-step visa guides with the official links
- polio certificate, money and gold rules, and FIA airport checks
- a day-by-day itinerary built around SriLankan's 2026 flight times, plus a fill-in trip card
  and emergency numbers
- what each kind of refusal costs, and Plans B and C
- a cover letter template
- a table of the 20+ countries checked and why each is or isn't in the plan

## How it was made

1. **Research.** Six parallel research passes covered:
   - Southeast Asia
   - the Caucasus and Central Asia
   - South Asia, the Indian Ocean and China
   - the Gulf, Turkey and the Middle East
   - Pakistan departure rules (FIA, polio, SBP/FBR cash and card rules)
   - visa documents for a self-employed gold trader
2. **Adversarial verification.** Six checkers tried to disprove every fact the chosen plan depends
   on, using government portals, embassy pages, airline fare pages and 2026 news. This pass changed
   the plan in four ways:
   - the Lahore fare is higher than first estimated
   - AirAsia's 2026 fuel surcharge raises the Bangkok → KL fare
   - Colombo–Kandy trains currently stop at Peradeniya after cyclone damage
   - Thaipusam on 22 Jan 2027 clashes with a KL stay, so the country order was reversed

   It also ruled out the Gulf route (the 2026 Iran war; Oman needs a sponsored visa).
3. **Budget model.** A line-item model of each option, at PKR 280 = USD 1. It showed that the
   first 15-night draft did not fit and set the 12-night length and the decision rule.
4. **Review.** Four independent reviewers checked the finished content for:
   - facts against the evidence
   - budget arithmetic and consistency
   - usability for a first-time traveller
   - risk and legal safety

   This pass led to several changes:
   - the itinerary was rebuilt around real flight times: you land in Colombo at night (so night 1
     is in Negombo), Colombo → Bangkok leaves at about 01:05, and you take the morning
     KL → Colombo flight to connect home the same day
   - a table of what each refusal costs, and advice to buy a non-refundable but changeable fare
   - stricter SBP gold-jewellery guidance (leave gold jewellery at home; Forms CD and J)
   - EFU's 14-day insurance band
   - a glossary
   - fixes for contradictions between sections

All facts were checked on **6 November 2026**. Visa rules and fares change, so re-check each
official link before paying.

## Files

- `plan.json`: all content, as typed blocks (steps, tables, checklists, visa cards, day plan, letter).
- `render.cjs`: turns `plan.json` into `5-lakh-travel-plan.html` (git-ignored) and the A4 PDF.
- `plan.css`: print styles.

## Rebuild the PDF

```sh
node travel-plan/render.cjs
```

This needs Node and Playwright with Chromium (`require('playwright')`). It also needs the Inter and
Noto Color Emoji fonts installed locally; nothing is loaded from the network.
