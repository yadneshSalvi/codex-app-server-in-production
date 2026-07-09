---
name: brand-kit
description: Apply a client's brand kit — logo, palette, voice — from the brief's assets folder, consistently across every page of a small static site.
---

# Brand kit

You are styling a site for a client who shipped paperwork: a
`brief/brief.md` and a `brief/assets/` folder. The brief SAYS what the
brand is; the assets ARE the brand. This playbook is how to honor both.

## 1. Inventory before styling

- Read `brief/brief.md` end to end and note every explicit brand rule:
  named colors (hex values), type instructions, tone words.
- List `brief/assets/` and open EVERY file in it. For an SVG, read the
  markup and write down the actual `fill` and `stroke` colors inside
  it — the logo's real colors, not the brief's description of them.
- If a copy file exists (menus, product names, addresses), treat it as
  canonical: transcribe, never paraphrase prices or names.

## 2. Reconcile brief vs assets

When the brief's stated colors and an asset's real colors disagree,
do not silently pick one:

- Style the pages consistently with ONE resolution (prefer the colors
  the client's own artwork uses — artwork is harder to change than
  paragraphs).
- Say so plainly in your final message: name the contradiction, the
  side you chose, and why. The client must be able to overrule you.

## 3. Apply the kit

- Copy every asset the site uses into the site's own folder (e.g.
  `assets/`) and reference the copy. Never reference `brief/` paths
  from a page — that folder does not ship.
- Define the palette once as CSS custom properties on `:root`
  (`--brand`, `--ink`, `--paper`, `--accent`) and use only those
  variables in the rest of the CSS.
- The logo appears wherever the brief asks (hero and footer if it
  doesn't say), always with the client's name as alt text.
- Match the brief's voice words in every heading and every line of
  copy you write; when the brief gives copy, use it verbatim.

## 4. Before you finish

Run through `checklist.md` (next to this file) and fix anything it
catches before reporting done.
