(() => {
  'use strict';
  const S = SIM.build();
  const { GEO, CALLS, CRANES, DISRUPTIONS, WINDOW, PARTIES, SVC, ORDER } = SIM;
  const { hhmm, parseKey, codeName, rowLabel } = SIM;
  const CALL = SIM.callById;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (u) => u * u * (3 - 2 * u);
  const normA = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = (n) => Math.round(n).toLocaleString('en-GB');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SHORT = { MSC: 'MSC', ECT: 'ECT Delta', PORT: 'Harbour Master', PILOT: 'Pilots', TUG: 'Boluda', MOOR: 'KRVE', BUNK: 'Bunker supplier', SLDG: 'Sludge barge', LASH: 'Lashing' };
  const dayTime = (t) => `${SIM.dayName(t)} ${hhmm(t)}`;
  const cellTime = (v, tNow) => (SIM.dayIdx(v) === SIM.dayIdx(tNow) ? hhmm(v) : `${SIM.dayName(v).slice(0, 2)} ${hhmm(v)}`);
  const hrs = (min) => (min / 60).toFixed(1);

  const state = { t: 600, playing: !reduceMotion, speed: 10, sel: null, follow: false, view: 'terminal', openKey: null };

  // ======================================================================= data helpers
  const msgsBy = {};
  for (const c of CALLS) msgsBy[c.id] = {};
  for (const m of S.messages) (msgsBy[m.call][m.key] ||= []).push(m);
  const msgById = Object.fromEntries(S.messages.map((m) => [m.id, m]));
  const sentCount = (t) => { let lo = 0, hi = S.messages.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (S.messages[mid].sendAt <= t) lo = mid + 1; else hi = mid; } return lo; };
  function latest(callId, key, cls, t) { const l = msgsBy[callId][key]; if (!l) return null; let r = null; for (const m of l) { if (m.sendAt > t) break; if (!cls || m.cls === cls) r = m; } return r; }

  function trackAt(tr, t) {
    const n = tr.length; if (!n || t < tr[0].t || t > tr[n - 1].t) return null;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid].t <= t) lo = mid; else hi = mid; }
    const a = tr[lo], b = tr[hi];
    if (b.t === a.t || lo === hi) return { x: b.x, z: b.z, h: b.h, moving: false };
    const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    let dh;
    if (b.spin) { dh = b.h - a.h; if (b.spin > 0) { while (dh <= 0) dh += TAU; while (dh > TAU) dh -= TAU; } else { while (dh >= 0) dh -= TAU; while (dh < -TAU) dh += TAU; } }
    else dh = normA(b.h - a.h);
    return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), h: a.h + dh * u, moving: Math.hypot(b.x - a.x, b.z - a.z) > 1 || Math.abs(dh) > 0.01 };
  }
  const vesselAt = (id, t) => trackAt(S.tracks[id], t);
  const inHarbour = (p) => Math.hypot(p.x - 1500, p.z - 2300) < 5200;
  const nearQuay = (p) => (p.x > -420 && p.x < 260 && p.z > -100 && p.z < 2800) || Math.hypot(p.x - 260, p.z - 2820) < 420;
  const viewFor = (p) => (nearQuay(p) ? 'quay' : inHarbour(p) ? 'terminal' : 'approach');
  const qp = GEO.qp, QUAYS = GEO.QUAYS;
  const l2w = (p, lx, lz) => { const c = Math.cos(p.h), s = Math.sin(p.h); return [p.x + lx * c + lz * s, p.z - lx * s + lz * c]; };

  const craneById = Object.fromEntries(CRANES.map((k) => [k.id, k]));
  function interpZ(list, t) {
    if (t <= list[0].t) return list[0].z;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= t) { const a = list[i], b = list[i + 1]; if (!b) return a.z; return lerp(a.z, b.z, (t - a.t) / Math.max(1e-6, b.t - a.t)); }
    return list[0].z;
  }
  function assignMoves(a, t) {
    if (t <= a.tStart) return 0; if (t >= a.tEnd) return a.total;
    for (const s of a.segs) if (t >= s.t0 && t < s.t1) return lerp(s.m0, s.m1, (t - s.t0) / (s.t1 - s.t0));
    return a.total;
  }
  function craneAt(id, t) {
    const tr = S.craneTracks[id]; const z = interpZ(tr.z, t);
    let a = null; for (const x of tr.assign) if (t >= x.tStart - 30 && t <= x.tEnd + 6) { a = x; break; }
    if (!a) return { z, state: 'idle', m: 0, a: null };
    if (t < a.tStart) return { z, state: 'ready', m: 0, a };
    if (t >= a.tEnd) return { z, state: 'done', m: a.total, a };
    for (const s of a.segs) if (t >= s.t0 && t < s.t1) return { z, state: s.kind === 'STOP' ? 'stop' : 'work', kind: s.kind, m: lerp(s.m0, s.m1, (t - s.t0) / (s.t1 - s.t0)), a, seg: s };
    return { z, state: 'work', m: 0, a };
  }
  const allAssign = []; for (const id in S.craneTracks) allAssign.push(...S.craneTracks[id].assign);
  const cumMoves = (t) => allAssign.reduce((s, a) => s + assignMoves(a, t), 0);
  const callMoves = (cid, t) => (S.cargo[cid] ? S.cargo[cid].cranes.reduce((s, a) => s + assignMoves(a, t), 0) : 0);
  const callTotal = (c) => c.moves.dis + c.moves.rst + c.moves.load;
  // hourly bins from -24 h to +48 h
  const HB0 = -1440, hourly = new Array(72 + 2).fill(0);
  for (const a of allAssign) for (const s of a.segs) {
    if (s.kind === 'STOP' || s.t1 <= s.t0) continue; const rate = (s.m1 - s.m0) / (s.t1 - s.t0);
    for (let h = Math.floor((s.t0 - HB0) / 60); h <= Math.floor((s.t1 - HB0) / 60); h++) { const h0 = HB0 + h * 60, h1 = h0 + 60; const ov = Math.min(s.t1, h1) - Math.max(s.t0, h0); if (ov > 0 && h >= 0 && h < hourly.length) hourly[h] += ov * rate; }
  }

  function stopFor(c, t) {
    for (const d of DISRUPTIONS) if (t >= d.start && t < d.end && (d.cranes === 'ALL' || c.cranes.some((k) => d.cranes.includes(k)))) {
      const A = S.times[c.id]; if (t >= A['CARGO_OPERATIONS|STRT|ALGS'] && t < A['CARGO_OPERATIONS|CMPL|ALGS']) return d;
    }
    return null;
  }
  function callStatus(c, t) {
    const A = S.times[c.id]; const tr = S.tracks[c.id];
    if (t < tr[0].t) return { code: 'exp', label: 'Expected', cls: '' };
    if (A['ANCHORAGE|ARRI|'] !== undefined && t >= A['ANCHORAGE|ARRI|'] && t < A['ANCHORAGE|DEPA|']) return { code: 'anch', label: 'At anchor', cls: 'anch' };
    if (t < A['SEA_PASSAGE|CMPL|INBD']) return { code: 'sea', label: c.jit ? 'Slow steaming' : 'At sea, inbound', cls: '' };
    if (t < A['ALL_FAST||ALGS']) return { code: 'inb', label: A['PILOTAGE|STRT|INBD'] !== undefined ? 'Pilotage inbound' : 'Inbound, no pilot', cls: 'naut' };
    if (t < A['CARGO_OPERATIONS|STRT|ALGS']) return { code: 'prep', label: 'Alongside', cls: '' };
    if (t < A['CARGO_OPERATIONS|CMPL|ALGS']) {
      const pct = Math.floor((100 * callMoves(c.id, t)) / callTotal(c));
      return stopFor(c, t) ? { code: 'stop', label: `Cranes stopped · ${pct}%`, cls: 'stop', pct } : { code: 'cargo', label: `Cargo ops ${pct}%`, cls: 'cargo', pct };
    }
    if (t < A['BERTH|DEPA|OUTB']) return { code: 'sail', label: t < A['VESSEL_READY_TO_SAIL||ALGS'] ? 'Lashing' : 'Ready to sail', cls: '' };
    if (t < A['SEA_PASSAGE|STRT|OUTB']) return { code: 'out', label: A['PILOTAGE|STRT|OUTB'] !== undefined ? 'Pilotage outbound' : 'Outbound', cls: 'naut' };
    return { code: 'gone', label: 'Departed', cls: 'done' };
  }
  function nextEvent(c, t) {
    const A = S.times[c.id];
    for (const k of ORDER) {
      if (A[k] === undefined || A[k] <= t || k === 'MOVES||') continue;
      if (!SVC[parseKey(k).type].neg) continue;
      const m = latest(c.id, k, 'PLN', t) || latest(c.id, k, 'EST', t);
      if (m) return m;
    }
    return null;
  }

  // ======================================================================= alerts and key moments
  const T = S.times;
  const ALERTS = [];
  for (const d of DISRUPTIONS) ALERTS.push({ t: d.start, end: d.end, sev: d.kind === 'wind' ? 'crit' : 'warn', title: d.title, text: d.detail });
  for (const d of DISRUPTIONS) {
    const rev = S.messages.filter((m) => m.revision === d.id && m.cls === 'EST');
    if (rev.length) { const mm = rev.find((m) => m.key === 'CARGO_OPERATIONS|CMPL|ALGS'); ALERTS.push({ t: rev[0].sendAt, sev: 'info', title: `${CALL[rev[0].call].name}: estimates revised`, text: `${rev.length} services re-estimated${mm ? `, cargo ops now complete ${hhmm(mm.value)}` : ''}. Departure, pilot, tugs and linesmen re-planned.` }); }
  }
  ALERTS.push({ t: T.BW['ANCHORAGE|ARRI|'], end: T.BW['ANCHORAGE|DEPA|'], sev: 'warn', title: 'Baltic Wren anchored', text: 'First estimate came 5 h before arrival. The feeder berth was already planned, so the terminal requested 16:00.' });
  ALERTS.push({ t: T.IR['BERTH|ARRI|INBD'], sev: 'good', title: `${CALL.IR.name} alongside on plan`, text: `ATA ${hhmm(T.IR['BERTH|ARRI|INBD'])} against PTA ${hhmm(CALL.IR.pta)}. Slowing down replaced about ${hrs(S.outcomes.IR.anchorAvoided)} h at anchor.` });
  ALERTS.push({ t: T.GU['BUNKERING|STRT|ALGS'], end: T.GU['BUNKERING|CMPL|ALGS'], sev: 'info', title: `Bunkering alongside ${CALL.GU.name}`, text: 'Bunker barge on the water side, simultaneous with cargo operations on berth A.' });
  ALERTS.push({ t: T.HG['SEA_PASSAGE|CMPL|INBD'], sev: 'info', title: 'Humber Gull inbound without pilot', text: 'Master holds a pilotage exemption certificate. No PBP or pilotage service in this call.' });
  ALERTS.sort((a, b) => b.t - a.t);

  const MOMENTS = [
    { t: 60, label: 'Bunkering', sel: 'GU', view: 'quay' },
    { t: T.NT['BERTH|DEPA|OUTB'] - 15, label: 'Nordic Tern sails', sel: 'NT', view: 'terminal' },
    { t: T.BW['ANCHORAGE|ARRI|'] - 25, label: 'Baltic Wren anchors', sel: 'BW', view: 'approach' },
    { t: T.HG['BERTH|ARRI|INBD'] - 30, label: 'Feeder without pilot', sel: 'HG', view: 'quay' },
    { t: T.GU['BERTH|DEPA|OUTB'] - 20, label: `${CALL.GU.name} sails`, sel: 'GU', view: 'terminal' },
    { t: T.IR['SEA_PASSAGE|CMPL|INBD'] - 30, label: 'Pilot by helicopter', sel: 'IR', view: 'follow' },
    { t: T.IR['BERTH|ARRI|INBD'] - 40, label: `${CALL.IR.name} berths on PTA`, sel: 'IR', view: 'quay' },
    { t: T.BW['ANCHORAGE|DEPA|'] - 10, label: 'Baltic Wren leaves anchor', sel: 'BW', view: 'approach' },
    { t: DISRUPTIONS[0].start - 10, label: 'Wind stop', sel: 'IR', view: 'terminal' },
    { t: DISRUPTIONS[1].start - 10, label: 'Q09 fault', sel: { kind: 'crane', id: 'Q09' }, view: 'quay' },
    { t: T.IR['BERTH|DEPA|OUTB'] - 25, label: `${CALL.IR.name} sails`, sel: 'IR', view: 'terminal' },
  ].sort((a, b) => a.t - b.t);

  // ======================================================================= three.js scene
  const stage = $('stage');
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 2, 260000);
  const controls = new THREE.MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = false;
  controls.maxPolarAngle = 1.32; controls.minDistance = 40; controls.maxDistance = 90000; controls.zoomSpeed = 1.2;

  const css = () => getComputedStyle(document.documentElement);
  const tok = (n) => css().getPropertyValue(n).trim() || '#888';
  const MAT = {};
  const lam = (k, color) => (MAT[k] = new THREE.MeshLambertMaterial({ color }));
  ['sea', 'seaDeep', 'basin', 'land', 'pave', 'quay', 'crane', 'craneAcc'].forEach((k) => lam(k, '#888'));
  lam('rail', '#555b5e'); lam('deck', '#7d8584'); lam('house', '#E8ECEB'); lam('funnel', '#2E3638');
  lam('tug', '#B04A3C'); lam('tender', '#D9772B'); lam('krve', '#2F6F84'); lam('white', '#EEF1F0'); lam('dark', '#343C40');
  lam('lng', '#DCE2E1'); lam('tank', '#9EA9AB'); lam('sludge', '#4A4F4C'); lam('heli', '#E46F2A'); lam('red', '#C0392B'); lam('green', '#2E8B57');
  lam('hivis', '#F08A24'); lam('agv', '#D3AC37'); lam('armg', '#6E8FA6'); lam('truck', '#ffffff'); lam('train', '#5A6B73');
  const accentMat = new THREE.MeshBasicMaterial({ color: '#ff6a00', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const HULL = { navy: '#2A3C57', sky: '#4C91B3', teal: '#3C7272', grey: '#68767C', green: '#4C7352' };
  const BOX_COLORS = ['#5B7F9C', '#B8794A', '#93504B', '#D9DCD8', '#8A9494', '#6A8A6C', '#3D5463', '#BFA766', '#C9CCC7', '#5E8584', '#A0A7A6', '#7A5E58'];
  const hemi = new THREE.HemisphereLight('#ffffff', '#88888a', 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 0.65); sun.position.set(-0.8, 1.6, 1.1); scene.add(sun);
  scene.fog = new THREE.Fog('#ccd', 10000, 60000);

  function applyTheme() {
    const map = { sea: '--sea', seaDeep: '--sea-deep', basin: '--sea', land: '--land', pave: '--pave', quay: '--quay', crane: '--crane', craneAcc: '--crane-acc' };
    for (const k in map) MAT[k].color.set(tok(map[k]));
    const sky = new THREE.Color(tok('--sky'));
    scene.background = sky; scene.fog.color = sky;
    accentMat.color.set(tok('--accent'));
    const dark = sky.getHSL({}).l < 0.3;
    hemi.intensity = dark ? 0.5 : 0.62; sun.intensity = dark ? 0.42 : 0.42;
    hemi.groundColor.set(dark ? '#30373a' : '#8a8f90');
  }

  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const flat = (shapePts, mat, y) => {
    const sh = new THREE.Shape(shapePts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; scene.add(m); return m;
  };
  const rect = (x0, z0, x1, z1, mat, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); scene.add(m); return m; };

  // ---- water and land from OpenStreetMap (src/geo-data.js), rotated so the Amazonehaven quay runs along +z
  // the sea plane and the harbour basins never write depth; land does, so hulls below the waterline stay hidden
  MAT.sea.depthWrite = false; MAT.seaDeep.depthWrite = false;
  MAT.basin.depthWrite = false; MAT.basin.depthTest = false;
  rect(-200000, -200000, 200000, 200000, MAT.sea, 0).renderOrder = -10;
  const strip = (a, b, w, mat, y) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat); m.rotation.set(-Math.PI / 2, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0, 'YXZ'); m.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); scene.add(m); return m; };
  const bar = (a, b, w, h, y, mat) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const m = box(len, h, w, mat); m.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); scene.add(m); return m; };
  strip(GEO.ENTRANCE, [GEO.ENTRANCE[0] + GEO.SEA_DIR[0] * 60000, GEO.ENTRANCE[1] + GEO.SEA_DIR[1] * 60000], 600, MAT.seaDeep, 0.2).renderOrder = -9;
  flat(GEODATA.land, MAT.land, 1).renderOrder = -8;
  for (const w of GEODATA.water) flat(w, MAT.basin, 1.2).renderOrder = -7;
  for (const b of GEODATA.bw) { if (b.c) flat(b.p, MAT.quay, 2.2); else for (let i = 1; i < b.p.length; i++) strip(b.p[i - 1], b.p[i], 16, MAT.quay, 2.2); }
  for (const p of GEODATA.pave) flat(p, MAT.pave, 1.4);
  // quay walls and crane rails: Amazonehaven quay (along +z at x = 0) and the feeder quay on the Beerkanaal
  for (const q of ['Q', 'F']) {
    const L = QUAYS[q].len;
    strip(qp(q, 0, 36), qp(q, L, 36), 76, MAT.quay, 1.6);
    for (const d of [12, 42]) bar(qp(q, 0, d), qp(q, L, d), 1.2, 0.6, 1.9, MAT.rail);
  }
  for (const r of GEODATA.railyard) bar([r[0], r[1]], [r[2], r[3]], 1.4, 0.6, 1.9, MAT.rail);
  bar([596, 126], [596, -3300], 1.2, 0.6, 1.5, MAT.rail); // rail line toward the Maasvlakte yards
  // neighbouring container terminals as stack blocks, oil terminals as tanks
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const DUMMY = new THREE.Object3D();
  {
    const list = [];
    for (const f of GEODATA.fill) {
      const ca = Math.cos(f.a), sa = Math.sin(f.a); const xs = f.p.map((q) => q[0]), zs = f.p.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2; const R = Math.hypot(Math.max(...xs) - cx, Math.max(...zs) - cz);
      for (let u = -R; u <= R; u += 132) for (let v = -R; v <= R; v += 36) {
        const x = cx + u * ca - v * sa, z = cz + u * sa + v * ca; const k = `${Math.round(x)}:${Math.round(z)}`;
        if (!inPoly(x, z, f.p) || !inPoly(x + 60 * ca, z + 60 * sa, f.p) || !inPoly(x - 60 * ca, z - 60 * sa, f.p) || SIM.rnd('nf' + k) > f.dense) continue;
        list.push([x, z, 118, 26, -f.a, 4 + SIM.rnd('nh' + k) * 8]);
      }
    }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), list.length);
    const col = new THREE.Color(); const NB = ['#8E9898', '#A3A9A6', '#7E8A8E', '#9C8A78', '#8A9A8C', '#B5B8B2'];
    list.forEach(([x, z, sx, sz, rot, h], i) => { DUMMY.position.set(x, 1.4 + h / 2, z); DUMMY.rotation.set(0, rot, 0); DUMMY.scale.set(sx, h, sz); DUMMY.updateMatrix(); inst.setMatrixAt(i, DUMMY.matrix); col.set(NB[Math.floor(SIM.rnd('nc' + i) * NB.length)]); inst.setColorAt(i, col); });
    scene.add(inst);
    const tk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 18), new THREE.MeshLambertMaterial({ color: '#E3E6E4' }), GEODATA.tanks.length);
    GEODATA.tanks.forEach(([x, z, r], i) => { const h = 16 + SIM.rnd('th' + i) * 8; DUMMY.position.set(x, 1 + h / 2, z); DUMMY.rotation.set(0, 0, 0); DUMMY.scale.set(r, h, r); DUMMY.updateMatrix(); tk.setMatrixAt(i, DUMMY.matrix); });
    scene.add(tk);
  }
  // channel buoys along the Maasgeul (IALA A: red to port, green to starboard when entering)
  {
    const g = new THREE.CylinderGeometry(9, 12, 22, 8);
    const ks = []; for (let k = 1800; k <= 44000; k += 2400) ks.push(k);
    const red = new THREE.InstancedMesh(g, MAT.red, ks.length), green = new THREE.InstancedMesh(g, MAT.green, ks.length);
    const d = new THREE.Object3D(); const [dx, dz] = GEO.SEA_DIR, [nx, nz] = GEO.LANE_N;
    ks.forEach((k, i) => { const x = GEO.ENTRANCE[0] + dx * k, z = GEO.ENTRANCE[1] + dz * k; d.position.set(x - nx * 330, 8, z - nz * 330); d.updateMatrix(); red.setMatrixAt(i, d.matrix); d.position.set(x + nx * 330, 8, z + nz * 330); d.updateMatrix(); green.setMatrixAt(i, d.matrix); });
    scene.add(red, green);
  }
  // PBP rings, anchorage circle, heli pad, tug and boatmen pontoons
  const ring = (x, z, r, w, mat) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 72), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.6, z); scene.add(m); return m; };
  const markMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  ring(GEO.EUROGEUL_PBP[0], GEO.EUROGEUL_PBP[1], 700, 40, markMat);
  ring(GEO.MAASCENTER_PBP[0], GEO.MAASCENTER_PBP[1], 450, 30, markMat);
  ring(GEO.ANCHORAGE[0], GEO.ANCHORAGE[1], 3000, 45, markMat);
  ring(GEO.TURN[0], GEO.TURN[1], 300, 10, markMat).position.y = 1.6;
  { const pad = new THREE.Mesh(new THREE.CircleGeometry(40, 32), MAT.dark); pad.rotation.x = -Math.PI / 2; pad.position.set(GEO.HELI_BASE[0], 1.8, GEO.HELI_BASE[1]); scene.add(pad); ring(GEO.HELI_BASE[0], GEO.HELI_BASE[1], 36, 4, markMat).position.y = 2; }
  const TUG_ROW = GEO.vecLocal([0, -1]); // tugs lie in a row along the quay
  bar([GEO.TUG_BASE[0] - TUG_ROW[0] * 20, GEO.TUG_BASE[1] - TUG_ROW[1] * 20], [GEO.TUG_BASE[0] + TUG_ROW[0] * 360, GEO.TUG_BASE[1] + TUG_ROW[1] * 360], 22, 4, 2, MAT.quay);
  { const kb = box(200, 4, 20, MAT.quay); kb.position.set(GEO.KRVE_BASE[0], 2, GEO.KRVE_BASE[1]); scene.add(kb); }
  // terminal buildings
  { const ops = box(70, 18, 40, MAT.white); ops.position.set(520, 10, 2440); scene.add(ops); const gate = box(30, 8, 200, MAT.quay); gate.position.set(520, 5, 1500); scene.add(gate); }

  // ---- ECT Delta yard: automated stacking crane (ASC) blocks behind the quay, as mapped in OpenStreetMap
  const YARD = GEODATA.yard;                  // { x0, x1, z, w }: perpendicular to the quay, waterside end at x0
  const DDN = GEODATA.ddn;                    // [cx, cz, len, w, angle]: Delta Dedicated North, Europahaven side
  {
    const boxes = [];
    YARD.forEach((b, bi) => {
      const nG = Math.max(2, Math.round(b.w / 6.2)); const gw = b.w / nG;
      for (let x = b.x0; x + 12.2 <= b.x1; x += 13.2) for (let gi = 0; gi < nG; gi++) {
        const k = `y${bi}-${Math.round(x)}-${gi}`; const r = SIM.rnd(k); if (r < 0.1) continue;
        boxes.push([x + 6.1, b.z - b.w / 2 + gw * (gi + 0.5), 12.2, gw - 0.6, 0, 1 + Math.floor(SIM.rnd(k + 't') * 5), k]);
      }
    });
    DDN.forEach(([cx, cz, len, w, ang], bi) => {
      const ca = Math.cos(ang), sa = Math.sin(ang); const nG = Math.max(2, Math.round(w / 6.2)); const gw = w / nG;
      for (let u = -len / 2; u + 12.2 <= len / 2; u += 13.2) for (let gi = 0; gi < nG; gi++) {
        const k = `d${bi}-${Math.round(u)}-${gi}`; if (SIM.rnd(k) < 0.14) continue; const v = -w / 2 + gw * (gi + 0.5);
        boxes.push([cx + (u + 6.1) * ca - v * sa, cz + (u + 6.1) * sa + v * ca, 12.2, gw - 0.6, -ang, 1 + Math.floor(SIM.rnd(k + 't') * 4), k]);
      }
    });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), boxes.length);
    const col = new THREE.Color();
    boxes.forEach(([x, z, sx, sz, rot, tiers, k], i) => { const h = tiers * 2.6; DUMMY.position.set(x, 1.5 + h / 2, z); DUMMY.rotation.set(0, rot, 0); DUMMY.scale.set(sx, h, sz); DUMMY.updateMatrix(); inst.setMatrixAt(i, DUMMY.matrix); col.set(BOX_COLORS[Math.floor(SIM.rnd(k + 'c') * BOX_COLORS.length)]); inst.setColorAt(i, col); });
    scene.add(inst);
  }
  const NASC = YARD.length + DDN.length;
  const ascLegs = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 20, 2), MAT.armg, NASC * 2);
  const ascBeams = new THREE.InstancedMesh(new THREE.BoxGeometry(3.5, 2.5, 1), MAT.armg, NASC);
  ascLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ascBeams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(ascLegs, ascBeams);
  function placeAsc(i, x, z, w, rot) {
    const c = Math.cos(rot), s = Math.sin(rot); DUMMY.rotation.set(0, rot, 0); DUMMY.scale.set(1, 1, 1);
    for (const k of [0, 1]) { const v = (k ? 1 : -1) * (w / 2 + 1.5); DUMMY.position.set(x + v * s, 11.5, z + v * c); DUMMY.updateMatrix(); ascLegs.setMatrixAt(i * 2 + k, DUMMY.matrix); }
    DUMMY.position.set(x, 21.5, z); DUMMY.scale.set(1, 1, w + 5); DUMMY.updateMatrix(); ascBeams.setMatrixAt(i, DUMMY.matrix);
  }
  DDN.forEach(([cx, cz, len, w, ang], bi) => { const u = (SIM.rnd('da' + bi) - 0.5) * len * 0.8; placeAsc(YARD.length + bi, cx + u * Math.cos(ang), cz + u * Math.sin(ang), w, -ang); });

  // ---- STS cranes
  const cranes = {};
  function makeCrane(spec) {
    const s = spec.type === 'FEEDER' ? 0.66 : 1; const g = new THREE.Group();
    const legH = 46 * s, by = legH + 4 * s, out = spec.outreach;
    const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); m.userData.pick = { kind: 'crane', id: spec.id }; return m; };
    for (const x of [12, 42]) for (const z of [-9, 9]) add(box(2.2, legH, 2.2, MAT.crane), x, legH / 2, z);
    for (const z of [-9, 9]) add(box(32, 3 * s, 2.2, MAT.crane), 27, legH, z);
    for (const x of [12, 42]) add(box(2.2, 3 * s, 20, MAT.crane), x, legH, 0);
    add(box(44, 4 * s, 7, MAT.crane), 34, by, 0);
    add(box(3, 20 * s, 3, MAT.crane), 40, by + 12 * s, 0);
    add(box(14, 6 * s, 8, MAT.craneAcc), 50, by + 4.5 * s, 0);
    const pivot = new THREE.Group(); pivot.position.set(12, by, 0); g.add(pivot);
    const fb = box(out, 4 * s, 7, MAT.crane); fb.position.set(-out / 2, 0, 0); fb.userData.pick = { kind: 'crane', id: spec.id }; pivot.add(fb);
    const trolley = box(7, 3, 8, MAT.craneAcc); g.add(trolley);
    const cable = box(0.4, 1, 0.4, MAT.dark); g.add(cable);
    const cont = box(2.5, 2.6, 12.2, new THREE.MeshLambertMaterial({ color: BOX_COLORS[Math.floor(SIM.rnd(spec.id) * BOX_COLORS.length)] })); g.add(cont);
    const W = QUAYS[spec.q].w; g.rotation.y = Math.atan2(W[1], -W[0]); // local -x points at the water
    const p0 = qp(spec.q, spec.home, 0); g.position.set(p0[0], 1.6, p0[1]); scene.add(g);
    cranes[spec.id] = { g, pivot, trolley, cable, cont, by, s, spec };
  }
  CRANES.forEach(makeCrane);

  // ---- vessels
  function hullShape(L, B) {
    const s = new THREE.Shape(); const hb = B / 2; const bow = Math.min(B * 1.6, L * 0.2);
    s.moveTo(-L / 2 + 5, -hb); s.lineTo(L / 2 - bow, -hb);
    s.quadraticCurveTo(L / 2 - bow * 0.15, -hb * 0.8, L / 2, 0);
    s.quadraticCurveTo(L / 2 - bow * 0.15, hb * 0.8, L / 2 - bow, hb);
    s.lineTo(-L / 2 + 5, hb); s.quadraticCurveTo(-L / 2, hb, -L / 2, hb - 5); s.lineTo(-L / 2, -hb + 5); s.quadraticCurveTo(-L / 2, -hb, -L / 2 + 5, -hb);
    return s;
  }
  function smallHull(L, B, fb, mat) {
    const g = new THREE.ExtrudeGeometry(hullShape(L, B), { depth: fb + 2, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -2, 0);
    return new THREE.Mesh(g, mat);
  }
  const vessels = {};
  const pickables = [];
  function makeVessel(c) {
    const L = c.loa, B = c.beam, ul = c.size === 'ULCV'; const fb = ul ? 16 : 8;
    const g = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(hullShape(L, B), { depth: fb + 4, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, -4, 0);
    const hull = new THREE.Mesh(geo, [MAT.deck, new THREE.MeshLambertMaterial({ color: HULL[c.hull] })]);
    hull.userData.pick = { kind: 'vessel', id: c.id }; g.add(hull); pickables.push(hull);
    const houseX = ul ? L / 2 - 0.3 * L : -L / 2 + 0.12 * L;
    const house = box(12, ul ? 34 : 18, B * 0.86, MAT.house); house.position.set(houseX, fb + (ul ? 17 : 9), 0); house.userData.pick = { kind: 'vessel', id: c.id }; g.add(house);
    const bridge = box(14, 3, B * 1.02, MAT.house); bridge.position.set(houseX, fb + (ul ? 33 : 17), 0); g.add(bridge);
    let funnelX = null;
    if (ul) { funnelX = -L / 2 + 0.1 * L; const f = box(10, 24, 9, MAT.funnel); f.position.set(funnelX, fb + 12, 0); g.add(f); }
    else { const f = box(6, 8, 6, MAT.funnel); f.position.set(houseX - 4, fb + 20, 0); g.add(f); }
    // deck stacks
    const bays = []; const nG = Math.max(2, Math.round(B / 9.6)); const gw = (B * 0.9) / nG;
    const x0 = -L / 2 + (ul ? 0.05 : 0.2) * L, x1 = L / 2 - 0.11 * L;
    for (let x = x0; x <= x1; x += 13.4) {
      if (Math.abs(x - houseX) < 10 || (funnelX !== null && Math.abs(x - funnelX) < 9)) continue;
      for (let gi = 0; gi < nG; gi++) {
        const key = `${c.id}-${Math.round(x)}-${gi}`; const r1 = SIM.rnd(key + 'a'), r2 = SIM.rnd(key + 'b'), r3 = SIM.rnd(key + 'd');
        const max = ul ? 10 : 5; const loadRatio = c.moves.load / Math.max(1, c.moves.dis);
        const arr = Math.round((ul ? 6 : 3) + r1 * (max - (ul ? 6 : 3)));
        const min = Math.round(r2 * (ul ? 2 : 1));
        const dep = clamp(Math.round(min + (arr - min) * clamp(loadRatio, 0.5, 1.4) * (0.85 + r3 * 0.25)), 1, max);
        bays.push({ lx: x, lz: -B * 0.45 + gw * (gi + 0.5), w: gw - 0.7, arr, min, dep, crane: 0, col: BOX_COLORS[Math.floor(SIM.rnd(key + 'c') * BOX_COLORS.length)], cur: -1 });
      }
    }
    const stacks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), bays.length);
    stacks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color(); bays.forEach((b, i) => { col.set(b.col); stacks.setColorAt(i, col); });
    stacks.userData.pick = { kind: 'vessel', id: c.id }; g.add(stacks); pickables.push(stacks);
    // map bays to this call's cranes
    const ops = S.cargo[c.id]; const info = S.info[c.id];
    if (ops) {
      const cl = ops.cranes.map((a) => (a.z - info.sc) * info.bowDir); // crane position in the hull frame
      bays.forEach((b) => { let best = 0, bd = 1e9; cl.forEach((x, i) => { const d = Math.abs(x - b.lx); if (d < bd) { bd = d; best = i; } }); b.crane = best; });
    }
    g.visible = false; scene.add(g);
    vessels[c.id] = { g, stacks, bays, c, fb, L, B };
  }
  CALLS.forEach(makeVessel);
  function updateStacks(v, t) {
    const ops = S.cargo[v.c.id]; const d = DUMMY; let dirty = false;
    v.bays.forEach((b, i) => {
      let tiers = b.arr;
      if (ops) {
        const a = ops.cranes[b.crane]; const m = assignMoves(a, t);
        const dis = a.parts[0].moves, rst = a.parts[1].moves, load = a.parts[2].moves;
        if (m <= 0) tiers = b.arr;
        else if (m < dis) tiers = lerp(b.arr, b.min, m / Math.max(1, dis));
        else if (m < dis + rst) tiers = b.min;
        else tiers = lerp(b.min, b.dep, clamp((m - dis - rst) / Math.max(1, load), 0, 1));
      }
      const q = Math.round(tiers * 2) / 2; if (q === b.cur) return; b.cur = q; dirty = true;
      const h = Math.max(0.01, q * 2.6);
      d.position.set(b.lx, v.fb + 1 + h / 2, b.lz); d.rotation.set(0, 0, 0); d.scale.set(12.2, h, b.w); d.updateMatrix(); v.stacks.setMatrixAt(i, d.matrix);
    });
    if (dirty) v.stacks.instanceMatrix.needsUpdate = true;
  }

  // ---- small craft
  function craft(build, pick) { const g = new THREE.Group(); build(g); g.traverse((o) => { if (o.isMesh) o.userData.pick = pick; }); scene.add(g); return g; }
  const tugs = {}; ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].forEach((id, i) => {
    tugs[id] = { g: craft((g) => { const h = smallHull(30, 11, 3, MAT.tug); g.add(h); const w = box(8, 5, 8, MAT.white); w.position.set(4, 5.5, 0); g.add(w); }, { kind: 'tug', id }), home: [GEO.TUG_BASE[0] + TUG_ROW[0] * i * 46 - TUG_ROW[1] * 22, GEO.TUG_BASE[1] + TUG_ROW[1] * i * 46 + TUG_ROW[0] * 22], i };
  });
  const heli = { g: craft((g) => { const b = box(11, 3.6, 3.6, MAT.heli); g.add(b); const tail = box(9, 1.2, 1.2, MAT.heli); tail.position.set(-9, 0.8, 0); g.add(tail); const r = box(15, 0.25, 0.8, MAT.dark); r.position.y = 2.6; r.name = 'rotor'; g.add(r); const r2 = r.clone(); r2.rotation.y = Math.PI / 2; r2.name = 'rotor2'; g.add(r2); }, { kind: 'heli', id: 'H1' }) };
  const tender = { g: craft((g) => { g.add(smallHull(20, 6, 3, MAT.tender)); const w = box(6, 3, 4, MAT.white); w.position.set(1, 4, 0); g.add(w); }, { kind: 'tender', id: 'PT1' }) };
  const krve = {}; ['M1', 'M2', 'M3'].forEach((id, i) => { krve[id] = { g: craft((g) => { g.add(smallHull(14, 4.5, 2, MAT.krve)); const w = box(4, 2.2, 3, MAT.white); w.position.set(0, 3, 0); g.add(w); }, { kind: 'moor', id }), home: [GEO.KRVE_BASE[0] - 60 + i * 30, GEO.KRVE_BASE[1] - 22] }; });
  const bunkerV = { g: craft((g) => { g.add(smallHull(110, 15, 5, MAT.sludge)); const d = box(70, 1.2, 9, MAT.red); d.position.set(0, 6.4, 0); g.add(d); for (const x of [-20, 0, 20]) { const p = box(1.2, 3, 7, MAT.white); p.position.set(x, 8, 0); g.add(p); } const h = box(12, 9, 13, MAT.white); h.position.set(-46, 10, 0); g.add(h); }, { kind: 'bunker', id: 'BNK' }) };
  const sludgeV = { g: craft((g) => { g.add(smallHull(70, 11, 4, MAT.sludge)); const h = box(8, 6, 8, MAT.white); h.position.set(-28, 8, 0); g.add(h); }, { kind: 'sludge', id: 'SLDG' }) };
  [...Object.values(tugs), heli, tender, ...Object.values(krve), bunkerV, sludgeV].forEach((o) => pickables.push(o.g));
  Object.values(cranes).forEach((k) => pickables.push(k.g));

  // ---- AGVs for the quay cranes (6 per working crane), straddle carriers at the feeder terminal
  const N_AGV = 72, N_ATT = 9, NA = N_AGV + N_ATT;
  const agvBody = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 1.6, 15), MAT.agv, NA);
  const agvBox = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 2.6, 12.2), new THREE.MeshLambertMaterial({ color: '#ffffff' }), NA);
  agvBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage); agvBox.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  { const col = new THREE.Color(); for (let i = 0; i < NA; i++) { col.set(i >= N_AGV ? '#7C909A' : '#D3AC37'); agvBody.setColorAt(i, col); col.set(BOX_COLORS[i % BOX_COLORS.length]); agvBox.setColorAt(i, col); } }
  agvBody.userData.pick = { kind: 'agv' }; scene.add(agvBody, agvBox); pickables.push(agvBody);
  const agvState = new Array(NA).fill(null);
  const STS_IDS = CRANES.filter((k) => k.type === 'STS' && !k.idle).map((k) => k.id);
  const FEED_IDS = CRANES.filter((k) => k.type === 'FEEDER').map((k) => k.id);
  const nearestBlock = (z, list) => { let b = 0, bd = 1e9; list.forEach((x, i) => { const d = Math.abs(x.z - z); if (d < bd) { bd = d; b = i; } }); return b; };
  // polyline pose with vessel-style heading (+x forward)
  function route(pts, u) { const p = along(pts, u); return { x: p.x, z: p.z, h: p.yaw - Math.PI / 2 }; }
  function along(pts, u) {
    let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    let tgt = clamp(u, 0, 1) * L;
    for (let i = 0; i < seg.length; i++) { if (tgt <= seg[i] || i === seg.length - 1) { const f = seg[i] ? clamp(tgt / seg[i], 0, 1) : 0; const a = pts[i], b = pts[i + 1]; return { x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) }; } tgt -= seg[i]; }
    const p = pts[pts.length - 1]; return { x: p[0], z: p[1], yaw: 0 };
  }

  // ---- trucks and train
  const N_TRUCK = 36;
  const trucks = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 3.8, 17), MAT.truck, N_TRUCK);
  trucks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  { const col = new THREE.Color(); for (let i = 0; i < N_TRUCK; i++) { col.set(BOX_COLORS[(i * 7) % BOX_COLORS.length]); trucks.setColorAt(i, col); } }
  scene.add(trucks);
  const N_WAGON = 26;
  const train = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 3.4, 19), MAT.train, N_WAGON + 1);
  train.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  { const col = new THREE.Color(); for (let i = 0; i <= N_WAGON; i++) { col.set(i === 0 ? '#C2412F' : BOX_COLORS[(i * 3) % BOX_COLORS.length]); train.setColorAt(i, col); } }
  scene.add(train);
  const TRAINS = [-330, 140, 610, 1080, 1550, 2020, 2490];

  // ---- people (linesmen on the quay, lashers on deck)
  const N_PEOPLE = 90;
  const people = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 1.9, 6), MAT.hivis, N_PEOPLE);
  people.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(people);

  // ---- selection marker
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 72), accentMat); selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);

  // ======================================================================= per-frame scene update
  const camDist = (x, z) => Math.hypot(camera.position.x - x, camera.position.z - z, camera.position.y);
  function placeCraft(g, x, z, h, y, scaleTarget) {
    g.visible = true; g.position.set(x, y, z); g.rotation.set(0, h, 0);
    const s = clamp(camDist(x, z) / (scaleTarget || 1800), 1, 40); g.scale.setScalar(s);
  }
  const vesselPos = {};
  function tugTarget(job, tugId, t) {
    const c = CALL[job.call]; const v = vesselAt(c.id, t); if (!v) return null;
    const k = job.tugs.indexOf(tugId); const L = c.loa, B = c.beam;
    const off = c.size === 'ULCV' ? [[L / 2 + 45, 0], [-L / 2 - 45, 0], [L * 0.28, -(B / 2 + 16)], [-L * 0.28, -(B / 2 + 16)]][k] : [[-L / 2 - 36, 0]][k] || [0, -(B / 2 + 14)];
    const [x, z] = l2w(v, off[0], off[1]); return { x, z, h: v.h + (k === 1 ? 0 : 0) };
  }
  function updateScene(t, secs) {
    // vessels
    for (const c of CALLS) {
      const v = vessels[c.id]; const p = vesselAt(c.id, t); vesselPos[c.id] = p;
      if (!p) { v.g.visible = false; continue; }
      v.g.visible = true; v.g.position.set(p.x, 0, p.z); v.g.rotation.y = p.h;
      v.g.scale.setScalar(inHarbour(p) ? 1 : clamp(camDist(p.x, p.z) / 9000, 1, 7));
      updateStacks(v, t);
    }
    // cranes
    for (const id in cranes) {
      const k = cranes[id]; const cs = craneAt(id, t); const cp = qp(k.spec.q, cs.z, 0); k.g.position.x = cp[0]; k.g.position.z = cp[1];
      const raised = cs.state === 'idle';
      const tgtRot = raised ? -1.32 : 0; k.pivot.rotation.z += (tgtRot - k.pivot.rotation.z) * 0.15;
      let tx = 27, ty = k.by - 2.5, carry = false, hookY = 30 * k.s;
      if ((cs.state === 'work' || cs.state === 'stop') && cs.a) {
        const c = CALL[cs.a.call]; const vx = -S.info[c.id].off;
        const mv = cs.m; const ph = mv - Math.floor(mv);
        const rowOff = ((SIM.hash(id + Math.floor(mv)) % 21) / 20 - 0.5) * c.beam * 0.8;
        const xv = vx + rowOff, xa = 27; const deckY = (c.size === 'ULCV' ? 16 : 8) + 14;
        const dis = cs.kind === 'DIS' || cs.kind === 'RST';
        const from = dis ? xv : xa, to = dis ? xa : xv; const yFrom = dis ? deckY : 6, yTo = dis ? 6 : deckY;
        if (ph < 0.15) { tx = from; hookY = lerp(k.by - 8, yFrom, Math.sin((ph / 0.15) * Math.PI)); carry = ph > 0.075; }
        else if (ph < 0.45) { tx = lerp(from, to, smooth((ph - 0.15) / 0.3)); hookY = k.by - 8; carry = true; }
        else if (ph < 0.6) { tx = to; hookY = lerp(k.by - 8, yTo, Math.sin(((ph - 0.45) / 0.15) * Math.PI)); carry = ph < 0.525; }
        else if (ph < 0.9) { tx = lerp(to, from, smooth((ph - 0.6) / 0.3)); hookY = k.by - 8; carry = false; }
        else { tx = from; hookY = k.by - 8; carry = false; }
      }
      k.trolley.position.set(tx, k.by - 2.5, 0);
      const cl = Math.max(1, k.by - 4 - hookY); k.cable.position.set(tx, hookY + cl / 2 + 1.3, 0); k.cable.scale.y = cl;
      k.cont.visible = carry; k.cont.position.set(tx, hookY, 0);
    }
    // ASCs shuttle along their blocks
    YARD.forEach((b, bi) => { const u = 0.5 + 0.5 * Math.sin(t * (0.05 + 0.03 * SIM.rnd('as' + bi)) + bi * 1.7); placeAsc(bi, b.x0 + 8 + u * (b.x1 - b.x0 - 16), b.z, b.w, 0); });
    ascLegs.instanceMatrix.needsUpdate = true; ascBeams.instanceMatrix.needsUpdate = true;
    // AGVs
    const used = new Array(NA).fill(false);
    const setAgv = (i, x, z, yaw, carry, st) => {
      DUMMY.position.set(x, 2.4, z); DUMMY.rotation.set(0, yaw, 0); DUMMY.scale.set(1, 1, 1); DUMMY.updateMatrix(); agvBody.setMatrixAt(i, DUMMY.matrix);
      if (carry) { DUMMY.position.set(x, 4.6, z); DUMMY.updateMatrix(); } else { DUMMY.scale.set(0.001, 0.001, 0.001); DUMMY.updateMatrix(); }
      agvBox.setMatrixAt(i, DUMMY.matrix); used[i] = true; agvState[i] = st;
    };
    const serve = (cid, ids, nA) => {
      const cs = craneAt(cid, t); if (!cs.a || cs.state === 'idle') return false;
      const q = craneById[cid].q, sq = cs.z; const A = QUAYS[q].a; const yawQ = Math.atan2(A[0], A[1]);
      const kindDis = cs.kind ? cs.kind !== 'LOAD' : true;
      for (let k = 0; k < nA; k++) {
        const i = ids[k]; const qq = cs.m / nA + k / nA; const cyc = Math.floor(qq); const ph = qq - cyc; const r = SIM.rnd(cid + cyc + '-' + k);
        let P0, P1, P2, P3, Pq;
        if (q === 'Q') { // quay crane to the waterside end of an ASC block and back
          const b = YARD[clamp(nearestBlock(sq, YARD) + Math.floor(r * 9) - 4, 0, YARD.length - 1)]; const zb = b.z + (k % 2 ? 3 : -3);
          P0 = [27, sq + (k - 2.5) * 1.5]; P1 = [60, sq + (k - 2.5) * 8]; P2 = [92, zb]; P3 = [b.x0 - 6, zb]; Pq = [46, sq - 18 + k * 7];
        } else { // feeder crane to the eastern end of the yard
          const xb = 150 + Math.floor(r * 7) * 26;
          P0 = qp('F', sq + (k - 1) * 2, 27); P1 = qp('F', sq + (k - 1) * 9, 70); P2 = [xb, 2570]; P3 = [xb, 2522]; Pq = qp('F', sq - 14 + k * 9, 50);
        }
        const yaw3 = Math.atan2(P3[0] - P2[0], P3[1] - P2[1]);
        let pose, carry;
        if (ph < 0.12) { pose = { x: P0[0], z: P0[1], yaw: yawQ }; carry = kindDis ? ph > 0.06 : ph < 0.06; }
        else if (ph < 0.42) { pose = along([P0, P1, P2, P3], (ph - 0.12) / 0.3); carry = kindDis; }
        else if (ph < 0.58) { pose = { x: P3[0], z: P3[1], yaw: yaw3 }; carry = kindDis ? ph < 0.5 : ph > 0.5; }
        else if (ph < 0.88) { pose = along([P3, P2, P1, Pq], (ph - 0.58) / 0.3); carry = !kindDis; }
        else { pose = along([Pq, P0], (ph - 0.88) / 0.12); carry = !kindDis; }
        setAgv(i, pose.x, pose.z, pose.yaw, carry, { crane: cid, carry, call: cs.a.call, stopped: cs.state === 'stop', moving: !(ph < 0.12 || (ph >= 0.42 && ph < 0.58)) && cs.state === 'work' });
      }
      return true;
    };
    STS_IDS.forEach((cid, ci) => serve(cid, [0, 1, 2, 3, 4, 5].map((k) => ci * 6 + k), 6));
    FEED_IDS.forEach((cid, ci) => serve(cid, [0, 1, 2].map((k) => N_AGV + ci * 3 + k), 3));
    let pk = 0;
    for (let i = 0; i < NA; i++) {
      if (used[i]) continue;
      if (i >= N_AGV) { const n = i - N_AGV; const pp = qp('F', 362 + (n % 3) * 9, 40 + Math.floor(n / 3) * 18); setAgv(i, pp[0], pp[1], 0, false, { parked: true }); continue; }
      setAgv(i, 64 + (pk % 8) * 6.2, 1160 + Math.floor(pk / 8) * 17, 0, false, { parked: true }); pk++;
    }
    agvBody.instanceMatrix.needsUpdate = true; agvBox.instanceMatrix.needsUpdate = true;
    // trucks: loop on the landside road
    {
      const xa = 458, xb = 482, z0 = 150, z1 = 2460, Lp = 2 * (z1 - z0) + 2 * (xb - xa);
      for (let i = 0; i < N_TRUCK; i++) {
        let s = (t * 95 + (i * Lp) / N_TRUCK + 40 * Math.sin(t * 0.21 + i)) % Lp; if (s < 0) s += Lp;
        let x, z, yaw;
        if (s < z1 - z0) { x = xa; z = z0 + s; yaw = 0; }
        else if (s < z1 - z0 + (xb - xa)) { x = xa + (s - (z1 - z0)); z = z1; yaw = Math.PI / 2; }
        else if (s < 2 * (z1 - z0) + (xb - xa)) { x = xb; z = z1 - (s - (z1 - z0) - (xb - xa)); yaw = Math.PI; }
        else { x = xb - (s - 2 * (z1 - z0) - (xb - xa)); z = z0; yaw = -Math.PI / 2; }
        DUMMY.position.set(x, 3.4, z); DUMMY.rotation.set(0, yaw, 0); DUMMY.scale.set(1, 1, 1); DUMMY.updateMatrix(); trucks.setMatrixAt(i, DUMMY.matrix);
      }
      trucks.instanceMatrix.needsUpdate = true;
    }
    // train
    {
      let head = -6000;
      for (const ta of TRAINS) {
        if (t >= ta && t < ta + 18) head = lerp(-3200, 140, smooth((t - ta) / 18));
        else if (t >= ta + 18 && t < ta + 210) head = 140;
        else if (t >= ta + 210 && t < ta + 228) head = lerp(140, -3200, smooth((t - ta - 210) / 18));
      }
      for (let i = 0; i <= N_WAGON; i++) { const z = head + i * 20.5; const x = z < 126 ? 596 : 596 - (z - 126) * 0.082; DUMMY.position.set(x, 3.2, z); DUMMY.rotation.set(0, z < 126 ? 0 : 0.082, 0); DUMMY.scale.set(1, 1, 1); DUMMY.updateMatrix(); train.setMatrixAt(i, DUMMY.matrix); }
      train.instanceMatrix.needsUpdate = true;
    }
    // tugs
    for (const id in tugs) {
      const tg = tugs[id]; let pose = null;
      for (const j of S.tugJobs) {
        if (!j.tugs.includes(id) || t < j.t0 || t > (j.tBack ?? j.t0)) continue;
        const arrive = j.t0 + 25;
        const meet = tugTarget(j, id, j.tMeet);
        const H = GEO.HARBOUR; const seaOut = [H[3], H[2], H[1], H[0], GEO.ENTRANCE]; const basin = S.info[j.call].q === 'Q' ? [H[4], GEO.MOUTH] : [H[4]];
        if (t < arrive && meet) { const via = j.phase === 'INBD' ? seaOut : basin; pose = { ...route([tg.home, ...via, [meet.x, meet.z]], smooth((t - j.t0) / 25)), st: `Heading to ${CALL[j.call].name}` }; }
        else if (t < j.tMeet && meet) pose = { ...meet, st: `Standing by for ${CALL[j.call].name}` };
        else if (t <= j.tRelease) { const p = tugTarget(j, id, t); if (p) pose = { ...p, st: `Towing ${CALL[j.call].name} (${j.phase === 'INBD' ? 'inbound' : 'outbound'})` }; }
        else { const rel = tugTarget(j, id, j.tRelease); if (rel) { const via = j.phase === 'INBD' ? [...basin].reverse() : [...seaOut].reverse(); pose = { ...route([[rel.x, rel.z], ...via, tg.home], smooth((t - j.tRelease) / 25)), st: 'Returning to base' }; } }
        if (pose) { pose.job = j; break; }
      }
      if (!pose) pose = { x: tg.home[0], z: tg.home[1], h: 0, st: 'At base' };
      placeCraft(tg.g, pose.x, pose.z, pose.h, 0, 1600); tg.pose = pose;
    }
    // helicopter
    {
      let pose = { x: GEO.HELI_BASE[0], z: GEO.HELI_BASE[1], y: 3, h: 0, st: 'On the pad', fly: false };
      for (const f of S.heli) {
        if (t < f.t0 || t > f.t3) continue;
        const c = CALL[f.call]; const at = (tt) => { const v = vesselAt(c.id, tt); if (!v) return null; const [x, z] = l2w(v, c.loa * 0.32, 0); return { x, z }; };
        const tgt = at(clamp(t, f.t1, f.t2)) || at(f.t1);
        if (!tgt) break;
        if (t < f.t1) { const u = smooth((t - f.t0) / (f.t1 - f.t0)); pose = { x: lerp(GEO.HELI_BASE[0], tgt.x, u), z: lerp(GEO.HELI_BASE[1], tgt.z, u), y: 70 + 220 * Math.sin(u * Math.PI), h: Math.atan2(-(tgt.z - GEO.HELI_BASE[1]), tgt.x - GEO.HELI_BASE[0]), st: `Flying a pilot ${f.kind === 'board' ? 'to' : 'to collect from'} ${c.name}`, fly: true }; }
        else if (t <= f.t2) pose = { x: tgt.x, z: tgt.z, y: 62, h: vesselAt(c.id, t)?.h || 0, st: `Hovering over ${c.name}, pilot ${f.kind === 'board' ? 'boarding' : 'disembarking'}`, fly: true };
        else { const u = smooth((t - f.t2) / (f.t3 - f.t2)); pose = { x: lerp(tgt.x, GEO.HELI_BASE[0], u), z: lerp(tgt.z, GEO.HELI_BASE[1], u), y: 70 + 220 * Math.sin(u * Math.PI), h: Math.atan2(-(GEO.HELI_BASE[1] - tgt.z), GEO.HELI_BASE[0] - tgt.x), st: 'Returning to base', fly: true }; }
        break;
      }
      placeCraft(heli.g, pose.x, pose.z, pose.h, pose.y, 1300); heli.pose = pose;
      const rot = pose.fly && !reduceMotion ? secs * 30 : 0.3; heli.g.getObjectByName('rotor').rotation.y = rot; heli.g.getObjectByName('rotor2').rotation.y = rot + Math.PI / 2;
    }
    // pilot tender
    {
      const home = GEO.TENDER_STATION; let pose = { x: home[0], z: home[1], h: 0.4, st: 'On station off Maascenter' };
      for (const f of S.tender) {
        if (t < f.t0 || t > f.t3) continue;
        const c = CALL[f.call]; const at = (tt) => { const v = vesselAt(c.id, tt); if (!v) return null; const [x, z] = l2w(v, 0, -(c.beam / 2 + 9)); return { x, z, h: v.h }; };
        const tgt = at(clamp(t, f.t1, f.t2)) || at(f.t1); if (!tgt) break;
        if (t < f.t1) { const u = smooth((t - f.t0) / (f.t1 - f.t0)); pose = { x: lerp(home[0], tgt.x, u), z: lerp(home[1], tgt.z, u), h: Math.atan2(-(tgt.z - home[1]), tgt.x - home[0]), st: `Bringing a pilot to ${c.name}` }; }
        else if (t <= f.t2) pose = { ...tgt, st: `Alongside ${c.name}` };
        else { const u = smooth((t - f.t2) / (f.t3 - f.t2)); pose = { x: lerp(tgt.x, home[0], u), z: lerp(tgt.z, home[1], u), h: Math.atan2(-(home[1] - tgt.z), home[0] - tgt.x), st: 'Returning to station' }; }
        break;
      }
      placeCraft(tender.g, pose.x, pose.z, pose.h, 0, 1400); tender.pose = pose;
    }
    // mooring boats + linesmen
    let pi = 0; const putPerson = (x, y, z) => { if (pi >= N_PEOPLE) return; DUMMY.position.set(x, y + 0.95, z); DUMMY.rotation.set(0, 0, 0); DUMMY.scale.set(1, 1, 1); DUMMY.updateMatrix(); people.setMatrixAt(pi++, DUMMY.matrix); };
    for (const id in krve) {
      const b = krve[id]; let pose = null;
      for (const j of S.moorJobs) {
        if (j.crew !== id || t < j.t0 - 15 || t > j.t1 + 15) continue;
        const c = CALL[j.call]; const v = vesselAt(c.id, clamp(t, j.t0, j.t1)) || vesselAt(c.id, j.t0); if (!v) break;
        const [x, z] = l2w(v, c.loa / 2 + 22, c.beam * 0.2);
        const u = t < j.t0 ? smooth((t - j.t0 + 15) / 15) : t > j.t1 ? 1 - smooth((t - j.t1) / 15) : 1;
        pose = { x: lerp(b.home[0], x, u), z: lerp(b.home[1], z, u), h: v.h, st: `${j.phase === 'INBD' ? 'Mooring' : 'Unmooring'} ${c.name}` };
        if (t >= j.t0 && t <= j.t1) { const bi = S.info[c.id]; for (const dz of [-c.loa * 0.43, -c.loa * 0.43 + 5, c.loa * 0.43, c.loa * 0.43 - 5]) { const pp = qp(bi.q, bi.sc + dz, 6); putPerson(pp[0], 1.6, pp[1]); } }
        pose.job = j; break;
      }
      if (!pose) pose = { x: b.home[0], z: b.home[1], h: 0, st: 'At KRVE base' };
      placeCraft(b.g, pose.x, pose.z, pose.h, 0, 1200); b.pose = pose;
    }
    // lashers on deck at start and end of cargo operations
    for (const c of CALLS) {
      const A = S.times[c.id]; const s0 = A['CARGO_OPERATIONS|STRT|ALGS'], s1 = A['CARGO_OPERATIONS|CMPL|ALGS'], s2 = A['LASHING|CMPL|ALGS'];
      if (!((t >= s0 - 20 && t < s0 + 90) || (t >= s1 - 120 && t < s2))) continue;
      const v = vesselPos[c.id]; if (!v) continue; const n = c.size === 'ULCV' ? 10 : 5;
      for (let k = 0; k < n; k++) { const lx = -c.loa * 0.4 + (k / (n - 1)) * c.loa * 0.75, lz = ((SIM.hash(c.id + k) % 7) - 3) * 4; const [x, z] = l2w(v, lx, lz); putPerson(x, (c.size === 'ULCV' ? 16 : 8) + 1, z); }
    }
    for (let i = pi; i < N_PEOPLE; i++) { DUMMY.scale.set(0.001, 0.001, 0.001); DUMMY.position.set(0, -50, 0); DUMMY.updateMatrix(); people.setMatrixAt(i, DUMMY.matrix); }
    people.instanceMatrix.needsUpdate = true;
    // bunker barge and sludge barge
    const serviceBoat = (obj, jobs, home, off, label) => {
      let pose = null;
      for (const j of jobs) {
        if (t < j.start - 40 || t > j.end + 40) continue;
        const c = CALL[j.call]; const v = vesselAt(c.id, clamp(t, j.start, j.end)); if (!v) break;
        const [x, z] = l2w(v, off(c)[0], off(c)[1]);
        const u = t < j.start ? smooth((t - j.start + 40) / 40) : t > j.end ? 1 - smooth((t - j.end) / 40) : 1;
        const r = route([home, GEO.HARBOUR[4], GEO.MOUTH, [x, z]], u);
        pose = { x: r.x, z: r.z, h: u > 0.97 ? v.h : (t > j.end ? r.h + Math.PI : r.h), st: t < j.start ? `Heading to ${c.name}` : t > j.end ? 'Returning' : `${label} ${c.name}`, job: j };
        break;
      }
      if (!pose) pose = { x: home[0], z: home[1], h: Math.PI, st: 'Waiting' };
      placeCraft(obj.g, pose.x, pose.z, pose.h, 0, 3000); obj.pose = pose;
    };
    serviceBoat(bunkerV, S.bunker, GEO.BUNKER_STATION, (c) => [-c.loa * 0.05, -(c.beam / 2 + 12)], 'Bunkering');
    serviceBoat(sludgeV, S.sludge, GEO.SLUDGE_STATION, (c) => [-c.loa * 0.3, -(c.beam / 2 + 8)], 'Collecting sludge from');
    // selection marker
    selRing.visible = false;
    if (state.sel?.kind === 'vessel' && vesselPos[state.sel.id]) { const p = vesselPos[state.sel.id]; const c = CALL[state.sel.id]; const sc = vessels[c.id].g.scale.x; selRing.visible = true; selRing.position.set(p.x, 0.7, p.z); selRing.scale.setScalar(c.loa * 0.62 * sc); }
    else if (state.sel?.kind === 'crane') { const k = cranes[state.sel.id]; const cp = k.g.localToWorld(new THREE.Vector3(27, 0, 0)); selRing.visible = true; selRing.position.set(cp.x, 2.2, cp.z); selRing.scale.setScalar(34); }
  }

  // ======================================================================= labels
  const labelsEl = $('labels');
  const LABELS = [];
  function addLabel(cls, html, pos, min, max, onClick) {
    const e = document.createElement('div'); e.className = 'lbl ' + cls; e.innerHTML = html; labelsEl.appendChild(e);
    if (onClick) e.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    const L = { e, pos, min, max, shown: true }; LABELS.push(L); return L;
  }
  const P3 = (x, y, z) => () => [x, y, z];
  const G = (x, z) => GEO.g(x, z);
  addLabel('place', 'Eurogeul PBP · helicopter', P3(GEO.EUROGEUL_PBP[0], 0, GEO.EUROGEUL_PBP[1]), 6000, 1e9);
  addLabel('place', 'Maascenter PBP', P3(GEO.MAASCENTER_PBP[0], 0, GEO.MAASCENTER_PBP[1]), 5000, 1e9);
  addLabel('place', 'Anchorage', P3(GEO.ANCHORAGE[0], 0, GEO.ANCHORAGE[1]), 6000, 1e9);
  const off = (k, n) => [GEO.ENTRANCE[0] + GEO.SEA_DIR[0] * k - GEO.LANE_N[0] * n, GEO.ENTRANCE[1] + GEO.SEA_DIR[1] * k - GEO.LANE_N[1] * n];
  { const p = off(34000, 700); addLabel('place', 'Eurogeul', P3(p[0], 0, p[1]), 9000, 1e9); }
  { const p = off(5000, 650); addLabel('place', 'Maasgeul', P3(p[0], 0, p[1]), 5000, 1e9); }
  const PLACES = [
    ['Maasmond', G(2200, -3350), 2500, 60000], ['Hoek van Holland', G(7600, -5200), 6000, 1e9], ['Europoort', G(8200, 400), 6000, 1e9],
    ['Calandkanaal', G(5600, -1900), 2500, 50000], ['Beerkanaal', G(3720, -1150), 1500, 50000], ['Yangtzehaven', G(-200, -2150), 1500, 40000],
    ['Europahaven', G(820, -640), 1500, 30000], ['Amazonehaven', [-150, 880], 1200, 30000], ['Mississippihaven', G(1950, 1950), 1500, 30000],
    ['Maasvlakte 1', G(1300, -1150), 6000, 1e9], ['Maasvlakte 2', G(-2600, 2700), 6000, 1e9],
    ['Hutchison Ports ECT Delta', [1000, 760], 2500, 30000], ['Delta Barge Feeder Terminal', GEO.qp('F', 210, 140), 600, 9000],
    ['Turning basin', [GEO.TURN[0], GEO.TURN[1]], 700, 9000], ['Tug harbour', GEO.TUG_BASE, 1500, 30000], ['KRVE boatmen · pilots', GEO.KRVE_BASE, 1500, 30000],
    ['Pilot helicopter pad', GEO.HELI_BASE, 1500, 30000],
    ['Berth A', GEO.qp('Q', 1505, -10), 300, 7000], ['Berth B', GEO.qp('Q', 2005, -10), 300, 7000],
    ['Other Delta berths · not modelled', GEO.qp('Q', 620, -10), 300, 9000], ['Yard · ASC blocks', [280, 2380], 300, 6000], ['Rail', [600, 500], 300, 4000],
  ];
  for (const [n, p, mn, mx] of PLACES) addLabel('place', esc(n), P3(p[0], 0, p[1]), mn, mx);
  const vLabels = {};
  for (const c of CALLS) {
    vLabels[c.id] = addLabel('vessel', `${esc(c.name)}<small></small>`, () => { const p = vesselPos[c.id]; if (!p) return null; const sc = vessels[c.id].g.scale.x; return [p.x, (c.size === 'ULCV' ? 62 : 30) * sc, p.z]; }, 0, 1e9, () => select({ kind: 'vessel', id: c.id }));
  }
  const heliLabel = addLabel('craft', 'Pilot helicopter', () => (heli.pose?.fly ? [heli.g.position.x, heli.g.position.y + 30 * heli.g.scale.x, heli.g.position.z] : null), 0, 1e9);
  const lngLabel = addLabel('craft', 'Bunker barge', () => (bunkerV.pose?.job ? [bunkerV.g.position.x, 30 * bunkerV.g.scale.x, bunkerV.g.position.z] : null), 0, 12000);
  const vtmp = new THREE.Vector3();
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight; const camD = camera.position.distanceTo(controls.target);
    for (const L of LABELS) {
      const p = L.pos(); let show = !!p && camD >= L.min && camD <= L.max;
      if (show) { vtmp.set(p[0], p[1], p[2]).project(camera); show = vtmp.z < 1 && vtmp.x > -1.2 && vtmp.x < 1.2 && vtmp.y > -1.2 && vtmp.y < 1.2; if (show) { const x = ((vtmp.x + 1) / 2) * w, y = ((1 - vtmp.y) / 2) * h; L.e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`; } }
      if (show !== L.shown) { L.e.style.display = show ? '' : 'none'; L.shown = show; }
    }
  }

  // ======================================================================= camera views
  const VIEWS = {
    approach: () => { const p = off(8800, 1600); return { target: [p[0], 0, p[1]], off: [-GEO.SEA_DIR[0] * 21000, 23000, -GEO.SEA_DIR[1] * 21000] }; },
    terminal: () => ({ target: [60, 0, 2120], off: [-1550, 1650, 1950] }),
    quay: () => {
      const s = state.sel; let q = 'Q', sq = 2005;
      if (s?.kind === 'vessel' && S.info[s.id]) { q = S.info[s.id].q; sq = S.info[s.id].sc; }
      if (s?.kind === 'crane') { q = craneById[s.id].q; sq = craneAt(s.id, state.t).z; }
      const Q = QUAYS[q]; const p = qp(q, sq, -40);
      return { target: [p[0], 0, p[1]], off: [Q.w[0] * 560 + Q.a[0] * 470, 330, Q.w[1] * 560 + Q.a[1] * 470] };
    },
  };
  let fly = null;
  function setView(name, instant) {
    state.view = name; document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    const v = VIEWS[name](); const asp = stage.clientWidth / Math.max(1, stage.clientHeight); const k = asp < 1 ? 1.55 : asp < 1.3 ? 1.2 : 1;
    const to = new THREE.Vector3(v.target[0], v.target[1], v.target[2]); const pos = new THREE.Vector3(v.target[0] + v.off[0] * k, v.off[1] * k, v.target[2] + v.off[2] * k);
    if (instant || reduceMotion) { controls.target.copy(to); camera.position.copy(pos); fly = null; }
    else fly = { t0: performance.now(), dur: 1100, fromT: controls.target.clone(), toT: to, fromP: camera.position.clone(), toP: pos };
  }
  function followVessel() {
    const s = state.sel; if (!state.follow || s?.kind !== 'vessel') return; const p = vesselPos[s.id]; if (!p) return;
    const dx = (p.x - controls.target.x) * 0.12, dz = (p.z - controls.target.z) * 0.12;
    controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
  }

  // ======================================================================= picking and selection
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const quick = performance.now() - down.t < 450; down = null;
    if (moved > 7 || !quick) return;
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object; while (o && !o.userData.pick) o = o.parent; if (!o || !o.visible) continue;
      const p = o.userData.pick;
      if (p.kind === 'agv') { if (h.instanceId === undefined || !agvState[h.instanceId] || agvState[h.instanceId].parked) continue; select({ kind: 'agv', id: h.instanceId }); return; }
      select({ kind: p.kind, id: p.id }); return;
    }
    select(null);
  });
  function select(sel) {
    if (sel && typeof sel === 'string') sel = { kind: 'vessel', id: sel };
    state.sel = sel; state.openKey = null; if (!sel || sel.kind !== 'vessel') state.follow = false;
    cardSig = ''; renderCard(true); uiDirty = true;
    for (const id in vLabels) vLabels[id].e.classList.toggle('sel', sel?.kind === 'vessel' && sel.id === id);
  }

  // ======================================================================= card (selection detail)
  const card = $('card'); let cardSig = '';
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-key],[data-msg]'); if (!b) return;
    if (b.dataset.act === 'close') { select(null); return; }
    if (b.dataset.act === 'follow') { state.follow = !state.follow; if (state.follow) { const p = vesselPos[state.sel.id]; if (p) { const v = { target: [p.x, 0, p.z] }; fly = { t0: performance.now(), dur: 900, fromT: controls.target.clone(), toT: new THREE.Vector3(p.x, 0, p.z), fromP: camera.position.clone(), toP: new THREE.Vector3(p.x - 700, 520, p.z + 650) }; } } cardSig = ''; renderCard(true); return; }
    if (b.dataset.msg) { openJson(b.dataset.msg); return; }
    if (b.dataset.key) { state.openKey = state.openKey === b.dataset.key ? null : b.dataset.key; cardSig = ''; renderCard(true); }
  });
  function statusDetail(c, t, st) {
    const A = S.times[c.id];
    if (st.code === 'exp' || st.code === 'sea') {
      const m = latest(c.id, 'BERTH|ARRI|INBD', 'PLN', t);
      if (c.jit && t >= c.jit.window - c.jit.etaUnconstrained - 4000) return `${c.jit.speedJit} kn instead of ${c.jit.speedFull} kn · PTA berth ${m ? hhmm(m.value) : 'n/a'}`;
      return m ? `PTA berth ${dayTime(m.value)}` : 'No plan yet';
    }
    if (st.code === 'anch') return `Waiting ${hrs(t - A['ANCHORAGE|ARRI|'])} h · PTA berth ${hhmm(latest(c.id, 'BERTH|ARRI|INBD', 'PLN', t)?.value ?? c.pta)}`;
    if (st.code === 'inb' || st.code === 'out') { const tj = S.tugJobs.find((j) => j.call === c.id && t >= j.tMeet && t <= j.tRelease); const pob = S.pilotOnBoard.find((p) => p.call === c.id && t >= p.from && t <= p.to); return [pob ? 'Pilot on board' : (c.pec ? 'Master holds PEC' : 'Pilot not yet on board'), tj ? `${tj.tugs.length} tug${tj.tugs.length > 1 ? 's' : ''} fast` : null].filter(Boolean).join(' · '); }
    if (st.code === 'cargo' || st.code === 'stop') { const d = stopFor(c, t); return `${fmtN(callMoves(c.id, t))} of ${fmtN(callTotal(c))} moves · ${c.cranes.length} cranes${d ? ` · ${d.title}` : ''}`; }
    if (st.code === 'prep') return `All fast ${hhmm(A['ALL_FAST||ALGS'])} · cranes start ${hhmm(A['CARGO_OPERATIONS|STRT|ALGS'])}`;
    if (st.code === 'sail') return `ETD ${hhmm(latest(c.id, 'BERTH|DEPA|OUTB', 'PLN', t)?.value ?? A['BERTH|DEPA|OUTB'])}`;
    return `Sailed ${dayTime(A['BERTH|DEPA|OUTB'])}`;
  }
  function renderCard(force) {
    const s = state.sel; const t = state.t;
    if (!s) { card.hidden = true; return; }
    card.hidden = false;
    let sig, html;
    if (s.kind === 'vessel') {
      const c = CALL[s.id]; const st = callStatus(c, t); const n = sentCount(t);
      sig = `v${s.id}|${n}|${st.label}|${state.openKey}|${Math.floor(t / 5)}|${state.follow}`;
      if (!force && sig === cardSig) return;
      const prevScroll = card.querySelector('.card-body')?.scrollTop || 0;
      const rows = ORDER.filter((k) => msgsBy[c.id][k]);
      let tb = '';
      for (const k of rows) {
        const { type } = parseKey(k); const neg = SVC[type].neg; const any = latest(c.id, k, null, t);
        const cells = ['EST', 'REQ', 'PLN', 'ACT'].map((cls) => {
          if (k === 'MOVES||') { if (cls !== 'EST') return '<td class="c na">·</td>'; const m = latest(c.id, k, 'EST', t); return m ? `<td class="c EST${t - m.sendAt < 20 ? ' fresh' : ''}"><b>${fmtN(m.moves.dis + m.moves.load + m.moves.rst)}</b></td>` : '<td class="c"></td>'; }
          if (!neg && cls !== 'ACT') return '<td class="c na">·</td>';
          const m = latest(c.id, k, cls, t); if (!m) return '<td class="c"></td>';
          const cnt = cls === 'EST' ? msgsBy[c.id][k].filter((x) => x.cls === 'EST' && x.sendAt <= t).length : 0;
          const dd = SIM.dayIdx(m.value) !== SIM.dayIdx(t) ? `<span class="dy">${SIM.dayName(m.value)}</span>` : '';
          return `<td class="c ${cls}${t - m.sendAt < 20 ? ' fresh' : ''}">${dd}<b>${hhmm(m.value)}</b>${cnt > 1 ? `<sup>${cnt}</sup>` : ''}</td>`;
        }).join('');
        const code = k.split('|').filter(Boolean).join(' · ');
        tb += `<tr class="row${any ? '' : ' future'}${state.openKey === k ? ' open' : ''}" data-key="${k}" tabindex="0"><td class="svc">${esc(rowLabel(k))}<span class="code">${code}</span></td>${cells}</tr>`;
        if (state.openKey === k) {
          const hist = msgsBy[c.id][k].filter((m) => m.sendAt <= t);
          tb += `<tr class="hist"><td colspan="5"><div class="hist-list">${hist.length ? hist.map((m) => `<button type="button" data-msg="${m.id}"><span class="cls ${m.cls}">${m.cls[0]}</span><span class="mono">${dayTime(m.sendAt)}</span><span class="who">${m.value != null ? `<b class="mono">${cellTime(m.value, m.sendAt)}</b> · ` : ''}${SHORT[m.from]} → ${SHORT[m.to]}${m.remark ? ` · ${esc(m.remark)}` : ''}</span></button>`).join('') : '<span class="who">Nothing sent yet.</span>'}</div></td></tr>`;
        }
      }
      const pob = S.pilotOnBoard.find((p) => p.call === c.id && t >= p.from && t <= p.to);
      html = `<div class="card-head"><div><div class="eyebrow">${esc(PARTIES[c.carrier].name)} · ${esc(c.serviceName)} · ${c.voyIn}${c.voyOut !== c.voyIn ? ' / ' + c.voyOut : ''}</div><h2>${esc(c.name)}</h2></div>
        <div class="acts"><button class="btn" type="button" data-act="follow" aria-pressed="${state.follow}">Follow</button><button class="btn icon" type="button" data-act="close" aria-label="Close">×</button></div>
        <div class="sub">${c.loa} m · ${c.beam} m beam · ${fmtN(c.teu)} TEU${c.fictional ? ' · fictional vessel' : ''}</div></div>
        <div class="card-body">
          <div class="status-line"><span class="pill ${st.cls}">${esc(st.label)}</span><span>${esc(statusDetail(c, t, st))}</span></div>
          <p class="story">${esc(c.story)}</p>
          <table class="erpa"><thead><tr><th>Service event</th><th class="c" title="Estimated">E</th><th class="c" title="Requested">R</th><th class="c" title="Planned">P</th><th class="c" title="Actual">A</th></tr></thead><tbody>${tb}</tbody></table>
          <p class="story">Latest value per classifier as sent by ${esc(dayTime(t))}. Small numbers count estimate revisions. Tap a row for its messages and payloads.</p>
        </div>`;
      cardSig = sig; card.innerHTML = html; const body = card.querySelector('.card-body'); if (body) body.scrollTop = prevScroll; return;
    }
    // other objects
    let title = '', eyebrow = '', kv = [], story = '';
    if (s.kind === 'crane') {
      const k = craneById[s.id]; const cs = craneAt(s.id, t);
      eyebrow = k.idle ? 'Ship-to-shore crane · other Delta berth' : k.type === 'STS' ? 'Ship-to-shore crane · remote operated' : 'Feeder and barge crane'; title = s.id;
      const stl = { work: 'Working', stop: 'Stopped', ready: 'Positioned, waiting for cargo ops', done: 'Finished', idle: 'Idle, boom up' }[cs.state];
      kv.push(['Status', stl], ['Outreach', `${k.outreach} m`]); if (k.year) kv.push(['Delivered', String(k.year)]);
      if (cs.a) { const c = CALL[cs.a.call]; kv.push(['Vessel', c.name], ['Moves', `${fmtN(cs.m)} of ${fmtN(cs.a.total)}`], ['Gross rate', `${cs.a.rate.toFixed(1)} moves/h`], ['Started', dayTime(cs.a.tStart)], ['Expected finish', dayTime(cs.a.tEnd)]); if (cs.kind) kv.push(['Now', { DIS: 'Discharging', RST: 'Restows', LOAD: 'Loading', STOP: 'Stopped' }[cs.kind]]); }
      const d = DISRUPTIONS.find((x) => t >= x.start && t < x.end && (x.cranes === 'ALL' || x.cranes.includes(s.id))); if (d) story = `${d.title}. ${d.detail}`;
      if (k.idle) story = 'Western part of the Amazonehaven quay. Not modelled, so it takes no vessel in this simulation.';
      sig = `c${s.id}|${Math.floor(cs.m)}|${cs.state}`;
    } else if (s.kind === 'agv') {
      const a = agvState[s.id]; title = s.id >= N_AGV ? `Straddle carrier ${s.id - N_AGV + 1}` : `AGV ${String(s.id + 1).padStart(2, '0')}`; eyebrow = s.id >= N_AGV ? 'Feeder terminal transport' : 'Automated guided vehicle';
      kv.push(['Serving', a?.crane || 'n/a'], ['Vessel', a?.call ? CALL[a.call].name : 'n/a'], ['Load', a?.carry ? 'Carrying a container' : 'Empty'], ['State', a?.parked ? 'Parked' : a?.stopped ? 'Holding, crane stopped' : a?.moving ? 'Driving' : 'At handover']);
      sig = `a${s.id}|${a?.carry}|${a?.moving}|${a?.stopped}`;
    } else if (s.kind === 'tug') {
      const tg = tugs[s.id]; title = `Tug ${s.id.slice(1)}`; eyebrow = PARTIES.TUG.name; kv.push(['Now', tg.pose?.st || 'At base']);
      const jobs = S.tugJobs.filter((j) => j.tugs.includes(s.id) && j.t0 >= -60 && j.t0 <= WINDOW); kv.push(['Jobs in window', String(jobs.length)]);
      jobs.forEach((j) => kv.push([`${dayTime(j.tMeet)}`, `${CALL[j.call].name} ${j.phase === 'INBD' ? 'inbound' : 'outbound'}`]));
      sig = `t${s.id}|${tg.pose?.st}`;
    } else if (s.kind === 'heli') { title = 'Pilot helicopter'; eyebrow = PARTIES.PILOT.name; kv.push(['Now', heli.pose?.st]); S.heli.filter((f) => f.t1 >= -60 && f.t1 <= WINDOW).forEach((f) => kv.push([dayTime(f.t1), `${f.kind === 'board' ? 'Pilot boards' : 'Pilot leaves'} ${CALL[f.call].name}`])); story = 'Deep-draught vessels take their pilot by helicopter before the Eurogeul.'; sig = `h|${heli.pose?.st}`; }
    else if (s.kind === 'tender') { title = 'Pilot tender'; eyebrow = PARTIES.PILOT.name; kv.push(['Now', tender.pose?.st]); S.tender.filter((f) => f.t1 >= -60 && f.t1 <= WINDOW).forEach((f) => kv.push([dayTime(f.t1), `${f.kind === 'board' ? 'Pilot boards' : 'Pilot leaves'} ${CALL[f.call].name}`])); sig = `p|${tender.pose?.st}`; }
    else if (s.kind === 'moor') { title = `Mooring crew ${s.id.slice(1)}`; eyebrow = PARTIES.MOOR.name; kv.push(['Now', krve[s.id].pose?.st], ['Crew', 'Boat with 2 boatmen, 4 linesmen ashore']); S.moorJobs.filter((j) => j.crew === s.id && j.t0 >= -60 && j.t0 <= WINDOW).forEach((j) => kv.push([dayTime(j.t0), `${j.phase === 'INBD' ? 'Mooring' : 'Unmooring'} ${CALL[j.call].name}`])); sig = `m${s.id}|${krve[s.id].pose?.st}`; }
    else if (s.kind === 'bunker') { title = 'Bunker barge'; eyebrow = PARTIES.BUNK.name; kv.push(['Now', bunkerV.pose?.st]); const j = S.bunker[0]; if (j) { const done = clamp((t - j.start) / (j.end - j.start), 0, 1) * j.qty; kv.push(['Job', `${CALL[j.call].name}, ${dayTime(j.start)} to ${hhmm(j.end)}`], ['Transferred', `${fmtN(done)} of ${fmtN(j.qty)} t ${j.product}`]); } story = 'Barge-to-ship bunkering on the water side while cranes work the other side.'; sig = `b|${bunkerV.pose?.st}|${Math.floor(t)}`; }
    else if (s.kind === 'sludge') { title = 'Sludge barge'; eyebrow = PARTIES.SLDG.name; kv.push(['Now', sludgeV.pose?.st]); S.sludge.forEach((j) => kv.push([dayTime(j.start), CALL[j.call].name])); sig = `s|${sludgeV.pose?.st}`; }
    if (!force && sig === cardSig) return;
    html = `<div class="card-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2></div><div class="acts"><button class="btn icon" type="button" data-act="close" aria-label="Close">×</button></div></div>
      <div class="card-body"><dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? 'n/a')}</dd>`).join('')}</dl>${story ? `<p class="story">${esc(story)}</p>` : ''}</div>`;
    cardSig = sig; card.innerHTML = html;
  }

  // ======================================================================= JSON drawer
  const jsonEl = $('json'); let jsonText = '';
  function highlight(json) {
    return esc(json).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g, (m, str, colon, bool) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (bool) return `<span class="b">${m}</span>`; return `<span class="n">${m}</span>`;
    });
  }
  function openJson(id) {
    const m = msgById[id]; if (!m) return; const c = CALL[m.call];
    const payload = [SIM.eventPayload(m)]; jsonText = JSON.stringify(payload, null, 2);
    $('json-title').textContent = codeName(m.key, m.cls);
    $('json-sub').textContent = `${c.name} · sent ${dayTime(m.sendAt)}${m.value != null ? ` · service time ${dayTime(m.value)}` : ''}`;
    $('json-req').textContent = `POST /events\nAPI-Version: 2.0.0\nRequest-Sending-Party: ${PARTIES[m.from].name}\nRequest-Receiving-Party: ${PARTIES[m.to].name}${m.cc?.length ? `\nAlso informed: ${m.cc.map((p) => PARTIES[p].name).join(', ')}` : ''}`;
    $('json-pre').innerHTML = highlight(jsonText);
    jsonEl.hidden = false; $('json-close').focus();
  }
  $('json-close').addEventListener('click', () => { jsonEl.hidden = true; });
  $('json-copy').addEventListener('click', () => {
    const b = $('json-copy');
    const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($('json-pre')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
    try { navigator.clipboard.writeText(jsonText).then(done, fallback); } catch (e) { fallback(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !jsonEl.hidden) { jsonEl.hidden = true; return; }
    if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement?.tagName || '')) { e.preventDefault(); togglePlay(); }
  });

  // ======================================================================= timeline, gantt, moments
  const ORDERED = [...CALLS].sort((a, b) => S.times[a.id]['BERTH|ARRI|INBD'] - S.times[b.id]['BERTH|ARRI|INBD']);
  const pct = (t) => `${(clamp(t, 0, WINDOW) / WINDOW) * 100}%`;
  const gantt = $('gantt');
  function buildGantt() {
    let h = '<div class="g-axis"><span></span><div class="ticks">';
    for (let k = 0; k <= 48; k += 6) { const t = k * 60; if (k === 48) continue; h += `<span class="${k % 12 ? 'minor' : ''}" style="left:${pct(t)}">${t % 1440 === 0 ? SIM.dayName(t) : hhmm(t)}</span>`; }
    h += '</div></div>';
    for (const c of ORDERED) {
      const A = S.times[c.id]; const tr = S.tracks[c.id]; const segs = [];
      const seg = (a, b, cls) => { if (a === undefined || b === undefined) return; const x0 = clamp(a, 0, WINDOW), x1 = clamp(b, 0, WINDOW); if (x1 <= x0) return; segs.push(`<i class="seg ${cls}" style="left:${pct(x0)};width:${((x1 - x0) / WINDOW) * 100}%"></i>`); };
      const firstStop = A['ANCHORAGE|ARRI|'] ?? A['SEA_PASSAGE|CMPL|INBD'];
      seg(tr[0].t, firstStop, 'sea');
      if (A['ANCHORAGE|ARRI|'] !== undefined) { seg(A['ANCHORAGE|ARRI|'], A['ANCHORAGE|DEPA|'], 'anch'); seg(A['ANCHORAGE|DEPA|'], A['SEA_PASSAGE|CMPL|INBD'], 'sea'); }
      seg(A['SEA_PASSAGE|CMPL|INBD'], A['ALL_FAST||ALGS'], 'naut');
      seg(A['ALL_FAST||ALGS'], A['BERTH|DEPA|OUTB'], 'berth');
      seg(A['CARGO_OPERATIONS|STRT|ALGS'], A['CARGO_OPERATIONS|CMPL|ALGS'], 'cargo');
      for (const d of DISRUPTIONS) if (c.cranes.some((k) => d.cranes === 'ALL' || d.cranes.includes(k))) seg(Math.max(d.start, A['CARGO_OPERATIONS|STRT|ALGS']), Math.min(d.end, A['CARGO_OPERATIONS|CMPL|ALGS']), 'stop');
      seg(A['BERTH|DEPA|OUTB'], A['SEA_PASSAGE|STRT|OUTB'], 'naut');
      seg(A['SEA_PASSAGE|STRT|OUTB'], tr[tr.length - 1].t, 'sea');
      let marks = '';
      if (c.pta >= 0 && c.pta <= WINDOW) marks += `<i class="mark" style="left:${pct(c.pta)}" title="PTA berth ${hhmm(c.pta)}"></i>`;
      if (c.jit && c.jit.etaUnconstrained >= 0) marks += `<i class="mark etau" style="left:${pct(c.jit.etaUnconstrained)}" title="ETA at full speed ${hhmm(c.jit.etaUnconstrained)}"></i>`;
      h += `<div class="g-row"><button type="button" class="g-name" data-call="${c.id}">${esc(c.name)}</button><div class="g-track" data-track>${segs.join('')}${marks}</div></div>`;
    }
    h += '<div class="g-area" id="g-area">';
    for (const d of DISRUPTIONS) h += `<i class="g-dis" style="left:${pct(d.start)};width:${((d.end - d.start) / WINDOW) * 100}%"></i>`;
    h += '<i class="g-ph" id="g-ph"></i></div>';
    gantt.innerHTML = h;
    const nameCol = getComputedStyle(gantt.querySelector('.g-row')).gridTemplateColumns.split(' ')[0];
    $('g-area').style.left = nameCol;
  }
  buildGantt();
  window.addEventListener('resize', () => { const r = gantt.querySelector('.g-row'); if (r) $('g-area').style.left = getComputedStyle(r).gridTemplateColumns.split(' ')[0]; });
  let scrub = false;
  const scrubTo = (e) => { const a = $('g-area').getBoundingClientRect(); const u = clamp((e.clientX - a.left) / a.width, 0, 1); state.t = u * WINDOW; uiDirty = true; };
  gantt.addEventListener('pointerdown', (e) => { if (e.target.closest('.g-name')) return; if (!e.target.closest('[data-track],.g-axis')) return; scrub = true; gantt.setPointerCapture(e.pointerId); scrubTo(e); });
  gantt.addEventListener('pointermove', (e) => { if (scrub) scrubTo(e); });
  gantt.addEventListener('pointerup', () => { scrub = false; });
  gantt.addEventListener('click', (e) => { const b = e.target.closest('.g-name'); if (b) { select({ kind: 'vessel', id: b.dataset.call }); if (vesselPos[b.dataset.call]) { state.follow = false; setView(viewFor(vesselPos[b.dataset.call])); } } });

  const momentsEl = $('moments');
  momentsEl.innerHTML = MOMENTS.map((m, i) => `<button type="button" data-i="${i}"><span>${SIM.dayName(m.t).slice(0, 2)} ${hhmm(m.t)}</span>${esc(m.label)}</button>`).join('');
  momentsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const m = MOMENTS[+b.dataset.i];
    state.t = m.t; select(m.sel);
    if (m.view === 'follow') { state.follow = true; updateScene(state.t, 0); const p = vesselPos[m.sel]; if (p) fly = { t0: performance.now(), dur: 1100, fromT: controls.target.clone(), toT: new THREE.Vector3(p.x, 0, p.z), fromP: camera.position.clone(), toP: new THREE.Vector3(p.x - 1500, 1100, p.z + 1300) }; state.view = 'follow'; document.querySelectorAll('#views button').forEach((x) => x.setAttribute('aria-pressed', 'false')); }
    else { updateScene(state.t, 0); setView(m.view); }
    if (!state.playing) togglePlay(); cardSig = ''; uiDirty = true;
  });
  document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => { state.follow = false; cardSig = ''; setView(b.dataset.view); }));
  document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => { state.speed = +b.dataset.speed; document.querySelectorAll('.speed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  const playBtn = $('play');
  const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>', ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
  function updatePlay() { playBtn.innerHTML = state.playing ? ICON_PAUSE : ICON_PLAY; playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play'); }
  function togglePlay() { if (!state.playing && state.t >= WINDOW - 0.1) state.t = 0; state.playing = !state.playing; updatePlay(); }
  playBtn.addEventListener('click', togglePlay);
  updatePlay();

  // ======================================================================= side panels
  let uiDirty = true;
  const vlist = $('vlist');
  vlist.innerHTML = ORDERED.map((c) => `<button type="button" class="vrow" data-call="${c.id}"><span class="n">${esc(c.name)}</span><span class="pill"></span><span class="s"></span><span class="nx"></span><span class="bar"><i style="width:0"></i></span></button>`).join('');
  vlist.addEventListener('click', (e) => { const b = e.target.closest('.vrow'); if (!b) return; const id = b.dataset.call; select({ kind: 'vessel', id }); const p = vesselPos[id]; if (p) setView(viewFor(p)); });
  const feedEl = $('feed');
  feedEl.addEventListener('click', (e) => { const b = e.target.closest('[data-msg]'); if (b) openJson(b.dataset.msg); });
  let feedSig = '';
  function updateUI() {
    const t = state.t;
    $('clock-d').textContent = SIM.longDate(t); $('clock-t').textContent = hhmm(t);
    $('g-ph').style.left = pct(t);
    gantt.querySelectorAll('.g-name').forEach((b) => b.classList.toggle('sel', state.sel?.kind === 'vessel' && state.sel.id === b.dataset.call));
    // vessel labels + list
    let inPort = 0;
    for (const c of ORDERED) {
      const st = callStatus(c, t); const row = vlist.querySelector(`[data-call="${c.id}"]`);
      if (!['exp', 'gone'].includes(st.code)) inPort++;
      const pill = row.querySelector('.pill'); pill.className = 'pill ' + st.cls; pill.textContent = st.label;
      row.querySelector('.s').textContent = `${PARTIES[c.carrier].name} · ${c.serviceName}`;
      const nx = nextEvent(c, t); row.querySelector('.nx').textContent = nx ? `${codeName(nx.key, nx.cls)} ${cellTime(nx.value, t)}` : '';
      const pr = st.code === 'cargo' || st.code === 'stop' ? st.pct : ['sail', 'out', 'gone'].includes(st.code) ? 100 : 0;
      const bar = row.querySelector('.bar i'); bar.style.width = pr + '%'; bar.style.background = st.code === 'stop' ? 'var(--crit)' : '';
      row.classList.toggle('sel', state.sel?.kind === 'vessel' && state.sel.id === c.id);
      vLabels[c.id].e.querySelector('small').textContent = st.label;
    }
    $('v-meta').textContent = `${inPort} in the port call now`;
    // JIT panel
    const dayStart = Math.floor(t / 1440) * 1440; const n = sentCount(t); const n0 = sentCount(t - 1440);
    $('j-sent').textContent = fmtN(n - n0);
    let open = 0;
    for (const c of CALLS) for (const k in msgsBy[c.id]) { if (!SVC[parseKey(k).type].neg) continue; const m = latest(c.id, k, null, t); if (m && (m.cls === 'EST' || m.cls === 'REQ')) open++; }
    $('j-open').textContent = open;
    let lastArr = null; for (const c of CALLS) { const m = latest(c.id, 'BERTH|ARRI|INBD', 'ACT', t); if (m && (!lastArr || m.value > lastArr.m.value)) lastArr = { c, m }; }
    if (lastArr) { const p = latest(lastArr.c.id, 'BERTH|ARRI|INBD', 'PLN', lastArr.m.sendAt); const d = Math.round(lastArr.m.value - (p ? p.value : lastArr.c.pta)); $('j-acc').innerHTML = `${d > 0 ? '+' : ''}${d}<small>min</small>`; $('j-acc-k').textContent = `ATA vs PTA · ${lastArr.c.name}`; }
    const counts = { EST: 0, REQ: 0, PLN: 0, ACT: 0 }; for (let i = n0; i < n; i++) counts[S.messages[i].cls]++;
    const tot = Math.max(1, n - n0);
    $('j-bar').innerHTML = ['EST', 'REQ', 'PLN', 'ACT'].map((k) => `<i style="width:${(counts[k] / tot) * 100}%;background:var(--${k[0].toLowerCase()})"></i>`).join('');
    $('j-legend').innerHTML = [['EST', 'Estimated'], ['REQ', 'Requested'], ['PLN', 'Planned'], ['ACT', 'Actual']].map(([k, l]) => `<span><i style="background:var(--${k[0].toLowerCase()})"></i>${l} ${counts[k]}</span>`).join('');
    const bw = S.anchorWait.BW; const bwSoFar = clamp(t - bw.from, 0, bw.to - bw.from);
    $('j-out').innerHTML = `<div class="outcome good"><div class="v">${hrs(S.outcomes.IR.anchorAvoided)} h</div><div class="k">at anchor avoided. ${esc(CALL.IR.name)} slowed to ${CALL.IR.jit.speedJit} kn after the terminal requested 14:00.</div></div>
      <div class="outcome warn"><div class="v">${hrs(bwSoFar)} h</div><div class="k">at anchor${bwSoFar < bw.to - bw.from ? ' so far' : ''}. Baltic Wren sent its first estimate 5 h out.</div></div>`;
    // quay: the modelled part of the Amazonehaven quay (left) and the feeder terminal (right)
    let working = 0, rate = 0; let strip = '';
    const SEG = { Q: { s0: 1150, s1: 2380, l0: 0, l1: 76 }, F: { s0: 0, s1: QUAYS.F.len, l0: 80, l1: 100 } };
    const zp = (q, v) => { const g = SEG[q]; return g.l0 + ((v - g.s0) / (g.s1 - g.s0)) * (g.l1 - g.l0); };
    strip += `<i class="wall" style="left:0;right:24%"></i><i class="wall" style="left:80%;right:0"></i><span class="zone" style="left:0">Amazonehaven</span><span class="zone" style="left:80%">DBFT</span>`;
    for (const c of CALLS) {
      const p = vesselPos[c.id]; const bi = S.info[c.id]; if (!p || Math.hypot(p.x - bi.pos[0], p.z - bi.pos[1]) > 260) continue;
      const g = SEG[bi.q]; const w = ((c.loa / (g.s1 - g.s0)) * (g.l1 - g.l0));
      strip += `<i class="ship${c.size === 'FEEDER' ? ' feeder' : ''}" style="left:${zp(bi.q, bi.sc) - w / 2}%;width:${w}%" title="${esc(c.name)}"></i>`;
    }
    let nCr = 0;
    for (const k of CRANES) { if (k.idle) continue; nCr++; const cs = craneAt(k.id, t); if (cs.state === 'work') { working++; rate += cs.a.rate; } strip += `<i class="cr ${cs.state === 'work' ? 'work' : cs.state === 'stop' ? 'stop' : ''}" style="left:${zp(k.q, cs.z)}%" title="${k.id}"></i>`; }
    $('q-strip').innerHTML = strip;
    $('q-cranes').innerHTML = `${working}<small>/ ${nCr}</small>`;
    $('q-rate').textContent = fmtN(rate);
    $('q-moves').textContent = fmtN(cumMoves(t) - cumMoves(dayStart));
    $('q-meta').textContent = '11 ULCS cranes · 3 feeder cranes';
    const hNow = Math.floor((t - HB0) / 60); let sp = ''; let mx = 1; for (let i = hNow - 23; i <= hNow; i++) mx = Math.max(mx, hourly[i] || 0);
    for (let i = hNow - 23; i <= hNow; i++) { let v = hourly[i] || 0; if (i === hNow) v = cumMoves(t) - cumMoves(HB0 + i * 60); sp += `<i class="${i === hNow ? 'now' : ''}" style="height:${(v / mx) * 100}%" title="${hhmm(HB0 + i * 60)} · ${fmtN(v)} moves"></i>`; }
    $('q-spark').innerHTML = sp;
    // nautical
    const tugBusy = Object.values(tugs).map((tg) => tg.pose?.job ? (t >= tg.pose.job.tMeet && t <= tg.pose.job.tRelease ? 'tow' : 'busy') : '');
    const nTow = tugBusy.filter((x) => x === 'tow').length, nBusy = tugBusy.filter(Boolean).length;
    const pobs = S.pilotOnBoard.filter((p) => t >= p.from && t <= p.to);
    const moorNow = S.moorJobs.filter((j) => t >= j.t0 && t <= j.t1);
    const rows = [
      ['Tugs', `<div class="cells">${tugBusy.map((x) => `<i class="${x}"></i>`).join('')}</div><div style="font-size:11.5px;color:var(--muted);margin-top:3px">${nTow} towing · ${nBusy - nTow} in transit · ${8 - nBusy} at base</div>`],
      ['Pilots on board', pobs.length ? pobs.map((p) => `${esc(CALL[p.call].name)} <span style="color:var(--muted)">${p.phase === 'INBD' ? 'inbound' : 'outbound'}</span>`).join('<br>') : '<span style="color:var(--muted)">None</span>'],
      ['Helicopter', esc(heli.pose?.st || 'On the pad')],
      ['Pilot tender', esc(tender.pose?.st || '')],
      ['Mooring crews', moorNow.length ? moorNow.map((j) => `${j.phase === 'INBD' ? 'Mooring' : 'Unmooring'} ${esc(CALL[j.call].name)}`).join('<br>') : '<span style="color:var(--muted)">3 of 3 available</span>'],
      ['Bunkering', esc(bunkerV.pose?.st || 'Waiting')],
    ];
    $('n-rows').innerHTML = rows.map(([k, v]) => `<div><span class="k">${k}</span><span>${v}</span></div>`).join('');
    // people
    const cranesStaffed = CRANES.filter((k) => ['work', 'stop'].includes(craneAt(k.id, t).state)).length;
    let lashers = 0; for (const c of CALLS) { const A = S.times[c.id]; const s0 = A['CARGO_OPERATIONS|STRT|ALGS'], s1 = A['CARGO_OPERATIONS|CMPL|ALGS'], s2 = A['LASHING|CMPL|ALGS']; if ((t >= s0 - 20 && t < s0 + 90) || (t >= s1 - 120 && t < s2)) lashers += c.size === 'ULCV' ? 14 : 6; else if (t >= s0 && t < s1) lashers += c.size === 'ULCV' ? 4 : 2; }
    const ppl = [['Pilots on board', pobs.length], ['Tug crews', nBusy * 4], ['KRVE boatmen and linesmen', moorNow.length * 6], ['Lashers on deck', lashers], ['Remote crane operators', cranesStaffed], ['Helicopter crew', heli.pose?.fly ? 2 : 0], ['Bunker vessel crew', bunkerV.pose?.job ? 7 : 0]];
    const totalP = ppl.reduce((s, x) => s + x[1], 0);
    $('pp-meta').textContent = `${totalP} on port call services`;
    $('pp-rows').innerHTML = ppl.map(([k, v]) => `<div><span class="k">${k}</span><span class="mono">${v}</span></div>`).join('');
    // alerts
    $('alerts').innerHTML = ALERTS.filter((a) => a.t <= t).slice(0, 6).map((a) => `<div class="alert ${a.sev}${a.end && t < a.end ? ' active' : ''}"><div class="h">${esc(a.title)}<span>${SIM.dayName(a.t).slice(0, 2)} ${hhmm(a.t)}</span></div><p>${esc(a.text)}</p></div>`).join('') || '<p class="story">No alerts yet.</p>';
    // feed
    const fs = `${n}|${Math.floor(t / 5)}`;
    if (fs !== feedSig) {
      feedSig = fs; const list = S.messages.slice(Math.max(0, n - 40), n).reverse();
      feedEl.innerHTML = list.map((m) => { const c = CALL[m.call]; return `<button type="button" data-msg="${m.id}" class="${t - m.sendAt < 15 ? 'new' : ''}"><span class="cls ${m.cls}">${m.cls[0]}</span><span class="c1"><span>${esc(codeName(m.key, m.cls))}</span> · ${esc(c.name)}</span><span class="val">${m.value != null ? cellTime(m.value, t) : m.moves ? fmtN(m.moves.dis + m.moves.load + m.moves.rst) + ' moves' : ''}</span><span class="c2">${SIM.dayName(m.sendAt).slice(0, 2)} ${hhmm(m.sendAt)} · ${SHORT[m.from]} → ${SHORT[m.to]}${m.remark ? ' · ' + esc(m.remark) : ''}</span></button>`; }).join('');
    }
    renderCard(false);
  }

  // ======================================================================= loop
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(stage);
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  let last = performance.now(), uiAcc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (state.playing) { state.t += dt * state.speed; if (state.t >= WINDOW) { state.t = WINDOW; state.playing = false; updatePlay(); } }
    updateScene(state.t, now / 1000);
    if (fly) { const u = smooth(clamp((now - fly.t0) / fly.dur, 0, 1)); controls.target.lerpVectors(fly.fromT, fly.toT, u); camera.position.lerpVectors(fly.fromP, fly.toP, u); if (u >= 1) fly = null; }
    else followVessel();
    controls.update();
    const d = camera.position.distanceTo(controls.target); scene.fog.near = d * 1.8; scene.fog.far = d * 6.5;
    renderer.render(scene, camera);
    updateLabels();
    uiAcc += dt; if (uiAcc > 0.25 || uiDirty) { uiAcc = 0; uiDirty = false; updateUI(); }
    requestAnimationFrame(frame);
  }
  function start(data) {
    if (data && data.t != null) { state.t = data.t; state.speed = data.speed || state.speed; }
    resize(); setView(data?.view && VIEWS[data.view] ? data.view : 'terminal', true);
    if (data?.sel) select(data.sel); else if (window.innerWidth >= 900) select({ kind: 'vessel', id: 'IR' });
    document.querySelectorAll('.speed button').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.speed === state.speed)));
    requestAnimationFrame((n) => { last = n; frame(n); });
  }
  // hooks for scripted recordings: refresh panels now, and find an object's position on screen
  window.__portcall = {
    state, camera, controls, setView, select,
    refresh: () => { uiDirty = true; },
    screen: (kind, id) => {
      let p = null;
      if (kind === 'crane') { const k = cranes[id]; p = k.g.localToWorld(new THREE.Vector3(40, k.by, 0)); }
      else if (kind === 'vessel' && vesselPos[id]) p = new THREE.Vector3(vesselPos[id].x, 18, vesselPos[id].z);
      else if (kind === 'tug') p = tugs[id].g.position.clone();
      else if (kind === 'heli') p = heli.g.position.clone();
      else if (kind === 'bunker') p = bunkerV.g.position.clone();
      else if (kind === 'agv') {
        // prefer an AGV out in the lanes, clear of the crane structures
        const m = new THREE.Matrix4(); let best = -1, bx = -1;
        agvState.forEach((a, i) => { if (!a || a.crane !== id || a.parked) return; agvBody.getMatrixAt(i, m); const x = new THREE.Vector3().setFromMatrixPosition(m).x; if (x > bx) { bx = x; best = i; } });
        if (best < 0) return null; window.__lastAgv = best; agvBody.getMatrixAt(best, m); p = new THREE.Vector3().setFromMatrixPosition(m); p.y = 3;
      }
      if (!p) return null;
      const r = canvas.getBoundingClientRect(); p.project(camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
  };
  const hot = window.claude?.hot;
  if (hot?.snapshot) hot.snapshot(() => ({ t: state.t, sel: state.sel, view: state.view, speed: state.speed }));
  if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});
})();
