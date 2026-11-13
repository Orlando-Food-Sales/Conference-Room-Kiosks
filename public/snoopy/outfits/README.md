# Snoopy outfits

Each outfit is a full sprite sheet in this folder: 8 columns, 192x208 cells, transparent background, same row order as `../snoopy.png`.

- Sheets are 1536x2288 (11 rows, with the look-around animation). Older 1536x1872 sheets (9 rows) also work, but Snoopy skips look-around while wearing one. `"rows"` in `../outfits.json` must match (11 or 9).

Ready: `party-hat`, `christmas`, `new-year`, `valentines`, `st-patricks`, `easter`, `july-4th`, `halloween`, `veterans-day`, `mlk-day`, `presidents-day`, `earth-day`, `memorial-day`, `juneteenth`, `labor-day`, `work-anniversary`, `birthday-work-anniversary`, `groundhog-day`, `lunar-new-year`, `april-fools`, `mothers-day`, `flag-day`, `fathers-day`, `national-dog-day`, `columbus-day`, `indigenous-peoples-day`, `diwali`, `hanukkah`, `autumn-thanksgiving`, `pajamas`, `storm`, `spring-raincoat`, `winter-snow`, `summer-sunshine`, `chef`.
Weather outfits. Rules ready, art still to come (until a sheet is added here Snoopy keeps today's choice: the winter coat for ice and cold, nothing for fog, chilly days, or the Hawaiian shirt on hot days):

| File | When | Outfit idea |
|---|---|---|
| `ice.png` | Freezing rain or sleet | Hooded insulated yellow jacket, knit mittens |
| `fog.png` | Fog | Trench coat and flat cap |
| `winter-cold-coat.png` | Dry and feels 4 C / 39 F or less (snow keeps `winter-snow.png`) | Wool peacoat, scarf, beanie |
| `chilly.png` | Dry and feels above 4 C up to 12 C / 39 to 54 F | Light knit sweater |
| `heatwave.png` | Clear, daytime, feels 29 C / 84 F or more (the Hawaiian shirt stays for 18 to 29 C) | Sun hat and light tank top, no sunglasses (they hide the eyes) |

Weather order (first match wins): storm, rain, ice, snow, fog, cold, chilly, heatwave, warm and sunny. Cloudy and mild days (12 to 18 C) and hot nights stay plain Snoopy. A test checks what Snoopy wears for each case, both before and after the new sheets arrive.

Holiday and celebration outfits (art by Codex, 11-row sheets, every row checked against the base Snoopy):

| Outfit id / file | When | Outfit idea |
|---|---|---|
| `mlk-day.png` | Third Monday in January | Smart cardigan with a heart pin |
| `presidents-day.png` | Third Monday in February | Navy blazer and patriotic tie |
| `memorial-day.png` | Last Monday in May | Navy jacket, remembrance ribbon, gentle nod |
| `earth-day.png` | April 22 (before Easter in the list, so it wins when Easter week covers it) | Green gardening overalls with a leaf badge |
| `juneteenth.png` | June 19 | Red shirt with a starburst badge |
| `labor-day.png` | First Monday in September | Yellow hard hat and work vest |
| `groundhog-day.png` | February 2 | Brown winter vest, cream scarf, knit cap |
| `lunar-new-year.png` | Lunar New Year and the two days after (listed through 2035) | Red-and-gold celebration jacket |
| `april-fools.png` | April 1 (not in Easter week) | Purple jester cap, mint shirt |
| `mothers-day.png` | Second Sunday in May, from the Friday before | Floral vest, lavender bow tie |
| `flag-day.png` | June 14 | Stars-and-stripes waistcoat |
| `fathers-day.png` | Third Sunday in June, from the Friday before | Blue polo, navy cap |
| `national-dog-day.png` | August 26 | Paw-print vest, navy bow tie |
| `columbus-day.png` | Second Monday in October | Sailor shirt and cap |
| `indigenous-peoples-day.png` | Second Monday in October (same day as Columbus Day; only one can be worn, the one listed first) | Heart sweater |
| `diwali.png` | Diwali main day and the day before (US date, listed through 2035) | Plum jacket, gold embroidery |
| `hanukkah.png` | 25 Kislev, eight days (worked out every year) | Blue-and-white sweater, gold star |
| `work-anniversary.png` | A work anniversary on the display today | Navy-and-gold anniversary vest, gold bow tie |
| `birthday-work-anniversary.png` | A birthday and a work anniversary on the same day | Anniversary vest and party hat |

The sleeping Snoopy (doghouse, pajamas) is a separate set of files: see `../README.md`.

Rules live in `../outfits.json`, first match wins, top to bottom:
1. `event`: who is on the display today, first so it beats everything. `"birthday+anniversary"` (a birthday and a work anniversary on the same day: anniversary vest and party hat), then `"birthday"` (party hat), then `"anniversary"` (navy-and-gold anniversary vest). Weekend ones shown early on Friday do not change the outfit.
2. `from` / `to` (MM-DD): festive dates, may wrap the new year. Add `year` for a rule that only applies in one year.
   `easter: { "before": 7, "after": 0 }`: from that many days before Easter Sunday to that many days after it. Easter moves every year, so the display works the date out itself; the one rule works for every year and never needs updating.
   `nthWeekday: { "month": 5, "weekday": 1, "nth": -1 }`: a holiday fixed to a weekday, worked out for every year. `nth` is 1 to 4, or -1 for the last one in the month; `weekday` 0 = Sunday, 1 = Monday. Optional `before` / `after` days show it around the day too (Mother's and Father's Day fall on a Sunday, when the office is closed, so they use `"before": 2` to show Friday to Sunday).
   `hebrew: { "month": "Kislev", "day": 25, "days": 8 }`: a Hebrew calendar date, worked out by the browser every year (Hanukkah).
   `dates: { "on": ["2027-02-06", ...], "before": 0, "after": 2 }`: holidays that follow a lunar calendar the browser cannot work out reliably, listed per year (Lunar New Year, Diwali). **The lists end in 2035**; after that the outfit is simply not worn until more years are added.
   When two festive rules apply on the same day, the shorter (more specific) one is listed first, so it wins: Christmas Eve and Day, then Hanukkah, then the Christmas season; Diwali over Halloween week; Flag Day and Juneteenth over Father's Day weekend. Exception: Easter week beats April Fools' Day. A test checks this for every day from 2027 to 2040.
3. `closed: true`: the display says Closed (after hours, weekend, holiday).
4. `weather` (clear, clouds, rain, storm, snow, ice, fog; ice is freezing rain or sleet and wears the winter coat), `daytimeOnly`, and feels-like temperature limits `minTempC` / `maxTempC` in Celsius.
5. `weekdays` (0 = Sunday ... 5 = Friday): the chef hat on Fridays, last so weather and festive outfits win.

Several rules can share one image (the winter coat is used for snow and for cold days). A missing image file is skipped. Preview on a room URL with `?date=12-25` or `?date=2027-03-25`, `?hours=closed`, `?celebrate=birthday`, `?weather=storm`, `?weather=clear&temp=2&day=1`, or use the preview page.
