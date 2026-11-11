# Snoopy

`snoopy.png` is an 8 column x 11 row atlas with 192x208 cells. `public/snoopy.js` plays it.

Rows: 0 idle, 1 running-right, 2 running-left, 3 waving, 4 jumping, 5 failed, 6 waiting, 7 working, 8 review, 9-10 look directions (16, clockwise from up).

Preview one animation: add `?snoopy=idle|runRight|runLeft|waving|jumping|failed|waiting|working|review|look` to a room URL.

## Sleeping on the doghouse

While the display says Closed (after hours, weekends, company holidays) Snoopy sleeps on his red doghouse in pajamas and a nightcap, with Zs floating up. A meeting still in progress overrides Closed, as it does for the status text.

- **Tap anywhere** and he wakes up in a full sequence (stir, open eyes, lift head, yawn, stretch, sit up, sleepy wave), then sits awake for **15 seconds**. Each further tap restarts the 15 seconds (it never queues a second wave). When time is up he gets drowsy, lies down and goes back to sleep.
- A tap while he is lying down again reverses that move instead of jumping. When the office reopens, everything is cancelled and the normal Snoopy returns. With "reduce motion" on, he shows a still sleeping or awake pose with the same 15 second rule.
- **More to see while he is awake.** After the wave, each time he has been idle for a couple of seconds he does the next one of: a shrug with open palms, a thoughtful hand-on-chin, a look around, a glance to the side, a sleepy droop. The order carries on from one wake to the next, so every tap shows something different. They never interrupt the wake sequence, and he still goes back to sleep on time.
- **He wakes up by himself now and then.** On a Closed day, about every 4 minutes (varying from 2.4 to 5.6) he stirs, yawns, stretches and waves like after a tap, stays up for about 10 seconds with one or two of the extras, and goes back to sleep. A tap during that extends it to the usual 15 seconds. Change `stirEveryMs` in `sleep-manifest.json` (30 seconds to 1 hour) or set it to `0` to switch it off; `stirAwakeMs` is how long a self-wake lasts. With "reduce motion" on he never stirs.
- Preview it with `?hours=closed` (and `&preview=free` so a sample meeting does not count as in progress).

Files:

| File | What it is |
|---|---|
| `sleep.png` | Character-only atlas, 8 columns x 23 rows of 288x312 cells (2304x7176, about 6 MB). Never play it as a 4-row or Pets sheet. |
| `sleep-house.png` | The fixed doghouse layer (288x312), drawn first |
| `sleep-zs.png` | The floating Zs, 8 frames (2304x312), drawn last and only while asleep |
| `sleep-manifest.json` | Which row, how many frames and how fast for each of the 18 clips, and `wakeMs` (15000) |
| `../snoopy-sleep-engine.js` | Playback rules (no browser needed, so it is unit tested) |
| `../snoopy-sleep.js`, `../snoopy-sleep.css` | The browser adapter and the layers. The normal `../snoopy.js` hides and pauses while this one is on screen |

Clips (22): settle_on_roof, lie_down, eyes_close, sleep_breathing (loop), sleep_ear_flick, sleep_paw_twitch, tap_reaction, eyes_open, head_raise, yawn, stretch, sit_up, sleepy_wave, awake_idle (loop), look_around, drowsy_blink, return_to_lying, rest_head_close_eyes, awake_shrug, awake_thinking, awake_glance, sleepy_droop. The last four come from Codex's ChatGPT Pet drawings (`../../tools/build_sleep_extras.py` cuts them out at full size, lines them up with the existing sitting pose and adds rows 19 to 22; the other 19 rows are unchanged). Left out on purpose: the doghouse bounce (the doghouse is one fixed layer here) and the four-legged trot (no frames to get there from sitting, so it would pop). If the manifest or any image is missing or the wrong size, the sleeping Snoopy does not appear and the normal one carries on.

### How sharp it is, and how to make it sharper

The sheet is the 1.5x rebuild (288x312 cells). Codex's original delivery was 192x208, which looked soft: the scene shares the cell with the doghouse, so Snoopy lying down is only 76 px tall at that size (166 px standing in the normal outfits), and Codex's packing step had shrunk its 384x416 working frames to 192x208. `../../tools/rebuild_sleep_hq.py` redoes only that last step from Codex's own drawings (same cut-out, same scales, same roof registration; shrunk back to 192x208 it matches Codex's sheet to within 2 px) and says exactly how to run it. The characters and Zs are edge-cleaned with Codex's despill tool; the doghouse only has leftover green keyed out, because that tool paints bumps onto its black outline at this size.

A still sharper sheet needs no code change: rebuild with a bigger size (for example `384 416`, 2x, about 97 MB decoded in the browser, so test it on the real tablet first), put the same size in `sleep-manifest.json` as `cellWidth` and `cellHeight`. Any size from 192x208 up to 576x624 works as long as the proportions stay 192:208. The page checks the image sizes against the manifest and falls back to the normal Snoopy if they do not match.
