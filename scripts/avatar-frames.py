# Cuts an 8-direction avatar sheet (busts on a flat blue background, read
# row by row: 0°, 45°, ... 315°) into a sprite sheet laid out like Charles's.
# Usage: python3 scripts/avatar-frames.py <image> <out dir> <cols> <y0:y1> [<y0:y1> ...]
#   e.g. python3 scripts/avatar-frames.py olle.jpg public/avatars/olle 4 53:376 471:798
# Each y0:y1 is a row band holding figures only (leave the labels out). The
# background is flood-filled away from the cell border, and only the largest
# blob is kept, so stray bits of labels or neighbours drop out.
import os
import sys
from collections import deque
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGB')
out_dir = sys.argv[2]
ncols = int(sys.argv[3])
rows = [tuple(int(v) for v in r.split(':')) for r in sys.argv[4:]]
W, H = src.size
BG = src.getpixel((2, 2))
TOL = 46
FW2, FH2 = 287, 342  # frame at 2x; the sheet is 8 x 143.5 x 171 like Charles's


def near_bg(p):
    return sum((a - b) ** 2 for a, b in zip(p, BG)) <= TOL * TOL


def cut(cell):
    w, h = cell.size
    px = cell.load()
    fg = bytearray(w * h)
    for i in range(w * h):
        fg[i] = 1
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not near_bg(px[x, y]):
            continue
        fg[i] = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    # largest connected foreground blob
    label = [0] * (w * h)
    best, best_n, n_lab = 0, 0, 0
    for start in range(w * h):
        if not fg[start] or label[start]:
            continue
        n_lab += 1
        label[start] = n_lab
        q = deque([start]); n = 0
        while q:
            i = q.popleft(); n += 1
            x, y = i % w, i // w
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if fg[j] and not label[j]:
                        label[j] = n_lab; q.append(j)
        if n > best_n:
            best, best_n = n_lab, n
    out = Image.new('RGBA', (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            if label[y * w + x] == best:
                r, g, b = px[x, y]
                op[x, y] = (r, g, b, 255)
    return out.crop(out.getbbox())


frames = []
for (y0, y1) in rows:
    for c in range(ncols):
        frames.append(cut(src.crop((c * W // ncols, y0, (c + 1) * W // ncols, y1))))
assert len(frames) == 8, f'expected 8 frames, got {len(frames)}'

# one scale for all frames so the head does not change size when he turns
s = min((FH2 - 6) / max(f.size[1] for f in frames), (FW2 - 12) / max(f.size[0] for f in frames))
os.makedirs(out_dir, exist_ok=True)
sheet2 = Image.new('RGBA', (FW2 * 8, FH2))
for i, f in enumerate(frames):
    f = f.resize((round(f.size[0] * s), round(f.size[1] * s)), Image.LANCZOS)
    cell = Image.new('RGBA', (FW2, FH2))
    cell.paste(f, ((FW2 - f.size[0]) // 2, FH2 - f.size[1]), f)  # bottom-centred: shoulders on one line
    sheet2.paste(cell, (i * FW2, 0), cell)
    if i == 0:
        cell.save(os.path.join(out_dir, 'portrait.png'))
sheet2.resize((1148, 171), Image.LANCZOS).save(os.path.join(out_dir, 'sheet.png'))
print(out_dir, 'scale', round(s, 3))
