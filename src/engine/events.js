// Campaign schedule (GDD §6), mandatory decisions and local events with SHA-256 rolls.
import { T, solOf, slotOf, isLightSlot } from './config.js';
import { roll } from './sha256.js';
import { log, notify, pause, cfgOf } from './state.js';
import { startJob, cancelJob } from './actions.js';

export const STORM1 = [T(8, 10), T(10, 6)];
export const HAZE1 = [T(10, 6), T(11, 0)];
export const STORM2 = [T(29, 3), T(30, 21)];
export const FROST = [T(17, 15), T(18, 3)];
export const SEP1 = { warn: T(13, 3), start: T(13, 7), end: T(13, 12), flux: 1.2 };
export const SEP2 = { warn: T(23, 10), start: T(23, 14), end: T(23, 21), flux: 0.8 };
export const LANDING_DEADLINE = T(28, 23);

const inR = (t, [a, b]) => t >= a && t < b;

export function lightAt(t) {
  if (inR(t, STORM1)) return 0.25;
  if (inR(t, HAZE1)) return 0.65;
  if (inR(t, STORM2)) return 0.18;
  return 1;
}
export function toutAt(t) {
  if (t >= FROST[0] && t <= FROST[1]) return -82;
  return isLightSlot(slotOf(t)) ? -40 : -65;
}
export function sepFluxAt(t) {
  for (const e of [SEP1, SEP2]) if (t >= e.start && t <= e.end) return e.flux;
  return 0;
}
export function sepWarningAt(t) {
  for (const e of [SEP1, SEP2]) if (t >= e.warn && t <= e.end) return true;
  return false;
}

// ---------- reserve control (GDD §4.1) ----------
export function setReserve(s, mode, { emergency = false, viaDecision = false } = {}) {
  const r = s.energy.reserve;
  if (s.tick < T(1, 1)) return 'req.reserveLater';
  if (mode === r.mode && !r.startingTo) return null;
  if (r.lockUntil > s.tick) {
    if (viaDecision) { r.queued = mode; log(s, 'reserveQueued', { key: 'log.reserveQueued', mode }); return null; }
    return 'req.reserveLock';
  }
  if (r.mode === 'standby' && mode !== 'standby') {
    r.startingTo = mode;
    r.startTick = s.tick;
    r.emergencyStart = emergency;
  } else {
    r.mode = mode;
    r.startingTo = null;
  }
  r.lockUntil = s.tick + 6 + (r.startingTo ? 1 : 0);
  log(s, 'reserve', { key: `log.reserve.${mode}`, mode });
  return null;
}

function openDecision(s, eventId, choices, def, timed) {
  const seconds = timed ? cfgOf(s).stormTimer : null;
  s.decision = { eventId, choices, defaultChoiceId: def, timerSeconds: s.timer === 'off' ? null : seconds, openedTick: s.tick };
  const id = log(s, 'decisionOpen', { key: `ev.${eventId}.title`, eventId, causalRootId: eventId });
  s.decision.logId = id;
  pause(s, 'decision', { eventId, logId: id, severity: 'critical' });
}

export function applyChoice(s, choiceId, expired = false) {
  const d = s.decision;
  if (!d) return 'req.noDecision';
  if (!d.choices.includes(choiceId)) return 'req.choice';
  s.decision = null;
  s.flags.decisions[d.eventId] = choiceId;
  const lid = log(s, 'choice', { key: `ch.${d.eventId}.${choiceId}`, eventId: d.eventId, choiceId, expired, causeIds: [d.logId], causalRootId: d.eventId });
  const ev = d.eventId;
  if (ev === 'E_DUST1' || ev === 'E_DUST2') {
    if (choiceId === 'safe') {
      setReserve(s, 'assist', { viaDecision: true });
      s.ghMode = 'preserve';
      s.eq.ledMode = 'off';
    } else if (choiceId === 'protect') {
      s.energy.folded[1] = true;
      s.flags.autoUnfold = true;
      setReserve(s, 'continuous', { viaDecision: true });
    }
  } else if (ev === 'E_SEP1' || ev === 'E_SEP2') {
    if (choiceId === 'shelter') {
      if (s.job?.eva) cancelJob(s, 'shelter');
      s.shelter = true;
      for (const c of s.crew) c.loc = 'shelter';
    } else if (choiceId === 'finish') {
      s.shelter = !s.job?.eva;
      if (s.job?.eva) s.pendingShelter = true;
      for (const c of s.crew) if (c.loc !== 'eva') c.loc = 'shelter';
      if (s.job?.eva) s.shelter = false;
    }
    // 'stay' keeps everyone in the habitat; new EVA is still blocked by the warning.
  } else if (ev === 'E_FEEDER') {
    setReserve(s, 'continuous', { emergency: s.energy.reserve.mode === 'standby', viaDecision: true });
    if (choiceId === 'repair') {
      if (s.job) cancelJob(s, 'feeder');
      const r = startJob(s, 'resetFeeder');
      if (r) notify(s, 'msg.feederNoRepair', { reason: r }, { causeIds: [lid] });
    }
  }
  return null;
}

// ---------- local events (GDD §6) ----------
const LOCAL = {
  L_PV: { ok: (s) => s.energy.clean.some((c, i) => !s.energy.folded[i] && s.energy.panelOk[i] && c > 0.65),
    apply(s) {
      let best = -1;
      s.energy.clean.forEach((c, i) => { if (!s.energy.folded[i] && c > 0.65 && (best < 0 || c > s.energy.clean[best])) best = i; });
      s.energy.clean[best] = Math.max(0.15, s.energy.clean[best] - 0.18);
      return { panel: best };
    }, resolved: () => true },
  L_PUMP: { ok: (s) => s.crops.some((c) => c.state === 'growing' || c.state === 'ripe'), apply(s) { s.eq.pump = false; }, resolved: (s) => s.eq.pump },
  L_FAN: { ok: (s) => s.stores.spareFans > 0 && s.eq.fan, apply(s) { s.eq.fan = false; if (s.eq.scrubMode === 'main') s.flags.fanFailTick = s.tick; }, resolved: (s) => s.eq.fan },
  L_RELAY: { ok: (s) => s.tick <= LANDING_DEADLINE - 48 && !s.flags.landingConfirmed, apply(s) { s.eq.relay = false; }, resolved: (s) => s.eq.relay },
  L_SEAL: { ok: (s) => s.zones.gh.leak === 0 && solOf(s.tick) > 3, apply(s) { s.zones.hab.leak = 0.001; s.zones.hab.kExtra = 0.008; s.eq.airlockLeak = true; }, resolved: (s) => !s.eq.airlockLeak },
  L_ADVICE: { ok: (s) => s.flags.sends.length > 0, apply(s) { s.inbox.push({ tick: T(solOf(s.tick) + 1, 0), key: 'msg.advice' }); }, resolved: () => true },
  L_LAB: { ok: (s) => solOf(s.tick) >= 5, apply(s) { s.flags.labTask = { until: T(solOf(s.tick) + 2, 0) - 1 }; }, resolved: () => true },
};

function localExcluded(s) {
  const t = s.tick;
  if (sepWarningAt(t)) return true;
  if (!s.energy.mainBus) return true;
  if (lightAt(t) <= 0.25) return true;
  if (s.events.activeLocal && !LOCAL[s.events.activeLocal].resolved(s)) return true;
  return false;
}

function localRoll(s) {
  const cfg = cfgOf(s);
  const sol = solOf(s.tick), slot = slotOf(s.tick);
  if (!cfg.localSlots.some(([a, b]) => a === sol && b === slot)) return;
  if (s._sim) return; // forecasts never reveal hidden rolls
  if (s.mode === 'demo') return; // curated runs fix their events
  const { u, v } = roll(s.configVersion, s.seed, s.tick);
  const rec = { tick: s.tick, u, hit: u < cfg.localP };
  if (!rec.hit || localExcluded(s)) { log(s, 'localRoll', { key: 'log.localNone', ...rec }); return; }
  const pool = cfg.localPool.filter((id) => !s.events.local[id] && LOCAL[id].ok(s)).sort();
  if (!pool.length) { log(s, 'localRoll', { key: 'log.localNone', ...rec }); return; }
  const id = pool[Math.floor(v * pool.length)];
  const out = LOCAL[id].apply(s) || {};
  s.events.local[id] = s.tick;
  s.events.activeLocal = id;
  notify(s, `ev.${id}.title`, out, { type: 'event', severity: 'warning', pause: true, root: id });
}

// ---------- scheduled campaign events ----------
const SCHEDULE = [
  [T(1, 0), 'E_START', (s) => notify(s, 'ev.E_START.title', {}, { type: 'event', root: 'E_START' })],
  [T(3, 4), 'E_PROBE', (s) => { s.zones.gh.leak = 0.001; s.zones.gh.kExtra = 0.008; notify(s, 'ev.E_PROBE.title', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_PROBE' }); }],
  [T(7, 0), 'E_FORECAST', (s) => notify(s, s.flags.forecastSent ? 'ev.E_FORECAST.cmu' : 'ev.E_FORECAST.local', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_FORECAST' })],
  [T(8, 10), 'E_DUST1', (s) => openDecision(s, 'E_DUST1', ['safe', 'protect', 'custom'], 'safe', true)],
  [T(10, 6), 'E_DUST1_END', (s) => { if (s.flags.autoUnfold) { s.energy.folded[1] = false; s.flags.autoUnfold = false; } if (s.ghMode === 'preserve' && s.flags.decisions.E_DUST1 === 'safe') { s.ghMode = 'normal'; s.eq.ledMode = 'auto'; } notify(s, 'ev.E_DUST1_END.title', {}, { type: 'event', pause: true, root: 'E_DUST1' }); }],
  [T(11, 4), 'E_SCRUB', (s) => { s.eq.scrubMain = false; s.flags.scrubFailedTick = s.tick; notify(s, 'ev.E_SCRUB.title', {}, { type: 'event', severity: 'critical', pause: true, root: 'E_SCRUB' }); }],
  [SEP1.warn, 'E_SEP1', (s) => openDecision(s, 'E_SEP1', ['shelter', 'finish', 'stay'], 'shelter', false)],
  [SEP1.end + 1, 'E_SEP1_END', (s) => endSep(s, 'E_SEP1')],
  [T(15, 6), 'E_WATER', (s) => { s.eq.cassetteOk = false; s.eq.recycleEff = 0.5; notify(s, 'ev.E_WATER.title', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_WATER' }); }],
  [T(16, 0), 'E_CACHE', (s) => { s.cache = 'field'; notify(s, 'ev.E_CACHE.title', {}, { type: 'event', pause: true, root: 'E_CACHE' }); }],
  [FROST[0], 'E_FROST', (s) => notify(s, 'ev.E_FROST.title', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_FROST' })],
  [T(18, 0), 'E_ICE', (s) => { s.flags.iceAvailable = true; notify(s, 'ev.E_ICE.title', {}, { type: 'event', pause: true, root: 'E_ICE' }); }],
  [T(19, 6), 'E_SENSOR', (s) => { s.sensors.habPOffset = -12; s.sensors.habPChecked = false; s.flags.sensorFaultTick = s.tick; }],
  [T(21, 9), 'E_FEEDER', (s) => { s.energy.mainBus = false; if (s.job && !['resetFeeder', 'serviceReserve', 'inspect', 'calibrate', 'send', 'rest'].includes(s.job.action)) cancelJob(s, 'feeder'); openDecision(s, 'E_FEEDER', ['repair', 'reserve'], 'repair', false); }],
  [SEP2.warn, 'E_SEP2', (s) => openDecision(s, 'E_SEP2', ['shelter', 'finish', 'stay'], 'shelter', false)],
  [SEP2.end + 1, 'E_SEP2_END', (s) => endSep(s, 'E_SEP2')],
  [T(25, 0), 'E_LANDING_CHECK', (s) => notify(s, 'ev.E_LANDING_CHECK.title', {}, { type: 'event', pause: true, root: 'E_LANDING_CHECK' })],
  [T(28, 18), 'E_DUST2_FORECAST', (s) => notify(s, 'ev.E_DUST2_FORECAST.title', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_DUST2' })],
  [LANDING_DEADLINE + 1, 'E_LANDING_DEADLINE', (s) => { if (!s.flags.landingConfirmed) { s.stats.deadlinesMissed += 1; notify(s, 'ev.E_LANDING_DEADLINE.missed', {}, { type: 'event', severity: 'warning', pause: true, root: 'E_LANDING_CHECK' }); } else notify(s, 'ev.E_LANDING_DEADLINE.ok', {}, { type: 'event', root: 'E_LANDING_CHECK' }); }],
  [STORM2[0], 'E_DUST2', (s) => openDecision(s, 'E_DUST2', ['safe', 'protect', 'custom'], 'safe', true)],
  [STORM2[1], 'E_DUST2_END', (s) => { if (s.flags.autoUnfold) { s.energy.folded[1] = false; s.flags.autoUnfold = false; } if (s.ghMode === 'preserve' && s.flags.decisions.E_DUST2 === 'safe') { s.ghMode = 'normal'; s.eq.ledMode = 'auto'; } notify(s, 'ev.E_DUST2_END.title', {}, { type: 'event', root: 'E_DUST2' }); }],
];

function endSep(s, id) {
  s.shelter = false;
  s.pendingShelter = false;
  for (const c of s.crew) if (c.loc === 'shelter') c.loc = 'hab';
  notify(s, `ev.${id}_END.title`, {}, { type: 'event', pause: true, root: id });
}

// Fire scheduled events, replies and local rolls for the current tick.
export function fireEvents(s) {
  const t = s.tick;
  s.energy.L = lightAt(t);
  s.Tout = toutAt(t);
  s.cold = t >= FROST[0] && t <= FROST[1];
  s.sep = sepFluxAt(t);
  s.sepWarning = sepWarningAt(t);
  // environment, big failures and deadlines in schedule order (stable by ID within a tick)
  const due = SCHEDULE.filter(([at]) => at === t).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  for (const [, id, fn] of due) {
    if (s.events.fired[id]) continue;
    s.events.fired[id] = t;
    if (s.mode === 'sandbox') continue;
    fn(s);
  }
  // delayed replies from mission control arrive at slot 0
  for (const r of s.replies) {
    if (!r.done && r.dueTick === t) { r.done = true; s.inbox.push({ tick: t, key: r.key }); notify(s, r.key, {}, { type: 'message' }); }
  }
  for (const m of s.inbox) if (m.tick === t && m.key === 'msg.advice' && !m.shown) { m.shown = true; notify(s, 'msg.advice', {}, { type: 'message' }); }
  localRoll(s);
}
