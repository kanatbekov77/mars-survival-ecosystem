// Scripted strategies (GDD §12): used by balance runs, tests and Demo snapshots.
import { T, solOf, slotOf, CROPS } from './config.js';
import { checkJob } from './actions.js';
import { zoneReadings } from './physics.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const once = (run, key, fn) => { const f = (run._once ||= {}); if (!f[key]) { const r = fn(); if (!r) f[key] = true; } };
const can = (s, a, t, p) => !checkJob(s, a, t, p);

function tryJobs(run, list) {
  const s = run.state;
  if (s.job || s.decision) return;
  for (const [a, t, p] of list) if (can(s, a, t, p)) { run.exec({ type: 'startJob', action: a, target: t, payload: p }); return; }
}

// Shared reactive layer: respond to faults the same way a careful operator would.
function reactive(run, opt) {
  const s = run.state;
  const jobs = [];
  if (!s.energy.mainBus) jobs.push(['resetFeeder']);
  if (!s.eq.scrubMain || !s.eq.fan) {
    if (s.eq.scrubMode !== 'emergency' && s.eq.scrubSwitchAt == null && (s.stores.cartridges > 0 || s.eq.cartridge > 0.01)) run.exec({ type: 'switchScrub', to: 'emergency' });
    if (s.flags.inspected.scrubber == null || s.flags.inspected.scrubber < (s.flags.scrubFailedTick ?? 0)) jobs.push(['inspect', 'scrubber']);
    if (!s.eq.fan) jobs.push(['repairFan']);
    if (!s.eq.scrubMain) jobs.push(['repairScrub']);
  }
  if (s.eq.scrubMode === 'emergency' && s.eq.cartridge < 0.6 && s.eq.cartridgeInserted && (!s.eq.scrubMain || !s.eq.fan)) jobs.push(['replaceCartridge']);
  if (s.eq.scrubMode === 'emergency' && s.eq.scrubMain && s.eq.fan && s.eq.scrubSwitchAt == null) run.exec({ type: 'switchScrub', to: 'main' });
  if (s.zones.gh.leak > 0) {
    if (s.flags.inspected.ghP == null || s.flags.inspected.ghP < T(3, 4)) jobs.push(['inspect', 'ghP']);
    else { if (!s.eq.ghIsolated) run.exec({ type: 'isolate', zone: 'gh', value: true }); jobs.push(['patch', 'gh']); }
  }
  if (s.eq.airlockLeak) jobs.push(['repairSeal', 'hab'], ['patch', 'hab']);
  if (!s.eq.pump) jobs.push(['repairPump']);
  if (!s.eq.led) jobs.push(['repairLED']);
  if (!s.eq.relay && !s.flags.landingConfirmed) jobs.push(['relayRepair']);
  if (!s.eq.cassetteOk) jobs.push(['waterService']);
  if (s.energy.reserve.maintDue != null || s.energy.reserve.limited) jobs.push(['serviceReserve']);
  if (s.flags.sensorFaultTick != null && !(s.flags.calibrated >= s.flags.sensorFaultTick)) {
    if (!(s.flags.inspected.habP >= s.flags.sensorFaultTick)) jobs.push(['inspect', 'habP']); else jobs.push(['calibrate', 'habP']);
  }
  for (const c of s.crops) if (c.state === 'ripe') jobs.push(['harvest', c.id]);
  for (const c of s.crops) if (c.state === 'growing' && c.nutrients < 0.35) jobs.push(['feed', c.id]);
  for (const c of s.crops) if (c.state === 'lost') jobs.push(['clearTray', c.id]);
  if (s.zones.gh.leak === 0 && zoneReadings(s.zones.gh).P < 78 && s.crops.some((c) => c.state === 'growing')) jobs.push(['greenhouseFill']);
  if (opt.clean !== false) s.energy.clean.forEach((c, i) => { if (c < 0.6 && s.energy.L >= 0.65) jobs.push(['cleanPV', i]); });
  // after the feeder is back and no storm ahead, return the reserve to Assist (saves maintenance parts)
  const r = s.energy.reserve;
  if (s.energy.mainBus && r.mode === 'continuous' && !r.startingTo && s.energy.L >= 1 && r.lockUntil <= s.tick) run.exec({ type: 'setReserve', mode: 'assist' });
  return jobs;
}

function decide(run, choice) {
  const s = run.state;
  if (!s.decision) return;
  const id = s.decision.eventId;
  const c = typeof choice === 'function' ? choice(id, s) : choice[id];
  run.exec({ type: 'choose', choiceId: c || s.decision.defaultChoiceId });
}

// ---------- control strategy ----------
export function controlStrategy(run) {
  const s = run.state;
  const sol = solOf(s.tick), slot = slotOf(s.tick);
  decide(run, { E_DUST1: 'safe', E_DUST2: 'safe', E_SEP1: 'shelter', E_SEP2: 'shelter', E_FEEDER: 'repair' });
  if (s.decision) return;
  const ob = (k) => once(run, `${k}${sol}`, () => run.exec({ type: 'observe', target: k }));
  if (sol === 1) ob('oxygen');
  if (sol === 2) { ob('greenhouse'); }
  if (sol === 4 && s.flags.sends.some((t) => solOf(t) === 4)) ob('energy');
  if (sol === 5) once(run, 'quiz', () => run.exec({ type: 'quiz', key: 'air', correct: true }));
  if (sol === 6) ob('water');
  if (sol === 7) { ob('energy'); once(run, 'plan7', () => run.exec({ type: 'savePlan' })); }
  if (sol === 7 && slot >= 12) once(run, 'res1', () => run.exec({ type: 'setReserve', mode: 'assist' }));
  if (sol === 8 && slot >= 10) ob('energy');
  if (sol === 10) ob('panels');
  if (sol === 12) ob('scrubber');
  if (sol === 13 && slot >= 3) ob('dose');
  if (sol === 17 && slot < 15) ob('heat');
  if (sol === 20) ob('forecast');
  if (sol === 22) ob('reserve');
  if (sol === 23) ob('dose');
  if (sol === 24) once(run, 'upg', () => run.exec({ type: 'decide', key: 'upgrade', value: 'decline' }));
  if (sol === 26) { once(run, 'plan26', () => run.exec({ type: 'setPlan', order: ['electrolysis', 'greenhouse', 'recycle', 'job'] })); ob('forecast'); }
  if (sol === 26 && slot >= 2) once(run, 'plan26b', () => run.exec({ type: 'setPlan', order: ['electrolysis', 'recycle', 'greenhouse', 'job'] }));
  if (sol === 27) ob('supplies');
  if (sol === 28) ob('greenhouse');
  const jobs = reactive(run, {});
  if (sol === 2) jobs.push(['plant', 'B', { species: 'radish' }]);
  if (sol === 4) jobs.push(['send']);
  const pvSamples = s.flags.samples.filter((x) => x.target === 'pv');
  if (sol >= 11 && s.energy.L >= 1 && !pvSamples.length) jobs.push(['sample', 'pv']);
  if (pvSamples.length === 1 && !s.flags.cleanedTicks.length && sol >= 11 && s.energy.L >= 1) jobs.push(['cleanPV', s.energy.clean[0] <= s.energy.clean[1] ? 0 : 1]);
  if (s.flags.cleanedTicks.length && pvSamples.length < 2 && s.energy.L >= 1 && pvSamples[0]?.L === 1) jobs.push(['sample', 'pv']);
  if (sol >= 16 && s.cache === 'field') jobs.push(['recoverCache']);
  if (s.cache === 'warehouse') jobs.push(['unload']);
  if (sol >= 18 && s.stores.cores > 0) jobs.push(['thawCore']);
  if (s.water.quarantineState === 'untested') jobs.push(['waterTest']);
  if (sol >= 25 && s.flags.landCheckTick == null) jobs.push(['landCheck']);
  if (s.flags.landCheckTick != null && !s.flags.landingConfirmed) jobs.push(['send']);
  if (sol === 28 && slot >= 18) once(run, 'res2', () => run.exec({ type: 'setReserve', mode: 'assist' }));
  tryJobs(run, jobs);
}

// (A) protect the farm, skip science and optional trips
export function compromiseA(run) {
  const s = run.state; const sol = solOf(s.tick);
  decide(run, { E_DUST1: 'custom', E_DUST2: 'custom', E_SEP1: 'shelter', E_SEP2: 'shelter', E_FEEDER: 'repair' });
  if (s.decision) return;
  if (sol === 7) once(run, 'res', () => run.exec({ type: 'setReserve', mode: 'assist' }));
  const jobs = reactive(run, { clean: false });
  if (sol === 2) jobs.push(['plant', 'B', { species: 'radish' }]);
  if (sol >= 25 && s.flags.landCheckTick == null) jobs.push(['landCheck']);
  if (s.flags.landCheckTick != null && !s.flags.landingConfirmed) jobs.push(['send']);
  tryJobs(run, jobs);
}

// (B) switch LEDs off in crises, rely on packs and repairs
export function compromiseB(run) {
  const s = run.state; const sol = solOf(s.tick);
  decide(run, { E_DUST1: 'safe', E_DUST2: 'safe', E_SEP1: 'shelter', E_SEP2: 'shelter', E_FEEDER: 'repair' });
  if (s.decision) return;
  if (sol === 8 && slotOf(s.tick) < 10) once(run, 'res', () => run.exec({ type: 'setReserve', mode: 'assist' }));
  if (sol >= 21 && sol <= 22) once(run, 'gh', () => run.exec({ type: 'ghMode', value: 'preserve' }));
  if (sol === 23) once(run, 'gh2', () => run.exec({ type: 'ghMode', value: 'normal' }));
  const jobs = reactive(run, {});
  if (sol >= 16 && s.cache === 'field') jobs.push(['recoverCache']);
  if (s.cache === 'warehouse') jobs.push(['unload']);
  if (sol >= 25 && s.flags.landCheckTick == null) jobs.push(['landCheck']);
  if (s.flags.landCheckTick != null && !s.flags.landingConfirmed) jobs.push(['send']);
  tryJobs(run, jobs);
}

// Random admissible decisions
const ALL_JOBS = ['inspect:ghP', 'inspect:habP', 'inspect:scrubber', 'patch:gh', 'patch:hab', 'repairScrub', 'repairFan', 'resetFeeder', 'cleanPV:0', 'cleanPV:1', 'serviceReserve', 'plant:B', 'feed:A', 'feed:B', 'harvest:A', 'harvest:B', 'send', 'relayRepair', 'waterService', 'waterTest', 'thawCore', 'recoverCache', 'unload', 'rest', 'landCheck', 'repairPump', 'repairLED', 'greenhouseFill'];
export function randomStrategy(run) {
  const s = run.state;
  const rnd = (run._rnd ||= mulberry32(run.meta.seed * 7919 + 13));
  if (s.decision) { const c = s.decision.choices; run.exec({ type: 'choose', choiceId: c[Math.floor(rnd() * c.length)] }); return; }
  if (rnd() < 0.04) { const m = ['auto', 'off', 'on'][Math.floor(rnd() * 3)]; run.exec({ type: 'setMode', system: 'electrolysis', value: m }); }
  if (rnd() < 0.03) run.exec({ type: 'setReserve', mode: ['standby', 'assist', 'continuous'][Math.floor(rnd() * 3)] });
  if (rnd() < 0.02 && (!s.eq.scrubMain || !s.eq.fan)) run.exec({ type: 'switchScrub', to: 'emergency' });
  if (!s.job && rnd() < 0.25) {
    const pick = ALL_JOBS[Math.floor(rnd() * ALL_JOBS.length)].split(':');
    const t = pick[1] != null ? (/^\d$/.test(pick[1]) ? +pick[1] : pick[1]) : undefined;
    run.exec({ type: 'startJob', action: pick[0], target: t, payload: pick[0] === 'plant' ? { species: 'radish' } : undefined });
  }
}

// Error strategy: switch air devices off, ignore repairs, risky EVA
export function errorStrategy(run) {
  const s = run.state;
  decide(run, { E_DUST1: 'custom', E_DUST2: 'custom', E_SEP1: 'stay', E_SEP2: 'stay', E_FEEDER: 'reserve' });
  if (s.decision) return;
  once(run, 'el', () => run.exec({ type: 'setMode', system: 'electrolysis', value: 'off' }));
  tryJobs(run, [['cleanPV', 0], ['cleanPV', 1], ['recoverCache']]);
}

export const STRATEGIES = { control: controlStrategy, compromiseA, compromiseB, random: randomStrategy, error: errorStrategy };

// Play a full run with a strategy; returns the Run.
export function playRun(RunClass, meta, strategy, untilTick = 720) {
  const run = new RunClass(meta);
  let guard = 0;
  while (run.state.status === 'active' && run.state.tick < untilTick && guard++ < 5000) {
    strategy(run);
    const r = run.step();
    if (r.blocked === 'decision') { strategy(run); if (run.state.decision) run.exec({ type: 'choose', choiceId: run.state.decision.defaultChoiceId }); run.step(); }
  }
  return run;
}
