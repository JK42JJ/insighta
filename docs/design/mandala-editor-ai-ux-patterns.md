# Mandala Editor — AI UX Patterns Research

> Research source: 20+ AI tools analyzed (2024-2026). Visual mockup: `insighta-mandala-editor-v3.html`
> GitHub Issue: #335

## Core Insight

A Mandala chart is a **hierarchical grid** (73 cells) — neither document, nor image, nor tree. Very few AI tools serve this category directly (Xmind is the only mainstream tool with Grid Structure layout). Patterns must be synthesized from adjacent tool categories.

## Five Design Decisions

### 1. Two-Phase Progressive Generation

| Phase | Scope | User Action |
|-------|-------|-------------|
| Phase 1 | Center 3x3 grid (goal + 8 sub-goals) | Review → Approve/Retry |
| Phase 2 | 8 outer sub-grids (64 action items) | Progressive reveal, per-subgrid regeneration |

- From: Miro AI staging, Xmind Copilot branch expansion
- Matches natural top-down thinking
- Prevents cognitive overload of reviewing 73 cells at once

### 2. Tab + Minimap Variant Comparison

```
[Variant A] [Variant B] [Variant C] [Variant D]    ← Tabs
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                ← Minimap thumbnails
│ □□□  │ │ □□□  │ │ □□□  │ │ □□□  │
│ □■□  │ │ □■□  │ │ □■□  │ │ □■□  │
└──────┘ └──────┘ └──────┘ └──────┘
┌──────────────────────────────────────────┐
│      Full-size Mandala (selected tab)     │        ← Readable, interactive
└──────────────────────────────────────────┘
[Use This Variant]  [Compare Side-by-Side]
```

- 3-4 variants (image tools: 4, text tools: 2 — Mandala splits the difference)
- Cell-level cherry-picking across variants
- Side-by-side diff highlighting (GitHub-style for grid data)

### 3. Compound-Action Undo with Auto-Snapshots

| Layer | Mechanism | Persistence |
|-------|-----------|-------------|
| 1 | AI generation = 1 atomic undo entry | Session |
| 2 | Auto-snapshot before every AI action | Cross-session |
| 3 | AI suggestion/preview mode (per-cell accept/reject) | Until commit |
| 4 | Figma-style version history sidebar | Permanent |

- 8-10 second undo toast (higher stakes than email)
- From: Cursor's painful lessons, Photoshop Snapshot model

### 4. Three-Level Partial Regeneration

| Level | Scope | Trigger |
|-------|-------|---------|
| Cell | Single cell | Right-click → "Regenerate" / "More specific" / "More actionable" |
| Sub-grid | 8 items for one subject | Click sub-grid header → "Regenerate this sub-grid" |
| Full chart | All 73 cells | "Regenerate entire Mandala" (with confirmation) |

- Pre-canned contextual refinements (Notion AI pattern)
- After commit: no visual distinction AI vs manual (Whimsical instant-to-native)
- "Reset to AI suggestion" preserves original generation as fallback

### 5. Hybrid Template + AI Creation Flow

```
✨ "Describe your goal..."                         ← AI prompt (primary)
[Career growth] [Study plan] [Business strategy]   ← Suggestion chips

📋 START WITH A TEMPLATE
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Career │ │ Study  │ │ Health │ │ Annual │
│ Goals  │ │ Plan   │ │ Goals  │ │ Review │
└────────┘ └────────┘ └────────┘ └────────┘

⬜ Start with blank Mandala                        ← Tertiary option
```

- Templates solve "what 8 categories?" + AI solves "what 64 sub-items?"
- 8-12 curated templates (Career, Study, Health, Business, Weekly, Annual, etc.)
- Suggestion chips solve cold-start problem (from Gamma.app)

## Implementation Priority

1. **AI suggestion/preview mode** — trust foundation, per-cell accept/reject
2. Template system with AI fill
3. Two-phase progressive generation
4. Variant comparison with minimap
5. Version history sidebar

## Tool Sources

| Category | Tools |
|----------|-------|
| Text gen | Notion AI, Claude Artifacts, ChatGPT |
| Visual gen | Midjourney, DALL-E, Adobe Firefly |
| Code gen | v0.dev, GitHub Copilot, Cursor AI |
| Hierarchy | Miro AI, Whimsical AI, Xmind, Lucidchart |
| Design/template | Canva, Wix, Squarespace, Gamma.app |
| Undo/versioning | Photoshop, Figma, Claude Artifacts |

## Key Quotes

> "A persistent, easy-to-read Action Audit log, with a prominent Undo button for every possible action, is the ultimate safety net." — Smashing Magazine (Feb 2026)

> "Never use a warning when you mean undo." — Design principle applied to AI generation

## Related

- Visual mockup: [`insighta-mandala-editor-v3.html`](insighta-mandala-editor-v3.html)
- Frontend v3 wireframes: #322
- Mandala Skills: #334
