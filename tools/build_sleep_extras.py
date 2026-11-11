"""Add the extra sitting animations from Codex's ChatGPT Pet drawings to the kiosk's sleeping-Snoopy sheet.

The pet folder (outputs/snoopy-sleep-pet/decoded) has full-size green-screen drawings of Snoopy on the doghouse that the
18 original sleep clips do not have.  This script cuts him out of four of them, lines him up exactly like the existing
sleep clips (same head size as the approved sitting pose, same roof contact line, same horizontal centre), cleans the
green edge halo with Codex's despill tool, and appends them as new rows under the existing sheet.  Existing rows are
copied through unchanged.

    new clip         drawn from   what it shows
    awake_shrug      waiting      open-palm shrugs
    awake_thinking   running      hand on chin
    awake_glance     review       head tilt and a glance to the side
    sleepy_droop     failed       eyes slowly closing, head sinking

Left out on purpose: jumping (the whole doghouse bounces, but the kiosk's doghouse is one fixed layer), running-right and
running-left (a four-legged trot, with no frames to get there from sitting, so it would pop), and idle/waving (Codex built
those from the existing sleep clips).

This is a record of how public/snoopy/sleep.png rows 19 to 22 were made.  It needs Codex's working folders on the same
Mac.  Make a scratch folder containing
    outputs/snoopy-sleep-pet/decoded/{waiting,running,review,failed}.png
    outputs/snoopy-sleep-rebuild/references/sitting-frame.png
    work/{sleep_assets,pipeline,run_pet_script}.py            (copied from Codex's work folder)
    in/sleep.png  in/sleep-manifest.json                      (the current files from public/snoopy/, 19 rows)
and this script in work/, then from the scratch folder run
    /usr/bin/python3 work/build_sleep_extras.py
The result is written to out/sleep.png and out/sleep-manifest.json (23 rows).  Copy them to public/snoopy/ and add the
engine settings (see the manifest in the repo) if you start from a fresh manifest.
"""
import sys, json, math, subprocess
sys.path.insert(0, 'work')
from pathlib import Path
from PIL import Image
import sleep_assets as a

ex = a.ex
LANCZOS = Image.Resampling.LANCZOS
PET = Path('outputs/snoopy-sleep-pet/decoded')
SITTING = Path('outputs/snoopy-sleep-rebuild/references/sitting-frame.png')
IN, OUT = Path('in'), Path('out')
OUT.mkdir(exist_ok=True)

# clip name, drawn from, frames, milliseconds per frame
NEW = [('awake_shrug', 'waiting', 6, 180), ('awake_thinking', 'running', 6, 220), ('awake_glance', 'review', 6, 200), ('sleepy_droop', 'failed', 8, 160)]


def is_red(p):
    return p[3] > 100 and p[0] > 145 and p[1] < 110 and p[2] < 110


def red_bounds(im):
    px = im.load(); xs = []; ys = []
    for y in range(im.height):
        for x in range(im.width):
            if is_red(px[x, y]):
                xs.append(x); ys.append(y)
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def character_above_roof(scene):
    """Codex's own rule (assemble_sleep_pet.py): the roof starts at the first row where red covers more than 28% of the house width."""
    b = red_bounds(scene); width = b[2] - b[0]; px = scene.load()
    roof = next(y for y in range(scene.height) if sum(1 for x in range(scene.width) if is_red(px[x, y])) > width * .28)
    crop = scene.crop((0, 0, scene.width, max(1, roof - 2)))
    return crop.crop(crop.getbbox())


def trim_roof_line(piece):
    """Drop bottom rows that are a thin dark line across (nearly) the whole width: that is the top edge of the roof, not a paw."""
    px = piece.load()
    while piece.height > 20:
        y = piece.height - 1
        row = [px[x, y] for x in range(piece.width) if px[x, y][3] > 100]
        dark = [p for p in row if 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2] < 70]
        if len(row) > 0.55 * piece.width and len(dark) > 0.6 * len(row):
            piece = piece.crop((0, 0, piece.width, y)); px = piece.load()
        else:
            break
    return piece


def clip_frames(slug, count, cell):
    im, gs = a.groups(PET / (slug + '.png'), count)
    pieces = [trim_roof_line(character_above_roof(ex.component_group_image(im, g, padding=0))) for g in gs]
    target = a.head_area(Image.open(SITTING))
    areas = [a.head_area(p) for p in pieces]
    scale = math.sqrt(target / ((areas[0] + areas[-1]) / 2))                                  # head size of the approved sitting pose
    scale = min(scale, 332 / max(p.width for p in pieces), 270 / max(p.height for p in pieces))   # same limits as sleep_assets.inspect
    out = []
    for p in pieces:
        c = p.resize((round(p.width * scale), round(p.height * scale)), LANCZOS)
        canvas = Image.new('RGBA', (384, 416))
        canvas.alpha_composite(c, (round(180 - a.lower_center(c)), 288 - c.height))            # roof contact line y=288, centre x=180 on the 384x416 canvas
        out.append(canvas.resize(cell, LANCZOS))
    return out, scale


manifest = json.loads((IN / 'sleep-manifest.json').read_text())
CELL = (manifest['cellWidth'], manifest['cellHeight'])
assert manifest['rows'] == 19, 'start from the 19-row manifest'
atlas = Image.open(IN / 'sleep.png').convert('RGBA')
assert atlas.size == (CELL[0] * 8, CELL[1] * 19), atlas.size

strip = Image.new('RGBA', (CELL[0] * 8, CELL[1] * len(NEW)))
scales = {}
for r, (name, slug, count, ms) in enumerate(NEW):
    frames, scales[name] = clip_frames(slug, count, CELL)
    for i, f in enumerate(frames):
        strip.alpha_composite(f, (i * CELL[0], r * CELL[1]))
    print('built', name, count, 'frames, scale', round(scales[name], 4), flush=True)
strip.save(OUT / 'extras-before-despill.png')
radius = str(int(round(7 * CELL[0] / 192.0)))
subprocess.run(['/usr/bin/python3', 'work/pipeline.py', 'despill_chroma_edges', str(OUT / 'extras-before-despill.png'), '--output', str(OUT / 'extras.png'), '--chroma-key', '#00FF00',
                '--edge-radius', radius, '--spill-tolerance', '.3', '--json-out', str(OUT / 'extras-despill.json')], check=True, stdout=subprocess.DEVNULL)
strip = Image.open(OUT / 'extras.png').convert('RGBA')
# A last pass for any key-green the despill tool left behind (nothing in this artwork is green): pull green down to the larger of red and blue.
px = strip.load()
for y in range(strip.height):
    for x in range(strip.width):
        r_, g_, b_, a_ = px[x, y]
        if a_ > 0 and g_ > max(r_, b_) + 8:
            px[x, y] = (r_, max(r_, b_), b_, a_)

result = Image.new('RGBA', (atlas.width, atlas.height + strip.height))
result.alpha_composite(atlas, (0, 0))
result.alpha_composite(strip, (0, atlas.height))
result.save(OUT / 'sleep.png')

for r, (name, slug, count, ms) in enumerate(NEW):
    manifest['clips'][name] = {'row': 19 + r, 'count': count, 'ms': ms, 'loop': False}
manifest['rows'] = 19 + len(NEW)
(OUT / 'sleep-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
json.dump({'cell': CELL, 'scales': scales, 'edge_radius': int(radius)}, open(OUT / 'extras-build.json', 'w'), indent=2)
print('done:', result.size, 'with', manifest['rows'], 'rows')
