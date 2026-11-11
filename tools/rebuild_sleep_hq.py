"""Rebuild the kiosk sleeping-Snoopy sheet with bigger cells (default 288x312, 1.5x) from Codex's own decoded drawings.

Why: Codex's packaging step composes every frame on a 384x416 canvas and then shrinks it to 192x208, which throws away
detail (Snoopy lying down is only 76 px tall in the 192x208 cell, so he looked soft next to the flat doghouse).  This
script reuses Codex's extraction code unchanged (same cut-out, same shared scale, same roof registration; all 18 clip
scales match the ones Codex recorded) and only changes the final shrink.

Characters and floating Zs are edge-cleaned with Codex's despill tool (radius scaled with the cell size).  The doghouse
is NOT run through that tool: at this size it paints dark red bumps onto the black outline, so only the leftover
chroma-key green is removed there (pixels where green clearly dominates).

This is a record of how public/snoopy/sleep*.png were made.  It needs Codex's working folders on the same Mac:
copy outputs/snoopy-sleep-rebuild/{decoded,references} and final/sleep-manifest.json, plus work/{sleep_assets,pipeline,
run_pet_script}.py, into a scratch folder with this script in work/, then from that folder run
    /usr/bin/python3 work/rebuild_sleep_hq.py 288 312
The result is written to out/ (sleep.png, sleep-house.png, sleep-zs.png).  Put them in public/snoopy/ and set cellWidth
and cellHeight in sleep-manifest.json to the same size (any size from 192x208 to 576x624 with the same proportions works).
"""
import sys, json, math, subprocess
sys.path.insert(0, 'work')
from pathlib import Path
from PIL import Image
import sleep_assets as a

ex, ROOT = a.ex, a.ROOT
CELL = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (288, 312)
K = CELL[0] / 192.0
OUT = Path('out'); OUT.mkdir(exist_ok=True)
LANCZOS = Image.Resampling.LANCZOS


def frames(slug, n, scale=None):
    im, gs = a.groups(ROOT / 'decoded' / (slug + '.png'), n)
    boxes = [ex.component_bounds(g) for g in gs]
    width = max(b[2] - b[0] for b in boxes); height = max(b[3] - b[1] for b in boxes)
    crops = [ex.component_group_image(im, g, padding=0) for g in gs]
    target_area = a.head_area(Image.open(ROOT / 'references/sitting-frame.png'))
    areas = [a.head_area(c) for c in crops]
    if scale is None:
        reference_area = (areas[0] + areas[-1]) / 2
        scale = math.sqrt(target_area / reference_area)
        scale = min(scale, 332 / width, 270 / height)
    out = []
    for g in gs:
        crop = ex.component_group_image(im, g, padding=0)
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), LANCZOS)
        c = Image.new('RGBA', (384, 416))
        x = round(180 - a.lower_center(crop)); y = 288 - crop.height
        c.alpha_composite(crop, (x, y))
        out.append(c.resize(CELL, LANCZOS))          # Codex shrinks to (192, 208) here
    return out, scale


manifest = json.loads((ROOT / 'final/sleep-manifest.json').read_text())
atlas = Image.new('RGBA', (CELL[0] * 8, CELL[1] * 19))
scales = {}
for name, clip in manifest['clips'].items():
    if name == 'look_around':
        first, s9 = frames('look_around_9', 8)
        second, _ = frames('look_around_10', 8, s9)          # same shared scale for both look rows
        imgs, scales[name] = first + second, s9
    else:
        imgs, scales[name] = frames(name, clip['count'])
    for i, im in enumerate(imgs):
        atlas.alpha_composite(im, ((i % 8) * CELL[0], (clip['row'] + i // 8) * CELL[1]))
    print('built', name, len(imgs), 'frames, scale', round(scales[name], 4), flush=True)
atlas.save(OUT / 'characters-before-despill.png')

house = Image.open(ROOT / 'references/doghouse-layer.png').resize(CELL, LANCZOS)      # drawn at 384x416
house.save(OUT / 'house-before-despill.png')


def remove_key_green(im):
    """Pull leftover chroma-key green down to the larger of red and blue; every other pixel stays exactly as it was."""
    out = im.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a > 0 and g > max(r, b) + 8: px[x, y] = (r, max(r, b), b, a)
    return out


remove_key_green(house).save(OUT / 'sleep-house.png')
print('cleaned sleep-house (green only)', flush=True)

im, gs = a.groups(ROOT / 'decoded/sleep_zs.png', 8)
bs = [ex.component_bounds(g) for g in gs]; bottom = max(b[3] for b in bs)
zs = Image.new('RGBA', (CELL[0] * 8, CELL[1])); zscale = 0.19 * K
for i, (g, b) in enumerate(zip(gs, bs)):
    c = ex.component_group_image(im, g, padding=0)
    c = c.resize((round(c.width * zscale), round(c.height * zscale)), LANCZOS)
    cell = Image.new('RGBA', CELL)
    cell.alpha_composite(c, (round(153 * K), round(108 * K) - round((bottom - b[1]) * zscale)))
    zs.alpha_composite(cell, (CELL[0] * i, 0))
zs.save(OUT / 'zs-before-despill.png')

radius = str(int(round(7 * K)))                                                       # Codex used 7 at 192 wide
for src, name in [('characters', 'sleep'), ('zs', 'sleep-zs')]:
    subprocess.run(['/usr/bin/python3', 'work/pipeline.py', 'despill_chroma_edges', str(OUT / (src + '-before-despill.png')),
                    '--output', str(OUT / (name + '.png')), '--chroma-key', '#00FF00', '--edge-radius', radius,
                    '--spill-tolerance', '.3', '--json-out', str(OUT / (name + '-despill.json'))], check=True, stdout=subprocess.DEVNULL)
    print('cleaned', name, flush=True)
json.dump({'cell': CELL, 'scales': scales, 'edge_radius': int(radius)}, open(OUT / 'build.json', 'w'), indent=2)
print('done', CELL)
