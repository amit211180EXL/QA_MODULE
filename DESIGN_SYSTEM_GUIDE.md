# Modern SaaS Design System

A professional, classy, and premium design system for the QA Platform. This document outlines design tokens, component patterns, and best practices for maintaining visual consistency across the entire application.

## Color System

### Primary Colors
- **Primary (Blue)**: Professional, trustworthy action color
  - `primary-50` - Subtle backgrounds
  - `primary-500` - Main accent (buttons, links, highlights)
  - `primary-600` - Hover state
  - `primary-700` - Active state

### Secondary Colors
- **Accent (Indigo)**: Complementary accent for secondary actions
  - `accent-500` - Secondary buttons, accents
  - `accent-600` - Hover state

### Neutral Colors
- **Slate**: Sophisticated grayscale for text, borders, backgrounds
  - `slate-50` - Lightest background
  - `slate-100` - Light backgrounds
  - `slate-200` - Borders, dividers
  - `slate-500` - Secondary text
  - `slate-700` - Body text
  - `slate-900` - Headings, primary text

### Semantic Colors
- **Success (Green)**: Positive actions, completed states
- **Warning (Amber)**: Caution, warnings, pending actions
- **Danger (Red)**: Destructive actions, errors
- **Info (Blue)**: Informational messages

## Typography

### Font Scale
- `text-2xs` (11px): Labels, badges, small UI text
- `text-xs` (12px): Form labels, helper text
- `text-sm` (13px): Body text, table data
- `text-base` (14px): Default body text
- `text-lg` (16px): Page subtitles
- `text-xl` (18px): Section headers
- `text-2xl` (20px): Page subtitles
- `text-3xl` (24px): Page headers
- `text-4xl` (30px): Main headings
- `text-5xl` (36px): Marketing headings

### Font Weights
- `font-regular` (400): Body text
- `font-medium` (500): Labels, buttons
- `font-semibold` (600): Section headers, emphasized text
- `font-bold` (700): Page headers, important text

## Spacing System

Uses a 4px grid for consistent spacing:
- `p-1` (4px), `p-2` (8px), `p-3` (12px)
- `p-4` (16px), `p-5` (20px), `p-6` (24px)
- `p-8` (32px), `p-10` (40px), `p-12` (48px)

## Border Radius

- `rounded-sm` (4px): Form inputs
- `rounded-md` (8px): Cards, buttons
- `rounded-lg` (12px): Larger components
- `rounded-xl` (16px): Major containers
- `rounded-2xl` (20px): Page-level cards
- `rounded-full` (9999px): Badges, avatars

## Shadows

### Shadow Hierarchy
- `shadow-xs`: Subtle elevation (1px) - form inputs, subtle separations
- `shadow-sm`: Light elevation (2px) - cards, popovers
- `shadow-base`: Standard elevation (4px) - default for cards
- `shadow-md`: Medium elevation (6px) - modal-like elements
- `shadow-lg`: Strong elevation (15px) - dropdowns, menus
- `shadow-xl`: Heavy elevation (25px) - modals

## Component Patterns

### Cards
Modern cards with consistent structure:

```tsx
<Card bordered shadow="sm">
  <CardHeader withGradient>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardBody>
    {/* Content */}
  </CardBody>
  <CardFooter>
    {/* Actions */}
  </CardFooter>
</Card>
```

### Buttons
- **Primary**: Main actions (blue background)
- **Secondary**: Alternative actions (light background)
- **Outline**: Tertiary actions (bordered)
- **Ghost**: Low-emphasis actions (transparent)
- **Danger**: Destructive actions (red)
- **Success**: Positive confirmations (green)

Sizes: `xs`, `sm`, `md`, `lg`, `xl`

### Tables
Professional data tables with:
- Subtle borders and spacing
- Small caps headers (`text-2xs font-semibold uppercase tracking-wide`)
- Hover states on rows
- Proper alignment and padding

### Forms
Clean, modern form design with:
- Clear labels (`text-sm font-medium`)
- Helpful error messages
- Focus rings (primary-500 with opacity)
- Proper spacing between fields
- Disabled state styling

### Badges
Semantic badges for status display:
- `variant`: default, primary, accent, success, warning, danger, info
- `size`: sm, md
- Use for tags, statuses, short labels

## Layout Patterns

### Page Layout
```tsx
<>
  <Topbar title="Page Title" />
  <div className="space-y-6">
    {/* Page header section */}
    <div>
      <h1 className="text-3xl font-bold">Main Title</h1>
      <p className="mt-2 text-base text-slate-600">Subtitle</p>
    </div>
    
    {/* Content areas */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Cards fill grid */}
    </div>
  </div>
</>
```

### Sidebar Navigation
- Light background (`bg-slate-50`)
- Bordered (`border-r border-slate-200`)
- Active states with background color
- Subtle indicators for active items

### Top Bar
- Sticky positioning (`sticky top-0 z-20`)
- Light background with backdrop blur
- Border at bottom
- User avatar with gradient

## Responsive Design

### Breakpoints (Tailwind defaults)
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

### Mobile-First Approach
- Design for mobile first
- Layer features with `sm:`, `md:`, `lg:` prefixes
- Hide non-essential elements on small screens

## Transitions & Animations

- Fast transitions: `duration-fast` (100ms) - hover states, quick feedback
- Standard transitions: `duration-base` (150ms) - default animations
- Slow transitions: `duration-slow` (200ms) - page transitions
- Timing function: `ease-smooth` cubic-bezier(0.4, 0, 0.2, 1)

## Accessibility

### Color Contrast
- All text meets WCAG AA contrast ratios (4.5:1 for normal text)
- Don't rely on color alone for meaning

### Focus States
- Clear focus rings on all interactive elements
- `focus:ring-2 focus:ring-offset-2` for buttons
- `focus:ring-primary-500` for normal elements

### Keyboard Navigation
- Tab order follows visual flow
- Skip to main content links implemented
- Dropdown menus accessible via keyboard

### Screen Readers
- Meaningful alt text for images
- Semantic HTML (buttons, links, headings)
- ARIA labels where needed

## Best Practices

### Do's
✅ Use the design tokens consistently
✅ Follow the spacing grid
✅ Use semantic colors (danger for destructive, success for positive)
✅ Maintain proper contrast ratios
✅ Use clear, descriptive labels
✅ Provide visual feedback for interactions
✅ Test on multiple screen sizes

### Don'ts
❌ Don't hardcode colors outside the design system
❌ Don't use arbitrary spacing (use 4px grid)
❌ Don't mix rounded sizes in related elements
❌ Don't rely on color alone for information
❌ Don't create new component variants without approval
❌ Don't use unnecessary shadows
❌ Don't ignore responsive design requirements

## Tailwind Configuration

All design tokens are defined in `tailwind.config.js`:
- Extended color palettes
- Custom font sizes with line heights
- Border radius scales
- Shadow definitions
- Opacity levels
- Duration and timing functions

## Implementation Examples

### Modern Card Header
```tsx
<Card>
  <CardHeader withGradient>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100">
          <Icon className="h-5 w-5 text-primary-700" />
        </div>
        <div>
          <CardTitle>Title</CardTitle>
          <CardDescription>Subtitle</CardDescription>
        </div>
      </div>
      <Button>Action</Button>
    </div>
  </CardHeader>
</Card>
```

### Data Table
```tsx
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
```

### Form Group
```tsx
<Input
  label="Field Label"
  placeholder="Placeholder text"
  hint="Help text"
  error={errors.field?.message}
  {...register('field')}
/>
```

## Maintenance

- Review design tokens quarterly
- Update tokens in Tailwind config centrally
- Test changes across all pages
- Document new patterns in this guide
- Keep component library up to date
