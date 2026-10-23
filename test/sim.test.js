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
  check(Math.abs(A['BERTH|ARRI|INBD'] - c.pta) <= 6, `${c.id} ATA berth equals PTA (${fmt(A['BERTH|ARRI|INBD'])})`);
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
console.log('\nmessages', S.messages.length, 'by class', ['EST', 'REQ', 'PLN', 'ACT'].map((k) => k + ':' + S.messages.filter((m) => m.cls === k).length).join(' '));
console.log('revisions', S.messages.filter((m) => m.revision).map((m) => `${m.call} ${SIM.codeName(m.key, m.cls)} ${fmt(m.sendAt)} -> ${fmt(m.value)}`).join('\n  '));
console.log('tug jobs', S.tugJobs.map((j) => `${j.call} ${j.phase} ${j.tugs.join(',')} ${fmt(j.t0)} meet ${fmt(j.tMeet)} rel ${fmt(j.tRelease)}`).join('\n  '));
console.log('outcomes', JSON.stringify(S.outcomes));
console.log(JSON.stringify(SIM.eventPayload(S.messages.find((m) => m.call === 'IR' && m.key === 'BERTH|ARRI|INBD' && m.cls === 'REQ')), null, 1).slice(0, 1600));
console.log(fail ? `\n${fail} FAILURES` : '\nALL CHECKS PASS');
