/* Port call discrete event simulation: Hutchison Ports ECT Delta, Maasvlakte I, Rotterdam.
   Time unit: minutes from Tue 2026-10-20 00:00 local (UTC+02:00). Negative = earlier.
   Every vessel, pilot, tug, mooring crew and crane runs in one event-driven engine.
   The engine runs once per disruption subset, so plans, revised estimates and actuals
   all come from the same model. Port call service codes follow DCSA Port Call 2.0. */

const SIM = (() => {
  // ---------------------------------------------------------------- time
  const T0_MS = Date.UTC(2026, 9, 19, 22, 0, 0); // 2026-10-20T00:00:00+02:00
  const OFF_MS = 2 * 3600e3;
  const WINDOW = 2880; // 48 h
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const dt = (t) => new Date(T0_MS + Math.round(t) * 60000 + OFF_MS);
  const hhmm = (t) => { const d = dt(t); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  const dayName = (t) => DOW[dt(t).getUTCDay()];
  const dayIdx = (t) => Math.floor((Math.round(t) + 0) / 1440);
  const longDate = (t) => { const d = dt(t); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const iso = (t) => { const d = dt(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00+02:00`; };

  // ---------------------------------------------------------------- deterministic randomness
  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(key) { let t = (hash(String(key)) + 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  const rr = (key, a, b) => a + (b - a) * rnd(key);
  function uuid(key) { let s = ''; for (let i = 0; i < 4; i++) s += hash(key + '#' + i).toString(16).padStart(8, '0'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`; }

  // ---------------------------------------------------------------- geography
  // Each port has its own geo frame (metres around a reference point, x east, z south, as projected from
  // OpenStreetMap) and its own scene frame: the map rotated so the main quay runs along +z at x = 0 (x grows
  // inland, the water is at x < 0), then shifted by a world offset so the ports sit far apart in one scene.
  // Rotterdam: offshore distances along the Maasgeul are compressed. Antwerp: the Westerschelde and the coast
  // outside the mapped area are schematic, with real distances.
  function frame(qw, qu, off) {
    const toLocal = ([x, z]) => { const dx = x - qw[0], dz = z - qw[1]; return [qu[1] * dx - qu[0] * dz + off[0], qu[0] * dx + qu[1] * dz + off[1]]; };
    const vecLocal = ([x, z]) => { const k = Math.hypot(x, z); return [(qu[1] * x - qu[0] * z) / k, (qu[0] * x + qu[1] * z) / k]; };
    return { toLocal, vecLocal, g: (x, z) => toLocal([x, z]).map(Math.round), off };
  }
  // quays as frames: o origin, a unit vector along the quay, w unit vector toward the water
  const quay = (o, a) => ({ o, a, w: [-a[1], a[0]] });
  const QUAYS = {};
  // point on a quay: s metres along it, d metres inland (negative d is on the water)
  const qp = (q, s, d) => { const Q = QUAYS[q]; return [Q.o[0] + Q.a[0] * s - Q.w[0] * d, Q.o[1] + Q.a[1] * s - Q.w[1] * d]; };
  const qHead = (q, dir) => { const Q = QUAYS[q]; return Math.atan2(-Q.a[1] * dir, Q.a[0] * dir); }; // heading along the quay

  // ---- Rotterdam: geo frame around 51.955 N 4.030 E; scene frame with the Amazonehaven quay of ECT Delta along +z
  const RF = frame([551, 963], [0.97837275, -0.20684961], [0, 0]);
  const toLocal = RF.toLocal, vecLocal = RF.vecLocal, g = RF.g;
  const SEA_DIR = vecLocal([-0.9403, -0.3404]); // Maasgeul, from the pier heads out to sea
  const LANE_N = [SEA_DIR[1], -SEA_DIR[0]];     // starboard side for inbound traffic
  const ENTRANCE = g(1009, -3928);
  const offshore = (k) => [ENTRANCE[0] + SEA_DIR[0] * k, ENTRANCE[1] + SEA_DIR[1] * k];
  const MAASCENTER = offshore(9000);
  const DBFT0 = g(3249, 326), DBFT1 = g(3122, -56);
  QUAYS.Q = { ...quay([0, 0], [0, 1]), len: 2702, name: 'Amazonehaven quay', port: 'RTM' };
  QUAYS.F = { ...quay(DBFT0, vecLocal([3122 - 3249, -56 - 326])), len: Math.round(Math.hypot(DBFT1[0] - DBFT0[0], DBFT1[1] - DBFT0[1])), name: 'Delta Barge Feeder Terminal', port: 'RTM' };
  const GEO = {
    port: 'RTM', toLocal, vecLocal, g, qp, qHead, QUAYS,
    SEA_DIR, LANE_N, LANE: 110, HLANE: 90,
    ENTRANCE,
    FAR: offshore(46000),
    EUROGEUL_PBP: offshore(24000),
    MAASCENTER_PBP: MAASCENTER,
    PBP: { EUROGEUL: offshore(24000), MAASCENTER },
    RDV: offshore(1200),
    ANCHORAGE: [MAASCENTER[0] - LANE_N[0] * 6500, MAASCENTER[1] - LANE_N[1] * 6500],
    // fairway through the Maasmond and down the Beerkanaal (centre line, in travel order inbound)
    HARBOUR: [g(2349, -3580), g(3250, -2750), g(3800, -1800), g(3650, -500), g(3500, 300)],
    TURN: g(3384, 706),            // turning basin at the mouth of the Amazonehaven
    CHANNEL_X: -150,               // centre line of the Amazonehaven
    MOUTH: [-150, 2640],           // Amazonehaven entrance, inside
    EXIT: [-60, 2965],             // Amazonehaven exit into the Beerkanaal
    TUG_BASE: g(2900, -640),       // tug harbour quay on the Beerkanaal
    HELI_BASE: g(2250, -2450),
    TENDER_STATION: [MAASCENTER[0] - LANE_N[0] * 700 + SEA_DIR[0] * 600, MAASCENTER[1] - LANE_N[1] * 700 + SEA_DIR[1] * 600],
    KRVE_BASE: g(4060, -560),      // Pistoolhaven
    PILOT_STATION: g(4148, -579),  // Loodswezen, Pistoolhaven
    BUNKER_STATION: g(3700, -1200),
    SLUDGE_STATION: g(3820, -980),
    BERTHS: {
      A: { q: 'Q', s0: 1290, s1: 1720, label: 'Amazonehaven berth A', abeam: 150, astern: true },
      B: { q: 'Q', s0: 1790, s1: 2220, label: 'Amazonehaven berth B', abeam: 150, astern: true },
      F: { q: 'F', s0: 105, s1: 325, label: 'Delta Barge Feeder Terminal' },
    },
  };

  // ---- Antwerp: geo frame and layout come from src/geo-anr-spec.js (tools/osm-prep-anr.py, OpenStreetMap)
  const ANR = (typeof GEO_ANR_SPEC !== 'undefined' ? GEO_ANR_SPEC : (typeof require !== 'undefined' ? require('./geo-anr-spec.js') : null));
  const AF = frame(ANR.qw, ANR.qu, ANR.off);
  QUAYS.M = { ...quay(AF.toLocal(ANR.qw), AF.vecLocal(ANR.qu)), len: ANR.quayLen, name: 'MSC PSA European Terminal quay', port: 'ANR' };
  { // Antwerp Gateway, across the dock (not modelled; drawn with idle cranes)
    const [a, b] = ANR.agwQuay.map((p) => AF.toLocal(p));
    QUAYS.G = { ...quay(a, AF.vecLocal([ANR.agwQuay[1][0] - ANR.agwQuay[0][0], ANR.agwQuay[1][1] - ANR.agwQuay[0][1]])), len: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])), name: 'Antwerp Gateway quay', port: 'ANR' };
  }
  const A_SEA = AF.vecLocal(ANR.seaDir); // from the Wandelaar out to sea, toward Rotterdam
  const GEO_ANR = {
    port: 'ANR', toLocal: AF.toLocal, vecLocal: AF.vecLocal, g: AF.g,
    SEA_DIR: A_SEA, LANE_N: [A_SEA[1], -A_SEA[0]], LANE: 110, HLANE: ANR.hlane,
    ENTRANCE: null,
    FAR: AF.g(...ANR.far),
    PBP: { WANDELAAR: AF.g(...ANR.wandelaar) },
    RIVER: ANR.river.map(([x, z]) => AF.g(x, z)),   // Wandelaar to the tug rendezvous, via Vlissingen
    VLISSINGEN: AF.g(...ANR.vlissingen),
    RDV: AF.g(...ANR.rdv),
    HARBOUR: [],
    TURN: AF.g(...ANR.turn),
    MOUTH: qp('M', ANR.mouthS, -ANR.abeam),
    EXIT: AF.g(...ANR.exit),
    TUG_BASE: AF.g(...ANR.tugBase),
    TENDER_STATION: AF.g(...ANR.tender),
    KRVE_BASE: AF.g(...ANR.mooringBase),
    BERTHS: { M: { q: 'M', s0: ANR.berth[0], s1: ANR.berth[1], label: 'Deurganckdok, MPET berth', abeam: ANR.abeam, astern: true } },
    TIDE: ANR.tide,
  };
  const PORTS = {
    RTM: { id: 'RTM', name: 'Rotterdam', unloc: 'NLRTM', geo: GEO, parties: { term: 'ECT', hm: 'PORT', pilot: 'PILOT', tug: 'TUG', moor: 'MOOR' }, ref: 'ECTD', pvr: 'NLRTM26' },
    ANR: { id: 'ANR', name: 'Antwerp', unloc: 'BEANR', geo: GEO_ANR, parties: { term: 'MPET', hm: 'PORTA', pilot: 'PILOTA', tug: 'TUGA', moor: 'MOORA' }, ref: 'MPET', pvr: 'BEANR26' },
  };

  // ---------------------------------------------------------------- parties (roles per DCSA Port Call 2.0 use cases)
  const PARTIES = {
    MSC: { name: 'MSC', role: 'Carrier', code: 'MSC' },
    ECT: { name: 'Hutchison Ports ECT Delta', role: 'Terminal' },
    PORT: { name: 'Port of Rotterdam Harbour Master', role: 'Port Authority' },
    PILOT: { name: 'Loodswezen (Dutch pilots)', role: 'Pilotage service provider' },
    TUG: { name: 'Boluda Towage', role: 'Towage service provider' },
    MOOR: { name: 'KRVE boatmen', role: 'Mooring service provider' },
    MPET: { name: 'MSC PSA European Terminal', role: 'Terminal' },
    PORTA: { name: 'Port of Antwerp-Bruges Harbour Master', role: 'Port Authority' },
    PILOTA: { name: 'Flemish pilots (DAB Loodswezen)', role: 'Pilotage service provider' },
    TUGA: { name: 'Port of Antwerp-Bruges towage', role: 'Towage service provider' },
    MOORA: { name: 'Brabo linesmen', role: 'Mooring service provider' },
    BUNK: { name: 'Bunker supplier', role: 'Bunkering service provider' },
    SLDG: { name: 'Waste reception barge', role: 'Sludge service provider' },
    LASH: { name: 'Lashing contractor', role: 'Lashing service provider' },
  };

  // ---------------------------------------------------------------- service catalogue
  // neg: negotiable with E-R-P-A. ab: abbreviation used in DCSA use case names.
  const SVC = {
    SEA_PASSAGE: { label: 'Sea passage', ab: 'SEA PASSAGE', neg: false },
    ANCHORAGE: { label: 'Anchorage', ab: 'ANCHORAGE', neg: true, fac: 'ANCH' },
    PILOT_BOARDING_PLACE: { label: 'Pilot boarding place', ab: 'PBP', neg: true, fac: 'PBPL' },
    PILOTAGE: { label: 'Pilotage', ab: 'PILOTAGE', neg: true },
    TOWAGE: { label: 'Towage', ab: 'TOWAGE', neg: true },
    MOORING: { label: 'Mooring', ab: 'MOORING', neg: true },
    BERTH: { label: 'Berth', ab: 'BERTH', neg: true, fac: 'BRTH' },
    ALL_FAST: { label: 'All fast', ab: 'ALL FAST', neg: false },
    GANGWAY_DOWN_AND_SECURE: { label: 'Gangway down and secure', ab: 'GANGWAY DOWN AND SECURE', neg: false },
    VESSEL_READY_FOR_CARGO_OPERATIONS: { label: 'Vessel ready for cargo ops', ab: 'VESSEL READY FOR CARGO OPERATIONS', neg: false },
    CARGO_OPERATIONS: { label: 'Cargo operations', ab: 'CARGO OPERATIONS', neg: true },
    DISCHARGE_CARGO_OPERATIONS: { label: 'Discharge', ab: 'DISCHARGE CARGO OPERATIONS', neg: false },
    LOADING_CARGO_OPERATIONS: { label: 'Loading', ab: 'LOADING CARGO OPERATIONS', neg: false },
    BUNKERING: { label: 'Bunkering', ab: 'BUNKERING', neg: true },
    SLUDGE: { label: 'Sludge', ab: 'SLUDGE', neg: true },
    LASHING: { label: 'Lashing', ab: 'LASHING', neg: false },
    VESSEL_READY_TO_SAIL: { label: 'Vessel ready to sail', ab: 'VESSEL READY TO SAIL', neg: false },
    MOVES: { label: 'Moves forecast', ab: 'MOVES', neg: false },
  };

  // Canonical order of service events in a call (key = TYPE|EVENT|PHASE)
  const ORDER = [
    'MOVES||',
    'ANCHORAGE|ARRI|', 'ANCHORAGE|DEPA|',
    'SEA_PASSAGE|CMPL|INBD',
    'PILOT_BOARDING_PLACE|ARRI|INBD',
    'PILOTAGE|STRT|INBD', 'TOWAGE|STRT|INBD', 'MOORING|STRT|INBD',
    'BERTH|ARRI|INBD',
    'ALL_FAST||ALGS', 'MOORING|CMPL|INBD', 'TOWAGE|CMPL|INBD', 'PILOTAGE|CMPL|INBD',
    'GANGWAY_DOWN_AND_SECURE||ALGS', 'VESSEL_READY_FOR_CARGO_OPERATIONS||ALGS',
    'CARGO_OPERATIONS|STRT|ALGS', 'DISCHARGE_CARGO_OPERATIONS|STRT|ALGS', 'DISCHARGE_CARGO_OPERATIONS|CMPL|ALGS',
    'LOADING_CARGO_OPERATIONS|STRT|ALGS', 'LOADING_CARGO_OPERATIONS|CMPL|ALGS',
    'BUNKERING|STRT|ALGS', 'BUNKERING|CMPL|ALGS', 'SLUDGE|STRT|', 'SLUDGE|CMPL|',
    'CARGO_OPERATIONS|CMPL|ALGS', 'LASHING|CMPL|ALGS', 'VESSEL_READY_TO_SAIL||ALGS',
    'PILOTAGE|STRT|OUTB', 'TOWAGE|STRT|OUTB', 'MOORING|STRT|OUTB', 'MOORING|CMPL|OUTB', 'BERTH|DEPA|OUTB',
    'TOWAGE|CMPL|OUTB', 'PILOTAGE|CMPL|OUTB', 'SEA_PASSAGE|STRT|OUTB',
  ];
  const parseKey = (k) => { const [type, evt, phase] = k.split('|'); return { type, evt: evt || null, phase: phase || null }; };
  const EVT_LETTER = { ARRI: 'A', DEPA: 'D', STRT: 'S', CMPL: 'C' };
  const CLS_LETTER = { EST: 'E', REQ: 'R', PLN: 'P', ACT: 'A' };
  function codeName(key, cls) { // e.g. PTA BERTH, ATC CARGO OPERATIONS, AT ALL FAST
    const { type, evt } = parseKey(key); const s = SVC[type];
    if (type === 'MOVES') return 'MOVES FORECAST';
    return CLS_LETTER[cls] + 'T' + (evt ? EVT_LETTER[evt] : '') + ' ' + s.ab;
  }
  function rowLabel(key) {
    const { type, evt, phase } = parseKey(key); const s = SVC[type];
    const ev = { ARRI: 'arrival', DEPA: 'departure', STRT: 'start', CMPL: 'complete' }[evt] || '';
    const ph = { INBD: 'in', OUTB: 'out', ALGS: '', SHIF: 'shift' }[phase] || '';
    return [s.label, ev, ph && `(${ph})`].filter(Boolean).join(' ');
  }

  // ---------------------------------------------------------------- the calls
  const ULCV = 'ULCV', FEEDER = 'FEEDER';
  const CALLS = [
    {
      id: 'GU', port: 'RTM', name: 'MSC Gülsün', carrier: 'MSC', size: ULCV, hull: 'navy',
      service: 'LION', serviceName: 'Lion', voyIn: 'FL641W', voyOut: 'FL641E',
      loa: 399.9, beam: 61.5, teu: 23756, draftArr: 15.6, draftDep: 15.3,
      rotation: 'Sines · Le Havre · Hamburg · Rotterdam · Antwerp · Le Havre',
      pta: -1320, pbp: 'EUROGEUL', tugsIn: 4, tugsOut: 4, berth: 'A',
      cranes: ['Q01', 'Q02', 'Q03', 'Q04', 'Q05'], rate: 23,
      moves: { dis: 1250, rst: 80, load: 2000 },
      bunker: { start: 90, end: 390, product: 'VLSFO', qty: 3400 },
      sludge: { start: 430, end: 505 },
      story: 'In from Hamburg. Loads export boxes for Asia, takes bunkers alongside and sails for Antwerp midday.',
    },
    {
      id: 'IR', port: 'RTM', name: 'MSC Irina', carrier: 'MSC', size: ULCV, hull: 'sky',
      service: 'BRITANNIA', serviceName: 'Britannia', voyIn: 'QB642W', voyOut: 'QB642W',
      loa: 399.99, beam: 61.3, teu: 24346, draftArr: 15.9, draftDep: 15.2,
      rotation: 'Colombo · Felixstowe · Rotterdam · Zeebrugge · Antwerp · Gdansk',
      pta: 840, arrDelta: 3, pbp: 'EUROGEUL', tugsIn: 4, tugsOut: 4, berth: 'B',
      jit: { etaUnconstrained: 425, window: 840, speedFull: 16.4, speedJit: 12.1 },
      cranes: ['Q06', 'Q07', 'Q08', 'Q09', 'Q10', 'Q11'], rate: 23,
      moves: { dis: 1800, rst: 90, load: 1360 },
      sludge: { start: 2040, end: 2120 },
      story: 'In from Felixstowe. Running 7 h ahead of its berth window, so it slows down instead of anchoring.',
    },
    {
      id: 'NT', port: 'RTM', name: 'Nordic Tern', carrier: 'MSC', size: FEEDER, hull: 'teal', fictional: true,
      service: 'S401', serviceName: 'Rotterdam–Gothenburg–Aarhus feeder', voyIn: '0418N', voyOut: '0419N',
      loa: 183, beam: 30.2, teu: 1900, draftArr: 9.8, draftDep: 9.4,
      rotation: 'Rotterdam · Gothenburg · Aarhus',
      pta: -290, pbp: 'MAASCENTER', tugsIn: 1, tugsOut: 1, berth: 'F',
      cranes: ['F1', 'F2', 'F3'], rate: 20,
      moves: { dis: 180, rst: 10, load: 210 },
      story: 'Feeder for the deep-sea calls. Finishes overnight and clears the feeder berth.',
    },
    {
      id: 'HG', port: 'RTM', name: 'Humber Gull', carrier: 'MSC', size: FEEDER, hull: 'grey', fictional: true,
      service: 'S512', serviceName: 'Rotterdam–Teesport feeder', voyIn: '0233W', voyOut: '0234E',
      loa: 172, beam: 27.6, teu: 1700, draftArr: 9.1, draftDep: 9.3,
      rotation: 'Rotterdam · Teesport',
      pta: 330, pbp: null, pec: true, tugsIn: 0, tugsOut: 0, berth: 'F',
      cranes: ['F1', 'F2', 'F3'], rate: 20,
      moves: { dis: 210, rst: 0, load: 250 },
      story: 'Master holds a pilotage exemption certificate, so the call has no pilotage or pilot boarding place service.',
    },
    {
      id: 'BW', port: 'RTM', name: 'Baltic Wren', carrier: 'MSC', size: FEEDER, hull: 'green', fictional: true,
      service: 'S303', serviceName: 'Rotterdam–Gdańsk feeder', voyIn: '0377E', voyOut: '0378W',
      loa: 185, beam: 29.8, teu: 2200, draftArr: 9.6, draftDep: 9.9,
      rotation: 'Rotterdam · Gdańsk · Gdynia',
      pta: 960, pbp: 'MAASCENTER', tugsIn: 1, tugsOut: 1, berth: 'F',
      anchor: { arrive: 280 }, lateNotice: 10, arrDelta: 6,
      cranes: ['F1', 'F2', 'F3'], rate: 20,
      moves: { dis: 260, rst: 10, load: 290 },
      story: 'Sent its first estimate 5 h before arrival. The feeder berth was already planned, so it waits at anchor.',
    },
    {
      id: 'KE', port: 'RTM', name: 'Kattegat Eider', carrier: 'MSC', size: FEEDER, hull: 'teal', fictional: true,
      service: 'S401', serviceName: 'Rotterdam–Gothenburg–Aarhus feeder', voyIn: '0420S', voyOut: '0421N',
      loa: 178, beam: 28.4, teu: 1800, draftArr: 9.4, draftDep: 9.6,
      rotation: 'Rotterdam · Gothenburg · Aarhus',
      pta: 1980, arrDelta: -4, pbp: 'MAASCENTER', tugsIn: 1, tugsOut: 1, berth: 'F',
      cranes: ['F1', 'F2', 'F3'], rate: 20,
      moves: { dis: 300, rst: 10, load: 330 },
      story: 'Plans ahead and berths on its requested time.',
    },
    {
      id: 'GA', port: 'ANR', prevCall: 'GU', name: 'MSC Gülsün', carrier: 'MSC', size: ULCV, hull: 'navy',
      service: 'LION', serviceName: 'Lion', voyIn: 'FL641E', voyOut: 'FL641E',
      loa: 399.9, beam: 61.5, teu: 23756, draftArr: 15.3, draftDep: 15.4,
      rotation: 'Sines · Le Havre · Hamburg · Rotterdam · Antwerp · Le Havre',
      passage: 190, pbp: 'WANDELAAR', tugsIn: 4, tugsOut: 4, berth: 'M',
      cranes: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'], rate: 25,
      moves: { dis: 1150, rst: 60, load: 2350 },
      story: 'Next port after Rotterdam. Its arrival depends on when it sails from Rotterdam and on the tide in the Scheldt.',
    },
  ];

  // Durations in minutes by vessel size
  const DUR = {
    ULCV: { approach: 160, pilotUp: 4, pbpToRdv: 115, rdvToBasin: 60, swingIn: 15, push: 25, moorLead: 12, allFast: 18, gangway: 15, ready: 25, craneStart: 10, lashing: 25, rts: 10, pilotOut: 20, tugsOut: 10, unmoor: 20, pullOff: 15, basinToRdv: 65, swingOut: 0, rdvToPbp: 110, anchToPbp: 35 },
    FEEDER: { approach: 120, pilotUp: 3, pbpToRdv: 45, rdvToBasin: 45, swingIn: 0, push: 15, moorLead: 8, allFast: 12, gangway: 10, ready: 14, craneStart: 8, lashing: 15, rts: 10, pilotOut: 15, tugsOut: 10, unmoor: 12, pullOff: 8, basinToRdv: 45, swingOut: 10, rdvToPbp: 45, anchToPbp: 30 },
  };
  // Antwerp: sea pilot from the Wandelaar to Vlissingen, river pilot up the Scheldt, tugs off the Deurganckdok
  const DURP = { ANR: { ULCV: { approach: 150, pbpToRdv: 255, rdvToBasin: 20, basinToRdv: 25, rdvToPbp: 250 } } };

  // Disruptions, in time order. Each engine run adds one more.
  const DISRUPTIONS = [
    { id: 'Q03', port: 'RTM', start: 420, end: 480, cranes: ['Q03'], kind: 'fault', title: 'Q03 hoist fault', detail: 'Crane Q03 stopped on MSC Gülsün. Its bays finish last, so the ship sails later.' },
    { id: 'WIND', port: 'RTM', start: 1690, end: 1780, cranes: 'ALL', kind: 'wind', title: 'Wind gusts above crane limit', detail: 'All quay cranes stopped. AGVs hold position.' },
    { id: 'Q09', port: 'RTM', start: 1930, end: 2020, cranes: ['Q09'], kind: 'fault', title: 'Q09 spreader fault', detail: 'Crane Q09 stopped on MSC Irina. Its bays finish last.' },
  ];
  const lcTitle = (t) => (/^[A-Z]\d/.test(t) ? t : t[0].toLowerCase() + t.slice(1));
  const hits = (d, c, id) => d.port === c.port && (d.cranes === 'ALL' || d.cranes.includes(id));

  // Crane fleet. ULCS quay on the Amazonehaven: 11 remote-operated cranes (8 delivered 2014-2015, 3 in 2025).
  // The western end of the quay is shown with idle cranes and not modelled. The feeder terminal on the Beerkanaal gets 3 cranes.
  // q: quay, home: metres along it.
  const CRANES = [];
  for (let i = 1; i <= 11; i++) CRANES.push({ id: 'Q' + pad(i), type: 'STS', q: 'Q', home: 1250 + (i - 1) * 101, outreach: i >= 9 ? 74 : 70, year: i >= 9 ? 2025 : i >= 6 ? 2015 : 2014 });
  for (let i = 1; i <= 8; i++) CRANES.push({ id: 'X' + i, type: 'STS', q: 'Q', home: 140 + (i - 1) * 128, outreach: 64, idle: true, note: 'Western part of the Amazonehaven quay. Not modelled, so it takes no vessel in this simulation.' });
  for (let i = 1; i <= 3; i++) CRANES.push({ id: 'F' + i, type: 'FEEDER', q: 'F', home: 95 + (i - 1) * 95, outreach: 42 });
  CRANES.forEach((k) => { k.port = 'RTM'; });
  // MPET, Antwerp: 38 quay cranes in all. The model draws 24 on the west quay of the Deurganckdok and works 8 of them
  // along MSC Gülsün's berth. Across the dock, Antwerp Gateway is drawn with idle cranes and not modelled.
  for (let i = 1; i <= 8; i++) CRANES.push({ id: 'M' + pad(i), type: 'STS', q: 'M', port: 'ANR', home: ANR.berth[0] - 60 + (i - 1) * 75, outreach: 70 });
  ANR.idleCranes.forEach((h, i) => CRANES.push({ id: 'Y' + pad(i + 1), type: 'STS', q: 'M', port: 'ANR', home: h, outreach: 66, idle: true, note: 'Another MPET berth on the Deurganckdok. Not modelled, so it takes no vessel in this simulation.' }));
  for (let i = 1; i <= 12; i++) CRANES.push({ id: 'G' + pad(i), type: 'STS', q: 'G', port: 'ANR', home: 140 + (i - 1) * 190, outreach: 66, idle: true, other: true, note: 'Antwerp Gateway, across the Deurganckdok. Another terminal, not modelled.' });

  // ---------------------------------------------------------------- engine
  class Heap {
    constructor() { this.a = []; }
    push(e) { const a = this.a; a.push(e); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.lt(a[l], a[m])) m = l; if (r < a.length && this.lt(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
    lt(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }
    get size() { return this.a.length; }
  }
  class Engine {
    constructor() { this.now = -4000; this.q = new Heap(); this.seq = 0; this.sig = {}; this.val = {}; }
    at(t, fn) { this.q.push({ t, s: this.seq++, fn }); }
    // signals: a process can wait for a value another process publishes (here: departure from the previous port)
    wait(name, cb) { if (name in this.val) this.at(this.now, () => cb(this.val[name])); else (this.sig[name] ||= []).push(cb); }
    fire(name, v) { this.val[name] = v; for (const cb of this.sig[name] || []) this.at(this.now, () => cb(v)); this.sig[name] = []; }
    process(gen) {
      const step = (val) => {
        const r = gen.next(val); if (r.done) return; const c = r.value;
        if (c.until !== undefined) this.at(Math.max(this.now, c.until), () => step());
        else if (c.acquire) c.acquire.request(c.n, (ids) => step(ids));
        else if (c.signal) this.wait(c.signal, (v) => step(v));
        else throw new Error('bad command');
      };
      this.at(this.now, () => step());
    }
    run() { while (this.q.size) { const e = this.q.pop(); this.now = e.t; e.fn(); } }
  }
  class Pool {
    constructor(eng, ids) { this.eng = eng; this.free = [...ids]; this.all = [...ids]; this.waiters = []; }
    request(n, cb) {
      if (n === 0) { this.eng.at(this.eng.now, () => cb([])); return; }
      if (!this.waiters.length && this.free.length >= n) { const g = this.free.splice(0, n); this.eng.at(this.eng.now, () => cb(g)); }
      else this.waiters.push({ n, cb });
    }
    release(ids) {
      this.free.push(...ids); this.free.sort();
      while (this.waiters.length && this.free.length >= this.waiters[0].n) { const w = this.waiters.shift(); const g = this.free.splice(0, w.n); this.eng.at(this.eng.now, () => w.cb(g)); }
    }
    releaseAt(t, ids) { this.eng.at(t, () => this.release(ids)); }
  }

  // ---------------------------------------------------------------- helpers
  const dirTo = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]); // heading: +x is 0, north (-z) is +PI/2
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const normA = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  // shift a polyline to the starboard side of its direction of travel (keep right in the fairway)
  function offsetPath(pts, off) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const k = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const dx = (b[0] - a[0]) / k, dz = (b[1] - a[1]) / k;
      return [Math.round(p[0] - dz * off), Math.round(p[1] + dx * off)];
    });
  }
  const lane = (p, inbound) => { const k = (inbound ? 1 : -1) * GEO.LANE; return [p[0] + GEO.LANE_N[0] * k, p[1] + GEO.LANE_N[1] * k]; };

  function craneSchedule(tStart, rate, parts, stops) {
    let t = tStart, m = 0; const segs = []; const marks = {};
    for (const p of parts) {
      let remaining = p.moves; marks[p.kind + '_start'] = null;
      while (remaining > 1e-6) {
        const st = stops.find((s) => s.end > t);
        if (st && st.start <= t) { segs.push({ t0: t, t1: st.end, m0: m, m1: m, kind: 'STOP', reason: st.id }); t = st.end; continue; }
        if (marks[p.kind + '_start'] === null) marks[p.kind + '_start'] = t;
        const tFin = t + (remaining / rate) * 60;
        if (st && st.start < tFin) { const done = ((st.start - t) * rate) / 60; segs.push({ t0: t, t1: st.start, m0: m, m1: m + done, kind: p.kind }); m += done; remaining -= done; t = st.start; }
        else { segs.push({ t0: t, t1: tFin, m0: m, m1: m + remaining, kind: p.kind }); m += remaining; remaining = 0; t = tFin; }
      }
      marks[p.kind + '_end'] = t;
    }
    return { segs, tEnd: t, marks, total: m };
  }

  // berth geometry of a call: quay, centre along the quay, which way the bow points along it, heading alongside
  // ULCVs swing in the turning basin and lie bow out (toward the Beerkanaal); feeders lie bow south on the feeder quay.
  function berthOf(c) {
    const B = PORTS[c.port].geo.BERTHS[c.berth]; const sc = (B.s0 + B.s1) / 2; const off = 3 + c.beam / 2;
    const bowDir = c.size === ULCV ? 1 : -1;
    return { q: B.q, sc, off, bowDir, pos: qp(B.q, sc, -off), h: qHead(B.q, bowDir) };
  }
  function cranePositions(c, b) {
    const L = c.loa, n = c.cranes.length;
    const bowS = b.sc + (b.bowDir * L) / 2;
    const from = b.sc - L / 2 + L * 0.07, to = b.sc + L / 2 - L * 0.07;
    const houseS = c.size === ULCV ? bowS - b.bowDir * L * 0.3 : b.sc - b.bowDir * L * 0.38; // deckhouse
    const out = [];
    for (let i = 0; i < n; i++) {
      let s = n === 1 ? b.sc : from + ((to - from) * i) / (n - 1);
      if (Math.abs(s - houseS) < 14) s += s < houseS ? -12 : 12;
      out.push(s);
    }
    return out;
  }

  function cargoOps(c, t0, b, disruptions) {
    const ws = c.cranes.map((id) => 0.96 + 0.08 * rnd(c.id + id + 'w'));
    const W = ws.reduce((a, b) => a + b, 0);
    const zs = cranePositions(c, b);
    const cranes = c.cranes.map((id, i) => {
      const f = ws[i] / W;
      const parts = [
        { kind: 'DIS', moves: Math.round(c.moves.dis * f) },
        { kind: 'RST', moves: Math.round(c.moves.rst * f) },
        { kind: 'LOAD', moves: Math.round(c.moves.load * f) },
      ];
      // the faulty crane is the slowest on its ship (Q03 on MSC Gülsün, Q09 on MSC Irina), so its fault drives the finish
      const rate = c.rate * (id === 'Q09' && c.id === 'IR' ? 0.985 : id === 'Q03' && c.id === 'GU' ? 0.95 : 0.99 + 0.05 * rnd(c.id + id + 'r'));
      const tStart = t0 + rr(c.id + id + 's', 0, 8);
      const stops = disruptions.filter((d) => hits(d, c, id)).map((d) => ({ start: d.start, end: d.end, id: d.id })).sort((a, b) => a.start - b.start);
      const sch = craneSchedule(tStart, rate, parts, stops);
      return { id, z: zs[i], parts, rate, tStart, ...sch, call: c.id };
    });
    const end = Math.max(...cranes.map((k) => k.tEnd));
    const disEnd = Math.max(...cranes.map((k) => k.marks.DIS_end));
    const loadStart = Math.min(...cranes.map((k) => k.marks.LOAD_start ?? k.tEnd));
    return { cranes, end, disEnd, loadStart, t0 };
  }

  // ---------------------------------------------------------------- one call as a process
  // Earliest pass of the tidal check point (Vlissingen) for a deep-draught ship: inside the inbound window
  // around high water, or the start of the next window. Returns the window used.
  function tideSlot(tide, tCheck) {
    const k = Math.ceil((tCheck - tide.after - tide.hw0) / tide.period);
    const hw = tide.hw0 + k * tide.period; const start = hw - tide.before, end = hw + tide.after;
    return { hw, start, end, tPass: Math.max(tCheck, start + tide.margin) };
  }

  function* callProc(S, c) {
    const P = PORTS[c.port]; const G = P.geo; const pools = S.pools[c.port];
    const D = { ...DUR[c.size], ...((DURP[c.port] || {})[c.size] || {}) };
    const T = (k, t) => { S.times[c.id][k] = t; };
    const track = S.tracks[c.id];
    const kf = (t, p, h, extra) => track.push({ t, x: p[0], z: p[1], h, ...extra });
    const ln = (p, inbound) => { const k = (inbound ? 1 : -1) * G.LANE; return [p[0] + G.LANE_N[0] * k, p[1] + G.LANE_N[1] * k]; };
    const b = berthOf(c); const hBerth = b.h; const B = G.BERTHS[c.berth];
    const swingIn = D.swingIn;
    const inbDur = D.pbpToRdv + D.rdvToBasin + swingIn + D.push;
    const pbpPos = G.PBP[c.pbp] || Object.values(G.PBP)[0];
    // where the vessel lies before the final push onto the berth
    const abeam = qp(b.q, b.sc, -(B.abeam ?? (b.off + 130)));
    S.info[c.id] = { ...b, zc: b.sc, abeam, port: c.port };
    const rdvPt = G.ENTRANCE ? ln(G.RDV, true) : G.RDV; // offshore rendezvous keeps to the inbound lane
    const spread = (pts, t0, t1, from, heads) => { // keyframes spaced by distance along a polyline
      let pv = from; const legs = pts.map((p) => { const d = dist(pv, p); pv = p; return d; });
      const L = legs.reduce((a, x) => a + x, 0) || 1; let acc = 0;
      pts.forEach((p, i) => { acc += legs[i]; kf(t0 + ((t1 - t0) * acc) / L, p, heads ? heads(i) : null); });
    };

    // ---- arrival: from the previous port (next-port call), from anchorage, or straight from sea
    let tPBP;
    if (c.prevCall) {
      const tSea = yield { signal: c.prevCall + ':sea' }; // pilot leaves the ship at the previous port
      const earliest = tSea + c.passage;
      tPBP = earliest;
      if (G.TIDE && c.draftArr > G.TIDE.limit) { const w = tideSlot(G.TIDE, earliest + G.TIDE.check); tPBP = w.tPass - G.TIDE.check; S.tideInfo[c.id] = { ...w, earliest }; }
      if (tPBP > earliest + 20) S.slowSteam[c.id] = { from: tSea, to: tPBP, saved: tPBP - earliest };
      kf(Math.max(tSea + 20, tPBP - D.approach), ln(G.FAR, true), null);
      kf(tPBP, ln(pbpPos, true), null);
      yield { until: tPBP };
    } else if (c.anchor) {
      const tA = c.anchor.arrive;
      const anchP = [G.ANCHORAGE[0] + rr(c.id + 'ax', -600, 600), G.ANCHORAGE[1] + rr(c.id + 'az', -500, 500)];
      kf(tA - D.approach, [anchP[0] - 22000, anchP[1] - 3000], null);
      kf(tA, anchP, 0.35);
      yield { until: tA };
      T('ANCHORAGE|ARRI|', tA);
      const tLeave = c.pta - inbDur - D.anchToPbp + (S.disruptions.length ? (c.arrDelta || 0) : 0);
      S.anchorWait[c.id] = { from: tA, to: tLeave };
      yield { until: tLeave };
      T('ANCHORAGE|DEPA|', tLeave);
      kf(tLeave, anchP, 0.35);
      tPBP = tLeave + D.anchToPbp;
      kf(tPBP, ln(pbpPos, true), null);
    } else {
      tPBP = c.pta - inbDur + (S.disruptions.length ? (c.arrDelta || 0) : 0);
      kf(tPBP - D.approach, ln(G.FAR, true), null);
      kf(tPBP, ln(pbpPos, true), null);
      yield { until: tPBP - 1 };
    }
    yield { until: tPBP };
    T('SEA_PASSAGE|CMPL|INBD', tPBP);
    let pilot = null, pobIn = null;
    if (c.pbp) {
      T('PILOT_BOARDING_PLACE|ARRI|INBD', tPBP);
      [pilot] = yield { acquire: pools.pilot, n: 1 };
      if (c.pbp === 'EUROGEUL') S.heli.push({ call: c.id, port: c.port, kind: 'board', t0: tPBP - 28, t1: tPBP - 2, t2: tPBP + 5, t3: tPBP + 33 });
      else S.tender.push({ call: c.id, port: c.port, kind: 'board', t0: tPBP - 18, t1: tPBP - 1, t2: tPBP + 4, t3: tPBP + 22 });
      T('PILOTAGE|STRT|INBD', tPBP + D.pilotUp);
      pobIn = { call: c.id, port: c.port, pilot, from: tPBP + D.pilotUp, to: null, phase: 'INBD' }; S.pilotOnBoard.push(pobIn);
    }

    // ---- to the tug rendezvous (offshore at Rotterdam; up the river at Antwerp)
    const tRdvPlan = tPBP + D.pbpToRdv;
    let tugs = [], tRdv = tRdvPlan, tugJob = null;
    if (c.tugsIn) {
      yield { until: tRdvPlan - 30 };
      tugs = yield { acquire: pools.tug, n: c.tugsIn };
      const gnow = S.eng.now; tRdv = Math.max(tRdvPlan, gnow + 25);
      tugJob = { call: c.id, port: c.port, tugs, phase: 'INBD', t0: gnow, tMeet: tRdv, meet: rdvPt, tRelease: null, tBack: null };
      S.tugJobs.push(tugJob);
    }
    const via = G.RIVER && G.RIVER.length ? offsetPath(G.RIVER, G.HLANE) : [];
    if (via.length) { spread(via, tPBP, tRdvPlan - D.pbpToRdv * 0.02, ln(pbpPos, true)); S.pilotChange[c.id] = tPBP + G.TIDE.check; }
    kf(tRdvPlan, rdvPt, null);
    if (tRdv > tRdvPlan) kf(tRdv, rdvPt, 0, { hold: true });
    yield { until: tRdv };
    if (c.tugsIn) T('TOWAGE|STRT|INBD', tRdv);

    // ---- into the basin: ULCVs swing and go astern to the berth, feeders straight abeam their quay
    const inH = offsetPath(G.HARBOUR, G.HLANE);
    const path = [...(G.ENTRANCE ? [ln(G.ENTRANCE, true)] : []), ...(B.astern ? [...inH, G.TURN] : [...inH.slice(0, 4), abeam])];
    const before = path.length >= 2 ? path[path.length - 2] : rdvPt;
    const hArrive = B.astern ? dirTo(before, G.TURN) : hBerth;
    spread(path, tRdv, tRdv + D.rdvToBasin, rdvPt, (i) => (i === path.length - 1 ? hArrive : null));
    const tSwing0 = tRdv + D.rdvToBasin;
    const tSwing1 = tSwing0 + swingIn;
    if (swingIn > 0) kf(tSwing1, G.TURN, hBerth, { spin: Math.sign(normA(hBerth - hArrive)) || 1 });
    const tFirstLine = tSwing1 + D.push;
    if (B.astern) { // astern into the basin, then pushed alongside
      const tIn = tSwing1 + D.push * 0.18, tAbeam = tSwing1 + D.push * 0.72;
      kf(tIn, G.MOUTH, hBerth); kf(tAbeam, abeam, hBerth);
    }
    kf(tFirstLine, b.pos, hBerth);

    // ---- mooring
    const tMoor = tFirstLine - D.moorLead;
    yield { until: tMoor };
    const [crew] = yield { acquire: pools.moor, n: 1 };
    const tMoorStart = S.eng.now;
    T('MOORING|STRT|INBD', tMoorStart);
    yield { until: tFirstLine };
    T('BERTH|ARRI|INBD', tFirstLine);
    const tAllFast = tFirstLine + D.allFast;
    yield { until: tAllFast };
    T('ALL_FAST||ALGS', tAllFast); T('MOORING|CMPL|INBD', tAllFast);
    S.moorJobs.push({ call: c.id, port: c.port, crew, phase: 'INBD', t0: tMoorStart, t1: tAllFast });
    pools.moor.release([crew]);
    if (c.tugsIn) { const tr = tAllFast + 2; T('TOWAGE|CMPL|INBD', tr); tugJob.tRelease = tr; tugJob.tBack = tr + 25; pools.tug.releaseAt(tr, tugs); }
    if (pilot) { const tp = tAllFast + 5; T('PILOTAGE|CMPL|INBD', tp); pobIn.to = tp; pools.pilot.releaseAt(tp, [pilot]); }
    T('GANGWAY_DOWN_AND_SECURE||ALGS', tAllFast + D.gangway);
    T('VESSEL_READY_FOR_CARGO_OPERATIONS||ALGS', tAllFast + D.ready);

    // ---- cargo operations
    const tCargo = tAllFast + D.ready + D.craneStart;
    const ops = cargoOps(c, tCargo, b, S.disruptions);
    S.cargo[c.id] = ops;
    T('CARGO_OPERATIONS|STRT|ALGS', tCargo);
    T('DISCHARGE_CARGO_OPERATIONS|STRT|ALGS', Math.min(...ops.cranes.map((k) => k.marks.DIS_start)));
    T('DISCHARGE_CARGO_OPERATIONS|CMPL|ALGS', ops.disEnd);
    T('LOADING_CARGO_OPERATIONS|STRT|ALGS', ops.loadStart);
    T('LOADING_CARGO_OPERATIONS|CMPL|ALGS', ops.end);
    T('CARGO_OPERATIONS|CMPL|ALGS', ops.end);
    if (c.bunker) { T('BUNKERING|STRT|ALGS', c.bunker.start); T('BUNKERING|CMPL|ALGS', c.bunker.end); S.bunker.push({ call: c.id, ...c.bunker }); }
    if (c.sludge) { T('SLUDGE|STRT|', c.sludge.start); T('SLUDGE|CMPL|', c.sludge.end); S.sludge.push({ call: c.id, ...c.sludge }); }
    yield { until: ops.end };
    T('LASHING|CMPL|ALGS', ops.end + D.lashing);
    const tRTS = ops.end + D.lashing + D.rts;
    T('VESSEL_READY_TO_SAIL||ALGS', tRTS);

    // ---- departure
    let pilotOut = null, pobOut = null;
    const tPilotOut = tRTS + D.pilotOut;
    if (c.pbp) {
      yield { until: tPilotOut - 1 };
      [pilotOut] = yield { acquire: pools.pilot, n: 1 };
      T('PILOTAGE|STRT|OUTB', tPilotOut);
      pobOut = { call: c.id, port: c.port, pilot: pilotOut, from: tPilotOut, to: null, phase: 'OUTB' }; S.pilotOnBoard.push(pobOut);
    }
    let tFast = tPilotOut + D.tugsOut, tugsO = [], tugJobO = null;
    if (c.tugsOut) {
      yield { until: tFast - 25 };
      tugsO = yield { acquire: pools.tug, n: c.tugsOut };
      const gnow = S.eng.now; tFast = Math.max(tFast, gnow + 25);
      tugJobO = { call: c.id, port: c.port, tugs: tugsO, phase: 'OUTB', t0: gnow, tMeet: tFast, meet: null, tRelease: null, tBack: null };
      S.tugJobs.push(tugJobO);
      yield { until: tFast };
      T('TOWAGE|STRT|OUTB', tFast);
    }
    const tUnmoor = tFast + 5;
    yield { until: tUnmoor };
    const [crewO] = yield { acquire: pools.moor, n: 1 };
    const tU0 = S.eng.now;
    T('MOORING|STRT|OUTB', tU0);
    const tATD = tU0 + D.unmoor;
    yield { until: tATD };
    T('MOORING|CMPL|OUTB', tATD); T('BERTH|DEPA|OUTB', tATD);
    S.moorJobs.push({ call: c.id, port: c.port, crew: crewO, phase: 'OUTB', t0: tU0, t1: tATD });
    pools.moor.release([crewO]);

    kf(tATD, b.pos, hBerth);
    const tOff = tATD + D.pullOff;
    kf(tOff, abeam, hBerth);
    const outH = offsetPath([...G.HARBOUR].reverse(), G.HLANE);
    const outPath = [...(B.astern ? [G.MOUTH, G.EXIT, ...outH] : outH.slice(1)), ...(G.ENTRANCE ? [ln(G.ENTRANCE, false), ln(G.RDV, false)] : [G.RDV])];
    let tGo = tOff;
    if (D.swingOut > 0) { tGo = tOff + D.swingOut; const hOut = dirTo(abeam, outPath[0]); kf(tGo, abeam, hOut, { spin: Math.sign(normA(hOut - hBerth)) || 1 }); }
    spread(outPath, tGo, tGo + D.basinToRdv, abeam);
    const tRdvOut = tGo + D.basinToRdv;
    if (c.tugsOut) { T('TOWAGE|CMPL|OUTB', tRdvOut); tugJobO.tRelease = tRdvOut; tugJobO.tBack = tRdvOut + 25; pools.tug.releaseAt(tRdvOut, tugsO); }
    const tPbpOut = tRdvOut + D.rdvToPbp;
    const viaOut = G.RIVER && G.RIVER.length ? offsetPath([...G.RIVER].reverse(), G.HLANE) : [];
    if (viaOut.length) spread(viaOut, tRdvOut, tPbpOut - D.rdvToPbp * 0.02, outPath[outPath.length - 1]);
    kf(tPbpOut, ln(pbpPos, false), null);
    if (c.pbp) {
      T('PILOTAGE|CMPL|OUTB', tPbpOut);
      pobOut.to = tPbpOut;
      pools.pilot.releaseAt(tPbpOut, [pilotOut]);
      if (c.pbp === 'EUROGEUL') S.heli.push({ call: c.id, port: c.port, kind: 'disembark', t0: tPbpOut - 30, t1: tPbpOut - 6, t2: tPbpOut + 1, t3: tPbpOut + 30 });
      else S.tender.push({ call: c.id, port: c.port, kind: 'disembark', t0: tPbpOut - 18, t1: tPbpOut - 3, t2: tPbpOut + 1, t3: tPbpOut + 20 });
    }
    T('SEA_PASSAGE|STRT|OUTB', tPbpOut);
    S.eng.fire(c.id + ':sea', tPbpOut);
    kf(tPbpOut + D.approach, ln(G.FAR, false), null);
    S.depart[c.id] = tPbpOut + D.approach;
  }

  // ---------------------------------------------------------------- run
  function finalizeTrack(k) {
    k.sort((a, b) => a.t - b.t);
    for (let i = 0; i < k.length; i++) {
      if (k[i].h !== null && k[i].h !== undefined) continue;
      const p = k[i - 1], n = k[i + 1]; let hs = [];
      if (p && dist([p.x, p.z], [k[i].x, k[i].z]) > 1) hs.push(dirTo([p.x, p.z], [k[i].x, k[i].z]));
      if (n && dist([k[i].x, k[i].z], [n.x, n.z]) > 1) hs.push(dirTo([k[i].x, k[i].z], [n.x, n.z]));
      if (!hs.length) k[i].h = p ? p.h : 0;
      else if (hs.length === 1) k[i].h = hs[0];
      else { const sx = Math.cos(hs[0]) + Math.cos(hs[1]), sy = Math.sin(hs[0]) + Math.sin(hs[1]); k[i].h = Math.atan2(sy, sx); }
    }
    return k;
  }

  function simulate(disruptions) {
    const eng = new Engine();
    const S = {
      eng, disruptions, times: {}, tracks: {}, info: {}, cargo: {}, tugJobs: [], heli: [], tender: [], moorJobs: [],
      bunker: [], sludge: [], pilotOnBoard: [], anchorWait: {}, depart: {},
      tideInfo: {}, slowSteam: {}, pilotChange: {},
      pools: {
        RTM: {
          tug: new Pool(eng, ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']),
          pilot: new Pool(eng, Array.from({ length: 10 }, (_, i) => 'P' + pad(i + 1))),
          moor: new Pool(eng, ['M1', 'M2', 'M3']),
        },
        ANR: {
          tug: new Pool(eng, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']),
          pilot: new Pool(eng, Array.from({ length: 8 }, (_, i) => 'V' + pad(i + 1))),
          moor: new Pool(eng, ['B1', 'B2']),
        },
      },
    };
    for (const c of CALLS) { S.times[c.id] = {}; S.tracks[c.id] = []; }
    const starts = CALLS.map((c) => ({ c, t: c.prevCall ? -4000 : (c.anchor ? c.anchor.arrive : c.pta) - 400 })).sort((a, b) => a.t - b.t);
    for (const { c, t } of starts) eng.at(t, () => eng.process(callProc(S, c)));
    eng.run();
    for (const c of CALLS) finalizeTrack(S.tracks[c.id]);
    return S;
  }

  // ---------------------------------------------------------------- crane tracks (gantry position along the quay)
  function buildCraneTracks(S) {
    const tracks = {};
    for (const k of CRANES) tracks[k.id] = { assign: [], z: [{ t: -1e9, z: k.home }] };
    const all = [];
    for (const id in S.cargo) for (const cr of S.cargo[id].cranes) all.push(cr);
    all.sort((a, b) => a.tStart - b.tStart);
    for (const cr of all) {
      const tr = tracks[cr.id]; const last = tr.z[tr.z.length - 1];
      const tMoveEnd = cr.tStart - 4, tMoveStart = Math.max(last.t, tMoveEnd - 22);
      if (Math.abs(last.z - cr.z) > 0.5) { tr.z.push({ t: tMoveStart, z: last.z }); tr.z.push({ t: tMoveEnd, z: cr.z }); }
      tr.z.push({ t: cr.tEnd + 1, z: cr.z });
      tr.assign.push(cr);
    }
    return tracks;
  }

  // ---------------------------------------------------------------- JIT messages (E-R-P-A)
  const LEAD = {
    'BERTH|ARRI|INBD': 4320, 'PILOT_BOARDING_PLACE|ARRI|INBD': 1440,
    'PILOTAGE|STRT|INBD': 480, 'PILOTAGE|CMPL|INBD': 480, 'TOWAGE|STRT|INBD': 360, 'TOWAGE|CMPL|INBD': 360, 'MOORING|STRT|INBD': 360, 'MOORING|CMPL|INBD': 360,
    'CARGO_OPERATIONS|STRT|ALGS': 2880, 'CARGO_OPERATIONS|CMPL|ALGS': 2880,
    'BUNKERING|STRT|ALGS': 2880, 'BUNKERING|CMPL|ALGS': 2880, 'SLUDGE|STRT|': 1440, 'SLUDGE|CMPL|': 1440,
    // outbound nautical services are first estimated with the departure, the day before (16 h ahead)
    'BERTH|DEPA|OUTB': 2880, 'PILOTAGE|STRT|OUTB': 960, 'PILOTAGE|CMPL|OUTB': 960, 'TOWAGE|STRT|OUTB': 960, 'TOWAGE|CMPL|OUTB': 960, 'MOORING|STRT|OUTB': 960, 'MOORING|CMPL|OUTB': 960,
    'ANCHORAGE|ARRI|': 180, 'ANCHORAGE|DEPA|': 0,
  };
  // Sender and receiver per DCSA Port Call 2.0 use cases. [E/P/A sender, receiver, secondary receivers]
  function route(c, key) {
    const { type, evt } = parseKey(key); const C = c.carrier;
    const { term: TE, hm: HM, pilot: PI, tug: TU, moor: MO } = PORTS[c.port].parties;
    switch (type) {
      case 'BERTH': return evt === 'ARRI' ? [C, TE, [HM]] : [C, HM, [TE]];
      case 'PILOT_BOARDING_PLACE': case 'ANCHORAGE': case 'ALL_FAST': return [C, HM, [TE]];
      case 'SEA_PASSAGE': case 'GANGWAY_DOWN_AND_SECURE': return [C, HM, [PI]];
      case 'PILOTAGE': return [PI, HM, [C]];
      case 'TOWAGE': return [TU, HM, [C]];
      case 'MOORING': return [MO, HM, [TE, C]];
      case 'CARGO_OPERATIONS': case 'DISCHARGE_CARGO_OPERATIONS': case 'LOADING_CARGO_OPERATIONS': return [TE, C, [HM]];
      case 'VESSEL_READY_FOR_CARGO_OPERATIONS': case 'VESSEL_READY_TO_SAIL': case 'MOVES': return [C, TE, [HM]];
      case 'BUNKERING': return ['BUNK', C, [HM, TE]];
      case 'SLUDGE': return ['SLDG', C, [HM]];
      case 'LASHING': return ['LASH', C, [HM, TE]];
    }
    return [C, HM, []];
  }

  function buildMessages(runs) {
    const plan = runs[0], act = runs[runs.length - 1];
    const msgs = [];
    const add = (c, key, cls, sendAt, value, remark, extra) => {
      const [s, r, cc] = route(c, key);
      const from = cls === 'REQ' ? r : s, to = cls === 'REQ' ? s : r;
      msgs.push({ id: uuid(c.id + key + cls + sendAt.toFixed(2)), call: c.id, key, cls, sendAt, value, from, to, cc: cls === 'REQ' ? cc : cc, remark: remark || null, ...extra });
    };
    for (const c of CALLS) {
      const P = plan.times[c.id], A = act.times[c.id];
      const keys = ORDER.filter((k) => A[k] !== undefined);
      // the engine run in force at a moment: a disruption counts once its revisions could have gone out
      // (later at a next port, which hears it through the carrier). Messages first sent after that carry its values.
      const kAt = (tt) => { let k = 0; DISRUPTIONS.forEach((d, i) => { if (tt >= d.start + 10 + (c.prevCall ? 14 : 0)) k = i + 1; }); return k; };
      const valAt = (key, tt) => runs[kAt(tt)].times[c.id][key] ?? P[key];
      // moves forecast
      const first = { dis: Math.round(c.moves.dis * 0.97 + 20), rst: c.moves.rst, load: Math.round(c.moves.load * 1.04 - 30) };
      add(c, 'MOVES||', 'EST', c.pta - (c.size === ULCV ? 4320 : 1440), null, null, { moves: first });
      add(c, 'MOVES||', 'EST', c.pta - (c.size === ULCV ? 1440 : 360), null, null, { moves: { ...c.moves } });
      for (const key of keys) {
        const { type } = parseKey(key); const meta = SVC[type];
        const va = A[key];
        if (!meta.neg) { add(c, key, 'ACT', va + rr(c.id + key + 'a', 1, 4), va); continue; }
        // initial E-R-P, timed from the plan, valued from the run in force when it is sent
        let lead = LEAD[key] ?? 720;
        let tE = P[key] - lead;
        if (c.lateNotice !== undefined && /INBD|ANCHORAGE/.test(key)) tE = Math.max(tE, c.lateNotice + rr(c.id + key + 'ln', 0, 25));
        if (key === 'ANCHORAGE|DEPA|') tE = A['ANCHORAGE|ARRI|'] + 35;
        if (key === 'ANCHORAGE|ARRI|') tE = c.lateNotice;
        const k0 = kAt(tE); const v0 = runs[k0].times[c.id][key] ?? P[key];
        let eVal = v0 + Math.round(rr(c.id + key + 'e', -12, 12));
        let rVal = v0, remarkR = null, remarkE = null;
        if (key === 'BERTH|ARRI|INBD' && c.jit) { eVal = c.jit.etaUnconstrained; remarkE = 'ETA at full sea speed'; remarkR = `Berth window opens ${hhmm(c.jit.window)}, after the outbound call clears the Amazonehaven. Reduce speed and arrive just in time.`; }
        if (key === 'BERTH|ARRI|INBD' && c.anchor) { eVal = A['ANCHORAGE|ARRI|'] + 85; remarkE = 'First estimate, sent on approach'; remarkR = 'Feeder berth planned for another call until about 15:00. Proceed to anchorage.'; }
        if (key === 'PILOT_BOARDING_PLACE|ARRI|INBD' && c.anchor) { eVal = A['ANCHORAGE|ARRI|']; }
        const tw = runs[k0].tideInfo[c.id];
        if (key === 'BERTH|ARRI|INBD' && tw) { remarkE = `ETA from the ${PORTS[callById[c.prevCall].port].name} schedule`; remarkR = `Inbound Scheldt tidal window: pass Vlissingen ${hhmm(tw.start)}–${hhmm(tw.end)}`; }
        if (key === 'PILOT_BOARDING_PLACE|ARRI|INBD' && tw) remarkR = 'Sea pilot at the Wandelaar, river pilot from Vlissingen';
        const tR = tE + rr(c.id + key + 'r', 12, 38), tP = tR + rr(c.id + key + 'p', 8, 22);
        add(c, key, 'EST', tE, eVal, remarkE);
        add(c, key, 'REQ', tR, rVal, remarkR);
        add(c, key, 'PLN', tP, rVal, null);
        if (key === 'BERTH|ARRI|INBD' && !c.anchor) {
          const e2 = P[key] - 1440 + rr(c.id + 'e2', -30, 30), e3 = A[key] - 360 + rr(c.id + 'e3', -20, 20); // a day out on the plan, 6 h out on the actual
          if (e2 > tP) add(c, key, 'EST', e2, valAt(key, e2) + Math.round(rr(c.id + 'e2v', -6, 6)), c.jit ? `Speed reduced to ${c.jit.speedJit} kn` : null);
          if (e3 > tP) add(c, key, 'EST', e3, valAt(key, e3) + Math.round(rr(c.id + 'e3v', -3, 3)));
        }
        // revisions after each disruption
        for (let k = k0 + 1; k < runs.length; k++) {
          const before = runs[k - 1].times[c.id][key], after = runs[k].times[c.id][key];
          const d = runs[k].disruptions[k - 1];
          if (before === undefined || after === undefined) continue;
          if (Math.abs(after - before) > 8 && before > d.start) {
            const prev = c.prevCall ? callById[c.prevCall] : null;
            const s0 = d.start + rr(c.id + key + d.id, 10, 22) + (prev ? 14 : 0); // the next port hears it once the carrier has re-planned
            const tideMissed = prev && runs[k].tideInfo[c.id] && runs[k - 1].tideInfo[c.id] && runs[k].tideInfo[c.id].hw !== runs[k - 1].tideInfo[c.id].hw;
            const why = prev
              ? `Revised: ${prev.name} sails from ${PORTS[prev.port].name} later after ${lcTitle(d.title)}${tideMissed ? '. Scheldt tidal window missed: next window, speed reduced' : ''}`
              : `Revised after ${lcTitle(d.title)} (${hhmm(d.start)}–${hhmm(d.end)})`;
            add(c, key, 'EST', s0, after, why, { revision: d.id });
            add(c, key, 'REQ', s0 + rr(c.id + key + d.id + 'r', 8, 18), after, null, { revision: d.id });
            add(c, key, 'PLN', s0 + rr(c.id + key + d.id + 'p', 20, 32), after, null, { revision: d.id });
          }
        }
        add(c, key, 'ACT', va + rr(c.id + key + 'a', 1, 4), va);
      }
    }
    msgs.sort((a, b) => a.sendAt - b.sendAt);
    msgs.forEach((m, i) => { m.seq = i; });
    return msgs;
  }

  // ---------------------------------------------------------------- DCSA event payload
  const callById = Object.fromEntries(CALLS.map((c) => [c.id, c]));
  function serviceLocation(c, key) {
    const { type } = parseKey(key); const P = PORTS[c.port]; const U = P.unloc;
    const atPBP = type === 'PILOT_BOARDING_PLACE' || type === 'SEA_PASSAGE' || key === 'PILOTAGE|STRT|INBD' || key === 'PILOTAGE|CMPL|OUTB';
    const PBPN = { EUROGEUL: 'Eurogeul pilot boarding (helicopter)', MAASCENTER: 'Maascenter pilot boarding place', WANDELAAR: 'Wandelaar pilot station' };
    if (atPBP) return { locationName: PBPN[c.pbp] || 'Pilot boarding place', UNLocationCode: U };
    if (key === 'TOWAGE|STRT|INBD' || key === 'TOWAGE|CMPL|OUTB') return { locationName: c.port === 'ANR' ? 'Tug rendezvous on the Scheldt off the Deurganckdok' : 'Tug rendezvous off Maasmond', UNLocationCode: U };
    if (type === 'ANCHORAGE') return { locationName: 'Maas anchorage area (schematic)', UNLocationCode: U };
    return { locationName: `${PARTIES[P.parties.term].name}, ${P.geo.BERTHS[c.berth].label}`, UNLocationCode: U };
  }

  function eventPayload(m) {
    const c = callById[m.call]; const { type, evt, phase } = parseKey(m.key);
    const svc = { portCallServiceID: uuid(c.id + 'svc' + m.key), portCallServiceTypeCode: type };
    if (evt) svc.portCallServiceEventTypeCode = evt;
    if (phase) svc.portCallPhaseTypeCode = phase;
    if (SVC[type].fac) svc.facilityTypeCode = SVC[type].fac;
    if (type !== 'MOVES') svc.serviceLocation = serviceLocation(c, m.key);
    svc.isCanceled = false; svc.isDeclined = false;
    const ev = {
      eventID: m.id,
      eventUpdatedDateTime: iso(m.sendAt),
      isFYI: false,
      portCall: { portCallID: uuid(c.id + 'pc'), portVisitReference: PORTS[c.port].pvr + String(4100 + Math.floor(rnd(c.id + 'pvr') * 800)).padStart(5, '0'), UNLocationCode: PORTS[c.port].unloc, isOmitted: false },
      terminalCall: {
        terminalCallID: uuid(c.id + 'tc'), terminalCallReference: PORTS[c.port].ref + '-' + c.voyIn, sequenceNumber: 1,
        carrierServiceName: c.serviceName, serviceCodeOrReference: { carrierServiceCode: c.service },
        importVoyageNumberOrReference: { carrierVoyageNumber: c.voyIn }, exportVoyageNumberOrReference: { carrierVoyageNumber: c.voyOut }, isOmitted: false,
      },
      portCallService: svc,
      vessel: { vesselName: c.name.toUpperCase(), vesselTypeCode: 'CONT', lengthOverall: c.loa, width: c.beam, vesselSizeUnit: 'MTR', draft: m.key.includes('OUTB') ? c.draftDep : c.draftArr, draftUnit: 'MTR' },
    };
    if (type === 'MOVES') {
      const mv = m.moves; const s40 = (n) => ({ totalUnits: n, size20Units: Math.round(n * 0.18), size40Units: n - Math.round(n * 0.18) - Math.round(n * 0.04), size45Units: Math.round(n * 0.04) });
      ev.movesForecasts = [{ carrierCode: PARTIES[c.carrier].code, carrierCodeListProvider: 'SMDG',
        dischargeUnits: { totalUnits: mv.dis, ladenUnits: s40(Math.round(mv.dis * 0.88)), emptyUnits: s40(mv.dis - Math.round(mv.dis * 0.88)) },
        loadUnits: { totalUnits: mv.load, ladenUnits: s40(Math.round(mv.load * 0.79)), emptyUnits: s40(mv.load - Math.round(mv.load * 0.79)), pluggedReeferUnits: s40(Math.round(mv.load * 0.07)) },
        restowUnits: s40(mv.rst) }];
    } else {
      ev.timestamp = { classifierCode: m.cls, serviceDateTime: iso(m.value) };
      if (m.remark) ev.timestamp.remark = m.remark;
    }
    return ev;
  }

  // ---------------------------------------------------------------- build everything
  function build() {
    const runs = [];
    for (let k = 0; k <= DISRUPTIONS.length; k++) runs.push(simulate(DISRUPTIONS.slice(0, k)));
    const S = runs[runs.length - 1];
    // a next-port call has no fixed PTA: its plan comes from the previous port, so take it from the undisturbed run
    for (const c of CALLS) if (c.prevCall) c.pta = Math.round(runs[0].times[c.id]['BERTH|ARRI|INBD']);
    S.craneTracks = buildCraneTracks(S);
    S.messages = buildMessages(runs);
    S.plan = runs[0];
    // JIT outcomes
    S.outcomes = {};
    for (const c of CALLS) {
      const A = S.times[c.id];
      const o = { ataBerth: A['BERTH|ARRI|INBD'], pta: c.pta };
      if (c.jit) o.anchorAvoided = c.jit.window - c.jit.etaUnconstrained;
      if (S.anchorWait[c.id]) o.anchorWait = S.anchorWait[c.id].to - S.anchorWait[c.id].from;
      if (c.prevCall) { o.ripple = A['BERTH|ARRI|INBD'] - runs[0].times[c.id]['BERTH|ARRI|INBD']; o.prevDelay = S.times[c.prevCall]['BERTH|DEPA|OUTB'] - runs[0].times[c.prevCall]['BERTH|DEPA|OUTB']; o.tide = S.tideInfo[c.id]; o.tidePlan = runs[0].tideInfo[c.id]; o.slow = S.slowSteam[c.id]; }
      S.outcomes[c.id] = o;
    }
    return S;
  }

  return { build, berthOf, tideSlot, PORTS, GEO_ANR, CALLS, CRANES, GEO, DUR, SVC, ORDER, PARTIES, DISRUPTIONS, WINDOW, parseKey, codeName, rowLabel, eventPayload, hhmm, dayName, dayIdx, longDate, iso, rnd, rr, hash, callById };
})();

if (typeof module !== 'undefined') module.exports = SIM;
