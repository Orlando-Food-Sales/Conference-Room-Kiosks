# Snoopy outfits

Put each outfit here as a full sprite sheet with the same layout as `../snoopy.png`:
8 columns x 11 rows, 192x208 cells, transparent background, same row order.

Standard sheets (1536x1872, 9 rows) also work: they have no look-around rows, so Snoopy skips that animation while wearing them (set `"rows": 9` in `../outfits.json`).

Files expected by `../outfits.json`: `christmas.png`, `new-year.png`, `halloween.png`, `autumn-thanksgiving.png`, `winter-snow.png`, `spring-raincoat.png`, `summer-sunshine.png`. A missing file is simply skipped.

To add another outfit, drop in the PNG and add an entry to `outfits.json` with either a date range (`from`/`to`, MM-DD) or `weather` (clear, clouds, rain, storm, snow, fog).
