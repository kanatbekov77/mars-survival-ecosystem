// Run controller: commands, command log, replay, forecast, saves (GDD §11).
import { TOTAL_TICKS, T, solOf, slotOf, DEFAULT_PLAN, CONFIG_VERSION, ENGINE_VERSION } from './config.js';
import { createState, cfgOf, log, deepClone } from './state.js';
import { step, sensorView } from './sim.js';
import { startJob, cancelJob, previewJob } from './actions.js';
import { applyChoice, setReserve } from './events.js';
import { zoneReadings } from './physics.js';
import { sha256Hex } from './sha256.js';

export const SAVE_SCHEMA = 1;

export const PRESETS = {
  standard: { plan: DEFAULT_PLAN, electrolysis: 'auto', recycle: 'auto', ledMode: 'auto', ghMode: 'normal', pumpMode: 'auto' },
  storm: { plan: ['recycle', 'electrolysis', 'job', 'greenhouse'], electrolysis: 'auto', recycle: 'auto', ledMode: 'off', ghMode: 'preserve', reserve: 'assist' },
  night: { plan: ['greenhouse', 'recycle', 'job', 'electrolysis'], electrolysis: 'auto' },
  saveWater: { electrolysis: 'off', pumpMode: 'auto', plan: ['recycle', 'greenhouse', 'job', 'electrolysis'] },
  savePlants: { ghMode: 'preserve', ledMode: 'off' },
};

const MODES = {
  electrolysis: ['auto', 'off', 'on'], recycle: ['auto', 'off'], ledMode: ['auto', 'off'], ghHeat: ['auto', 'on', 'off'],
  habHeat: ['auto', 'off'], pumpMode: ['auto', 'off'], ghDehum: ['auto', 'off'],
};

export function applyCommand(s, cmd) {
  cfgOf(s);
  if (s.status !== 'active' && !['observe'].includes(cmd.type)) return 'req.over';
  const blockedByDecision = s.decision && !['choose', 'observe', 'quiz'].includes(cmd.type);
  if (blockedByDecision) return 'req.decision';
  switch (cmd.type) {
    case 'observe':
      s.flags.observed[cmd.target] = s.tick;
      if (cmd.target === 'panels' && solOf(s.tick) === 10) s.flags.observed.panels10 = s.tick;
      return null;
    case 'startJob': return startJob(s, cmd.action, cmd.target, cmd.payload);
    case 'cancelJob': return cancelJob(s, 'player');
    case 'choose': return applyChoice(s, cmd.choiceId, !!cmd.expired);
    case 'setMode': {
      if (!MODES[cmd.system]?.includes(cmd.value)) return 'req.mode';
      s.eq[cmd.system] = cmd.value;
      log(s, 'mode', { key: 'log.mode', system: cmd.system, value: cmd.value });
      return null;
    }
    case 'setReserve': return setReserve(s, cmd.mode);
    case 'fold': {
      if (![0, 1].includes(cmd.panel)) return 'req.target';
      s.energy.folded[cmd.panel] = !!cmd.value;
      log(s, 'fold', { key: cmd.value ? 'log.fold' : 'log.unfold', panel: cmd.panel });
      return null;
    }
    case 'isolate': {
      const k = cmd.zone === 'gh' ? 'ghIsolated' : 'habIsolated';
      s.eq[k] = !!cmd.value;
      if (cmd.zone === 'gh' && cmd.value) s.flags.ghIsolatedTick = s.tick;
      log(s, 'isolate', { key: cmd.value ? 'log.isolate' : 'log.unisolate', zone: cmd.zone });
      return null;
    }
    case 'shelter': {
      if (cmd.value) {
        if (s.job?.eva) cancelJob(s, 'shelter');
        s.shelter = true;
        for (const c of s.crew) c.loc = 'shelter';
      } else {
        s.shelter = false;
        for (const c of s.crew) if (c.loc === 'shelter') c.loc = 'hab';
      }
      log(s, 'shelter', { key: cmd.value ? 'log.shelter' : 'log.unshelter' });
      return null;
    }
    case 'switchScrub': {
      if (cmd.to === 'emergency') {
        if (!s.eq.cartridgeInserted) {
          if (s.stores.cartridges < 1) return 'req.mat.cartridges';
          s.stores.cartridges -= 1; s.eq.cartridgeInserted = true; s.eq.cartridge = cfgOf(s).cartridgeKg;
        } else if (s.eq.cartridge <= 1e-8) return 'req.cartridgeEmpty';
      } else if (!(s.eq.scrubMain && s.eq.fan)) return 'req.scrubBroken';
      s.eq.scrubSwitchAt = s.tick + 1;
      s.eq.scrubSwitchTo = cmd.to;
      log(s, 'scrub', { key: `log.scrub.${cmd.to}` });
      return null;
    }
    case 'ration':
      if (![1, 0.9].includes(cmd.value)) return 'req.mode';
      s.ration = cmd.value; log(s, 'ration', { key: 'log.ration', value: cmd.value }); return null;
    case 'ghMode':
      if (!['normal', 'preserve'].includes(cmd.value)) return 'req.mode';
      s.ghMode = cmd.value; s.eq.ledMode = cmd.value === 'preserve' ? 'off' : 'auto';
      log(s, 'ghMode', { key: `log.ghMode.${cmd.value}` }); return null;
    case 'setPlan': {
      const ok = Array.isArray(cmd.order) && cmd.order.length === DEFAULT_PLAN.length && DEFAULT_PLAN.every((x) => cmd.order.includes(x));
      if (!ok) return 'req.plan';
      s.energy.plan = [...cmd.order];
      s.flags.planChangedTick = s.tick;
      log(s, 'plan', { key: 'log.plan', order: cmd.order });
      return null;
    }
    case 'preset': {
      const p = PRESETS[cmd.id];
      if (!p) return 'req.preset';
      if (p.plan) { s.energy.plan = [...p.plan]; s.flags.planChangedTick = s.tick; }
      for (const k of ['electrolysis', 'recycle', 'ledMode', 'pumpMode']) if (p[k]) s.eq[k] = p[k];
      if (p.ghMode) s.ghMode = p.ghMode;
      if (p.reserve) setReserve(s, p.reserve, { viaDecision: true });
      log(s, 'preset', { key: `preset.${cmd.id}.name` });
      return null;
    }
    case 'decide': s.flags.decisions[cmd.key] = cmd.value; log(s, 'decide', { key: `dec.${cmd.key}.${cmd.value}` }); return null;
    case 'quiz': s.flags.quiz[cmd.key] = !!cmd.correct; return null;
    case 'savePlan': s.flags.planSaved[solOf(s.tick)] = s.tick; log(s, 'plan', { key: 'log.planSaved' }); return null;
    default: return 'req.unknown';
  }
}

// ------------- forecast (no hidden rolls, no logging) -------------
export function forecast(s, ticks) {
  const c = deepClone(s);
  c._sim = true;
  c.log = []; c.history = [];
  const out = [];
  for (let i = 0; i < ticks; i++) {
    if (c.status !== 'active' || c.tick >= TOTAL_TICKS) break;
    const r = step(c);
    if (r.blocked) { out.push({ blocked: r.blocked, t: c.tick }); break; }
    const h = zoneReadings(c.zones.hab);
    out.push({ t: c.tick - 1, soc: c.energy.soc, pO2: h.pO2, pCO2: h.pCO2, P: h.P, T: h.T, water: c.water.clean, o2: c.tanks.O2, food: c.food.packs + c.food.fresh.reduce((a, f) => a + f.kcal, 0), pv: c.energy.lastPV, net: c.energy.lastNet, status: c.status });
  }
  return out;
}

export function forecastEndOfSol(s) {
  const left = 24 - slotOf(s.tick);
  const f = forecast(s, left);
  const last = f.filter((x) => !x.blocked).slice(-1)[0];
  return { soc: last ? last.soc : s.energy.soc, minSoc: Math.min(s.energy.soc, ...f.filter((x) => !x.blocked).map((x) => x.soc)), series: f, blocked: f.find((x) => x.blocked) };
}

// ------------- Run controller -------------
export class Run {
  constructor(meta = {}) {
    this.meta = { id: meta.id || `run-${(meta.seed >>> 0) || 1}-${meta.profile || 'engineer'}`, parentId: meta.parentId || null, profile: meta.profile || 'engineer', seed: (meta.seed ?? 1) >>> 0, mode: meta.mode || 'campaign', timer: meta.timer || 'on', branchStartTick: meta.branchStartTick || 0 };
    this.state = createState(this.meta);
    this.commands = [];
    this.seq = 0;
  }
  get tick() { return this.state.tick; }
  exec(cmd) {
    const pre = this.state.eventsDoneTick !== this.state.tick;
    const reason = applyCommand(this.state, cmd);
    if (!reason) this.commands.push({ atTick: this.state.tick, pre, sequence: this.seq++, cmd: deepClone(cmd) });
    return reason;
  }
  step() { return step(this.state); }
  preview(action, target, payload) { return previewJob(this.state, action, target, payload); }
  hash() { return sha256Hex(JSON.stringify(this.state)); }

  static replay(meta, commands, untilTick = TOTAL_TICKS, onTick) {
    const run = new Run(meta);
    const byTick = new Map();
    for (const c of commands) { if (!byTick.has(c.atTick)) byTick.set(c.atTick, []); byTick.get(c.atTick).push(c); }
    while (run.state.status === 'active' && run.state.tick < untilTick) {
      const t = run.state.tick;
      const list = (byTick.get(t) || []).sort((a, b) => a.sequence - b.sequence);
      for (const c of list.filter((x) => x.pre)) run.exec(c.cmd);
      let r = run.step();
      if (r.blocked === 'decision') {
        for (const c of list.filter((x) => !x.pre)) run.exec(c.cmd);
        if (run.state.decision) {
          // decision unresolved in log: stop here (the save holds an open decision)
          break;
        }
        r = run.step();
      } else {
        // post-phase commands without a decision (UI actions taken after events fired)
        // were applied before step in the live run only if pre=false and no block; mirror that
      }
      if (onTick) onTick(run, r);
    }
    return run;
  }

  toSave(remainingDecisionMs = null) {
    const snapshot = JSON.parse(JSON.stringify(this.state));
    const env = {
      schemaVersion: SAVE_SCHEMA, configVersion: CONFIG_VERSION, engineVersion: ENGINE_VERSION, meta: this.meta,
      lastCommittedTick: this.state.tick, stateSnapshot: snapshot, commandLog: this.commands,
      unresolvedDecision: this.state.decision ? this.state.decision.eventId : null, remainingDecisionMs, savedAtUTC: new Date().toISOString(),
    };
    env.checksum = sha256Hex(JSON.stringify(env.stateSnapshot) + JSON.stringify(env.commandLog));
    return env;
  }

  static fromSave(env) {
    if (!env || env.schemaVersion !== SAVE_SCHEMA) throw new Error('save.schema');
    const sum = sha256Hex(JSON.stringify(env.stateSnapshot) + JSON.stringify(env.commandLog));
    if (sum !== env.checksum) throw new Error('save.checksum');
    if (env.configVersion !== CONFIG_VERSION) throw new Error('save.config');
    const run = new Run(env.meta);
    run.state = env.stateSnapshot;
    cfgOf(run.state);
    run.commands = env.commandLog;
    run.seq = env.commandLog.length ? env.commandLog[env.commandLog.length - 1].sequence + 1 : 0;
    run.remainingDecisionMs = env.remainingDecisionMs;
    return run;
  }

  branchFromSol(sol) {
    const until = T(sol, 0);
    const meta = { ...this.meta, id: `${this.meta.id}-b${sol}-${this.commands.length}`, parentId: this.meta.id, branchStartTick: until };
    const keep = this.commands.filter((c) => c.atTick < until);
    const r = Run.replay(meta, keep, until);
    r.meta = meta;
    return r;
  }
}

export { sensorView };
