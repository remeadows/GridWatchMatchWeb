# usage: python3 alpha_stats.py <rgba png>  -> alpha coverage, and a coarse map of where it is opaque
import struct, sys, zlib
d = open(sys.argv[1], 'rb').read(); o = 8; idat = []
while o < len(d):
    n, k = struct.unpack(">I4s", d[o:o+8]); b = d[o+8:o+8+n]
    if k == b'IHDR': w, h = struct.unpack(">II", b[:8])
    if k == b'IDAT': idat.append(b)
    o += 12 + n
raw = zlib.decompress(b''.join(idat)); stride = w * 4; prev = bytearray(stride); pos = 0
rows = []
for y in range(h):
    f = raw[pos]; line = bytearray(raw[pos+1:pos+1+stride]); pos += 1 + stride
    if f == 1:
        for x in range(4, stride): line[x] = (line[x] + line[x-4]) & 255
    elif f == 2:
        for x in range(stride): line[x] = (line[x] + prev[x]) & 255
    elif f == 3:
        for x in range(stride): line[x] = (line[x] + (((line[x-4] if x >= 4 else 0) + prev[x]) >> 1)) & 255
    elif f == 4:
        for x in range(stride):
            a = line[x-4] if x >= 4 else 0; b_ = prev[x]; c = prev[x-4] if x >= 4 else 0
            p = a + b_ - c; pa, pb, pc = abs(p-a), abs(p-b_), abs(p-c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b_ if pb <= pc else c)) & 255
    rows.append(bytes(line[3::4])); prev = line
total = w * h
clear = sum(r.count(0) for r in rows); solid = sum(r.count(255) for r in rows)
print(f"{w}x{h}  transparent {clear/total:.1%}  opaque {solid/total:.1%}  partial {(total-clear-solid)/total:.1%}")
print("corner alphas", rows[0][0], rows[0][-1], rows[-1][0], rows[-1][-1])
for y in range(0, h, h // 24):
    print("".join(" .:-=+*#%@"[min(9, sum(rows[y][x:x + w // 48]) * 10 // (255 * (w // 48)))] for x in range(0, w - w // 48 + 1, w // 48)))
