<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# UI Design Principles

## Palette — natural earth tones only

Custom color tokens are defined in `app/globals.css`. Use them; do not introduce violet, purple, indigo, blue, or other saturated "tech" colors.

| Token | Role | When to use |
|---|---|---|
| `sage-*` | Primary accent | Generation nodes, primary buttons, active UI chrome |
| `acacia-*` | Warm highlight | Reference edges/handles, warm secondary accents |
| `clay-*` | Destructive / error | Delete hover, error states, error buttons |
| `moss-500` | Success | Saved indicator, "done" status dot |
| `stone-*` (Tailwind built-in) | Neutral chrome | Backgrounds, borders, secondary text, source nodes |

The palette is inspired by interior wall paint — Sage, Acacia, Clay, Moss. The goal is colors you would find in a calm, well-staged room, not a SaaS dashboard.

## Photos are the hero

The canvas exists to show real estate photography. Chrome should recede:
- Node cards have white backgrounds and subtle borders — never colored fills that compete with images
- Canvas background: `stone-50`, not white. Barely-warm, like linen.
- Shadows: `shadow-sm` only. Never `shadow-lg` or above on nodes.
- Avoid gradients, glassmorphism, or decorative backgrounds.

## Semantic color, not decorative color

Every use of color communicates something:
- **Sage** = "this is a generation node / primary action"
- **Stone** = "this is raw input / neutral state"
- **Acacia** = "this is a reference connection"
- **Clay** = "this will destroy something / something went wrong"
- **Moss** = "this succeeded"

Do not reach for a color just to add variety.

## Minimal, dense, touch-aware chrome

- Interactive targets: minimum 32 × 32 px touch area
- Prefer whitespace over decorative dividers
- Use `text-xs` for metadata inside nodes; `text-sm` for primary UI labels
- Icons at 13–14 px inside nodes; 16–18 px in top-level chrome

## Consistency over novelty

Use the existing shadcn component set (`Button`, `Badge`, `Textarea`). Do not introduce new UI component libraries. If a pattern doesn't exist yet, compose it from primitives already in the codebase before reaching for a new dependency.
