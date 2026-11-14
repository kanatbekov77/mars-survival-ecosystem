// Initial state and shared helpers (log, notices, pending effects).
import { getConfig, CREW, CONFIG_VERSION, ENGINE_VERSION, DEFAULT_PLAN } from './config.js';
import { makeZone } from './physics.js';

export function createState({ profile = 'engineer', seed = 1, mode = 'campaign', timer = 'on' } = {}) {
  const cfg = getConfig(profile);
  const s = {
    schema: 1,
    configVersion: CONFIG_VERSION,
    engineVersion: ENGINE_VERSION,
    profile,
    seed: seed >>> 0,
    mode,
    timer, // 'on' | 'off' (unlimited)
    tick: 0,
    eventsDoneTick: -1,
    status: 'active',
    ending: null,
    zones: { hab: makeZone(cfg.zones.hab), gh: makeZone(cfg.zones.gh) },
    tanks: { O2: cfg.tanks.O2, N2: cfg.tanks.N2, CO2gh: cfg.tanks.CO2gh },
    water: { clean: cfg.water.clean, grey: cfg.water.grey, quarantine: 0, quarantineState: 'none', fromSample: 0 },
    sinks: { water: 0, H2: 0, CO2out: 0, condensate: 0, harvestWater: 0, leakO2: 0, leakN2: 0, leakCO2: 0, leakH2O: 0, soil: 0, curtailedKWh: 0 },
    food: { packs: cfg.food.kcal, fresh: [], spoiled: 0 },
    stores: { ...cfg.stores },
    warehouse: { kcal: 0, water: 0, parts: 0 },
    cache: 'none', // none | field | warehouse | taken
    energy: {
      soc: cfg.energy.soc,
      clean: [1, 1],
      folded: [false, false],
      panelOk: [true, true],
      L: 1,
      mainBus: true,
      reserve: { mode: 'standby', startingTo: null, lockUntil: -1, contTicks: 0, maintDue: null, limited: false, hours: 0 },
      plan: [...DEFAULT_PLAN],
      lastPV: 0,
      lastNet: 0,
      lastUse: 0,
      dispatch: {},
      rejected: {},
    },
    Tout: -40,
    cold: false,
    sep: 0, // spike EU/h currently applied
    sepWarning: false,
    eq: {
      scrubMain: true,
      scrubMode: 'main', // main | emergency
      scrubSwitchAt: null,
      cartridge: 0, // remaining capacity kg in inserted cartridge (0 = none)
      cartridgeInserted: false,
      fan: true,
      electrolysis: 'auto',
      recycle: 'auto',
      recycleEff: 0.88,
      cassetteOk: true,
      pump: true,
      led: true,
      ledMode: 'auto',
      relay: true,
      ghHeat: 'auto',
      habIsolated: false,
      ghIsolated: false,
      airlockLeak: false,
    },
    ghMode: 'normal', // normal | preserve
    crops: [
      { id: 'A', species: 'lettuce', eff: 18, water: 1.5, nutrients: 1, stress: 0, halved: false, state: 'growing', plantedTick: -1, grewSol: 0, solGrowth: 0 },
      { id: 'B', species: null, eff: 0, water: 0, nutrients: 0, stress: 0, halved: false, state: 'empty', plantedTick: null, grewSol: 0, solGrowth: 0 },
    ],
    crew: CREW.map((c) => ({ id: c.id, role: c.role, dose: 0, dose24: new Array(24).fill(0), loc: 'hab', evaBanUntil: -1 })),
    shelter: false,
    ration: 1,
    fatigue: 0,
    tokens: cfg.tokens,
    tokenPenaltyNext: 0,
    job: null,
    sensors: { habPOffset: 0, habPChecked: false },
    alarms: { active: {}, safe: {} },
    stopCounters: {},
    events: { fired: {}, local: {}, activeLocal: null },
    pending: [],
    missions: {},
    flags: {
      observed: {}, decisions: {}, quiz: {}, inspected: {}, samples: [], sends: [], landCheckTick: null,
      landingConfirmed: false, protocols: { air: false, water: false, farm: false, energy: false }, tech: {},
      techUnlocked: { T_TELEMETRY: false }, harvests: 0, recycledThisSol: 0, planSaved: {}, scrubFailedTick: null,
      iceAvailable: false, scrubPreferredMain: true, cleanedTicks: [], forecastSent: false, tasksSeen: {},
    },
    inbox: [],
    replies: [],
    decision: null,
    counters: { rationLowTicks: 0, rationLowSols: 0, coldTicks: 0, foodLowStreak: 0, ghLeakTicks: 0, airlockLeakTicks: 0, ghWetTicks: 0, ghRhHist: [] },
    history: [],
    log: [],
    seq: 0,
    stats: { minSoC: cfg.energy.soc, minClean: cfg.water.clean, partsUsed: 0, autopauses: 0, harvestKcal: 0, firstTerminal: null, deadlinesMissed: 0, maxDose: 0 },
    pauses: [],
  };
  Object.defineProperty(s, 'cfg', { value: cfg, enumerable: false, writable: true }); // not serialized
  return s;
}

export function cfgOf(s) {
  if (!s.cfg) Object.defineProperty(s, 'cfg', { value: getConfig(s.profile), enumerable: false, writable: true });
  return s.cfg;
}

// Append a causal log entry. Returns its id.
export function log(s, type, data = {}) {
  if (s._sim) return null;
  const id = `L${s.tick}-${s.seq++}`;
  s.log.push({ id, tick: s.tick, type, ...data });
  return id;
}

export function pause(s, kind, data = {}) {
  if (s._sim) return;
  s.pauses.push({ kind, tick: s.tick, ...data });
}

export function addPending(s, { key, dueTick, effect, causeIds = [], data = {} }) {
  if (s.pending.some((p) => p.key === key && p.status === 'pending')) return null;
  const p = { id: `P${s.tick}-${s.seq++}`, key, dueTick, effect, causeIds, status: 'pending', data, createdTick: s.tick };
  s.pending.push(p);
  const lid = log(s, 'pending', { key: `pending.${effect}`, pendingId: p.id, dueTick, causeIds });
  p.logId = lid;
  return p;
}

export function cancelPending(s, key, reason) {
  for (const p of s.pending) {
    if (p.key === key && p.status === 'pending') {
      p.status = 'canceled';
      log(s, 'pendingCanceled', { key: `pending.${p.effect}`, pendingId: p.id, reason, causeIds: [p.logId] });
    }
  }
}

export function notify(s, key, params = {}, opts = {}) {
  const id = log(s, opts.type || 'notice', { key, params, severity: opts.severity || 'info', causeIds: opts.causeIds || [], causalRootId: opts.root });
  if (opts.pause) pause(s, opts.pause === true ? 'notice' : opts.pause, { key, params, logId: id, severity: opts.severity || 'info' });
  return id;
}

export function deepClone(o) {
  return structuredClone(o);
}
