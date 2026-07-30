# BKE Digital Solutions brand system

This palette is the approved foundation for the BKE Digital Solutions interface. Typography will be selected separately.

| Role | HEX | RGB | Recommended use |
| --- | --- | --- | --- |
| Primary Blue | `#3D75A7` | 61, 117, 167 | Logo, primary buttons, links, icons, active states |
| Primary Dark | `#14202B` | 20, 32, 43 | Main application background |
| Deep Navy | `#10161E` | 16, 22, 30 | Sidebar, footer, modals, deep surfaces |
| Dark Blue | `#213A53` | 33, 58, 83 | Cards, navigation, panels |
| Secondary Blue | `#2D5579` | 45, 85, 121 | Hover states, secondary buttons, borders, accents |

## CSS variables

```css
:root {
  --background: #14202B;
  --surface: #10161E;
  --primary: #3D75A7;
  --primary-hover: #2D5579;
  --secondary: #213A53;
  --border: #2D5579;
  --text: #F5F7FA;
  --text-muted: #A8B5C4;
  --success: #22C55E;
  --warning: #F59E0B;
  --danger: #EF4444;
}
```

## Tailwind color names

Use `background`, `surface`, `primary`, `primaryHover`, `secondary`, `border`, `text`, `muted`, `success`, `warning`, and `danger` if this palette is promoted into a Tailwind theme configuration.

The homepage secure-portal card uses Dark Blue to Deep Navy surfaces, Primary Blue borders and status accents, light text, and muted secondary copy. Avoid plain white feature cards on dark hero sections.
