// The tick: deterministic state transition (GDD §2 order of operations).
import { H, LOADS, FIXED_PLAN, SECONDARY_BUS, DOSE, CROPS, THRESH, TOTAL_TICKS, solOf, slotOf, isLightSlot, isLedSlot, isNightSlot, T } from './config.js';
import { zoneReadings, massFor, psat, leakFraction, clamp, EPS } from './physics.js';
import { cfgOf, log, notify, pause, addPending } from './state.js';
import { fireEvents } from './events.js';
import { finishJob, cancelJob } from './actions.js';
import { evaluateMissions, closeSolMissions } from './missions.js';
import { evaluateEnding } from './ending.js';

// ---------------- power dispatch ----------------
function heaterRequest(z, Tout, Qpeople, QelecPrev, C, K, Pmax) {
  const req = ((21 - z.T) * C) / H + (K + z.kExtra) * (z.T - Tout) - Qpeople - QelecPrev;
  return clamp(req, 0, Pmax);
}

function rhOf(z) { return zoneReadings(z).RH; }

function activeTrays(s) { return s.crops.filter((c) => c.state === 'growing' || c.state === 'ripe'); }

export function buildLoads(s) {
  const cfg = cfgOf(s);
  const slot = slotOf(s.tick);
  const hab = s.zones.hab, gh = s.zones.gh;
  const L = [];
  const r = s.energy.reserve;
  if (r.startingTo && !r.emergencyStart) L.push({ id: 'reserveStart', kw: 0.5 / H, bus: 'secondary' });
  // habitat air: fan + scrubber
  let fanKW = 0, scrub = 'none';
  const emergencyReady = s.eq.scrubMode === 'emergency' && s.eq.cartridgeInserted && s.eq.cartridge > EPS;
  if (emergencyReady) { fanKW = LOADS.habEmergency; scrub = 'emergency'; }
  else if (s.eq.fan && s.eq.scrubMain && s.eq.scrubMode === 'main') { fanKW = LOADS.habFan; scrub = 'main'; }
  else if (s.eq.fan) { fanKW = LOADS.habFanOnly; scrub = 'none'; }
  const habLoads = [];
  habLoads.push({ id: 'habFan', kw: fanKW, bus: 'secondary', scrub });
  const habQelecPrev = s.energy.qelecPrev?.hab ?? 0.25 * (fanKW + 0.45);
  const heatMode = s.eq.habHeat || 'auto';
  if (hab.T > 24) habLoads.push({ id: 'habRadiator', kw: LOADS.radiator, bus: 'secondary' });
  else if (heatMode === 'auto') habLoads.push({ id: 'habHeat', kw: heaterRequest(hab, s.Tout, 0.4, habQelecPrev, cfg.zones.hab.C, cfg.zones.hab.K, cfg.zones.hab.heatMax), modulated: true, bus: 'secondary' });
  if (rhOf(hab) > cfg.zones.hab.rhSet + EPS) habLoads.push({ id: 'habDehum', kw: cfg.zones.hab.dehumKW, bus: 'secondary' });
  const groups = { habFan: [habLoads[0]], habHeat: habLoads.filter((x) => x.id === 'habHeat' || x.id === 'habRadiator'), habDehum: habLoads.filter((x) => x.id === 'habDehum') };
  // electrolysis
  const elMode = s.eq.electrolysis;
  const elWant = elMode === 'on' || (elMode === 'auto' && s.tanks.O2 < cfg.electrolysisThreshold);
  groups.electrolysis = elWant && s.water.clean > 25 + EPS && s.tanks.O2 < cfg.tanks.O2cap - EPS ? [{ id: 'electrolysis', kw: LOADS.electrolysis, bus: 'main' }] : [];
  // water recycling
  const qReady = s.water.quarantineState === 'passed' && s.water.quarantine > EPS;
  const recKW = s.flags.tech.T_LOOP ? LOADS.recycleLoop : LOADS.recycle;
  const recBus = s.flags.tech.T_ISOLATION ? 'secondary' : 'main';
  groups.recycle = s.eq.recycle === 'auto' && isLightSlot(slot) && (s.water.grey > EPS || qReady) && s.water.clean < cfg.water.cleanCap - EPS ? [{ id: 'recycle', kw: recKW, bus: recBus }] : [];
  // greenhouse
  const trays = activeTrays(s);
  const gl = [];
  if (trays.length && s.eq.pump && s.eq.pumpMode !== 'off') gl.push({ id: 'ghPump', kw: LOADS.ghPump, bus: 'main' });
  const ledWanted = trays.length && s.eq.led && s.eq.ledMode !== 'off' && s.ghMode !== 'preserve' && isLedSlot(slot);
  if (ledWanted) gl.push({ id: 'ghLED', kw: LOADS.ghLED, bus: 'main' });
  const ghQelecPrev = s.energy.qelecPrev?.gh ?? 0;
  const ghHeatOn = s.eq.ghHeat === 'on' || (s.eq.ghHeat === 'auto' && trays.length > 0);
  if (gh.T > 24) gl.push({ id: 'ghRadiator', kw: LOADS.radiator, bus: 'main' });
  else if (ghHeatOn) gl.push({ id: 'ghHeat', kw: heaterRequest(gh, s.Tout, 0, ghQelecPrev, cfg.zones.gh.C, cfg.zones.gh.K, cfg.zones.gh.heatMax), modulated: true, bus: 'main' });
  if (rhOf(gh) > cfg.zones.gh.rhSet + EPS && s.eq.ghDehum !== 'off') gl.push({ id: 'ghDehum', kw: cfg.zones.gh.dehumKW, bus: 'main' });
  groups.greenhouse = gl;
  // job
  const j = s.job;
  groups.job = j && j.kw > 0 ? [{ id: 'job', kw: j.kw, bus: ['resetFeeder', 'serviceReserve', 'inspect', 'calibrate', 'send', 'rest'].includes(j.action) ? 'secondary' : 'main' }] : [];
  const order = [...FIXED_PLAN, ...s.energy.plan];
  for (const g of order) for (const x of groups[g] || []) L.push(x);
  return L;
}

export function dispatch(s, loads) {
  const cfg = cfgOf(s);
  const E = s.energy, r = E.reserve;
  const slot = slotOf(s.tick);
  let pv = 0;
  const pvPanels = [0, 0];
  if (E.mainBus && isLightSlot(slot)) {
    for (let i = 0; i < 2; i++) if (!E.folded[i] && E.panelOk[i]) { pvPanels[i] = cfg.energy.panelPeakKW * E.L * E.clean[i]; pv += pvPanels[i]; }
  }
  const resLimit = r.limited ? cfg.energy.reserveLimitedKW : cfg.energy.reserveKW;
  const resActive = !r.startingTo && (r.mode === 'assist' || r.mode === 'continuous');
  let pvLeft = pv * H;
  let resLeft = resActive ? resLimit * H : 0;
  const batMax = E.mainBus ? Math.min(cfg.energy.dischargeKW * H, E.soc * cfg.energy.etaOut) : 0;
  let batLeft = batMax;
  const given = {}, rejected = {};
  let used = 0;
  for (const ld of loads) {
    const onBus = E.mainBus || SECONDARY_BUS.has(ld.id) || ld.bus === 'secondary';
    const want = ld.kw * H;
    if (!onBus) { rejected[ld.id] = 'bus'; given[ld.id] = 0; continue; }
    const avail = pvLeft + resLeft + (E.mainBus ? batLeft : 0);
    let got;
    if (ld.modulated) got = Math.min(want, avail);
    else got = want <= avail + EPS ? want : 0;
    if (got < want - EPS && !ld.modulated) rejected[ld.id] = 'power';
    if (ld.modulated && got < want - EPS) rejected[ld.id] = 'partial';
    let need = got;
    const fromPv = Math.min(need, pvLeft); pvLeft -= fromPv; need -= fromPv;
    const fromRes = Math.min(need, resLeft); resLeft -= fromRes; need -= fromRes;
    const fromBat = Math.min(need, batLeft); batLeft -= fromBat; need -= fromBat;
    given[ld.id] = (given[ld.id] || 0) + got;
    used += got;
  }
  const batOut = batMax - batLeft;
  let socDelta = -batOut / cfg.energy.etaOut;
  // surplus: PV leftover plus continuous reserve leftover charges the battery
  let surplus = pvLeft + (r.mode === 'continuous' && resActive ? resLeft : 0);
  let charged = 0;
  if (E.mainBus && surplus > EPS && batOut < EPS) {
    const intoBat = Math.min(surplus, cfg.energy.chargeKW * H, Math.max(0, (cfg.energy.socCap - E.soc) / cfg.energy.etaIn));
    charged = intoBat * cfg.energy.etaIn;
    socDelta += charged;
    surplus -= intoBat;
  }
  s.sinks.curtailedKWh += Math.max(0, surplus);
  E.soc = clamp(E.soc + socDelta, 0, cfg.energy.socCap);
  const reserveOut = resActive ? (r.mode === 'continuous' ? resLimit * H : resLimit * H - resLeft) : 0;
  E.lastPV = pv; E.lastPanels = pvPanels; E.lastUse = used / H; E.lastNet = (pv * H + reserveOut - used) / H; E.lastReserve = reserveOut / H;
  E.lastBatOut = batOut / H; E.lastCharge = charged / H;
  E.dispatch = given; E.rejected = rejected;
  return given;
}

// ---------------- flows ----------------
function zoneLeak(s, z, zoneId) {
  if (z.leak <= 0) return 0;
  const P = zoneReadings(z).P;
  const f = leakFraction(z.leak, P, H);
  for (const k of ['O2', 'N2', 'CO2', 'H2O']) { const d = z.gas[k] * f; z.gas[k] -= d; s.sinks[`leak${k}`] += d; }
  return f;
}

function heatStep(z, P_heat, Qpeople, Qelec, Tout, C, K, Pcool) {
  const Q = P_heat + Qpeople + Qelec - (K + z.kExtra) * (z.T - Tout) - Pcool;
  z.T = z.T + (Q * H) / C;
}

function dehumidify(s, z, rhSet, maxKgH, T0) {
  const target = (rhSet * psat(T0) * 1000 * z.V) / (461.5 * (T0 + 273.15));
  const take = clamp(z.gas.H2O - target, 0, maxKgH * H);
  z.gas.H2O -= take;
  return take;
}

function passiveCondense(s, z) {
  const sat = (psat(z.T) * 1000 * z.V) / (461.5 * (z.T + 273.15));
  if (z.gas.H2O > sat + EPS) { const ex = z.gas.H2O - sat; z.gas.H2O = sat; s.sinks.condensate += ex; z.condensate = true; return ex; }
  z.condensate = false;
  return 0;
}

export function step(s) {
  const cfg = cfgOf(s);
  s.pauses = [];
  if (s.status !== 'active') return { blocked: 'over' };
  if (s.tick >= TOTAL_TICKS) return { blocked: 'over' };
  // 1. scheduled events and inputs
  if (s.eventsDoneTick !== s.tick) {
    s.eventsDoneTick = s.tick;
    if (slotOf(s.tick) === 0) startSol(s);
    fireEvents(s);
    processPendingDue(s);
  }
  // 2. an unresolved mandatory choice freezes the world
  if (s.decision) return { blocked: 'decision' };
  const t = s.tick, slot = slotOf(t);
  const hab = s.zones.hab, gh = s.zones.gh;
  // reserve queued / starting
  const r = s.energy.reserve;
  if (r.queued && r.lockUntil <= t) { const q = r.queued; r.queued = null; r.lockUntil = -1; setReserveDirect(s, q); }
  if (s.eq.scrubSwitchAt != null && s.eq.scrubSwitchAt <= t) { s.eq.scrubMode = s.eq.scrubSwitchTo; s.eq.scrubSwitchAt = null; }
  // 3. snapshot setpoints (state at tick start)
  const T0h = hab.T, T0g = gh.T;
  const habR0 = zoneReadings(hab), ghR0 = zoneReadings(gh);
  // job status
  if (s.job && s.job.status === 'queued') s.job.status = 'running';
  // 4. power
  const loads = buildLoads(s);
  const given = dispatch(s, loads);
  const powered = (id) => {
    const ld = loads.find((x) => x.id === id);
    return ld ? (given[id] || 0) >= ld.kw * H - EPS && ld.kw > 0 : false;
  };
  const kwOf = (id) => (given[id] || 0) / H;
  // reserve start completes after its tick
  if (r.startingTo) {
    if (r.emergencyStart || powered('reserveStart')) { r.mode = r.startingTo; r.startingTo = null; r.emergencyStart = false; log(s, 'reserveOnline', { key: `log.reserveOnline`, mode: r.mode }); }
  }
  // 5–6. flows
  // --- habitat
  zoneLeak(s, hab, 'hab');
  const ration = s.ration;
  // crew water use: 12 kg/sol; shortage scales outputs equally
  const waterNeed = 12 / 24;
  const waterUse = Math.min(waterNeed, Math.max(0, s.water.clean));
  const wFrac = waterNeed > 0 ? waterUse / waterNeed : 1;
  s.water.clean -= waterUse;
  let greyIn = (8 / 12) * waterUse;
  s.sinks.water += (1 / 12) * waterUse;
  s.waterFrac = wFrac;
  // breathing
  const o2Need = 3.36 / 24;
  const o2Used = Math.min(o2Need, hab.gas.O2);
  hab.gas.O2 -= o2Used;
  hab.gas.CO2 += 4 / 24;
  hab.gas.H2O += (3 / 12) * waterUse;
  // scrubber
  const fanLd = loads.find((x) => x.id === 'habFan');
  const fanOn = powered('habFan');
  const co2Floor = massFor('CO2', 0.05, T0h, hab.V);
  let co2Removed = 0;
  if (fanOn && fanLd.scrub === 'main') {
    co2Removed = clamp(hab.gas.CO2 - co2Floor, 0, 0.24 * H);
    s.sinks.CO2out += co2Removed;
  } else if (fanOn && fanLd.scrub === 'emergency') {
    co2Removed = clamp(Math.min(hab.gas.CO2 - co2Floor, s.eq.cartridge), 0, 0.20 * H);
    s.eq.cartridge -= co2Removed;
  }
  hab.gas.CO2 -= co2Removed;
  s.lastScrub = co2Removed;
  // O2 / N2 regulators (passive)
  const o2Def = massFor('O2', 19, T0h, hab.V) - hab.gas.O2;
  const o2Feed = clamp(o2Def, 0, Math.min(0.45 * H, s.tanks.O2));
  hab.gas.O2 += o2Feed; s.tanks.O2 -= o2Feed;
  const n2Def = massFor('N2', 65, T0h, hab.V) - hab.gas.N2;
  const n2Feed = clamp(n2Def, 0, Math.min(0.65 * H, s.tanks.N2));
  hab.gas.N2 += n2Feed; s.tanks.N2 -= n2Feed;
  // dehumidifier
  let greyCredit = 0;
  if (powered('habDehum')) greyCredit += dehumidify(s, hab, cfg.zones.hab.rhSet, cfg.zones.hab.dehumMax, T0h);
  // heat
  const habQelec = 0.25 * (kwOf('habFan') + kwOf('habDehum'));
  heatStep(hab, kwOf('habHeat'), 0.4, habQelec, s.Tout, cfg.zones.hab.C, cfg.zones.hab.K, powered('habRadiator') ? Math.min(1, ((T0h - 24) * cfg.zones.hab.C) / H) : 0);
  passiveCondense(s, hab);
  // --- electrolysis (credited at end of tick)
  let o2Made = 0;
  if (powered('electrolysis')) {
    o2Made = clamp(Math.min(0.15 * H, (s.water.clean - 25) / 1.125, cfg.tanks.O2cap - s.tanks.O2), 0, Infinity);
    s.water.clean -= 1.125 * o2Made;
    s.sinks.H2 += 0.125 * o2Made;
  }
  // --- greenhouse
  zoneLeak(s, gh, 'gh');
  const ledOn = powered('ghLED');
  const pumpOn = powered('ghPump');
  if (pumpOn) s.counters.pumpTicks = (s.counters.pumpTicks || 0) + 1;
  const trays = s.crops;
  let co2Uptake = 0;
  for (const c of trays) {
    if (c.state !== 'growing' && c.state !== 'ripe') continue;
    if (ledOn) {
      const take = Math.min(0.004 * H, Math.max(0, gh.gas.CO2 - massFor('CO2', 0.02, T0g, gh.V)));
      gh.gas.CO2 -= take; gh.gas.O2 += take * 32 / 44; co2Uptake += take;
    }
    // transpiration
    const tr = Math.min(c.water, ledOn ? 0.8 / 14 : 0.2 / 10);
    c.water -= tr; gh.gas.H2O += tr;
    // pump refill from clean tank (keeps 25 kg for crew)
    if (pumpOn) {
      const set = s.flags.tech.T_DRIP ? 1.2 : 1.5;
      const add = clamp(Math.min(set - c.water, 0.08 * H, s.water.clean - 25), 0, Infinity);
      c.water += add; s.water.clean -= add;
    }
  }
  // CO2 dosing from greenhouse tank
  if (partial0(gh, 'CO2', T0g) < 0.09 && s.tanks.CO2gh > EPS) {
    const dose = clamp(Math.min(massFor('CO2', 0.09, T0g, gh.V) - gh.gas.CO2, 0.012 * H, s.tanks.CO2gh), 0, Infinity);
    gh.gas.CO2 += dose; s.tanks.CO2gh -= dose;
  }
  if (powered('ghDehum')) greyCredit += dehumidify(s, gh, cfg.zones.gh.rhSet, cfg.zones.gh.dehumMax, T0g);
  heatStep(gh, kwOf('ghHeat'), 0, 0.85 * kwOf('ghLED'), s.Tout, cfg.zones.gh.C, cfg.zones.gh.K, powered('ghRadiator') ? Math.min(1, ((T0g - 24) * cfg.zones.gh.C) / H) : 0);
  passiveCondense(s, gh);
  s.energy.qelecPrev = { hab: habQelec, gh: 0.85 * kwOf('ghLED') };
  // --- water recycling (quarantine first once tested)
  let recOut = 0;
  if (powered('recycle')) {
    const eff = s.eq.recycleEff;
    const room = (cfg.water.cleanCap - s.water.clean) / eff;
    let cap = Math.min(1.15 * H, room);
    if (s.water.quarantineState === 'passed' && s.water.quarantine > EPS) {
      const q = Math.min(cap, s.water.quarantine);
      s.water.quarantine -= q; cap -= q; recOut += eff * q; s.sinks.water += (1 - eff) * q;
      s.water.fromSample += eff * q;
      if (s.water.fromSample >= 1 - EPS && s.flags.waterTested != null) s.flags.protocols.water = true;
    }
    const g = Math.min(cap, s.water.grey);
    s.water.grey -= g; recOut += eff * g; s.sinks.water += (1 - eff) * g;
  }
  s.flags.recycledThisSol += recOut;
  // --- food (fresh first, then packs)
  let kcalNeed = 400 * ration;
  s.food.fresh.sort((a, b) => a.expiresTick - b.expiresTick);
  for (const f of s.food.fresh) { const d = Math.min(f.kcal, kcalNeed); f.kcal -= d; kcalNeed -= d; }
  s.food.fresh = s.food.fresh.filter((f) => f.kcal > EPS);
  const fromPacks = Math.min(kcalNeed, s.food.packs);
  s.food.packs -= fromPacks; kcalNeed -= fromPacks;
  s.foodFrac = (400 * ration - kcalNeed) / 400;
  for (const f of s.food.fresh) if (f.expiresTick <= t) { s.food.spoiled += f.kcal; log(s, 'spoiled', { key: 'log.spoiled', outputs: { kcal: f.kcal } }); f.kcal = 0; }
  s.food.fresh = s.food.fresh.filter((f) => f.kcal > EPS);
  // --- crops: growth and stress
  cropStep(s, ledOn, pumpOn, slot);
  // --- end-of-tick credits
  s.tanks.O2 += o2Made;
  s.water.clean += recOut;
  s.water.grey += greyIn + greyCredit;
  if (s.water.grey > cfg.water.greyCap) { s.sinks.water += s.water.grey - cfg.water.greyCap; s.water.grey = cfg.water.greyCap; }
  s.lastFlows = { o2Made, o2Feed, co2Removed, recOut, co2Uptake, waterUse, greyCredit };
  // 7. jobs
  jobStep(s, given);
  // 8. exposure, delayed effects, missions, alarms
  doseStep(s);
  reserveStep(s);
  delayedConditions(s);
  alarmsAndStops(s);
  evaluateMissions(s);
  recordHistory(s);
  if (s.status !== 'active') return { done: true };
  // 9. advance clock
  s.tick += 1;
  if (slotOf(s.tick) === 0) endSol(s);
  if (s.tick >= TOTAL_TICKS) { evaluateEnding(s); return { done: true }; }
  return { ok: true };
}

function partial0(z, gas, T0) { return (z.gas[gas] * { O2: 259.8, N2: 296.8, CO2: 188.9, H2O: 461.5 }[gas] * (T0 + 273.15)) / (1000 * z.V); }

function setReserveDirect(s, mode) {
  const r = s.energy.reserve;
  if (r.mode === 'standby' && mode !== 'standby') { r.startingTo = mode; r.emergencyStart = false; }
  else r.mode = mode;
  r.lockUntil = s.tick + 6;
  log(s, 'reserve', { key: `log.reserve.${mode}`, mode });
}

function cropStep(s, ledOn, pumpOn, slot) {
  const gh = s.zones.gh;
  const g = zoneReadings(gh);
  for (const c of s.crops) {
    if (c.state !== 'growing' && c.state !== 'ripe') continue;
    const goodEnv = g.T >= 17 && g.T <= 25 && g.RH >= 0.40 && g.RH <= 0.80 && g.pCO2 >= 0.05 && g.pCO2 <= 0.16 && g.P >= 65;
    const ok = ledOn && pumpOn && goodEnv && c.water >= 0.4 && c.nutrients > EPS;
    c.limit = !ledOn ? 'light' : !pumpOn ? 'pump' : c.water < 0.4 ? 'water' : c.nutrients <= EPS ? 'nutrients' : !goodEnv ? (g.T < 17 || g.T > 25 ? 'temp' : g.P < 65 ? 'pressure' : g.pCO2 < 0.05 || g.pCO2 > 0.16 ? 'co2' : 'humidity') : null;
    const severe = g.T < 10 || g.P < 55;
    if (severe) c.stress += 3;
    else if (isLedSlot(slot)) {
      if (ok) c.stress = Math.max(0, c.stress - 0.5);
      else c.stress += 1;
    }
    if (ok && c.state === 'growing') {
      const sol = solOf(s.tick);
      if (c.grewSol !== sol) { c.grewSol = sol; c.solGrowth = 0; }
      const inc = Math.min(1 / 14, 1 - c.solGrowth);
      if (inc > EPS) {
        c.eff += inc; c.solGrowth += inc;
        c.nutrients = Math.max(0, c.nutrients - 0.1 * inc);
      }
      if (c.eff >= CROPS[c.species].sols - EPS) { c.state = 'ripe'; notify(s, 'log.ripe', { tray: c.id, species: c.species }, { severity: 'info', pause: true }); }
    }
    if (c.stress >= 18 && !c.warned) { c.warned = true; notify(s, 'log.cropStress', { tray: c.id }, { severity: 'warning', pause: true }); }
    if (c.stress < 10) c.warned = false;
    if (c.stress >= 45 && !c.halved) { c.halved = true; log(s, 'cropHalved', { key: 'log.cropHalved', tray: c.id }); }
    if (c.stress >= 75) { c.state = 'lost'; notify(s, 'log.cropLost', { tray: c.id }, { severity: 'critical', pause: true }); }
  }
}

function jobStep(s, given) {
  const j = s.job;
  if (!j) return;
  const need = j.kw * H;
  const got = j.kw <= 0 ? 0 : (given.job || 0);
  const ok = j.kw <= 0 || got >= need - EPS;
  if (!ok) { j.status = 'waiting'; j.waitTicks += 1; return; }
  j.status = 'running';
  if (j.eva) {
    if (!j.evaPaid) {
      if (s.stores.evaKits < 1) { cancelJob(s, 'noEvaKit'); return; }
      s.stores.evaKits -= 1; j.evaPaid = true;
    }
    const c = s.crew.find((x) => x.id === j.executor);
    if (c) c.loc = 'eva';
    if (s.energy.L < 0.65 && j.action === 'recoverCache') { cancelJob(s, 'storm'); return; }
  }
  j.remaining -= 1;
  if (j.remaining <= 0) finishJob(s);
}

function doseStep(s) {
  const t = s.tick;
  const pos = t % 24;
  for (const c of s.crew) {
    let loc = c.loc;
    if (s.job?.eva && s.job.executor === c.id && s.job.status === 'running' && s.job.evaPaid) loc = 'eva';
    const [b, k] = DOSE.factors[loc] || DOSE.factors.hab;
    const d = H * (DOSE.base * b + s.sep * k);
    c.dose += d;
    c.dose24[pos] = d;
    const last24 = c.dose24.reduce((x, y) => x + y, 0);
    if (last24 >= 5 && c.evaBanUntil < t) { c.evaBanUntil = t + 24; notify(s, 'log.evaBan', { crew: c.id }, { severity: 'warning' }); }
    if (c.dose > s.stats.maxDose) s.stats.maxDose = c.dose;
    if (c.loc === 'eva' && !(s.job?.eva && s.job.executor === c.id)) c.loc = s.shelter ? 'shelter' : 'hab';
  }
}

function reserveStep(s) {
  const r = s.energy.reserve;
  if (r.mode === 'continuous' && !r.startingTo) { r.contTicks += 1; r.hours += H; }
  else if (r.mode === 'assist' && !r.startingTo) r.hours += (s.energy.lastReserve || 0) > 0 ? H : 0;
  if (r.contTicks >= 24 && r.maintDue == null) {
    r.maintDue = s.tick + 48;
    addPending(s, { key: 'reserveMaint', dueTick: r.maintDue, effect: 'reserveLimit', data: { hours: r.hours } });
    notify(s, 'log.reserveMaint', { due: r.maintDue }, { severity: 'warning', pause: true });
  }
}

function processPendingDue(s) {
  for (const p of s.pending) {
    if (p.status !== 'pending' || p.dueTick !== s.tick) continue;
    if (p.effect === 'leakEscalate') {
      const z = s.zones[p.data.zone];
      if (z.leak > 0) {
        z.leak = 0.006; p.status = 'applied';
        notify(s, 'log.leakEscalated', { zone: p.data.zone }, { severity: 'critical', pause: true, causeIds: [p.logId], type: 'applied' });
      } else { p.status = 'canceled'; }
    } else if (p.effect === 'ledFault') {
      const h = s.counters.ghRhHist.slice(-2);
      if (h.length === 2 && h.every((x) => x.rh <= 0.80 && !x.cond)) { p.status = 'canceled'; log(s, 'pendingCanceled', { key: 'pending.ledFault', pendingId: p.id }); }
      else { s.eq.led = false; p.status = 'applied'; notify(s, 'log.ledFault', {}, { severity: 'critical', pause: true, causeIds: [p.logId], type: 'applied' }); }
    } else if (p.effect === 'reserveLimit') {
      if (s.energy.reserve.maintDue != null) { s.energy.reserve.limited = true; p.status = 'applied'; notify(s, 'log.reserveLimited', {}, { severity: 'warning', pause: true, causeIds: [p.logId], type: 'applied' }); }
      else p.status = 'canceled';
    }
  }
}

function delayedConditions(s) {
  const t = s.tick;
  // micro-leak escalation: 12 continuous ticks → crack risk in 6 ticks
  for (const zid of ['gh', 'hab']) {
    const z = s.zones[zid];
    const key = zid === 'gh' ? 'ghLeakTicks' : 'airlockLeakTicks';
    if (z.leak > 0 && z.leak < 0.005) s.counters[key] += 1; else s.counters[key] = 0;
    if (s.counters[key] === 12) addPending(s, { key: `crack_${zid}`, dueTick: t + 6, effect: 'leakEscalate', data: { zone: zid } });
  }
  // greenhouse humidity → connector check
  const g = zoneReadings(s.zones.gh);
  s.counters.ghRhHist.push({ rh: g.RH, cond: s.zones.gh.condensate });
  if (s.counters.ghRhHist.length > 4) s.counters.ghRhHist.shift();
  if (g.RH > 0.85 || s.zones.gh.condensate) s.counters.ghWetTicks += 1; else s.counters.ghWetTicks = 0;
  if (s.counters.ghWetTicks === 8 && s.eq.led) addPending(s, { key: 'connector', dueTick: t + 4, effect: 'ledFault' });
  // cold night fatigue
  const slot = slotOf(t);
  if (isNightSlot(slot) && s.zones.hab.T < 16) s.counters.coldTicks += 1;
  if (slot === 2) {
    if (s.counters.coldTicks >= 6) { s.fatigue = Math.min(3, s.fatigue + 1); s.tokenPenaltyNext += 1; notify(s, 'log.coldFatigue', {}, { severity: 'warning' }); }
    s.counters.coldTicks = 0;
  }
  // cartridge low
  if (s.eq.scrubMode === 'emergency' && s.eq.cartridgeInserted) {
    if (s.eq.cartridge < 0.6 && !s.flags.cartridgeWarned) { s.flags.cartridgeWarned = true; notify(s, 'log.cartridgeLow', { hours: s.eq.cartridge / 0.17 }, { severity: 'warning', pause: true }); }
    if (s.eq.cartridge <= EPS && !s.flags.cartridgeEmpty) { s.flags.cartridgeEmpty = true; notify(s, 'log.cartridgeEmpty', {}, { severity: 'critical', pause: true }); }
    if (s.eq.cartridge > 0.6) { s.flags.cartridgeWarned = false; s.flags.cartridgeEmpty = false; }
  }
  // dirty panel warning
  s.energy.clean.forEach((c, i) => {
    const k = `dirty${i}`;
    if (c < 0.55 && !s.flags[k]) { s.flags[k] = true; notify(s, 'log.panelDirty', { panel: i }, { severity: 'warning' }); }
    if (c >= 0.6) s.flags[k] = false;
  });
  // panel dust deposition (per tick 1/24 of daily rate)
  const L = s.energy.L;
  const rate = L <= 0.25 ? 0.12 : L < 1 ? 0.03 : 0.002;
  for (let i = 0; i < 2; i++) {
    const f = s.energy.folded[i] ? (s.flags.tech.T_DUST ? 0.15 : 0.25) : 1;
    s.energy.clean[i] = Math.max(0.15, s.energy.clean[i] - (rate * f) / 24);
  }
  // protocols: air
  if (s.flags.scrubFailedTick != null && s.flags.inspected.scrubber >= s.flags.scrubFailedTick && (s.lastScrub || 0) > 0) s.flags.protocols.air = true;
  // protocols: energy (sample after cleaning at same L, plus sample before or archived S10 observation)
  if (!s.flags.protocols.energy && s.flags.cleanedTicks.length) {
    const c0 = s.flags.cleanedTicks[0];
    const after = s.flags.samples.find((x) => x.target === 'pv' && x.tick > c0);
    const before = s.flags.samples.find((x) => x.target === 'pv' && x.tick < c0) || (s.flags.observed.panels10 ? { L: 1 } : null);
    if (after && before && Math.abs(after.L - before.L) < 1e-9) s.flags.protocols.energy = true;
  }
  // local event follow-ups
  if (s.events.activeLocal) {
    const id = s.events.activeLocal;
    const resolved = id === 'L_PUMP' ? s.eq.pump : id === 'L_FAN' ? s.eq.fan : id === 'L_RELAY' ? s.eq.relay : id === 'L_SEAL' ? !s.eq.airlockLeak : true;
    if (resolved) s.events.activeLocal = null;
  }
}

// --------- alarms (sensor view) and training stops (truth) ---------
export function sensorView(s) {
  const h = zoneReadings(s.zones.hab);
  return { ...h, Pshown: h.P + s.sensors.habPOffset };
}

function alarmsAndStops(s) {
  const cfg = cfgOf(s);
  const v = sensorView(s);
  const A = THRESH.alarm;
  const maxDose24 = Math.max(...s.crew.map((c) => c.dose24.reduce((a, b) => a + b, 0)));
  const checks = {
    pO2: v.pO2 < A.pO2, pCO2: v.pCO2 > A.pCO2, P: v.Pshown < A.P, Tlo: v.T < A.Tlo, Thi: v.T > A.Thi, RH: v.RH > A.RH,
    soc: s.energy.soc < A.socFrac * cfg.energy.socCap, water: s.water.clean < A.water, dose: maxDose24 >= A.dose24,
  };
  for (const [k, bad] of Object.entries(checks)) {
    const was = s.alarms.active[k];
    if (bad) {
      s.alarms.safe[k] = 0;
      if (!was) {
        s.alarms.active[k] = s.tick;
        const crit = ['pO2', 'pCO2', 'P', 'Tlo', 'Thi'].includes(k);
        const unverified = k === 'P' && s.sensors.habPOffset !== 0;
        notify(s, `alarm.${k}`, { unverified }, { type: 'alarm', severity: 'critical', pause: true });
        s.stats.autopauses += 1;
        if (crit) s.flags.airAlarmTick = s.tick;
      }
    } else if (was != null) {
      s.alarms.safe[k] = (s.alarms.safe[k] || 0) + 1;
      if (s.alarms.safe[k] >= 2) delete s.alarms.active[k];
    }
  }
  // cadet auto-pause / engineer warning: < 3 sols of food or O2
  const foodSols = (s.food.packs + s.food.fresh.reduce((a, f) => a + f.kcal, 0)) / 9600;
  const o2Sols = s.tanks.O2 / 3.36;
  for (const [k, val] of [['foodLow', foodSols], ['o2Low', o2Sols]]) {
    if (val < 3 && !s.flags[k]) { s.flags[k] = true; notify(s, `alarm.${k}`, { sols: val }, { type: 'alarm', severity: 'warning', pause: s.profile === 'cadet' }); }
  }
  // terminal (truth)
  const h = zoneReadings(s.zones.hab);
  const S = THRESH.stop;
  const conds = {
    pO2: [h.pO2 < S.pO2[0], S.pO2[1]],
    pCO2: [h.pCO2 > S.pCO2[0], S.pCO2[1]],
    P: [h.P < S.P[0], S.P[1]],
    T: [h.T < S.T[0] || h.T > S.T[1], S.T[2]],
    water: [(s.waterFrac ?? 1) < S.water[0], S.water[1]],
    food: [(s.foodFrac ?? 1) < S.food[0], S.food[1]],
  };
  const hits = [];
  for (const [k, [bad, n]] of Object.entries(conds)) {
    s.stopCounters[k] = bad ? (s.stopCounters[k] || 0) + 1 : 0;
    if (s.stopCounters[k] >= n) hits.push(k);
  }
  if (s.crew.some((c) => c.dose >= S.dose)) hits.push('dose');
  if (hits.length) {
    s.status = 'stopped';
    s.stats.firstTerminal = hits[0];
    const id = log(s, 'terminal', { key: `stop.${hits[0]}`, hits });
    s.ending = { id: 'stop', cause: hits[0], all: hits, tick: s.tick, logId: id };
    evaluateEnding(s);
    pause(s, 'ending', { severity: 'critical' });
  }
}

function startSol(s) {
  const cfg = cfgOf(s);
  const sol = solOf(s.tick);
  s.tokens = Math.max(1, cfg.tokens - s.tokenPenaltyNext);
  s.tokenPenaltyNext = 0;
  s.flags.recycledThisSol = 0;
  s.counters.rationLowTicks = 0;
  s.flags.solStart = { tick: s.tick, sol };
  if (sol > 1) notify(s, 'log.morning', { sol }, { type: 'sol' });
}

function endSol(s) {
  // evening accounting for the sol that just ended
  const sol = solOf(s.tick - 1);
  closeSolMissions(s, sol);
  const lowRation = s.counters.rationLowTicks >= 12;
  if (lowRation) { s.fatigue = Math.min(3, s.fatigue + 1); s.counters.rationLowSols += 1; } else s.counters.rationLowSols = 0;
  if (s.counters.rationLowSols >= 3) { s.tokenPenaltyNext += 1; s.counters.rationLowSols = 0; }
  let reduced = false;
  if (s.flags.restSol === sol && s.fatigue > 0) { s.fatigue -= 1; reduced = true; }
  const minT = Math.min(...s.history.filter((x) => x.t >= T(sol, 0)).map((x) => x.habT));
  if (!reduced && s.fatigue > 0 && s.ration >= 1 && minT >= 17 && !lowRation) { s.fatigue -= 1; }
  if (s.fatigue >= 3) s.tokenPenaltyNext = Math.max(s.tokenPenaltyNext, 1);
  for (const c of s.crew) c.fatigue = s.fatigue;
}

function recordHistory(s) {
  const h = zoneReadings(s.zones.hab), g = zoneReadings(s.zones.gh);
  if (s.ration < 0.95) s.counters.rationLowTicks += 1;
  if (s.energy.soc < s.stats.minSoC) s.stats.minSoC = s.energy.soc;
  if (s.water.clean < s.stats.minClean) s.stats.minClean = s.water.clean;
  if (s._sim) return;
  s.history.push({
    t: s.tick, pO2: h.pO2, pCO2: h.pCO2, P: h.P, Pshown: h.P + s.sensors.habPOffset, habT: h.T, RH: h.RH,
    ghP: g.P, ghT: g.T, ghCO2: g.pCO2, ghRH: g.RH,
    soc: s.energy.soc, pv: s.energy.lastPV, use: s.energy.lastUse, res: s.energy.lastReserve || 0,
    o2: s.tanks.O2, water: s.water.clean, grey: s.water.grey, food: s.food.packs + s.food.fresh.reduce((a, f) => a + f.kcal, 0),
    dose: Math.max(...s.crew.map((c) => c.dose)), L: s.energy.L, clean0: s.energy.clean[0], clean1: s.energy.clean[1],
  });
}
