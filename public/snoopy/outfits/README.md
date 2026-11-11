# Snoopy outfits

Each outfit is a full sprite sheet in this folder: 8 columns, 192x208 cells, transparent background, same row order as `../snoopy.png`.

- Extended sheets (1536x2288, 11 rows) include the look-around animation. Standard sheets (1536x1872, 9 rows) do not, and Snoopy skips that animation while wearing one. `"rows"` in `../outfits.json` must match (11 or 9).

Ready: `party-hat`, `christmas`, `new-year`, `valentines`, `halloween`, `autumn-thanksgiving`, `pajamas`, `spring-raincoat`, `winter-snow`, `summer-sunshine`.
Waiting for art (already in `../outfits.json`, skipped until the file exists): `st-patricks`, `easter`, `july-4th`, `storm`.
Not wired yet: `chef` (needs a Friday / company anniversary rule).

Rules live in `../outfits.json`, first match wins, top to bottom:
1. `event: "birthday"`: a birthday or work anniversary is on the display today (party hat). It is first, so it beats everything.
2. `from` / `to` (MM-DD): festive dates, may wrap the new year.
3. `closed: true`: the display says Closed (after hours, weekend, holiday).
4. `weather` (clear, clouds, rain, storm, snow, fog), `daytimeOnly`, and feels-like temperature limits `minTempC` / `maxTempC` in Celsius.

Several rules can share one image (the winter coat is used for snow and for cold days). A missing image file is skipped. Preview on a room URL with `?date=12-25`, `?hours=closed`, `?celebrate=birthday`, `?weather=clear&temp=2&day=1`, or use the preview page.
