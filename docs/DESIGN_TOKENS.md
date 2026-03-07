# Insighta Design Token Reference

## Color Tokens

All colors use HSL format via CSS custom properties. Light and dark mode are defined in `frontend/src/index.css`.

### Core

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--primary` | `20 90% 52%` (warm orange) | `18 85% 58%` (coral) | Primary actions, links, focus rings |
| `--secondary` | `24 5% 44%` | `220 15% 50%` | Secondary actions |
| `--destructive` | `0 72% 50%` | `0 84% 60%` | Errors, delete actions, YouTube brand |
| `--accent` | `35 30% 95%` | `225 25% 18%` | Highlighted backgrounds |
| `--muted` | `35 8% 85%` | `225 25% 18%` | Disabled states, subtle backgrounds |

### Status

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--success` | `142 71% 45%` | `142 71% 45%` | Positive feedback, completed states |
| `--warning` | `38 92% 50%` | `38 92% 50%` | Quota warnings, caution states |
| `--info` | `217 91% 60%` | `217 91% 65%` | Informational messages |

### Surfaces (Depth System)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg-base` | `40 10% 94%` | `225 40% 7%` | Page background |
| `--bg-mid` | `40 12% 97%` | `225 35% 10%` | Sidebar, popover |
| `--bg-light` | `40 15% 99%` | `225 30% 14%` | Cards, elevated surfaces |
| `--bg-sunken` | `40 8% 90%` | `225 45% 4%` | Inset containers, list backgrounds |

### Foreground

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--foreground` | `24 9% 10%` | `220 20% 97%` | Primary text |
| `--muted-foreground` | `24 10% 30%` | `220 15% 65%` | Secondary text, placeholders |

## Typography

| Property | Value |
|----------|-------|
| **Sans** | Inter, system-ui fallbacks |
| **Serif** | Source Serif Pro |
| **Mono** | JetBrains Mono |
| **Scale** | Tailwind defaults: `text-xs` (12px) to `text-4xl` (36px) |
| **Weights** | 400 (normal), 500 (medium), 600 (semibold), 700 (bold) |

## Shadows (Depth System)

Two-part shadow strategy: ambient shadow + inset highlight for physicality.

| Token | Usage |
|-------|-------|
| `--shadow-sm` | Cards at rest, filter bars |
| `--shadow-md` | Hovered cards, dropdowns |
| `--shadow-lg` | Modals, floating elements |
| `--shadow-xl` | Drag previews, overlays |
| `--shadow-inset-raised` | Raised surfaces (center cells) |
| `--shadow-inset-sunken` | Sunken containers (list areas) |

## Spacing

Uses Tailwind's default `0.25rem` base unit:

| Class | Value | Usage |
|-------|-------|-------|
| `gap-2` | 0.5rem | Tight groups (icon + text) |
| `gap-4` | 1rem | Standard spacing |
| `p-3` | 0.75rem | Cell padding |
| `p-4` | 1rem | Card content padding |
| `p-6` | 1.5rem | Section padding |

## Border Radius

| Token | Value |
|-------|-------|
| `--radius` | 0.75rem (12px) |
| `rounded-sm` | 8px |
| `rounded-md` | 10px |
| `rounded-lg` | 12px |
| `rounded-xl` | 16px |
| `rounded-2xl` | 20px |

## Component Classes

Reusable CSS component classes defined in `index.css`:

| Class | Description |
|-------|-------------|
| `.surface-base/mid/light/sunken` | Background elevation layers |
| `.surface-raised` | Raised surface with inset highlight |
| `.depth-card` | Card with shadow + hover lift |
| `.mandala-cell` | Mandala grid cell with interaction states |
| `.insight-card` | Glass-morphism card with backdrop blur |
| `.filter-bar` / `.filter-chip` | Navigation filter components |
| `.nav-item` | Sidebar navigation item with active indicator |
| `.list-container` | Sunken inset container for lists |

## Theme Switching

- **Provider**: `next-themes` with `attribute="class"`
- **Default**: System preference (`defaultTheme="system"`)
- **Toggle**: Header button (Sun/Moon icons)
- **Storage**: `localStorage` (automatic by next-themes)

## Usage Guidelines

1. **Never use hardcoded colors** in components. Use semantic tokens (`text-primary`, `bg-destructive`, `text-success`).
2. **Use surface classes** for elevation hierarchy, not arbitrary background colors.
3. **Status colors**: success (green), warning (yellow), destructive (red), info (blue).
4. **YouTube brand** uses `text-destructive` (red) consistently.
5. **Dark mode** is automatic via CSS variables. No conditional dark: classes needed for token-based colors.
