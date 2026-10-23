"""Turns the OpenStreetMap extracts in data/ into src/geo-data.js for the 3D scene.

Map data (c) OpenStreetMap contributors, available under the Open Database License (ODbL).
The extracts were taken with the OSM API (map calls) around Maasvlakte I, projected to metres
around 51.955 N 4.03 E (x east, z south) and simplified (Douglas-Peucker, 5 to 8 m). Only the
coastline, harbour water, breakwaters, terminal outlines and crane rails are kept.

The scene frame is rotated so the Amazonehaven quay of ECT Delta runs along +z at x = 0
(x grows inland, water at x < 0). The same transform lives in src/sim.js (toLocal).
Usage: python3 tools/osm-prep.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
water = json.load(open(os.path.join(ROOT, 'data', 'osm-water.json')))
port = json.load(open(os.path.join(ROOT, 'data', 'osm-port.json')))

W = (551.0, 963.0)   # west end of the ECT Delta quay on the Amazonehaven
E = (3195.0, 404.0)  # east end, at the Beerkanaal
L = math.hypot(E[0] - W[0], E[1] - W[1])
U = ((E[0] - W[0]) / L, (E[1] - W[1]) / L)   # along the quay
N = (U[1], -U[0])                            # inland (north)


def T(p):
    dx, dz = p[0] - W[0], p[1] - W[1]
    return [round(N[0] * dx + N[1] * dz), round(U[0] * dx + U[1] * dz)]


def poly(pts):
    out = []
    for q in pts:
        t = T(q)
        if not out or t != out[-1]:
            out.append(t)
    return out


def area(pts):
    a = 0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        a += x0 * z1 - x1 * z0
    return abs(a) / 2


def inside(pt, pts):
    x, z = pt
    c = False
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[i - 1]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0:
            c = not c
    return c


# land: the coastline (land on its left), closed far inland to the south and east
coast = water['coast'] + [[1540, 20000], [40000, 20000], [40000, -16081]]
land = poly(coast)

waters = []
for w in water['water']:
    p = poly(w['p'])
    if len(p) >= 3 and area(p) > 25000:
        waters.append(p)

bws = [{'c': 1 if b['c'] else 0, 'p': poly(b['p'])} for b in port['bw']]

CONTAINER = {'Hutchison Delta 2 Terminal', 'Hutchison ECT Euromax Terminal', 'Rotterdam World Gateway',
             'Container terminal Maasvlakte 2', 'Rotterdam Container Terminal', 'Delta Container Services'}
TANKS = {'BP Raffinaderij Rotterdam', 'Gate terminal', 'Indorama Ventures Europe B.V.', 'EECV'}
pave, fill, tanks = [], [], []
ect = []
for t in port['terms']:
    p = poly(t['p'])
    if t['n'] == 'Hutchison ECT Delta Terminal':
        ect.append(p)
        pave.append(p)
        continue
    if t['n'] in CONTAINER:
        pave.append(p)
        # stack fill aligned with the polygon's longest edge
        best, ang = 0, 0
        for i in range(len(p)):
            a, b = p[i - 1], p[i]
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            if d > best:
                best, ang = d, math.atan2(b[1] - a[1], b[0] - a[0])
        fill.append({'p': p, 'a': round(ang, 4), 'dense': 0.55 if t['n'] == 'Delta Container Services' else 0.9})
    if t['n'] in TANKS:
        xs = [q[0] for q in p]
        zs = [q[1] for q in p]
        step = 120
        k = 0
        for x in range(int(min(xs)) + 60, int(max(xs)) - 40, step):
            for z in range(int(min(zs)) + 60, int(max(zs)) - 40, step):
                k += 1
                if inside((x, z), p) and (k * 7919) % 10 < 7:
                    tanks.append([x, z, 30 + (k * 31) % 16])

# yard blocks from the stacking crane rails (OpenStreetMap man_made=crane_rail)
rails = []
for r in port['rails']:
    a, b = T(r[0]), T(r[-1])
    if a[0] > b[0]:
        a, b = b, a
    rails.append((a, b))

# south yard: blocks perpendicular to the Amazonehaven quay, between rails 15 to 24 m apart
south = sorted([r for r in rails if 100 < r[0][0] < 130 and abs(r[1][1] - r[0][1]) < 6], key=lambda r: (r[0][1] + r[1][1]) / 2)
yard = []
for i in range(1, len(south)):
    a, b = south[i - 1], south[i]
    za, zb = (a[0][1] + a[1][1]) / 2, (b[0][1] + b[1][1]) / 2
    if 15 <= zb - za <= 24:
        yard.append({'x0': max(a[0][0], b[0][0]) + 4, 'x1': min(a[1][0], b[1][0]) - 4, 'z': round((za + zb) / 2, 1), 'w': round(zb - za - 3, 1)})

# north yard (Delta Dedicated North, Europahaven side): tilted rails
north = sorted([r for r in rails if 580 < r[0][0] < 700 and r[1][0] > 900], key=lambda r: (r[0][1] + r[1][1]) / 2)
ddn = []
for i in range(1, len(north)):
    a, b = north[i - 1], north[i]
    za, zb = (a[0][1] + a[1][1]) / 2, (b[0][1] + b[1][1]) / 2
    if 15 <= zb - za <= 24:
        cx = (a[0][0] + a[1][0] + b[0][0] + b[1][0]) / 4
        cz = (a[0][1] + a[1][1] + b[0][1] + b[1][1]) / 4
        ang = math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0])
        ddn.append([round(cx), round(cz), round(min(a[1][0] - a[0][0], b[1][0] - b[0][0]) - 8), round(zb - za - 3, 1), round(ang, 4)])

# rail terminal inside ECT Delta (two long rails running along the quay)
railyard = [[*r[0], *r[1]] for r in rails if 500 < r[0][0] < 640 and abs(r[1][1] - r[0][1]) > 500]

out = {'land': land, 'water': waters, 'bw': bws, 'pave': pave, 'ect': ect, 'fill': fill, 'tanks': tanks,
       'yard': yard, 'ddn': ddn, 'railyard': railyard}
js = ('/* Map geometry derived from OpenStreetMap data, (c) OpenStreetMap contributors, Open Database License (ODbL).\n'
      '   Generated by tools/osm-prep.py. Scene frame: metres, Amazonehaven quay of ECT Delta along +z at x = 0. */\n'
      'const GEODATA = ' + json.dumps(out, separators=(',', ':')) + ';\n'
      "if (typeof module !== 'undefined') module.exports = GEODATA;\n")
open(os.path.join(ROOT, 'src', 'geo-data.js'), 'w').write(js)
print('land', len(land), 'water', len(waters), sum(len(w) for w in waters), 'bw', len(bws), 'pave', len(pave), 'fill', len(fill),
      'tanks', len(tanks), 'yard', len(yard), 'ddn', len(ddn), 'railyard', railyard, 'bytes', len(js))
print('yard z range', yard[0]['z'], yard[-1]['z'], 'x', min(b['x0'] for b in yard), max(b['x1'] for b in yard))
