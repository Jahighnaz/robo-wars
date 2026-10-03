# Cuts the 8-direction Charles sprite sheet into transparent PNG frames.
# Usage: python3 scripts/charles-frames.py <sheet.jpg>
import sys
from collections import deque
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGB')
W, H = src.size
BG = (3, 62, 154)
TOL = 20
rows = [(0, 386), (440, 800)]
cols = [(i * W // 4, (i + 1) * W // 4) for i in range(4)]

def near_bg(p):
    return sum((a - b) ** 2 for a, b in zip(p, BG)) <= TOL * TOL

frames = []
for (y0, y1) in rows:
    for (x0, x1) in cols:
        cell = src.crop((x0, y0, x1, y1))
        w, h = cell.size
        px = cell.load()
        out = Image.new('RGBA', (w, h))
        op = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                op[x, y] = (r, g, b, 255)
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
            op[x, y] = (0, 0, 0, 0)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                    q.append((nx, ny))
        bbox = out.getbbox()
        frames.append(out.crop(bbox))

# common canvas, figures bottom-centred so the shoulders sit on the same line
FW = max(f.size[0] for f in frames) + 8
FH = max(f.size[1] for f in frames) + 4
sheet = Image.new('RGBA', (FW * 8, FH))
for i, f in enumerate(frames):
    fx = i * FW + (FW - f.size[0]) // 2
    fy = FH - f.size[1]
    sheet.paste(f, (fx, fy), f)
    single = Image.new('RGBA', (FW, FH)); single.paste(f, ((FW - f.size[0]) // 2, fy), f)
    single.save(f'public/charles/frame{i}.png')
sheet.save('public/charles/sheet.png')
print('frame size', FW, FH)
