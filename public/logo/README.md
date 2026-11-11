# Orlando Foods logo (web copies)

These are the files the tablets load, served at `/logo/<file name>`:

| File | Used for |
|---|---|
| `orlando-foods-white.png` | The dark theme (the default). All white. |
| `orlando-foods-color.png` | The light theme. Burgundy and gold, with dark "FOODS EST. 1948" lettering, so it only works on light backgrounds. |
| `orlando-foods-black.png` | Not on the display; kept for light-grey or printed uses. |

They are trimmed to the logo and 800 px wide (transparent PNG, under 60 KB each), made from the full-size originals in
`assets/logo/` (3508x2482 with a lot of empty space, which are too heavy to send to tablets). To replace the logo, put
the new full-size files in `assets/logo/` and make 800 px wide trimmed copies here with the same names.

The logo shows in the middle of the top bar and above "Choose a room". It is hidden on narrow (portrait) and very short
screens where there is no space.
