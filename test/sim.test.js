const SIM = require('../src/sim.js');
const S = SIM.build();
const fmt = (t) => (t === undefined ? '   --   ' : `${SIM.dayName(t)} ${SIM.hhmm(t)}`);
let fail = 0; const check = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };
for (const c of SIM.CALLS) {
  const A = S.times[c.id];
  console.log(`\n== ${c.name} (${c.id})`);
  const keys = SIM.ORDER.filter((k) => A[k] !== undefined);
  for (const k of keys) console.log('  ', fmt(A[k]), k);
  // sequence sanity: ordered inbound and outbound phases
  const seq = ['PILOT_BOARDING_PLACE|ARRI|INBD', 'TOWAGE|STRT|INBD', 'MOORING|STRT|INBD', 'BERTH|ARRI|INBD', 'ALL_FAST||ALGS', 'CARGO_OPERATIONS|STRT|ALGS', 'CARGO_OPERATIONS|CMPL|ALGS', 'LASHING|CMPL|ALGS', 'VESSEL_READY_TO_SAIL||ALGS', 'MOORING|STRT|OUTB', 'BERTH|DEPA|OUTB', 'TOWAGE|CMPL|OUTB', 'SEA_PASSAGE|STRT|OUTB'].filter((k) => A[k] !== undefined);
  for (let i = 1; i < seq.length; i++) check(A[seq[i]] >= A[seq[i - 1]], `${c.id} order ${seq[i - 1]} -> ${seq[i]}`);
  if (!c.prevCall) check(Math.abs(A['BERTH|ARRI|INBD'] - c.pta) <= 6, `${c.id} ATA berth equals PTA (${fmt(A['BERTH|ARRI|INBD'])})`);
  const tr = S.tracks[c.id]; for (let i = 1; i < tr.length; i++) check(tr[i].t >= tr[i - 1].t, `${c.id} track sorted`);
  for (const p of tr) check(Number.isFinite(p.h), `${c.id} heading finite at ${p.t}`);
}
// berth conflicts
const occ = SIM.CALLS.map((c) => ({ c, b: c.berth, a: S.times[c.id]['BERTH|ARRI|INBD'] - 30, d: S.times[c.id]['BERTH|DEPA|OUTB'] + 20 }));
for (const x of occ) for (const y of occ) if (x !== y && x.b === y.b && x.a < y.d && y.a < x.d) check(false, `berth overlap ${x.c.id}/${y.c.id}`);
// vessel encounters: hull centres closer than 130 m, or two vessels under way in the Amazonehaven at once
const pos = (tr, t) => { if (t < tr[0].t || t > tr[tr.length - 1].t) return null; let i = 1; while (tr[i].t < t) i++; const a = tr[i - 1], b = tr[i]; const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t); return [a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u]; };
for (let t = -600; t <= 3000; t += 1) {
  for (let i = 0; i < SIM.CALLS.length; i++) for (let j = i + 1; j < SIM.CALLS.length; j++) {
    const a = SIM.CALLS[i], b = SIM.CALLS[j]; const pa = pos(S.tracks[a.id], t), pb = pos(S.tracks[b.id], t); if (!pa || !pb) continue;
    const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]); const atA = Math.hypot(pa[0] - S.info[a.id].pos[0], pa[1] - S.info[a.id].pos[1]) < 2, atB = Math.hypot(pb[0] - S.info[b.id].pos[0], pb[1] - S.info[b.id].pos[1]) < 2;
    const inBasin = (p, at) => !at && p[0] < 0 && p[0] > -320 && p[1] < 2660;
    if ((d < 130 && !(atA && atB)) || (inBasin(pa, atA) && inBasin(pb, atB))) check(false, `encounter ${a.id}/${b.id} at ${fmt(t)} d=${d.toFixed(0)}`);
  }
}
// crane conflicts
for (const id in S.craneTracks) { const as = S.craneTracks[id].assign; for (let i = 1; i < as.length; i++) check(as[i].tStart > as[i - 1].tEnd, `crane ${id} double booked`); }
// every service's last estimate or plan before its actual is within 30 min of it (no stale values left behind)
for (const c of SIM.CALLS) for (const k of Object.keys(S.times[c.id])) {
  const l = S.messages.filter((m) => m.call === c.id && m.key === k && m.cls !== 'ACT' && m.value != null);
  if (l.length) check(Math.abs(l[l.length - 1].value - S.times[c.id][k]) <= 30, `${c.id} ${k} last estimate ${fmt(l[l.length - 1].value)} vs actual ${fmt(S.times[c.id][k])}`);
}
// next port: sails after the previous call, passes Vlissingen inside the tidal window, talks to Antwerp parties only
const ANRP = new Set(['MSC', 'MPET', 'PORTA', 'PILOTA', 'TUGA', 'MOORA', 'LASH']); // lashing is a generic party
for (const c of SIM.CALLS.filter((x) => x.prevCall)) {
  const A = S.times[c.id], P = S.times[c.prevCall]; const tw = S.tideInfo[c.id];
  check(A['SEA_PASSAGE|CMPL|INBD'] >= P['SEA_PASSAGE|STRT|OUTB'] + c.passage - 1, `${c.id} arrives after the passage from the previous port`);
  check(tw && A['SEA_PASSAGE|CMPL|INBD'] + 105 >= tw.start && A['SEA_PASSAGE|CMPL|INBD'] + 105 <= tw.end, `${c.id} passes Vlissingen inside the tidal window`);
  check(S.outcomes[c.id].ripple > 300, `${c.id} ripple from the previous port (${S.outcomes[c.id].ripple} min)`);
  for (const m of S.messages.filter((x) => x.call === c.id)) check(ANRP.has(m.from) && ANRP.has(m.to) && (m.cc || []).every((x) => ANRP.has(x)), `${c.id} message between Antwerp parties ${m.from} -> ${m.to}`);
  // the track stays on the water: inside a mapped water area or off the coast
  const G = require('../src/geo-anr-data.js');
  const inside = (pt, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) r = !r; } return r; };
  const wet = (pt) => !inside(pt, G.land) || G.water.some((w) => inside(pt, w));
  const tr = S.tracks[c.id]; let dry = 0;
  for (let t = tr[0].t; t <= tr[tr.length - 1].t; t += 2) { const p = pos(tr, t); if (p && !wet(p)) dry++; }
  check(dry === 0, `${c.id} track on the water (${dry} dry samples)`);
}
// no Maersk or APM anywhere in the sources
const fs = require('fs'), path = require('path');
for (const f of ['sim.js', 'app.js', 'template.html', 'geo-data.js', 'geo-anr-data.js', 'geo-anr-spec.js', 'styles.css']) { const txt = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); check(!/maersk|\bAPM\b/i.test(txt), `${f} mentions Maersk or APM`); }
console.log('\nmessages', S.messages.length, 'by class', ['EST', 'REQ', 'PLN', 'ACT'].map((k) => k + ':' + S.messages.filter((m) => m.cls === k).length).join(' '));
console.log('revisions', S.messages.filter((m) => m.revision).map((m) => `${m.call} ${SIM.codeName(m.key, m.cls)} ${fmt(m.sendAt)} -> ${fmt(m.value)}`).join('\n  '));
console.log('tug jobs', S.tugJobs.map((j) => `${j.call} ${j.phase} ${j.tugs.join(',')} ${fmt(j.t0)} meet ${fmt(j.tMeet)} rel ${fmt(j.tRelease)}`).join('\n  '));
console.log('outcomes', JSON.stringify(S.outcomes));
console.log(JSON.stringify(SIM.eventPayload(S.messages.find((m) => m.call === 'IR' && m.key === 'BERTH|ARRI|INBD' && m.cls === 'REQ')), null, 1).slice(0, 1600));
console.log(fail ? `\n${fail} FAILURES` : '\nALL CHECKS PASS');
