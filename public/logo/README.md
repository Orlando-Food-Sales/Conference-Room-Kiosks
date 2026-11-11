# Orlando Foods logo (web copies)

These are the files the tablets load, served at `/logo/<file name>`:

| File | Used for |
|---|---|
| `orlando-foods-white.png` | The dark theme (the default). All white. |
| `orlando-foods-color.png` | The light theme. Burgundy and gold, with dark "FOODS EST. 1948" lettering, so it only works on light backgrounds. |
| `orlando-foods-black.png` | Not on the display; kept for light-grey or printed uses. |

Each is made in five sizes (`-200`, `-300`, `-400`, `-600` and the plain name at 800 px wide), and the pages use `srcset` so a tablet loads the size closest to what it shows instead of shrinking a big image itself, which looks soft on thin lettering. They are trimmed to the logo (transparent PNG, under 60 KB each), resampled with Lanczos and with the edge slightly sharpened, from the full-size originals in
`assets/logo/` (3508x2482 with a lot of empty space, which are too heavy to send to tablets). To replace the logo, put
the new full-size files in `assets/logo/` and make 800 px wide trimmed copies here with the same names.

## Browser tab icon

`public/favicon.ico` (16, 32 and 48 px) and `public/apple-touch-icon.png` (180 px, for "Add to home screen") are the white "O" of ORLANDO, cut from the white logo, on the brand burgundy `#97222b` (the colour of the colour logo). The whole wordmark would be unreadable at 16 px. All three pages link them. To remake them after a logo change, crop the first letter from `assets/logo/` the same way.

The logo shows in the middle of the top bar and above "Choose a room". It is hidden only on narrow portrait screens, and a little smaller on screens 540 px tall or less. The real Samsung Galaxy Tab A7 Lite reports a 1006x600 page at 1.33x, so it gets the normal size, using the 200 px file.
