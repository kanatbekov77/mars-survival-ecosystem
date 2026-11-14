// Ending selection (GDD §8) and causal debrief chains.
import { TOTAL_TICKS } from './config.js';
import { zoneReadings } from './physics.js';
import { log } from './state.js';

export const ALT = {
  E_PROBE: 'alt.E_PROBE', E_SCRUB: 'alt.E_SCRUB', E_DUST1: 'alt.E_DUST', E_DUST2: 'alt.E_DUST', E_SEP1: 'alt.E_SEP', E_SEP2: 'alt.E_SEP',
  E_WATER: 'alt.E_WATER', E_FROST: 'alt.E_FROST', E_FEEDER: 'alt.E_FEEDER', E_LANDING_CHECK: 'alt.E_LANDING', L_FAN: 'alt.L_FAN', L_SEAL: 'alt.E_PROBE',
  L_PUMP: 'alt.L_PUMP', L_RELAY: 'alt.E_LANDING', reserve: 'alt.reserve', water: 'alt.water', food: 'alt.food',
};

const ROOT_ACTIONS = {
  E_PROBE: ['inspect', 'patch', 'greenhouseFill'], L_SEAL: ['repairSeal', 'patch'], E_SCRUB: ['repairScrub', 'replaceCartridge', 'inspect'], L_FAN: ['repairFan', 'replaceCartridge'],
  E_WATER: ['waterService'], E_FEEDER: ['resetFeeder'], E_DUST1: ['cleanPV', 'sample'], E_DUST2: ['cleanPV'], E_SEP1: [], E_SEP2: [], L_PUMP: ['repairPump'], L_RELAY: ['relayRepair', 'send'],
  E_LANDING_CHECK: ['landCheck', 'send'], E_FROST: ['rest'],
};
const STOP_ROOTS = { pCO2: ['E_SCRUB', 'L_FAN'], P: ['E_PROBE', 'L_SEAL'], pO2: ['E_PROBE', 'L_SEAL', 'E_WATER'], T: ['E_FEEDER', 'E_FROST'], water: ['E_WATER'], food: [], dose: ['E_SEP1', 'E_SEP2'] };

export function protocolsCount(s) { return Object.values(s.flags.protocols).filter(Boolean).length; }
export function stars(n) { return n >= 3 ? 3 : n; }

export function sustainability(s) {
  const h = zoneReadings(s.zones.hab);
  const food = s.food.packs + s.food.fresh.reduce((a, f) => a + f.kcal, 0);
  const c = {
    protocols: protocolsCount(s) >= 3,
    P: h.P >= 72, pO2: h.pO2 >= 17, pCO2: h.pCO2 <= 0.25, T: h.T >= 17 && h.T <= 28,
    water: s.water.clean >= 20, food: food >= 9600, soc: s.energy.soc >= 12, bus: s.energy.mainBus,
  };
  return c;
}

function rootEntries(s, root) {
  return s.log.filter((e) => e.causalRootId === root || e.eventId === root);
}

function chainFor(s, root, kind) {
  const entries = rootEntries(s, root);
  if (!entries.length) return null;
  const first = entries[0];
  const rel = ROOT_ACTIONS[root] || [];
  const after = s.log.filter((e) => e.tick >= first.tick && e.tick <= first.tick + 24 && (e.type === 'alarm' || e.type === 'applied' || ((e.type === 'jobDone' || e.type === 'jobStart') && rel.includes(e.action)))).slice(0, 4);
  const steps = [...entries.slice(0, 3), ...after].sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : 1));
  const uniq = steps.filter((e, i) => steps.findIndex((x) => x.id === e.id) === i).slice(0, 6);
  return { root, kind, steps: uniq, alt: ALT[root] || 'alt.generic' };
}

function nearestBoundary(s) {
  // closest approach to a terminal threshold over the run (normalised margin)
  let best = null;
  for (const h of s.history) {
    const m = [
      ['pCO2', (0.65 - h.pCO2) / 0.65], ['pO2', (h.pO2 - 15) / 15], ['P', (h.P - 60) / 60], ['T', Math.min(h.habT - 10, 35 - h.habT) / 10],
      ['water', h.water / 220], ['reserve', h.soc / 120],
    ];
    for (const [k, v] of m) if (!best || v < best.v) best = { k, v, t: h.t };
  }
  return best;
}

export function evaluateEnding(s) {
  let id;
  if (s.status === 'stopped' || (s.ending && s.ending.id === 'stop')) id = 'stop';
  else if (s.tick >= TOTAL_TICKS) {
    const sus = sustainability(s);
    const allSus = Object.values(sus).every(Boolean);
    if (!s.flags.landingConfirmed) id = 'remote';
    else if (allSus) id = 'sustainable';
    else id = 'survived';
    s.status = 'success';
  } else return null;
  const sus = sustainability(s);
  const chains = [];
  const seen = new Set();
  const push = (c) => { if (c && !seen.has(c.root)) { seen.add(c.root); chains.push(c); } };
  if (id === 'stop') {
    for (const r of STOP_ROOTS[s.ending?.cause] || []) { const c = chainFor(s, r, 'terminal'); if (c) { push(c); break; } }
    if (!chains.length) chains.push({ root: s.ending?.cause || 'stop', kind: 'terminal', steps: s.log.filter((e) => e.type === 'terminal' || e.type === 'alarm').slice(-4), alt: ALT[s.ending?.cause] || 'alt.generic' });
  } else {
    const nb = nearestBoundary(s);
    if (nb) {
      const near = s.log.filter((e) => e.causalRootId && e.tick <= nb.t).slice(-1)[0];
      if (near) push(chainFor(s, near.causalRootId, 'nearest'));
    }
  }
  // applied delayed effects, newest first
  for (const p of [...s.pending].filter((x) => x.status === 'applied').sort((a, b) => b.dueTick - a.dueTick)) {
    if (chains.length >= 3) break;
    const steps = s.log.filter((e) => e.pendingId === p.id || e.causeIds?.includes(p.logId));
    if (!seen.has(p.key)) { seen.add(p.key); chains.push({ root: p.key, kind: 'delayed', steps, alt: p.effect === 'reserveLimit' ? ALT.reserve : ALT.E_PROBE }); }
  }
  // largest single resource loss category
  if (chains.length < 3) {
    const losses = [
      ['leak', s.sinks.leakO2 + s.sinks.leakN2, 'E_PROBE'],
      ['water', s.sinks.water + s.sinks.condensate, 'E_WATER'],
      ['food', s.food.spoiled / 1000, 'food'],
    ].sort((a, b) => b[1] - a[1]);
    for (const [, , root] of losses) { if (!seen.has(root)) { const c = chainFor(s, root, 'loss'); if (c) { push(c); break; } } }
  }
  const nProt = protocolsCount(s);
  s.ending = { ...(s.ending || {}), id, sustainability: sus, protocols: nProt, stars: stars(nProt), chains: chains.slice(0, 3), tick: s.tick };
  log(s, 'ending', { key: `end.${id}.title` });
  // cargo is credited only after evaluation
  if (id !== 'stop') {
    s.ending.cargo = id === 'remote' ? 'remote' : 'nominal';
    if (id !== 'remote') s.warehouse = { kcal: s.warehouse.kcal + 192000, water: s.warehouse.water + 100, parts: s.warehouse.parts + 4, o2: 15 };
  }
  return id;
}
