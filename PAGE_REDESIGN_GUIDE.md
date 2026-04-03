# Page-by-Page Redesign Implementation Guide

This guide shows how to update each remaining page to match the modern design system. All pages should follow the same structural pattern for consistency.

## Pattern for Page Redesign

### 1. Remove Old Styles
- Replace custom color classes (gray-*, blue-*, red-*, etc.)
- Remove old border/shadow styles
- Remove old card wrappers

### 2. Apply New Structure
Every page should follow:
```tsx
<>
  <Topbar title="Page Title" />
  <div className="space-y-6">
    {/* Page Header */}
    <div>
      <h1 className="text-3xl font-bold text-slate-900">Title</h1>
      <p className="mt-2 text-base text-slate-600">Subtitle</p>
    </div>

    {/* Page Content - using Card components */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>...</CardHeader>
        <CardBody>...</CardBody>
      </Card>
    </div>
  </div>
</>
```

### 3. Color Replacements
Search and replace in each file:
- `gray-50` → `slate-50`
- `gray-100` → `slate-100`
- `gray-200` → `slate-200`
- `gray-300` → `slate-300`
- `gray-500` → `slate-500`
- `gray-600` → `slate-600`
- `gray-700` → `slate-700`
- `gray-800` → `slate-800`
- `gray-900` → `slate-900`

- `red-50` → `danger-50`
- `red-100` → `danger-100`
- `red-500` → `danger-500`
- `red-600` → `danger-600`
- `red-700` → `danger-700`

- `green-50` → `success-50`
- `green-100` → `success-100`
- `green-500` → `success-500`
- `green-600` → `success-600`
- `green-700` → `success-700`

- `yellow-50` → `warning-50`
- `yellow-100` → `warning-100`
- `yellow-500` → `warning-500`
- `yellow-600` → `warning-600`
- `yellow-700` → `warning-700`

- `blue-50` → `primary-50`
- `blue-100` → `primary-100`
- `blue-500` → `primary-500`
- `blue-600` → `primary-600`
- `blue-700` → `primary-700`

- `indigo-500` → `accent-500`
- `indigo-600` → `accent-600`
- `indigo-700` → `accent-700`

### 4. Card Updates
Replace inline card styles:

**Old:**
```tsx
<div className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
  <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3">
    {/* Header content */}
  </div>
</div>
```

**New:**
```tsx
<Card>
  <CardHeader withGradient>
    {/* Header content */}
  </CardHeader>
  <CardBody>
    {/* Body content */}
  </CardBody>
</Card>
```

### 5. Table Header Updates
Replace:
```tsx
<th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
```

With:
```tsx
<th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
```

### 6. Badge Updates
Replace inline badge styles with Badge component:

**Old:**
```tsx
<span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
  Active
</span>
```

**New:**
```tsx
<Badge variant="success" size="md">Active</Badge>
```

## Pages to Update (Priority Order)

### High Priority (Main Workflows)
1. **analytics/page.tsx**
   - Current: Basic chart cards
   - Action: Update card styling, table headers, use Badge for statuses

2. **billing/page.tsx** ⚠️ Already has page header
   - Current: Subscription card, pricing tables
   - Action: Update card styling, button variants, alert styling

3. **settings/** (all sub-pages)
   - Current: Form groups with inline styling
   - Action: Update form labels, input styling, card wrappers

### Medium Priority (Supporting Features)
4. **conversations/page.tsx** ⚠️ Already has page header
   - Current: Data table with filters
   - Action: Update table headers, button variants

5. **forms/page.tsx** ⚠️ Already has page header
   - Current: Form list table
   - Action: Update table styling, actions

6. **users/page.tsx** ⚠️ Already has page header
   - Current: User table with roles
   - Action: Update table, badges, modal styling

### Lower Priority (Data Pages - Already Partially Updated)
7. **qa-queue/page.tsx** ⚠️ Already modernized
8. **verifier-queue/page.tsx** ⚠️ Already modernized
9. **escalation-queue/page.tsx** ⚠️ Already modernized
10. **audit-queue/page.tsx** ⚠️ Already modernized
11. **upload/page.tsx** ⚠️ Already has gradient header
12. **dashboard/page.tsx** ✅ Modernized

## Component Usage Examples

### For Status Badges
```tsx
import { Badge } from '@/components/ui/badge';

// ACTIVE status
<Badge variant="success" size="md">Active</Badge>

// PENDING status
<Badge variant="warning" size="md">Pending</Badge>

// ERROR status
<Badge variant="danger" size="md">Error</Badge>
```

### For Action Buttons
```tsx
import { Button } from '@/components/ui/button';

// Primary action
<Button variant="primary" size="md">Save</Button>

// Secondary action
<Button variant="secondary" size="md">Cancel</Button>

// Destructive action
<Button variant="danger" size="md">Delete</Button>
```

### For Alert Messages
```tsx
import { Alert } from '@/components/ui/alert';

// Success
<Alert variant="success">Operation completed successfully</Alert>

// Error
<Alert variant="danger">Something went wrong</Alert>

// Warning
<Alert variant="warning">Please review this information</Alert>
```

### For Page Headers
```tsx
<div>
  <h1 className="text-3xl font-bold text-slate-900">Page Title</h1>
  <p className="mt-2 text-base text-slate-600">Descriptive subtitle</p>
</div>
```

### For Data Tables
```tsx
<Card>
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-slate-100">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
            Column Header
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((item) => (
          <tr key={item.id} className="hover:bg-slate-50">
            <td className="px-4 py-3 text-sm text-slate-700">{item.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Card>
```

## Quick Wins (Easy Updates)

### 1. Text Color Updates
Most text should be:
- Primary (headings): `text-slate-900`
- Secondary: `text-slate-700`
- Tertiary: `text-slate-600`
- Meta/Labels: `text-slate-500`

### 2. Border Updates
Use `border-slate-200` for all borders, `border-slate-100` for subtle dividers

### 3. Background Updates
- Page background: `bg-slate-50/50` (already applied globally)
- Card backgrounds: `bg-white` (use Card component)
- Hover backgrounds: `hover:bg-slate-50`

### 4. Spacing Updates
Ensure consistent spacing with the 4px grid:
- Section gaps: `gap-6` or `space-y-6`
- Card padding: `p-5` for headers, `p-4` for sections
- Grid gaps: `gap-4` or `gap-6`

## Testing Checklist

After updating each page, verify:
- [ ] All text colors use new slate palette
- [ ] All buttons use new button variants
- [ ] All cards use Card component or updated inline styles
- [ ] All alerts use new Alert component
- [ ] All badges use Badge component
- [ ] Table headers use updated typography
- [ ] Responsive design works on mobile (sm:, md:, lg: prefixes)
- [ ] No console errors
- [ ] Hover states work properly
- [ ] Focus states visible for accessibility
- [ ] Spacing aligns with 4px grid

## Assets & Resources

- **Design System Guide**: `/DESIGN_SYSTEM_GUIDE.md`
- **Tailwind Config**: `apps/web/tailwind.config.js`
- **Component Examples**: Check dashboard, forms/new for reference implementations
- **Color Reference**: Access design system via VS Code color intellisense

## Performance Notes

- Modern Tailwind config is fully tree-shakeable
- Only active utilities are included in output
- No performance impact from expanded color palette
- Smooth transitions use `duration-base` (150ms default)
- Shadows are GPU-accelerated

## Accessibility Compliance

All components follow WCAG 2.1 AA standards:
- Contrast ratios ≥ 4.5:1 for normal text
- Focus rings clearly visible
- Keyboard navigation supported
- Semantic HTML used throughout
- ARIA labels where needed

## Need Help?

1. Check DESIGN_SYSTEM_GUIDE.md for detailed patterns
2. Review dashboard/page.tsx for modern implementation example
3. Compare old vs new Card component usage
4. Verify Tailwind config has all needed tokens
