# Extension icon

`assets/icon-source.png` is the 1254px source; `icon16.png`, `icon32.png`, `icon48.png` and `icon128.png` are downscaled PNGs with transparency for Chrome.

Design: an emerald gradient rounded-square tile (about 90 percent of the canvas, transparent margin) with a single white keyboard Return arrow pointing left, thick rounded strokes, a soft top highlight and a faint arrow shadow. The light tile stays visible on dark browser toolbars, where the previous near-black tile blended in, and the arrow remains readable at 16px.

It was drawn programmatically (Pillow, 2048px canvas, downsampled with Lanczos) rather than generated, so it can be reproduced exactly.
