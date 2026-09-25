# Conduit icon

The reference logo was simplified into a bold C with two circuit connections. The dark tile, glow, small details, and excessive padding were removed. Built-in image generation supplied the concept; the final artwork was reconstructed as clean SVG geometry to avoid raster edge artifacts at small sizes.

Final assets: `assets/icon.svg` (editable master), `assets/icon.png` (transparent 1024px desktop icon), `public/conduit-mark.svg` (UI/favicon), and `public/conduit-mark.png` (PNG counterpart). Regenerate with `node scripts/build-icon.mjs`; set `CHROMIUM_PATH` when using an existing Chromium installation.

## Built-in generation prompt

Create a replacement production app icon for Conduit inspired by this reference, optimized to read at 24px. Single square 1024x1024 PNG with true transparent background outside the mark. ONLY the standalone logo glyph: a bold rounded geometric capital C, with two short thick horizontal circuit traces exiting the open right side and ending in round terminals. Large clear C aperture, extremely simple confident silhouette, thick strokes, no tiny details. Keep the reference cyan-to-electric-blue-to-violet gradient identity. Flat crisp vector-like shapes, no glow, no bevel, no shadows. NO dark rounded-square tile, NO black backdrop, NO mockup, NO words. Logo fills approximately 88 percent of canvas width and height, centered with narrow even transparent padding. Transparent negative space inside the C and around all shapes. Actual reusable application logo asset, not a presentation.
