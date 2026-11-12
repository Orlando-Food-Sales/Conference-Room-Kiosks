# Snoopy outfits

Each outfit is a full sprite sheet in this folder: 8 columns, 192x208 cells, transparent background, same row order as `../snoopy.png`.

- Sheets are 1536x2288 (11 rows, with the look-around animation). Older 1536x1872 sheets (9 rows) also work, but Snoopy skips look-around while wearing one. `"rows"` in `../outfits.json` must match (11 or 9).

Ready: `party-hat`, `christmas`, `new-year`, `valentines`, `st-patricks`, `easter`, `july-4th`, `halloween`, `veterans-day`, `mlk-day`, `presidents-day`, `earth-day`, `memorial-day`, `juneteenth`, `labor-day`, `autumn-thanksgiving`, `pajamas`, `storm`, `spring-raincoat`, `winter-snow`, `summer-sunshine`, `chef`.
Holiday outfits (art by Codex, 11-row sheets):

| Outfit id / file | When | Outfit idea |
|---|---|---|
| `mlk-day.png` | Third Monday in January | Smart cardigan with a heart pin |
| `presidents-day.png` | Third Monday in February | Navy blazer and patriotic tie |
| `memorial-day.png` | Last Monday in May | Navy jacket, remembrance ribbon, gentle nod |
| `earth-day.png` | April 22 (before Easter in the list, so it wins when Easter week covers it) | Green gardening overalls with a leaf badge |
| `juneteenth.png` | June 19 | Red shirt with a starburst badge |
| `labor-day.png` | First Monday in September | Yellow hard hat and work vest |

The sleeping Snoopy (doghouse, pajamas) is a separate set of files: see `../README.md`.

Rules live in `../outfits.json`, first match wins, top to bottom:
1. `event: "birthday"`: a birthday or work anniversary is on the display today (party hat). It is first, so it beats everything.
2. `from` / `to` (MM-DD): festive dates, may wrap the new year. Add `year` for a rule that only applies in one year.
   `easter: { "before": 7, "after": 0 }`: from that many days before Easter Sunday to that many days after it. Easter moves every year, so the display works the date out itself; the one rule works for every year and never needs updating.
   `nthWeekday: { "month": 5, "weekday": 1, "nth": -1 }`: a holiday fixed to a weekday, worked out for every year. `nth` is 1 to 4, or -1 for the last one in the month; `weekday` 0 = Sunday, 1 = Monday.
3. `closed: true`: the display says Closed (after hours, weekend, holiday).
4. `weather` (clear, clouds, rain, storm, snow, ice, fog; ice is freezing rain or sleet and wears the winter coat), `daytimeOnly`, and feels-like temperature limits `minTempC` / `maxTempC` in Celsius.
5. `weekdays` (0 = Sunday ... 5 = Friday): the chef hat on Fridays, last so weather and festive outfits win.

Several rules can share one image (the winter coat is used for snow and for cold days). A missing image file is skipped. Preview on a room URL with `?date=12-25` or `?date=2027-03-25`, `?hours=closed`, `?celebrate=birthday`, `?weather=storm`, `?weather=clear&temp=2&day=1`, or use the preview page.
