# Cursor prompt: integrate the KushMetaX pixel-dog rebrand (home page only)

Add the `kushmedia-redesign/` folder to the repo as `/_redesign/`, then paste the prompt below.

---

You're working in the KushMedia.xyz codebase. It's a static multi-page HTML site with a shared `brand.css`, Inter and Orbitron fonts, and a hamburger nav overlay. The pages are `index.html`, `dd-evaluator/`, `voyager.html`, `contact.html`, `pricing.html` and `legal/{terms-of-service,privacy-policy,refund-policy}.html`.

## HARD RULES (non-negotiable)
1. **Don't touch the DD Evaluator.** Don't modify, move, rename, reformat or "clean up" anything under `dd-evaluator/`. That covers its HTML, JS, data files, API or fetch logic, auth/login, Plus/Stripe gating and wallet estimates.
2. **Don't change shared `brand.css` in any way that could alter the evaluator or other tool pages.** Don't edit or remove existing selectors or variables that those pages use. All new styling goes in a NEW file, `home.css`, loaded only by `index.html`, and is scoped under `body.home`. Leave the existing `--accent` and other tokens in `brand.css` exactly as they are. Define the new palette tokens (below) inside `body.home { ... }` in `home.css`.
3. **Same caution applies to `voyager.html`, `contact.html`, `pricing.html` and `legal/*`.** Their markup, scripts, forms and styles stay unchanged. The only allowed change is swapping the logo image `src` and adding the favicon `<link>` tags. If a page's layout would shift because of that swap, revert the swap on that page and report it.
4. **Verify before and after.** Before you change anything, and again after, check each of these and report pass/fail in a checklist:
   - The evaluator loads.
   - A Doginal Dog valuation returns a price.
   - DDL TCG card pricing works.
   - Login works.
   - The Plus/pricing flow (`pricing.html`, upgrade and checkout entry) works.
   - Voyager loads.
   - Contact links work.
   - The legal pages load.
   - No new console errors.
   If anything regresses, revert it.
5. **Routes stay identical.** Every link in the new home page points at the existing paths above.

## What to do
- Replace `index.html` with `_redesign/index.html`. Add `class="home"` to its `<body>`. Keep the current canonical, OG and Twitter meta tags, and change the title and description only.
- Move `_redesign/styles.css` into `home.css`, prefixing its selectors with `body.home` (or nesting them). Copy `_redesign/main.js` and `posts.js` in as `home.js` and `home-posts.js`, used by the home page only.
- **Logo swap:** stop using the old yellow-background `assets/Kush.png` everywhere. Use the new dog assets instead. Don't delete `Kush.png` until the swap is confirmed (or leave it in place if `og-home.jpg` or the tool pages depend on it).
  - `assets/kush-dog.png` and `assets/kush-dog.webp`: 1000×1000 PFP on a mint background.
  - `assets/kush-dog-cutout.png`: transparent background, used in the hero.
  - `assets/favicon.ico`, `favicon-32.png`, `favicon-180.png` (apple-touch) and `favicon-512.png`.
  - Use `image-rendering: pixelated` on these images.
- **Fonts:** add Press Start 2P (display headings) and Silkscreen (UI labels and buttons) on the home page only. Body text stays in Inter.
- Keep the `[bracketed]` placeholders visible and list them in your summary. Don't invent content.
- Don't add a build step, and don't put an X API key in client code. `home-posts.js` is static data.

## Palette (sampled from the PFP pixels)
- `--mint #8DFFA4`: primary accent and buttons
- `--orange #FFAD33`: secondary, hard shadows, CTA band
- `--tan #CC9246`, `--tan-dark #A16E3F`, `--tan-light #DCB263`, `--ochre #B07A23`
- Hatband stripe: `--band-green #00DB3E`, `--yellow #FED83A`, `--red #E33B44`. Use it as the repeating divider `.band`.
- `--eye #46EC70`, `--grey #B2B2B2`, `--grey-dark #565656`, `--ink #000` (outlines and hard shadows)
- Base: `--bg #0B120D`, `--bg-2 #101A13`, `--card #16221A`, `--text #F2FFF5`, `--dim #B9CDBE`

Pixel style: 4px black borders, offset hard shadows (`6px 6px 0 #000`), no border radius, press-down button states.

When you're done: list the changed files, confirm that nothing under `dd-evaluator/` changed (`git diff --stat dd-evaluator/` should be empty), confirm `brand.css` has no diff or only additive changes, and include the verification checklist.
