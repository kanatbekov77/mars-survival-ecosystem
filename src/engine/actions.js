// Work catalog (GDD §6) and technologies (GDD §8).
// Every job: ticks of powered work × kW, token (diagnostics are token-free, decision D3),
// materials reserved at start and returned if canceled before use.
import { H, CROPS, solOf, T } from './config.js';
import { zoneReadings, massFor } from './physics.js';
import { log, notify, cancelPending } from './state.js';

const SECONDARY_JOBS = new Set(['resetFeeder', 'serviceReserve', 'inspect', 'calibrate', 'send', 'rest']);

export const TECH = {
  T_TELEMETRY: { ticks: 1, kw: 0.3, mat: {}, req: (s) => (solOf(s.tick) >= 3 && Object.keys(s.flags.inspected).length > 0 ? null : 'req.telemetry') },
  T_DUST: { ticks: 2, kw: 0.6, mat: { parts: 1 }, req: (s) => (solOf(s.tick) >= 10 && s.flags.samples.some((x) => x.target === 'pv') && s.flags.cleanedTicks.length > 0 ? null : 'req.dustCover') },
  T_DRIP: { ticks: 2, kw: 0.5, mat: { parts: 1 }, req: (s) => (solOf(s.tick) >= 14 && (s.counters.pumpTicks || 0) >= 6 ? null : 'req.drip') },
  T_LOOP: { ticks: 2, kw: 0.7, mat: { cassettes: 1 }, req: (s) => (s.flags.waterTested && s.flags.waterServiced ? null : 'req.loop') },
  T_ISOLATION: { ticks: 2, kw: 0.8, mat: { parts: 1 }, req: (s) => (s.flags.feederRepaired ? null : 'req.isolation') },
};

const tray = (s, id) => s.crops.find((c) => c.id === id);

export const ACTIONS = {
  inspect: {
    ticks: 1, kw: 0.3, token: false,
    targets: ['ghP', 'habP', 'scrubber', 'pv', 'water', 'dose', 'air'],
    done(s, j) {
      s.flags.inspected[j.target] = s.tick;
      if (j.target === 'habP') s.sensors.habPChecked = true;
      const z = j.target === 'ghP' ? s.zones.gh : s.zones.hab;
      const r = zoneReadings(z);
      return { truth: { P: r.P, pO2: r.pO2, pCO2: r.pCO2, T: r.T } };
    },
  },
  calibrate: {
    ticks: 1, kw: 0.3, token: false, targets: ['habP'],
    req: (s) => (s.flags.inspected.habP != null && s.flags.inspected.habP >= (s.flags.sensorFaultTick ?? -1) ? null : 'req.inspectFirst'),
    done(s) { s.sensors.habPOffset = 0; s.flags.calibrated = s.tick; },
  },
  sample: {
    ticks: 1, kw: 0.4, token: false, targets: ['pv', 'ice', 'air'],
    done(s, j) {
      s.flags.samples.push({ tick: s.tick, target: j.target, L: s.energy.L, clean: [...s.energy.clean] });
    },
  },
  patch: {
    ticks: 2, kw: 0.6, token: true, mat: { patches: 1 }, targets: ['gh', 'hab'],
    req: (s, t) => (s.zones[t].leak > 0 ? null : 'req.noDamage'),
    done(s, j) {
      const z = s.zones[j.target];
      z.leak = 0; z.kExtra = 0;
      if (j.target === 'hab') s.eq.airlockLeak = false;
      cancelPending(s, `crack_${j.target}`, 'patched');
      s.flags[`patched_${j.target}`] = s.tick;
    },
  },
  repairSeal: {
    ticks: 2, kw: 0.6, token: true, mat: { seals: 1 }, targets: ['hab'],
    req: (s) => (s.eq.airlockLeak ? null : 'req.noDamage'),
    done(s) { s.zones.hab.leak = 0; s.zones.hab.kExtra = 0; s.eq.airlockLeak = false; cancelPending(s, 'crack_hab', 'sealed'); },
  },
  replaceCartridge: {
    ticks: 1, kw: 0.1, token: true, mat: { cartridges: 1 },
    req: (s) => (s.eq.cartridgeInserted ? null : 'req.noCartridgeSlot'),
    done(s) { s.eq.cartridge = s.cfg.cartridgeKg; cancelPending(s, 'cartridgeLow', 'replaced'); },
  },
  repairScrub: {
    ticks: 2, kw: 0.7, token: true, mat: { parts: 1 },
    req: (s) => (!s.eq.scrubMain ? null : 'req.noDamage'),
    done(s) {
      s.eq.scrubMain = true;
      if (s.eq.fan) s.eq.scrubMode = 'main';
      s.flags.scrubRepaired = s.tick;
    },
  },
  repairFan: {
    ticks: 2, kw: 0.7, token: true, mat: { spareFans: 1 },
    req: (s) => (!s.eq.fan ? null : 'req.noDamage'),
    done(s) { s.eq.fan = true; if (s.eq.scrubMain) s.eq.scrubMode = 'main'; },
  },
  resetFeeder: {
    ticks: 2, kw: 0.8, token: true, mat: { parts: 1 },
    req: (s) => (!s.energy.mainBus ? null : 'req.noDamage'),
    done(s) { s.energy.mainBus = true; s.flags.feederRepaired = s.tick; },
  },
  cleanPV: {
    ticks: 2, kw: 0.5, token: true, eva: true, mat: { pads: 1 }, targets: [0, 1],
    req: (s, t) => (s.energy.clean[t] < 0.999 ? null : 'req.alreadyClean'),
    done(s, j) {
      s.energy.clean[j.target] = Math.min(1, s.energy.clean[j.target] + 0.45);
      s.flags.cleanedTicks.push(s.tick);
    },
  },
  serviceReserve: {
    ticks: 2, kw: 0.6, token: true, mat: { parts: 1 },
    req: (s) => (s.energy.reserve.maintDue != null || s.energy.reserve.limited || s.energy.reserve.contTicks > 0 ? null : 'req.noService'),
    done(s) {
      const r = s.energy.reserve;
      r.maintDue = null; r.limited = false; r.contTicks = 0;
      cancelPending(s, 'reserveMaint', 'serviced');
      s.flags.reserveServiced = s.tick;
    },
  },
  plant: {
    ticks: 1, kw: 0.25, token: true, targets: ['A', 'B'],
    mat: (s, t, p) => ({ [p?.species === 'lettuce' ? 'seedsLettuce' : 'seedsRadish']: 1, liners: 1, nutrients: 1 }),
    req: (s, t) => (tray(s, t).state === 'empty' ? (s.water.clean >= 26 ? null : 'req.water') : 'req.trayBusy'),
    done(s, j) {
      const c = tray(s, j.target);
      Object.assign(c, { species: j.payload?.species || 'radish', eff: 0, water: 1, nutrients: 1, stress: 0, halved: false, state: 'growing', plantedTick: s.tick });
      s.water.clean -= 1;
      s.flags.planted = s.flags.planted || {};
      s.flags.planted[j.target] = s.tick;
    },
  },
  feed: {
    ticks: 1, kw: 0.25, token: true, targets: ['A', 'B'],
    mat: (s, t) => ({ nutrients: Math.max(1, Math.min(2, Math.floor(3 - (tray(s, t)?.nutrients ?? 3)))) }),
    req: (s, t) => { const c = tray(s, t); return c.state === 'growing' || c.state === 'ripe' ? (c.nutrients <= 2 ? null : 'req.nutrientsFull') : 'req.trayEmpty'; },
    done(s, j) { const c = tray(s, j.target); c.nutrients = Math.min(3, c.nutrients + (j.reserved.nutrients || 0)); },
  },
  harvest: {
    ticks: 1, kw: 0.25, token: true, targets: ['A', 'B'],
    req: (s, t) => (tray(s, t).state === 'ripe' ? null : 'req.notRipe'),
    done(s, j) {
      const c = tray(s, j.target);
      const kcal = CROPS[c.species].kcal * (c.halved ? 0.5 : 1);
      s.food.fresh.push({ kcal, expiresTick: s.tick + 72, acquiredTick: s.tick, species: c.species });
      const removed = Math.min(0.5, c.water);
      s.sinks.harvestWater += removed;
      s.water.grey = Math.min(s.cfg.water.greyCap, s.water.grey + (c.water - removed));
      Object.assign(c, { species: null, eff: 0, water: 0, nutrients: 0, stress: 0, halved: false, state: 'empty', plantedTick: null });
      s.stores.liners += 1;
      s.flags.harvests += 1;
      s.stats.harvestKcal += kcal;
      s.flags.protocols.farm = true;
      return { kcal };
    },
  },
  clearTray: {
    ticks: 1, kw: 0.25, token: true, targets: ['A', 'B'],
    req: (s, t) => (tray(s, t).state === 'lost' ? null : 'req.notLost'),
    done(s, j) {
      const c = tray(s, j.target);
      s.sinks.soil += c.water;
      Object.assign(c, { species: null, eff: 0, water: 0, nutrients: 0, stress: 0, halved: false, state: 'empty', plantedTick: null });
      s.stores.liners += 1;
    },
  },
  greenhouseFill: {
    ticks: 1, kw: 0.35, token: true,
    req: (s) => (s.zones.gh.leak > 0 ? 'req.patchFirst' : zoneReadings(s.zones.gh).P < 84 ? null : 'req.pressureOk'),
    done(s) {
      const z = s.zones.gh;
      const dO2 = Math.max(0, Math.min(3, s.tanks.O2, massFor('O2', 19, z.T, z.V) - z.gas.O2));
      const dN2 = Math.max(0, Math.min(10, s.tanks.N2, massFor('N2', 65, z.T, z.V) - z.gas.N2));
      z.gas.O2 += dO2; s.tanks.O2 -= dO2; z.gas.N2 += dN2; s.tanks.N2 -= dN2;
      return { O2: dO2, N2: dN2 };
    },
  },
  exchangeGas: {
    ticks: 1, kw: 0.35, token: true,
    req: (s) => (s.eq.ghIsolated ? 'req.isolated' : zoneReadings(s.zones.gh).pCO2 <= 0.16 ? null : 'req.ghCO2'),
    done(s) {
      const g = s.zones.gh, hb = s.zones.hab;
      const fGh = 0.1, fHab = 0.1 * g.V / hb.V;
      for (const k of ['O2', 'N2', 'CO2', 'H2O']) {
        const a = g.gas[k] * fGh, b = hb.gas[k] * fHab;
        g.gas[k] += b - a; hb.gas[k] += a - b;
      }
    },
  },
  repairLED: {
    ticks: 2, kw: 0.6, token: true, mat: { parts: 1 },
    req: (s) => (!s.eq.led ? null : 'req.noDamage'),
    done(s) { s.eq.led = true; },
  },
  repairPump: {
    ticks: 2, kw: 0.6, token: true, mat: { parts: 1 },
    req: (s) => (!s.eq.pump ? null : 'req.noDamage'),
    done(s) { s.eq.pump = true; },
  },
  send: {
    ticks: 1, kw: 0.5, token: true,
    req: (s) => (s.eq.relay ? null : 'req.relay'),
    done(s) {
      s.flags.sends.push(s.tick);
      const sol = solOf(s.tick);
      if (sol >= 4 && sol <= 6) s.flags.forecastSent = true;
      if (s.flags.landCheckTick != null && s.tick <= T(28, 23)) {
        s.flags.landingConfirmed = true;
        log(s, 'landing', { key: 'log.landingConfirmed', causeIds: [] });
      }
      s.replies.push({ dueTick: T(sol + 1, 0), key: s.flags.landingConfirmed ? 'msg.reply.landing' : sol <= 5 ? 'msg.reply.status' : 'msg.reply.generic', sentTick: s.tick });
    },
  },
  relayRepair: {
    ticks: 2, kw: 0.6, token: true, mat: { parts: 1 },
    req: (s) => (!s.eq.relay ? null : 'req.noDamage'),
    done(s) { s.eq.relay = true; },
  },
  waterService: {
    ticks: 2, kw: 0.5, token: true, mat: { cassettes: 1 },
    req: (s) => (!s.eq.cassetteOk ? null : 'req.noDamage'),
    done(s) { s.eq.cassetteOk = true; s.eq.recycleEff = s.flags.tech.T_LOOP ? 0.91 : 0.88; s.flags.waterServiced = s.tick; },
  },
  waterTest: {
    ticks: 1, kw: 0.35, token: true, mat: { tests: 1 },
    req: (s) => (s.water.quarantineState === 'untested' ? null : 'req.noSample'),
    done(s) { s.water.quarantineState = 'passed'; s.flags.waterTested = s.tick; },
  },
  thawCore: {
    ticks: 3, kw: 1.5, token: true, mat: { cores: 1 },
    req: (s) => (!s.flags.iceAvailable ? 'req.iceLater' : s.cfg.water.quarantineCap - s.water.quarantine >= 9 ? null : 'req.quarantineFull'),
    done(s) { s.water.quarantine += 9; s.water.quarantineState = 'untested'; s.sinks.soil += 6; s.flags.thawed = s.tick; },
  },
  recoverCache: {
    ticks: 3, kw: 1.5, token: true, eva: true,
    req: (s) => (s.cache === 'field' ? null : 'req.noCache'),
    done(s) { s.cache = 'warehouse'; s.warehouse.kcal += 19200; s.warehouse.water += 16; s.warehouse.parts += 1; s.flags.cacheRecovered = s.tick; },
  },
  unload: {
    ticks: 1, kw: 0.3, token: true,
    req: (s) => (s.warehouse.kcal + s.warehouse.water + s.warehouse.parts > 0 ? null : 'req.warehouseEmpty'),
    done(s) {
      const w = s.warehouse;
      const water = Math.min(w.water, s.cfg.water.cleanCap - s.water.clean);
      s.water.clean += water; w.water -= water;
      const kcal = Math.min(w.kcal, s.cfg.food.kcalCap - s.food.packs);
      s.food.packs += kcal; w.kcal -= kcal;
      s.stores.parts += w.parts; w.parts = 0;
      if (w.kcal + w.water + w.parts <= 0) s.cache = 'taken';
      return { water, kcal };
    },
  },
  rest: { ticks: 2, kw: 0, token: true, done(s) { s.flags.restSol = solOf(s.tick); } },
  landCheck: {
    ticks: 1, kw: 0.5, token: true,
    req: (s) => (solOf(s.tick) >= 25 ? null : 'req.landingLater'),
    done(s) { s.flags.landCheckTick = s.tick; s.flags.landingConfirmed = false; },
  },
  install: {
    token: true, targets: Object.keys(TECH),
    ticksFor: (t) => TECH[t].ticks, kwFor: (t) => TECH[t].kw, mat: (s, t) => TECH[t].mat,
    req: (s, t) => (s.flags.tech[t] ? 'req.installed' : TECH[t].req(s)),
    done(s, j) {
      s.flags.tech[j.target] = s.tick;
      if (j.target === 'T_LOOP' && s.eq.cassetteOk) s.eq.recycleEff = 0.91;
    },
  },
};

export function jobBus(action) { return SECONDARY_JOBS.has(action) ? 'secondary' : 'main'; }

export function materialsFor(s, action, target, payload) {
  const a = ACTIONS[action];
  if (!a.mat) return {};
  return typeof a.mat === 'function' ? a.mat(s, target, payload) : a.mat;
}

export function jobSpec(action, target) {
  const a = ACTIONS[action];
  return { ticks: a.ticksFor ? a.ticksFor(target) : a.ticks, kw: a.kwFor ? a.kwFor(target) : a.kw };
}

export function evaExecutor(s) {
  const ok = s.crew.filter((c) => c.evaBanUntil < s.tick);
  if (!ok.length) return null;
  ok.sort((a, b) => a.dose24.reduce((x, y) => x + y, 0) - b.dose24.reduce((x, y) => x + y, 0) || (a.id < b.id ? -1 : 1));
  return ok[0].id;
}

// Returns null if the job can start, else a reason key.
export function checkJob(s, action, target, payload) {
  const a = ACTIONS[action];
  if (!a) return 'req.unknown';
  if (s.status !== 'active') return 'req.over';
  if (s.decision) return 'req.decision';
  if (s.job) return 'req.busy';
  if (a.targets && !a.targets.includes(target)) return 'req.target';
  if (a.token && s.tokens < 1) return 'req.noToken';
  if (!s.energy.mainBus && jobBus(action) !== 'secondary') return 'req.mainBus';
  const mat = materialsFor(s, action, target, payload);
  for (const [k, v] of Object.entries(mat)) if ((s.stores[k] || 0) < v) return `req.mat.${k}`;
  if (a.eva) {
    if (s.shelter || s.sepWarning || s.sep > 0) return 'req.evaSep';
    if (s.energy.L < 0.65) return 'req.evaLight';
    if (s.stores.evaKits < 1) return 'req.mat.evaKits';
    if (!evaExecutor(s)) return 'req.evaBanned';
  }
  if (a.req) { const r = a.req(s, target, payload); if (r) return r; }
  return null;
}

export function previewJob(s, action, target, payload) {
  const reason = checkJob(s, action, target, payload);
  const spec = jobSpec(action, target);
  const a = ACTIONS[action];
  return {
    action, target, reason,
    ticks: spec.ticks,
    kw: spec.kw,
    kWh: spec.ticks * spec.kw * H,
    token: !!a.token,
    eva: !!a.eva,
    mat: materialsFor(s, action, target, payload),
    effectKey: `act.${action}.effect`,
    riskKey: a.eva ? 'risk.eva' : spec.kw >= 1 ? 'risk.power' : null,
  };
}

export function startJob(s, action, target, payload) {
  const reason = checkJob(s, action, target, payload);
  if (reason) return reason;
  const a = ACTIONS[action];
  const spec = jobSpec(action, target);
  const mat = materialsFor(s, action, target, payload);
  for (const [k, v] of Object.entries(mat)) s.stores[k] -= v;
  if (a.token) s.tokens -= 1;
  const executor = a.eva ? evaExecutor(s) : null;
  const id = log(s, 'jobStart', { key: `act.${action}.name`, action, target, inputs: { kWh: spec.ticks * spec.kw * H, ...mat }, executor });
  s.job = { id, action, target, payload: payload || null, remaining: spec.ticks, kw: spec.kw, eva: !!a.eva, executor, reserved: { ...mat }, evaPaid: false, startedTick: s.tick, status: 'queued', waitTicks: 0 };
  return null;
}

export function cancelJob(s, reason = 'player') {
  const j = s.job;
  if (!j) return 'req.noJob';
  for (const [k, v] of Object.entries(j.reserved)) s.stores[k] += v; // unspent materials come back
  log(s, 'jobCancel', { key: `act.${j.action}.name`, action: j.action, reason, causeIds: [j.id] });
  if (j.eva && j.executor) { const c = s.crew.find((x) => x.id === j.executor); if (c && c.loc === 'eva') c.loc = s.shelter ? 'shelter' : 'hab'; }
  s.job = null;
  return null;
}

export function finishJob(s) {
  const j = s.job;
  const a = ACTIONS[j.action];
  const out = a.done ? a.done(s, j) : null;
  s.stats.partsUsed += j.reserved.parts || 0;
  const lid = log(s, 'jobDone', { key: `act.${j.action}.name`, action: j.action, target: j.target, outputs: out || {}, causeIds: [j.id] });
  if (j.eva && j.executor) { const c = s.crew.find((x) => x.id === j.executor); if (c) c.loc = s.shelter || s.pendingShelter ? 'shelter' : 'hab'; }
  s.job = null;
  if (s.pendingShelter) { s.pendingShelter = false; s.shelter = true; for (const c of s.crew) c.loc = 'shelter'; }
  notify(s, `done.${j.action}`, { target: j.target, ...(out || {}) }, { causeIds: [lid] });
  return out;
}
