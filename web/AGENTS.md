<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# UI Design System

## Stack

Styles: **Tailwind CSS v4** — configured via `@theme` blocks in `app/globals.css`. No `tailwind.config.js`.

Components: **shadcn with `base-nova` style** — wraps **Base UI (`@base-ui/react`)**, NOT Radix UI. `@radix-ui/*` is NOT installed. Do not import from it.

Extending the kit: `npx shadcn add <component>` in `web/`. This generates a Base UI wrapper. Do not hand-roll Base UI wrappers.

---

## Palette — natural earth tones only

Tokens are defined in `app/globals.css` under `@theme`. Do not introduce violet, purple, indigo, blue, or other saturated "tech" colors — ever.

| Token | Role | When to use |
|---|---|---|
| `sage-*` | Primary accent | Primary buttons, generation nodes, active chrome, focus rings |
| `acacia-*` | Warm highlight | Reference edges/handles, warm secondary accents |
| `clay-*` | Destructive / error | Delete hover, error states, error buttons |
| `moss-500` | Success | "Done" status dot, saved confirmations |
| `stone-*` | Neutral chrome | Backgrounds, borders, secondary text, source nodes |

Every color communicates something. Do not reach for a color just to add variety.

- **Sage** = primary action / generation
- **Stone** = raw input / neutral state  
- **Acacia** = reference connection
- **Clay** = destruction / error
- **Moss** = success

---

## CSS Tokens

All defined in `:root` in `app/globals.css`.

### Semantic tokens (map to palette)
```
--primary               oklch sage-600  — default Button fill, links
--primary-foreground    white
--ring                  oklch sage-600  — focus rings on all controls
--destructive           oklch clay      — destructive Button variant
--border                stone-200       — default border
--input                 stone-200       — input border
--muted-foreground      stone-500       — placeholder, helper text
```

### Design tokens (spatial)
```
--radius                0.625rem        — base radius; shadcn components scale from this
--radius-node           10px            — canvas node card corners (Apple-style)
--shadow-float          subtle 2-layer  — MenuBar and floating panels; use shadow-[var(--shadow-float)]
--duration-fast         100ms           — micro-interactions (hover, ripple)
--duration-base         180ms           — transitions (open/close, color change)
```

### Z-index scale
```
--z-header      10   — sticky AppHeader
--z-dropdown    50   — DropdownMenu, Select popover
--z-modal       100  — Dialog overlays
--z-toast       200  — Toaster (always on top)
```

Use `z-[var(--z-header)]` etc. — never raw z-index numbers.

---

## Component Library

### Available shadcn components (`components/ui/`)

| Component | Import path | Use for |
|---|---|---|
| `Button` | `@/components/ui/button` | All clickable actions |
| `Input` | `@/components/ui/input` | Text, email, password, search fields |
| `Textarea` | `@/components/ui/textarea` | Multi-line text |
| `Label` | `@/components/ui/label` | Form field labels |
| `Select` / `SelectTrigger` etc. | `@/components/ui/select` | Dropdown selects |
| `DropdownMenu` + family | `@/components/ui/dropdown-menu` | Context menus, user menus |
| `Dialog` + family | `@/components/ui/dialog` | Modals (includes focus trap, Escape, ARIA) |
| `Tooltip` / `TooltipContent` | `@/components/ui/tooltip` | Icon-button affordances |
| `Skeleton` | `@/components/ui/skeleton` | Loading placeholder shapes |
| `Sonner` (`Toaster`) | `@/components/ui/sonner` | Global toast notifications |
| `Badge` | `@/components/ui/badge` | Status chips, labels |
| `Separator` | `@/components/ui/separator` | Dividers |
| `Card` | `@/components/ui/card` | Content cards |
| `StatusDot` | `@/components/ui/status-dot` | Colored status indicator dots |

### Custom shared components

| Component | Path | Use for |
|---|---|---|
| `AppHeader` | `@/components/AppHeader` | Top navigation bar on every non-canvas page |
| `StatusDot` | `@/components/ui/status-dot` | Status indicator (moss/acacia/clay/stone) |

---

## Form patterns

Always compose: `<Label>` + `<Input>` (or `<Textarea>`, `<Select>`).

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

<div className="space-y-1.5">
  <Label htmlFor="name">Property name</Label>
  <Input id="name" type="text" value={name} onChange={...} />
</div>
```

**Never** style raw `<input>` / `<textarea>` / `<label>` from scratch in forms. The shadcn components handle focus rings, disabled states, and aria-invalid automatically via the `--ring` and `--input` tokens.

**Exception:** Inline editing fields (e.g. session rename, property name in-place edit) use a bare `<input>` with `bg-transparent border-b border-stone-300 outline-none` — intentionally minimal, looks like editable text, not a form control.

---

## Select pattern

Base UI Select `onValueChange` passes `string | null`. Always guard:

```tsx
<Select value={value} onValueChange={(val) => { if (val !== null) setValue(val); }}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="foo">Foo</SelectItem>
  </SelectContent>
</Select>
```

Or for optional fields that allow clearing: `onValueChange={(val) => setValue(val ?? "")}`.

---

## Modal / Dialog pattern

Use `<Dialog>` from `@/components/ui/dialog`. Never build hand-rolled fixed overlays (`fixed inset-0 z-50 bg-black/30`). The Dialog component provides focus trapping, Escape-to-close, backdrop, and ARIA roles automatically.

Controlled usage (open state owned externally):
```tsx
<Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent className="sm:max-w-[480px]" showCloseButton={false}>
    <DialogHeader className="flex-row items-center justify-between">
      <DialogTitle>Title</DialogTitle>
      <DialogClose className="text-stone-400 hover:text-stone-600 p-1 rounded">
        <X size={15} />
      </DialogClose>
    </DialogHeader>
    {/* content */}
  </DialogContent>
</Dialog>
```

Triggered usage (Dialog owns open state):
```tsx
<Dialog>
  <DialogTrigger render={<Button>Open</Button>} />
  <DialogContent>...</DialogContent>
</Dialog>
```

---

## Dropdown / navigation menu pattern

Use `DropdownMenu` from `@/components/ui/dropdown-menu`.

- Navigation links (href): use `DropdownMenuLinkItem` — wraps Base UI `Menu.LinkItem`.
- Actions (onClick): use `DropdownMenuItem`.
- Never use `asChild` — Base UI does not support the Radix render-prop pattern.

```tsx
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

<DropdownMenu>
  <DropdownMenuTrigger>…</DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLinkItem href="/settings">Settings</DropdownMenuLinkItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Toast / notification pattern

A global `<Toaster>` is mounted in `app/layout.tsx`. Use `sonner`'s `toast` function anywhere:

```tsx
import { toast } from "sonner";

toast.success("Saved");
toast.error("Something went wrong");
toast("Neutral message");
```

Do not create inline success/error `<p>` banners for transient feedback. Use toasts. Reserve inline error text for persistent validation errors (required fields, server errors that persist after a failed submit).

---

## Tooltip pattern

`TooltipProvider` is mounted in `app/layout.tsx`. Use `Tooltip` for icon-only buttons:

```tsx
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

<Tooltip>
  <TooltipTrigger render={<Button variant="ghost" size="icon-sm"><Trash2 size={14} /></Button>} />
  <TooltipContent>Delete</TooltipContent>
</Tooltip>
```

Every button that shows only an icon must have either a visible label or a `<Tooltip>`.

---

## Loading states

Use `<Skeleton>` for content areas that are loading (preserves layout shape). Reserve `<Loader2 className="animate-spin">` for in-button spinners and full-page blocking loads only.

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// List loading placeholder
<div className="space-y-2">
  <Skeleton className="h-10 w-full" />
  <Skeleton className="h-10 w-full" />
  <Skeleton className="h-10 w-2/3" />
</div>
```

---

## StatusDot

Use for inline status indicators. The caller owns the semantic mapping; the component owns only the visual.

```tsx
import { StatusDot } from "@/components/ui/status-dot";
import type { StatusDotTone } from "@/components/ui/status-dot";

// Tone values: "moss" | "acacia" | "clay" | "stone"
<StatusDot tone="moss" />              // success
<StatusDot tone="acacia" pulse />      // in-progress (animated)
<StatusDot tone="clay" />              // error
<StatusDot tone="stone" />             // idle / unknown
```

---

## AppHeader

Every non-canvas page uses `AppHeader`. Never duplicate the header markup.

```tsx
import { AppHeader } from "@/components/AppHeader";

// Simple
<AppHeader />

// With breadcrumb
<AppHeader breadcrumb={
  <>
    <Link href="/admin" className="text-sm text-stone-500 hover:text-stone-700">Admin</Link>
    <span className="text-stone-300 mx-0.5">/</span>
    <span className="text-sm text-stone-700">Billing</span>
  </>
} />

// With action buttons
<AppHeader actions={<Button size="sm">Save</Button>} />
```

The header is always `h-12 bg-stone-50 border-b border-stone-200 sticky top-0 z-[var(--z-header)]`.

---

## Button variants

Default `<Button>` fills with `--primary` (sage-600). Use variants for other intents:

```
<Button>                       sage fill — primary action
<Button variant="outline">     bordered — secondary action
<Button variant="ghost">       transparent — tertiary / icon actions
<Button variant="destructive"> clay fill — irreversible destructive action
```

Avoid manually overriding `bg-sage-*` on Button. If you find yourself writing `className="bg-sage-600 hover:bg-sage-700 text-white"` on a Button, you're fighting the design token — check that `--primary` is set correctly.

---

## Typography scale

| Context | Class | Notes |
|---|---|---|
| Page title | `text-xl font-semibold text-stone-900` | |
| Section heading | `text-sm font-semibold text-stone-700` | |
| Body / form labels | `text-sm text-stone-700` | |
| Metadata, timestamps | `text-xs text-stone-400` | |
| Node labels | `text-xs` | Dense canvas context |
| Section group labels | `text-[11px] font-medium text-stone-400 uppercase tracking-wide` | e.g. "Link access" dividers |

---

## Border radius rules

| Context | Value | Notes |
|---|---|---|
| Canvas nodes | `rounded-[var(--radius-node)]` | 10px — Apple-style card |
| Cards, modals, panels | `rounded-xl` | 12px — standard UI card |
| Buttons, inputs, badges | `rounded-lg` | from `--radius` token |
| Avatar circles | `rounded-full` | |

Never use `rounded-2xl` or above on cards — it reads as playful/mobile, not professional.

---

## Shadows

| Context | Class |
|---|---|
| Canvas node cards | `shadow-sm` only |
| Floating MenuBar, panels | `shadow-[var(--shadow-float)]` |
| Modals | handled by Dialog component |
| Cards in page layout | `shadow-sm` at most |

Never use `shadow-lg` or higher. Chrome should recede; photos are the hero.

---

## Photos are the hero

- Node cards: white backgrounds, subtle borders — no colored fills competing with images.
- Canvas background: `stone-50`, not white.
- Shadows on nodes: `shadow-sm` only.
- No gradients, glassmorphism, or decorative backgrounds.

---

## Consistency over novelty

1. Check `components/ui/` before writing anything from scratch.
2. Use `npx shadcn add` to extend the kit — don't hand-roll Base UI wrappers.
3. Do not introduce new UI libraries. The stack is: Tailwind v4 + Base UI via shadcn.
4. One focus style everywhere: `focus-visible:ring-3 focus-visible:ring-ring/50` (handled by shadcn components automatically via `--ring`).
5. Inline `style={{}}` is banned for anything covered by a Tailwind utility.
