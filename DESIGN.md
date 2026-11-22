# DESIGN.md

The design system for this app. **Every page uses only the values below.** If something
you need is missing, add it here first, with a reason, and then use it.

Source: Section 9 of the product brief ("must not look AI-generated"), extracted from
`src/app/globals.css` and reviewed against three checks: a 4px spacing grid, type sizes far
enough apart to read as different levels, and WCAG 2.2 AA contrast.

Brand name lives in `src/config/brand.ts` only.

---

## 1. Character

A trusted financial company with an editorial streak: a printed real-estate fact sheet, not a
startup template. Warm paper, black ink, one green. Rules (lines) instead of boxes. Real
photographs and real numbers carry the page.

Never: gradients, glass, glows, neon, heavy shadows, emoji, purple/violet/indigo, centred hero
with three identical cards, stock Tailwind palette, "Unlock / Seamless / Empower / Elevate".

---

## 2. Colour

Defined as tokens in `globals.css` (`@theme`). The default Tailwind palette is removed, so only
these exist.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `paper` | `#F6F3EE` | Page background | — |
| `paper-deep` | `#ECE7DE` | Sunk areas, active row, table header fill | — |
| `card` | `#FBFAF7` | Input fills, raised surfaces | — |
| `white` | `#FFFFFF` | The printed statement sheet only | — |
| `ink` | `#1C1B19` | Text, heavy rules, dark buttons | 16.3:1 on paper |
| `ink-soft` | `#45423D` | Secondary text | 9.0:1 on paper |
| `stone` | `#6A655C` | Labels, captions, tertiary text | 5.2:1 paper · 4.7:1 paper-deep · 5.5:1 card |
| `rule` | `#D8D2C6` | Hairline dividers (decorative only) | not for controls |
| `edge` | `#878074` | Borders that identify a control: inputs, selects, checkboxes | 3.8:1 card · 3.5:1 paper · 3.2:1 paper-deep |
| `accent` | `#1F4D3A` | The one brand colour: primary buttons, chart series, focus ring, active state | 8.7:1 on paper |
| `accent-deep` | `#163A2B` | Primary button hover, text on `accent-wash` | 10.2:1 on accent-wash |
| `accent-wash` | `#E2EAE4` | Success notes, bid depth bars | — |
| `on-accent` | `#F6F3EE` | Text on `accent` | 8.7:1 |
| `gain` | `#2C6548` | **Gains only** | 6.2:1 on paper |
| `loss` | `#9A3B26` | **Losses and errors only** | 6.3:1 paper · 5.6:1 loss-wash |
| `loss-wash` | `#F4E4DE` | Error note background | — |
| `notice` | `#7A5A12` | Drafts, caution | 5.8:1 paper · 5.3:1 notice-wash |
| `notice-wash` | `#F3EAD0` | Caution note background | — |

Rules:
- Body text ≥ 4.5:1. Control borders and meaningful graphics ≥ 3:1. Hairlines are decoration.
- `gain`/`loss` colour only a **change in value**. Money simply moving (a deposit, a purchase) is
  ink. Every coloured figure also carries a `+` or `−`, so colour is never the only signal.
- One accent. A second brand colour is not allowed.

---

## 3. Typography

Display serif **Fraunces** (headlines, large figures). Grotesk **IBM Plex Sans** (UI, body).
All financial figures use the `.num` class: tabular, lining numerals.

| Token | Size / line height | Family | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | sans | Small-caps labels (`.label`), captions, hints, badges |
| `text-sm` | 14 / 20 | sans | UI text, tables, form controls, secondary copy |
| `text-base` | 16 / 24 | sans | Body copy |
| `text-md` | 20 / 28 | serif or sans | Small figures, list titles, lead sentences |
| `text-lg` | 24 / 32 | serif | Section headings (h2), card titles |
| `text-xl` | 30 / 36 | serif | Stats, sub-page titles |
| `text-2xl` | 36 / 40 | serif | Page titles on mobile, auth pages |
| `text-3xl` | 48 / 52 | serif | Page titles, headline figures |
| `text-4xl` | 64 / 64 | serif | Property masthead, account value |
| `text-5xl` | 88 / 88 | serif | Marketing headline only |

Rules:
- Adjacent steps differ by at least 2px below 16px and by at least 1.2× from 16px up, so every
  level reads as a different level. No sizes outside this table (no `text-[13px]`).
- Line heights sit on the 4px grid.
- `.label`: 12px, weight 500, uppercase, letter-spacing 0.09em, `stone`.
- Headings: serif, weight 400, letter-spacing −0.015em, `text-wrap: balance`.
- Weights: 400 and 500 (600 only for totals in tables). No bold display type.

---

## 4. Spacing

**4px base.** Use Tailwind steps that are multiples of 4px: `1` (4), `2` (8), `3` (12), `4` (16),
`5` (20), `6` (24), `8` (32), `10` (40), `12` (48), `14` (56), `16` (64), `24` (96).
No `0.5`, `1.5`, `2.5`, `3.5` and no arbitrary pixel values for spacing.

| Context | Value |
|---|---|
| Page gutter | 16 mobile · 32 desktop |
| Max content width | `max-w-page` 1248px; prose `max-w-prose` 640px |
| Table row | 8px vertical, 16px between columns |
| Form field gap | 20px (`space-y-5`) |
| Section gap | 56px (`pt-14`) |
| Header bottom rule → content | 32–40px |

Exempt: stroke weights (1, 2, 3px rules and the wordmark's beam) and icon sizes, which use the
icon scale (16, 20).

Layout: asymmetric grids (e.g. `1fr 22rem`, `1.2fr 2fr`), mix full-bleed photography with dense
tables, and vary section rhythm. Not every section is the same width.

---

## 5. Shape and depth

| Token | Value | Use |
|---|---|---|
| `rounded-xs` | 2px | Badges, checkboxes |
| `rounded-sm` | 4px | Buttons, inputs, toggles |
| `rounded-md` | 6px | Menus, dialogs, statement sheet |
| `rounded-full` | — | Unread dot only |

One shadow, `shadow-pop`, for layers that float above the page: menus, dialogs, toasts, chart
tooltips. Nothing else has a shadow. Structure comes from 1px rules: `border-ink` for strong
dividers (under page and section headings, table heads), `border-rule` for row dividers.

---

## 6. Components

All in `src/components/ui` and `src/components/site`. Shown together at `/design`.

| Component | Notes |
|---|---|
| Button / ButtonLink | `primary` (accent), `secondary` (ink outline), `quiet` (underlined text), `danger` (loss outline). Sizes 32/40/48px tall |
| Input, Select, Textarea, Checkbox | `card` fill, `edge` border, accent focus outline; label above in `.label`; hint or error below |
| ActionForm / Submit | Server-action form; field errors, idempotency key, pending label |
| Table / Th / Td | Ruled rows; numbers right-aligned and `.num`; caption for screen readers |
| Stat | `.label` over a serif figure; optional note |
| Facts | Key–value rows for fact sheets and order reviews |
| Badge | Small-caps text in a 1px outline; `solid` only for "open now" states |
| Tabs | Links with URLs; 2px ink underline on the active tab |
| Note | Left rule, plain text; neutral / notice / loss |
| Empty | One sentence, one next step, no illustration |
| Dialog | Native `<dialog>` |
| Toast | Ink bar, bottom-left, `aria-live="polite"` |
| ChartFrame + charts | Title, one-line reading, direct key, table alternative |
| PropertyCard | Photo, city label, serif name, three figures on a ruled row |
| Wordmark | Typeset brand name under a single beam. No icon |

---

## 7. Data visualisation

- The accent is the main series; ink (dashed or dots) is the comparison. Never more than two series.
- Horizontal hairline grid only; no vertical grid, no chart border, no legend box. Keys sit
  above the chart as text with a drawn sample.
- Every chart states what it shows in one sentence and has a "View as a table" alternative.
- No animation on charts.

---

## 8. Motion

- Only purposeful motion: the account-value count-up (700ms, ease-out cubic), a 6px rise on
  toasts (500ms), colour transitions on hover (150ms), and a 2% image zoom on card hover (500ms).
- Ease-out for things entering; nothing over 700ms; no linear fades.
- Everything is disabled under `prefers-reduced-motion`.

---

## 9. Accessibility

WCAG 2.2 AA. Visible 2px accent focus outline. A skip link. Every control has a visible label.
Tabs, filters and pagination are links, so they work without JavaScript. Errors are announced
(`role="alert"`) and tied to their field (`aria-describedby`).

---

## 10. Copy

Plain, specific, calm. Short sentences. Real numbers. Explain jargon inline ("appraised value is
an independent estimate…"). Risks in the same tone as benefits. Empty states are written with
care: what is missing, and the one thing to do next.
