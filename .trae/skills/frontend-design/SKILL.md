---
name: "frontend-design"
description: "Improves frontend visual consistency and component styling. Invoke when user asks to optimize layout, spacing, readability, and UI polish."
---

# Frontend Design

## Purpose
Optimize interface presentation without changing core business behavior.

## When To Invoke
- User asks to improve page look and feel
- UI appears crowded, inconsistent, or hard to scan
- Need quick visual polish before release

## Working Rules
- Keep existing product flow and data logic unchanged.
- Prefer CSS-first improvements before large JSX refactors.
- Improve hierarchy: spacing, typography, contrast, grouping.
- Preserve accessibility basics: focus states, hover states, readable sizes.
- Ensure responsive behavior for common desktop widths.

## Checklist
1. Audit current layout and reusable classes.
2. Define tokens for color, radius, shadow, and spacing.
3. Improve navigation and primary action emphasis.
4. Standardize form controls and card/list presentation.
5. Add responsive breakpoints for tablet/small desktop.
6. Validate no functional regression after style updates.

## Output Expectation
- Cleaner layout
- Better readability and action discoverability
- Consistent component look across tabs
