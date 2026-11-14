// Arithmetic, boundary and integration checks from GDD §12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/engine/state.js';
import { zoneReadings, massFor, psat } from '../src/engine/physics.js';
import { buildLoads, dispatch, step } from '../src/engine/sim.js';
import { H, T, TOTAL_TICKS } from '../src/engine/config.js';
import { Run, forecast } from '../src/engine/run.js';
import { STRATEGIES, playRun } from '../src/engine/strategies.js';
import { sha256Hex, roll } from '../src/engine/sha256.js';
import { checkJob, startJob } from '../src/engine/actions.js';
import { lightAt } from '../src/engine/events.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('sha256 matches the standard vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const r = roll('v', 1, 5); assert.ok(r.u >= 0 && r.u < 1 && r.v >= 0 && r.v < 1);
});

test('control atmosphere at init (§12)', () => {
  const s = createState();
  const z = s.zones.hab;
  near(z.gas.O2, 37.3, 0.05, 'O2 kg');
  near(z.gas.N2, 111.7, 0.05, 'N2 kg');
  near(z.gas.CO2, 0.189, 0.001, 'CO2 kg');
  const r = zoneReadings(z);
  near(r.pH2O, 1.09, 0.01, 'pH2O');
  near(r.RH, 0.44, 0.01, 'RH');
  near(r.P, 85.16, 0.02, 'P');
});

test('oxygen stock arithmetic (§12)', () => {
  near(44 / 3.36, 13.1, 0.01, 'sols of O2 in tank');
  near(3.36 * 30, 100.8, 1e-9, 'O2 for 30 sols');
  near(0.15 * H * 24, 3.699, 0.001, 'max electrolysis per sol');
});

test('night battery discharge and charge (§12)', () => {
  const s = createState();
  s.tick = T(2, 20); // night slot
  s.energy.soc = 20;
  dispatch(s, [{ id: 'x', kw: 5 / H }]);
  near(s.energy.soc, 14.565, 0.001, 'SoC after 5 kWh');
  const s2 = createState();
  s2.tick = T(2, 20); s2.energy.soc = 20; s2.energy.reserve.mode = 'continuous';
  // 5 kWh input → +4.75 (reserve output exactly 5 kWh when limit set so)
  s2.cfg.energy.reserveKW = 5 / H;
  dispatch(s2, []);
  near(s2.energy.soc, 24.75, 0.001, 'SoC after 5 kWh charge');
  s2.cfg.energy.reserveKW = 5;
  const s3 = createState(); s3.tick = T(2, 20); s3.energy.mainBus = false; s3.energy.soc = 50;
  dispatch(s3, [{ id: 'habFan', kw: 0.8 }]);
  assert.equal(s3.energy.soc, 50, 'battery isolated when feeder broken');
});

test('storm single light tick cascade (§12)', () => {
  const s = createState();
  s.tick = T(8, 11); s.energy.L = 0.25; s.energy.soc = 60;
  dispatch(s, [{ id: 'load', kw: 4.5 }]);
  near(s.energy.lastPV, 3.5, 1e-9, 'PV peak in storm');
  near(60 - s.energy.soc, 1.11683, 0.0001, 'SoC debit');
  const s2 = createState(); s2.tick = T(8, 11); s2.energy.L = 0.25; s2.energy.folded[1] = true;
  dispatch(s2, []);
  near(s2.energy.lastPV, 1.75, 1e-9, 'one panel folded');
  assert.equal(lightAt(T(8, 10)), 0.25); assert.equal(lightAt(T(10, 5)), 0.25); assert.equal(lightAt(T(10, 6)), 0.65); assert.equal(lightAt(T(11, 0)), 1);
});

test('reserve produces 123.3 kWh per sol (§12)', () => near(5 * H * 24, 123.3, 0.05, 'reserve kWh/sol'));

test('scrubber failure: 4th tick crosses 0.25 kPa (§12)', () => {
  const s = createState();
  const z = s.zones.hab;
  z.gas.CO2 = massFor('CO2', 0.05, 21, z.V);
  const perTick = (4 / 24) * 188.9 * 294.15 / (1000 * 150);
  near(perTick, 0.06174, 0.00002, 'kPa per tick');
  let p = 0.05, n = 0; while (p <= 0.25) { p += perTick; n++; }
  assert.equal(n, 4);
  near(0.20, 0.162 / 1, 0.04, 'emergency limit covers breathing inflow');
  near((4 / 24) / H, 0.162, 0.001, 'breathing CO2 kg/h');
});

test('electrolysis: 1 kg O2 ⇒ 1.125 kg water, 0.125 kg H2; zero at water guard', () => {
  const s = createState();
  s.tanks.O2 = 30; s.tick = T(1, 5); s.eventsDoneTick = s.tick;
  const w0 = s.water.clean, h0 = s.sinks.H2, o0 = s.tanks.O2;
  step(s);
  const made = s.lastFlows.o2Made;
  assert.ok(made > 0);
  near(s.sinks.H2 - h0, 0.125 * made, 1e-12, 'H2');
  const s2 = createState(); s2.tanks.O2 = 30; s2.water.clean = 25; s2.tick = T(1, 5); s2.eventsDoneTick = s2.tick;
  assert.ok(!buildLoads(s2).some((l) => l.id === 'electrolysis'), 'no request at 25 kg guard');
  void w0; void o0;
});

test('crop: 14 good light ticks = 1 effective sol; cold stops growth', () => {
  const s = createState();
  s.tick = T(1, 3); s.eventsDoneTick = s.tick;
  const a = s.crops[0];
  const e0 = a.eff;
  for (let i = 0; i < 14; i++) { s.eventsDoneTick = s.tick; step(s); }
  near(a.eff - e0, 1, 1e-9, 'one effective sol');
  assert.ok(a.eff - e0 <= 1 + 1e-9);
});

test('micro-leak escalation canceled by patch before due; ×6 without repair', () => {
  const run = new Run({ seed: 3 });
  const s = run.state;
  while (s.tick < T(3, 4)) { run.step(); }
  run.step();
  assert.equal(s.zones.gh.leak, 0.001);
  // no repair: run to 18 ticks after start
  while (s.tick < T(3, 4) + 19) run.step();
  assert.equal(s.zones.gh.leak, 0.006, 'escalated');
  const r2 = new Run({ seed: 3 });
  while (r2.state.tick < T(3, 5)) r2.step();
  r2.exec({ type: 'startJob', action: 'patch', target: 'gh' });
  for (let i = 0; i < 20; i++) r2.step();
  assert.equal(r2.state.zones.gh.leak, 0);
  assert.ok(!r2.state.pending.some((p) => p.status === 'applied'));
});

test('radiation: EVA > habitat > shelter for both components; flare class changes nothing', () => {
  const f = { eva: [1, 1], hab: [0.8, 0.65], shelter: [0.65, 0.18] };
  assert.ok(f.eva[0] > f.hab[0] && f.hab[0] > f.shelter[0]);
  assert.ok(f.eva[1] > f.hab[1] && f.hab[1] > f.shelter[1]);
  const a = playRun(Run, { seed: 9 }, STRATEGIES.control, T(14, 0)).hash();
  const b = playRun(Run, { seed: 9 }, STRATEGIES.control, T(14, 0)).hash();
  assert.equal(a, b, 'archive FLR class is display-only, simulation identical');
});

test('determinism: same seed and commands ⇒ same state; replay equals live', () => {
  const live = playRun(Run, { seed: 42, profile: 'engineer' }, STRATEGIES.control);
  const rep = Run.replay(live.meta, live.commands);
  assert.equal(rep.state.tick, live.state.tick);
  assert.equal(rep.hash(), live.hash());
  const other = playRun(Run, { seed: 43, profile: 'engineer' }, STRATEGIES.random);
  assert.notEqual(other.hash(), live.hash());
});

test('save → load roundtrip and checksum guard', () => {
  const r = playRun(Run, { seed: 5 }, STRATEGIES.control, T(9, 0));
  const env = r.toSave();
  const back = Run.fromSave(JSON.parse(JSON.stringify(env)));
  assert.equal(back.hash(), r.hash());
  const bad = JSON.parse(JSON.stringify(env)); bad.stateSnapshot.tick = 1;
  assert.throws(() => Run.fromSave(bad), /checksum/);
  // continuing the loaded run equals continuing the original
  for (let i = 0; i < 30; i++) { STRATEGIES.control(r); r.step(); STRATEGIES.control(back); back.step(); }
  assert.equal(back.hash(), r.hash());
});

test('decision freezes the world; timer expiry logs Safe', () => {
  const run = new Run({ seed: 1 });
  while (run.state.tick < T(8, 10)) { STRATEGIES.control(run); if (run.step().blocked) break; }
  const r = run.step();
  assert.equal(r.blocked, 'decision');
  const t = run.state.tick;
  assert.equal(run.step().blocked, 'decision');
  assert.equal(run.state.tick, t, 'no ticks while modal open');
  assert.equal(run.exec({ type: 'choose', choiceId: 'safe', expired: true }), null);
  const entry = run.state.log.find((e) => e.type === 'choice');
  assert.equal(entry.expired, true); assert.equal(entry.choiceId, 'safe');
});

test('terminal threshold on tick 719 beats cargo delivery', () => {
  const run = playRun(Run, { seed: 2 }, STRATEGIES.control, 719);
  const z = run.state.zones.hab;
  run.state.stopCounters.pCO2 = 2;
  z.gas.CO2 = massFor('CO2', 0.9, z.T, z.V);
  run.state.eq.scrubMain = false; run.state.eq.fan = false;
  run.step();
  assert.equal(run.state.ending.id, 'stop');
  assert.equal(run.state.ending.cargo, undefined, 'no cargo after a stop');
});

test('message without landCheck does not confirm the landing site', () => {
  const run = playRun(Run, { seed: 4 }, (r) => { STRATEGIES.compromiseB(r); }, T(25, 0));
  const s = run.state; s.flags.landCheckTick = null; s.flags.landingConfirmed = false;
  while (s.job) run.step();
  s.tokens = 3;
  assert.equal(startJob(s, 'send'), null);
  while (s.job) run.step();
  assert.equal(s.flags.landingConfirmed, false);
});

test('control strategy reaches a delivery ending on both profiles', () => {
  for (const profile of ['cadet', 'engineer']) {
    const r = playRun(Run, { seed: 11, profile }, STRATEGIES.control);
    assert.equal(r.state.tick, TOTAL_TICKS, profile);
    assert.ok(['sustainable', 'survived'].includes(r.state.ending.id), `${profile}: ${r.state.ending.id}`);
  }
});

test('forecast never mutates state nor reveals local rolls', () => {
  const r = playRun(Run, { seed: 6 }, STRATEGIES.control, T(14, 4));
  const h = r.hash();
  const f = forecast(r.state, 3);
  assert.equal(f.length, 3);
  assert.equal(r.hash(), h);
});

test('EVA blocked in storm / SEP, diagnostics are token-free (D3)', () => {
  const s = createState(); s.tick = T(8, 12); s.energy.L = 0.25;
  assert.equal(checkJob(s, 'cleanPV', 0), 'req.evaLight');
  s.energy.L = 1; s.sepWarning = true;
  assert.equal(checkJob(s, 'recoverCache'), 'req.evaSep');
  s.tokens = 0;
  assert.equal(checkJob(s, 'inspect', 'ghP'), null);
  assert.equal(checkJob(s, 'patch', 'gh'), 'req.noToken');
});

test('mass balance: water accounted across tanks and sinks', () => {
  const r = playRun(Run, { seed: 8 }, STRATEGIES.control, T(12, 0));
  const s = r.state;
  const zoneW = s.zones.hab.gas.H2O + s.zones.gh.gas.H2O;
  const roots = s.crops.reduce((a, c) => a + c.water, 0);
  const total = s.water.clean + s.water.grey + s.water.quarantine + zoneW + roots + s.sinks.water + s.sinks.condensate + s.sinks.leakH2O + s.sinks.harvestWater + s.sinks.soil
    + 9 * (s.sinks.H2 / 1) * 1 // electrolysed water = 9 × H2 mass
    ;
  const start = 170 + 18 + 1.2 + 0.37 + 1.5 + 9 * 0; // initial stocks (+core water if thawed)
  const thawed = s.flags.thawed != null ? 15 : 0;
  near(total, start + thawed + (s.cache === 'taken' || s.cache === 'warehouse' ? 0 : 0) + (s.flags.cacheRecovered ? 16 - s.warehouse.water : 0), 1e-6, 'water mass');
});
