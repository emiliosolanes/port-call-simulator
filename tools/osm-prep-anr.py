"""Builds the Antwerp layout for the simulation from the OpenStreetMap extract in data/osm-anr.json.

Map data (c) OpenStreetMap contributors, available under the Open Database License (ODbL).
The extract was taken with the OSM API (map calls) around the Deurganckdok, projected to metres around
51.280 N 4.250 E (x east, z south) and simplified (Douglas-Peucker, 4 to 6 m). It holds the Scheldt, the docks
of the Waasland and right-bank port, the MPET and Antwerp Gateway terminal outlines and storage tanks.

The Westerschelde from Bath to the sea and the North Sea coast lie outside the extract. They are drawn
schematically from a handful of reference positions (fairway bends, coastal towns), with real distances.

Writes:
  src/geo-anr-spec.js  layout the simulation needs (geo frame: berth, fairway, pilot stations, tide)
  src/geo-anr-data.js  geometry for the 3D scene, in the scene frame (MPET quay along +z at x = 0, shifted by OFF)
Usage: python3 tools/osm-prep-anr.py
"""
import json
import math
import os

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'data', 'osm-anr.json')))

LAT0, LON0 = 51.28, 4.25
KX, KZ = 111320 * math.cos(math.radians(LAT0)), 111195


def ll(lat, lon):
    return [round((lon - LON0) * KX), round(-(lat - LAT0) * KZ)]


# MPET quay on the west side of the Deurganckdok, from the inner end (Kieldrecht lock) to the mouth on the Scheldt
QW, QE = (-151, -272), (1306, -2579)
QLEN = math.hypot(QE[0] - QW[0], QE[1] - QW[1])
QU = ((QE[0] - QW[0]) / QLEN, (QE[1] - QW[1]) / QLEN)
OFF = (400000, 0)


def T(p):  # geo -> scene (same transform as frame() in src/sim.js)
    dx, dz = p[0] - QW[0], p[1] - QW[1]
    return [round(QU[1] * dx - QU[0] * dz + OFF[0], 1), round(QU[0] * dx + QU[1] * dz + OFF[1], 1)]


def Ti(lx, lz):  # scene frame without offset -> geo
    return [round(QW[0] + QU[1] * lx + QU[0] * lz), round(QW[1] - QU[0] * lx + QU[1] * lz)]


def poly(pts):
    out = []
    for q in pts:
        t = T(q)
        if not out or t != out[-1]:
            out.append([round(t[0]), round(t[1])])
    return out


def ring(g):
    return [list(c) for c in g.exterior.coords][:-1]


# ---------------------------------------------------------------- fairway (geo frame)
WANDELAAR = ll(51.394, 3.047)
FAR = ll(51.75, 3.05)                       # offshore, on the way down from Rotterdam
TENDER = [WANDELAAR[0] + 900, WANDELAAR[1] + 700]
VLISSINGEN = ll(51.437, 3.585)
# Westerschelde fairway bends, west to east (schematic)
ESTUARY = [ll(*p) for p in [
    (51.385, 3.25), (51.395, 3.40), (51.412, 3.50), (51.437, 3.585), (51.415, 3.66), (51.375, 3.74), (51.352, 3.82),
    (51.372, 3.88), (51.405, 3.93), (51.435, 3.995), (51.428, 4.05), (51.405, 4.08), (51.395, 4.13), (51.396, 4.185),
]]
# Scheldt from Bath to the Deurganckdok, along the middle of the OpenStreetMap river polygon
SCHELDT = [[-2585, -13000], [-2150, -11800], [-1700, -10500], [-1480, -9300], [-1000, -8500], [-200, -7850],
           [600, -7200], [1150, -6400], [1550, -5500], [1640, -4600]]
RDV = [1650, -4000]                          # tugs make fast, inbound
EXIT = Ti(0, 3500)                           # outbound, clear of the dock mouth
TURN = Ti(-260, 3150)                        # swinging area in front of the dock mouth, about 450 m clear all round
TUG_BASE = Ti(-360, 150)                     # schematic standby berths at the inner end of the dock
MOOR_BASE = Ti(-260, 330)
RIVER = ESTUARY + SCHELDT                    # inbound waypoints after the Wandelaar, ending before the rendezvous

# ---------------------------------------------------------------- water and land
river_osm = [Polygon(w['p']).buffer(0) for w in d['water']]
dock = Polygon(d['dock'][0]).buffer(0)

# schematic Westerschelde: buffered centre line, wider toward the sea
EST_W = [1800, 2400, 2600, 2400, 2600, 2600, 2400, 2200, 2000, 1700, 1500, 1300, 1000, 800]
est = []
line = [ll(51.39, 3.30)] + ESTUARY + [SCHELDT[0], SCHELDT[1]]
widths = [2600] + EST_W + [600, 500]
for i in range(1, len(line)):
    w = (widths[i - 1] + widths[i]) / 2
    est.append(LineString([line[i - 1], line[i]]).buffer(w, cap_style=1, join_style=1))
estuary = unary_union(est).simplify(60)

# North Sea coast (schematic): Belgian coast to Breskens, then Walcheren north of the estuary
south_coast = [ll(*p) for p in [(50.95, 2.40), (51.10, 2.58), (51.235, 2.92), (51.30, 3.08), (51.335, 3.17), (51.355, 3.28),
                                (51.375, 3.38), (51.385, 3.45), (51.398, 3.53)]]
north_coast = [ll(*p) for p in [(51.445, 3.56), (51.50, 3.47), (51.53, 3.44), (51.565, 3.49), (51.60, 3.58), (51.66, 3.66),
                                (51.75, 3.75), (51.85, 3.92), (51.95, 4.05)]]
land_geo = south_coast + north_coast + [ll(51.95, 5.4), ll(50.95, 5.4)]
land = poly(land_geo)

waters = [poly(ring(estuary))]
for g in river_osm:
    if g.area < 25000:
        continue
    for p in (getattr(g, 'geoms', None) or [g]):
        waters.append(poly(ring(p.simplify(4))))

# ---------------------------------------------------------------- terminals
terms = {t['n']: Polygon(t['p']).buffer(0) for t in d['terms']}
mpet_geo, agw_geo = terms['MPET'], terms['AGW']
pave = [poly(ring(mpet_geo)), poly(ring(agw_geo))]
mpet = Polygon([T(p) for p in ring(mpet_geo)])
agw = Polygon([T(p) for p in ring(agw_geo)])


def rnd(k):
    h = 2166136261
    for ch in str(k):
        h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return h / 4294967296


# MPET straddle carrier yard: single-width container rows perpendicular to the quay, behind a 95 m apron
rows = []
X0 = OFF[0]
for zi, z in enumerate(range(int(OFF[1]) + 30, int(OFF[1] + QLEN) - 30, 7)):
    if (zi % 9) == 8:          # cross lanes
        continue
    x = X0 + 95
    seg = 0
    while x < X0 + 900:
        x1 = x + 48
        if mpet.buffer(-12).contains(LineString([(x, z), (x1, z)])):
            r = rnd(f'r{zi}-{seg}')
            if r > 0.08:
                rows.append([round((x + x1) / 2, 1), z, 48, round(1 + rnd(f'h{zi}-{seg}') * 3.2)])
        x = x1 + 22 if (seg % 3) == 2 else x1 + 4
        seg += 1

# Antwerp Gateway: stack blocks (drawn like the other neighbouring terminals)
fill = []
agw_in = agw.buffer(-90)
for x in range(int(agw.bounds[0]), int(agw.bounds[2]), 34):
    for z in range(int(agw.bounds[1]), int(agw.bounds[3]), 130):
        if agw_in.contains(LineString([(x, z - 58), (x, z + 58)])) and rnd(f'g{x}:{z}') < 0.9:
            fill.append([x, z, round(3 + rnd(f'gh{x}:{z}') * 7)])

fill = [f for f in fill if sum(1 for g in fill if g is not f and abs(g[0] - f[0]) <= 40 and abs(g[1] - f[1]) <= 140) >= 2]  # drop stray blocks
tanks = [[*T(t[:2]), t[2]] for t in d['tanks']]
tanks = [[round(t[0]), round(t[1]), t[2]] for t in tanks]

# Antwerp Gateway quay (east side of the dock), mouth end first so its frame faces the dock
AGW_Q = [[1536, -2099], [186, -57]]

# fairway buoys along the inbound route (alternating sides are added in the scene)
route = LineString([WANDELAAR] + RIVER + [RDV])
buoys = []
for k in range(1500, int(route.length) - 1500, 2600):
    a, b = route.interpolate(k), route.interpolate(k + 50)
    dx, dz = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dz)
    ux, uz = dx / n, dz / n
    buoys.append([*T((a.x, a.y)), round(QU[1] * ux - QU[0] * uz, 4), round(QU[0] * ux + QU[1] * uz, 4)])  # direction in the scene frame

places = {
    'North Sea': ll(51.52, 3.05), 'Westerschelde': ll(51.40, 3.80), 'Scheldt': [1750, -5200], 'Zeebrugge': ll(51.33, 3.19),
    'Vlissingen': ll(51.452, 3.585), 'Terneuzen': ll(51.33, 3.83), 'Hansweert': ll(51.452, 3.995), 'Bath': ll(51.401, 4.205),
    'Doel': [794, -3426], 'Deurganckdok': Ti(-215, 1300), 'MPET': Ti(450, 1350), 'Antwerp Gateway': Ti(-850, 1200),
    'Kieldrecht lock': [-160, 140], 'Antwerp': ll(51.23, 4.40), 'Waaslandhaven': [-700, 1300],
}
places = {k: T(v) for k, v in places.items()}

spec = {
    'qw': list(QW), 'qu': [round(v, 8) for v in QU], 'off': list(OFF), 'quayLen': round(QLEN),
    'agwQuay': AGW_Q,
    'wandelaar': WANDELAAR, 'far': FAR, 'tender': TENDER, 'vlissingen': VLISSINGEN,
    'seaDir': [round(v, 4) for v in ((FAR[0] - WANDELAAR[0]) / math.dist(FAR, WANDELAAR), (FAR[1] - WANDELAAR[1]) / math.dist(FAR, WANDELAAR))],
    'river': RIVER, 'hlane': 90, 'rdv': RDV, 'turn': TURN, 'exit': EXIT,
    'mouthS': 2560, 'abeam': 130, 'berth': [1720, 2120],
    'idleCranes': [130, 240, 350, 460, 570, 690, 810, 930, 1050, 1170, 1290, 1410, 1530, 2330, 2440, 2550],
    'tugBase': TUG_BASE, 'mooringBase': MOOR_BASE,
    # Inbound tidal window for deep-draught ships, checked when passing Vlissingen (simplified: fixed HW interval)
    'tide': {'hw0': 1140, 'period': 745, 'before': 150, 'after': 30, 'margin': 20, 'check': 105, 'limit': 14.5},
}
route_km = (LineString([WANDELAAR] + RIVER + [RDV]).length / 1000)
to_vliss = LineString([WANDELAAR] + ESTUARY[:4]).length / 1000

spec_js = ('/* Antwerp layout for the simulation, generated by tools/osm-prep-anr.py from OpenStreetMap data\n'
           '   ((c) OpenStreetMap contributors, ODbL) plus schematic positions for the Westerschelde and the coast.\n'
           '   Geo frame: metres around 51.280 N 4.250 E, x east, z south. */\n'
           'const GEO_ANR_SPEC = ' + json.dumps(spec, separators=(',', ':')) + ';\n'
           "if (typeof module !== 'undefined') module.exports = GEO_ANR_SPEC;\n")
open(os.path.join(ROOT, 'src', 'geo-anr-spec.js'), 'w').write(spec_js)

data = {'land': land, 'water': waters, 'pave': pave, 'rows': rows, 'fill': fill, 'tanks': tanks, 'buoys': buoys,
        'places': places, 'fairway': [T(p) for p in [WANDELAAR] + RIVER + [RDV]]}
data_js = ('/* Antwerp map geometry: Scheldt, docks, terminals and tanks from OpenStreetMap data, (c) OpenStreetMap contributors,\n'
           '   Open Database License (ODbL); Westerschelde and coast schematic. Generated by tools/osm-prep-anr.py.\n'
           '   Scene frame: metres, MPET quay on the Deurganckdok along +z at x = 400000. */\n'
           'const GEODATA_ANR = ' + json.dumps(data, separators=(',', ':')) + ';\n'
           "if (typeof module !== 'undefined') module.exports = GEODATA_ANR;\n")
open(os.path.join(ROOT, 'src', 'geo-anr-data.js'), 'w').write(data_js)
print(f'route {route_km:.1f} km, Wandelaar to Vlissingen {to_vliss:.1f} km; quay {QLEN:.0f} m')
print('water', len(waters), 'rows', len(rows), 'fill', len(fill), 'tanks', len(tanks), 'buoys', len(buoys), 'bytes', len(spec_js), len(data_js))
