# 30-day lunch plan: research and audit notes

This folder holds a 30-day, repeatable, low-fat lunch plan built only from dishes on the Jalsa menu (`../data/menu.json`), plus the printable PDF.

- **`30-day-lunch-plan.pdf`**: the printable plan (12 pages, US Letter)
- **`plan.json`**: the plan data (days, rules, green/yellow/red lists, swaps, assumptions)
- **`render.cjs` + `plan.css`**: turn `plan.json` into the PDF: `node lunch-plan/render.cjs` (needs Playwright + Chromium)

> General guidance for a healthy adult, not medical advice. Nutrition numbers are estimates: the restaurant publishes no nutrition data, and restaurant cooking varies two- to three-fold in oil, ghee and cream.

## How it was made

1. **Research** (4 independent agents): an evidence review (WHO, ICMR-NIN 2024, DGA, AHA, trials and meta-analyses); per-dish nutrition estimates for all 123 menu items from USDA FoodData Central, the Indian Food Composition Tables / INDB and lab-tested UK and Irish takeaway data; and how restaurant kitchens add hidden fat, with what to ask the cook.
2. **Design**: a 30-day plan from those numbers, using only exact menu names.
3. **Audit** (3 independent reviewers): nutrition science, menu fit and practicality, and adversarial safety. Verdicts: nutrition `ship-with-fixes`, menu fit `ship-with-fixes`, safety `ship-with-fixes`. No critical issues; every major issue was fixed. Issues deliberately not applied are listed with reasons in `plan.json` → `assumptions`.
4. **Final checks**: a script confirms every name exists on the menu, all 123 items are classified exactly once, no lunch repeats on consecutive days (including Day 30 → Day 1), and every day's estimate (middle of its range) sits inside the targets. The PDF text was compared against `plan.json`, and the rendered pages were reviewed for readability on a phone and in print.

## Lunch targets

| | Target per lunch |
|---|---|
| Energy | 450–650 kcal |
| Fat | 12–22 g (salmon days slightly higher: mostly omega-3 fat) |
| Saturated fat | ≤ 6 g |
| Protein | ≥ 25 g |
| Fibre | ≥ 8 g |

Why not zero fat: Do not aim for zero fat. It is impossible, since rice, wheat, dal and chicken all contain natural fat, and it is unsafe. The body cannot make two fats: linoleic acid (omega-6) and alpha-linolenic acid (omega-3). ICMR-NIN 2024 sets minimums of about 3% of energy from omega-6 (about 6.6 g/day at 2000 kcal) and 0.6-1.2% from omega-3 (about 2.2 g/day); US Adequate Intakes are about 11-17 g and 1.1-1.6 g/day. Adults on fat-free IV feeding show essential-fatty-acid deficiency in blood tests within 1-2 weeks. Vitamins A, D, E, K and carotenoids are absorbed only together with dietary fat; carotenoid absorption from salad was close to zero with fat-free dressing, and about 3 g of oil was enough in a later study. Very-low-fat crash diets with fast weight loss also raise gallstone risk.

Rate of loss: The safe default is about 0.5 kg (1 lb) a week.

## Key evidence

- **Body fat comes off when you eat less energy than you burn, and the plan you can keep doing matters more than its exact mix of fat, carbs and protein.** _(strong)_ — [DIETFITS randomized clinical trial (Gardner et al., JAMA 201](https://pubmed.ncbi.nlm.nih.gov/29466592/) · [Comparison of weight loss among named diet programs (Johnsto](https://pubmed.ncbi.nlm.nih.gov/25182101/) · [Popular Diets Equally Effective for Losing Weight (AAFP summ](https://www.aafp.org/afp/2005/0501/p1783.html)
- **Lower-fat eating works about as well as other approaches. It is a sensible tool, but it is not magic, and it does not have to be zero fat.** _(strong)_ — [Door Closing on Low-fat Diets for Long-term Weight Managemen](https://www.tctmd.com/news/door-closing-low-fat-diets-long-term-weight-management) · [Low-fat diets fail to lead to long-term weight loss (Healio ](https://www.healio.com/news/endocrinology/20151217/lowfat-diets-fail-to-lead-to-longterm-weight-loss) · [NIH study compares low-fat, plant-based diet to low-carb, an](https://www.nih.gov/news-events/news-releases/nih-study-compares-low-fat-plant-based-diet-low-carb-animal-based-diet)
- **A zero-fat diet is impossible and unsafe: the body needs essential fats and some fat to absorb vitamins A, D, E and K.** _(strong)_ — [ICMR-NIN Dietary Guidelines for Indians 2024 (fats section, ](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf) · [DRI: The Essential Guide to Nutrient Requirements - fat and ](https://nap.edu/read/11537/chapter/12) · [Fat-Soluble Vitamins A, D, E, and K: Review for the Clinicia](https://pmc.ncbi.nlm.nih.gov/articles/PMC11242131)
- **Keep total fat moderate and saturated fat low: about 20-30% of calories from fat, under 10% from saturated fat, and almost no trans fat.** _(strong)_ — [WHO updates guidelines on fats and carbohydrates (17 July 20](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates) · [Saturated fatty acid and trans-fatty acid intake for adults ](https://www.who.int/publications/i/item/9789240083592) · [ICMR-NIN Dietary Guidelines for Indians 2024 (pp. 53-54 fats](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf)
- **In restaurant Indian food, most of the fat comes from cooking: oil, ghee, butter, cream, coconut milk and frying. Asking the kitchen to change these is the biggest lever.** _(strong)_ — [Tikka Shack Menu Nutrition Information v2022 (published chai](https://www.tikkashack.com/uploads/b/79627190-8308-11e9-9713-3b6906145db8/Tikka%20Shack%20Nutrition%20Summary%202022.pdf) · [Nutritional composition of takeaway food in the UK (Jaworows](https://researchonline.ljmu.ac.uk/id/eprint/3064/1/Nutritional%20composition%20of%20Takeaway%20Food%20in%20the%20UK%20accepted%20version.pdf) · [Saturated and trans fatty acids in UK takeaway food (Davies ](https://researchonline.ljmu.ac.uk/id/eprint/3000/1/Saturated%20and%20Trans%20fatty%20acids%20in%20the%20UK%20takeaway%20food%20%20IJFSN%20V1.0%2005012016%20%28Final%20Draft%20Accepted%20Version%20%29.pdf)
- **Restaurant portions are much larger than a weight-loss lunch, so aim for about 600 kcal or less.** _(strong)_ — [(Over)eating out at major UK restaurant chains (Robinson et ](https://pmc.ncbi.nlm.nih.gov/articles/PMC6290483) · [Why we are working to reduce calorie intake (PHE/UKHSA blog,](https://ukhsa.blog.gov.uk/2018/03/06/why-we-are-working-to-reduce-calorie-intake) · [Mowgli Street Food introduces the new 600 calorie Lite Tiffi](https://liverpoolbidcompany.com/mowgli-street-food-introduces-the-new-600-calorie-lite-tiffin-for-just-15-per-person/)
- **Swap the daily naan (refined maida) for one tandoori roti (whole-wheat atta). This is probably the single biggest easy win.** _(moderate)_ — [Indian Food Composition Tables 2017 (A018 maida, A019 atta)](https://nin.res.in/ebooks/IFCT2017.pdf) · [USDA FoodData Central - Bread, naan (FNDDS 2707613)](https://fdc.nal.usda.gov/portal-data/external/2707613) · [USDA FoodData Central - Bread, chappatti or roti (FNDDS 2707](https://fdc.nal.usda.gov/portal-data/external/2707713)
- **Rice comes with every curry and tandoor plate, so portion size is the lever: plain steamed rice, half a portion.** _(moderate)_ — [USDA FoodData Central - Rice, white, cooked, no added fat (F](https://fdc.nal.usda.gov/portal-data/external/2708408) · [Indian takeaways loaded with fat and salt (safefood survey c](https://www.irishhealthpro.com/content/news/show/name/indian-takeaways-loaded-with-fat-and-salt) · [ICMR-NIN Dietary Guidelines for Indians 2024 (Guideline 9, p](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf)
- **Eat about 25-30 g or more of protein at lunch. It keeps you full and protects muscle while you lose fat.** _(moderate)_ — [The role of protein in weight loss and maintenance (Leidy et](https://pubmed.ncbi.nlm.nih.gov/25926512/) · [Effects of energy-restricted high-protein, low-fat vs standa](https://researchnow.flinders.edu.au/en/publications/effects-of-energy-restricted-high-protein-low-fat-compared-with-s/) · [ICMR-NIN Dietary Guidelines for Indians 2024 (protein pp. ~5](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf)
- **Fill half the plate with vegetables, dal or chana. Fibre makes a meal filling and was among the strongest predictors of weight loss.** _(moderate)_ — [Fiber Intake Predicts Weight Loss and Dietary Adherence: POU](https://pmc.ncbi.nlm.nih.gov/articles/PMC6768815/) · [When it comes to diets, one simple change can be effective (](https://www.umassmed.edu/news/news-archives/2015/02/when-it-comes-to-diets-one-simple-change-can-be-effective) · [WHO updates guidelines on fats and carbohydrates (fibre, veg](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates)
- **Do not drink calories: water, seltzer or unsweetened chai instead of soda, lemonade, Indian sodas or mango lassi.** _(strong)_ — [Sugar-sweetened beverages and weight gain in children and ad](https://pmc.ncbi.nlm.nih.gov/articles/3778861) · [WHO Sugar Guideline 2015: a summary for health professionals](https://www.foodwatch.com.au/blog/student-material/item/who-sugar-guideline-a-summary-for-health-professionals.html) · [WHO advises not to use non-sugar sweeteners for weight contr](https://www.paho.org/en/news/15-5-2023-who-advises-not-use-non-sugar-sweeteners-weight-control-newly-released-guideline)
- **Restaurant curry is very salty. Ask for less salt and skip pickle, extra papad and salty chutneys.** _(strong)_ — [WHO sodium fact sheet (French edition)](https://www.who.int/mediacentre/factsheets/fs393/fr/) · [Salt intake (PAHO/WHO)](https://www.paho.org/en/enlace/salt-intake) · [Action on Salt (CASH) 2010 curry survey](https://actiononsalt.org.uk/news/surveys/2010/curries)
- **Fried snacks, creamy or buttery curries, wraps, biryani and sweets have the most calories per bite. Keep them as occasional treats, not daily lunch.** _(moderate)_ — [ICMR-NIN Dietary Guidelines for Indians 2024 (Guideline 15, ](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf) · [USDA FoodData Central - Samosa (FNDDS 2708730)](https://fdc.nal.usda.gov/portal-data/external/2708730) · [Tikka Shack Menu Nutrition Information v2022](https://www.tikkashack.com/uploads/b/79627190-8308-11e9-9713-3b6906145db8/Tikka%20Shack%20Nutrition%20Summary%202022.pdf)
- **Jalsa menu sorted into green (most days, with kitchen changes), amber (about once a week) and red (rare treat), based on how each dish is cooked.** _(moderate)_ — [Tikka Shack Menu Nutrition Information v2022 (dish-type comp](https://www.tikkashack.com/uploads/b/79627190-8308-11e9-9713-3b6906145db8/Tikka%20Shack%20Nutrition%20Summary%202022.pdf) · [Saturated and trans fatty acids in UK takeaway food (Davies ](https://researchonline.ljmu.ac.uk/id/eprint/3000/1/Saturated%20and%20Trans%20fatty%20acids%20in%20the%20UK%20takeaway%20food%20%20IJFSN%20V1.0%2005012016%20%28Final%20Draft%20Accepted%20Version%20%29.pdf) · [ICMR-NIN Dietary Guidelines for Indians 2024 (HFSS)](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf)
- **My worked estimates of sample lunches show the targets can be met from this menu, but only with kitchen changes and smaller rice portions.** _(weak)_ — [USDA FoodData Central - Chicken breast, grilled (FNDDS 27059](https://fdc.nal.usda.gov/portal-data/external/2705968) · [USDA FoodData Central - Fish, salmon, baked or broiled (FNDD](https://fdc.nal.usda.gov/portal-data/external/2706286) · [USDA FoodData Central - Chickpeas, from canned, no added fat](https://fdc.nal.usda.gov/portal-data/external/2707418)
- **Eat fish (salmon tikka, shrimp) about twice a week. Fish fat is the good kind, so these days can go a little over the fat target.** _(moderate)_ — [Fish and Omega-3 Fatty Acids (American Heart Association)](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/fats/fish-and-omega-3-fatty-acids) · [ICMR-NIN Dietary Guidelines for Indians 2024 (fats, p. 53)](https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf) · [Indian Food Composition Tables 2017 (P068 salmon, Q007/Q008 ](https://nin.res.in/ebooks/IFCT2017.pdf)
- **Move every day and do strength work twice a week, so the weight lost is fat rather than muscle.** _(moderate)_ — [World Health Organization 2020 guidelines on physical activi](https://bjsm.bmj.com/content/54/24/1451) · [Resistance Training Prevents Muscle Loss Induced by Caloric ](https://pmc.ncbi.nlm.nih.gov/articles/PMC5946208/) · [Comparing exercise modalities during caloric restriction: ne](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12158682/)
- **Drink a big glass of water (about 500 ml) before lunch. It is a small, cheap habit with modest evidence.** _(weak)_ — [Water consumption increases weight loss during a hypocaloric](https://pubmed.ncbi.nlm.nih.gov/19661958/)

## Estimated nutrition of the dishes used in the plan

Restaurant serving as described; curries exclude rice. Ranges reflect recipe variation.

| Dish | kcal | fat g | sat fat g | protein g | rating |
|---|---|---|---|---|---|
| Tandoori Chicken Tikka | 300–500 | 8–22 | 2–7 | 48–72 | green |
| Spinach Soup | 80–190 | 3–11 | 0.5–6 | 3–7 | green |
| Tandoori Roti | 160–280 | 1–5 | 0.2–1.2 | 6–10 | green |
| Yellow Daal | 300–490 | 9–24 | 1–4 | 15–24 | green |
| Lentil Soup | 170–300 | 2–10 | 0.3–2.5 | 10–16 | green |
| Vegan Steamed White Rice | 300–420 | 0.5–4 | 0.1–1.2 | 6–9 | green |
| Shrimp Jalfrezi | 320–470 | 17–32 | 2–5.5 | 30–41 | green |
| Veggie Soup | 80–180 | 1.5–8 | 0.2–1.5 | 2–5 | green |
| Tandoori Ghost Chicken | 300–520 | 8–24 | 2–7.5 | 48–72 | green |
| Idly | 310–640 | 8–26 | 4–11 | 13–24 | green |
| Tandoori Salmon Fish Tikka | 290–600 | 12–37 | 2.5–8 | 40–58 | yellow |
| Tandoori Chicken Kathi Roll | 450–680 | 16–30 | 4–9 | 30–45 | yellow |
| Mix Daal | 380–560 | 13–28 | 1.5–4.5 | 17–26 | green |
| Tandoori Rosemary Chicken Tikka | 300–500 | 8–22 | 2–7 | 48–72 | green |
| Chana Masala | 450–710 | 17–34 | 2–4.5 | 19–30 | green |
| Chicken Jalfrezi | 410–600 | 21–36 | 4–9.5 | 41–52 | green |
| Tandoori Chicken Leg | 380–640 | 16–34 | 4.5–11 | 52–73 | yellow |
| Plain Dosa | 480–800 | 14–39 | 4.5–13 | 15–21 | green |
| Chicken Veggie Soup | 120–230 | 3–9 | 0.8–2.5 | 11–20 | green |
| Chana Kathi Roll | 480–720 | 20–32 | 3–8 | 14–22 | yellow |

## Cautions

- See a doctor before changing your diet if you have diabetes, especially if you take insulin or sulfonylurea tablets (gliclazide, glimepiride, glipizide). Eating less can make blood sugar fall too low, and your doses may need to change.
- Kidney disease: do not push protein high. KDIGO 2024 advises about 0.8 g protein per kg of body weight a day for chronic kidney disease (CKD) stages 3-5, and no more than 1.3 g/kg if the disease may get worse. Ask your doctor or dietitian.
- Pregnant or breastfeeding: do not follow a weight-loss plan now. You need more nutrients, including omega-3 from fish, nuts and seeds. Talk to your doctor.
- Taking warfarin: keep green leafy foods (spinach soup, saag, palak) about the same amount every day. Do not suddenly add or remove them.
- High blood pressure, heart disease or heart failure: restaurant curries are very salty. Ask for less salt, and skip pickle, papad and extra chutney.
- Had gallstones before: lose weight slowly and avoid crash or very-low-fat diets.
- Under 18, over 65, very muscular, or an eating disorder now or in the past: get advice from a doctor or dietitian first.
- Allergies: korma, nizami, navratan and malai kofta dishes contain nuts. Shrimp dishes contain shellfish. Naan, roti, samosa, pav, puri and kathi rolls contain gluten. Paneer, yogurt marinades, ghee and cream contain milk. Tell the kitchen, as the Jalsa menu asks.
- South Asian background: diabetes and heart risk start at lower weights. WHO notes higher risk below a BMI of 25, and ICMR flags a waist over 90 cm for men or 80 cm for women. Ask your doctor for blood sugar and cholesterol checks.
- Stop and see a doctor if you feel dizzy or weak, are always tired, faint, lose hair, miss periods, or lose more than about 1 kg a week for several weeks.
- Do not stop any medicine that may cause weight gain (for example steroids, some antidepressants, or insulin) without talking to your doctor. Unexplained weight gain or swelling also needs a check-up.
