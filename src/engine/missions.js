// 30 sol tasks (GDD §7). Tasks are optional: they never block the next sol.
import { T, solOf } from './config.js';
import { notify } from './state.js';

const inSol = (tick, sol) => tick != null && solOf(tick) === sol;
const obs = (s, k, sol) => inSol(s.flags.observed[k], sol);

export const MISSIONS = {
  1: { act: 1, check: (s) => s.flags.observed.oxygen != null && s.tick > s.flags.observed.oxygen },
  2: { act: 1, check: (s) => obs(s, 'greenhouse', 2) && (inSol(s.flags.planted?.B, 2) || s.flags.decisions.trayB === 'empty') },
  3: { act: 1, check: (s) => s.flags.inspected.ghP >= T(3, 4) && s.flags.ghIsolatedTick >= s.flags.inspected.ghP },
  4: { act: 1, check: (s) => s.flags.sends.some((t) => solOf(t) === 4) && obs(s, 'energy', 4) },
  5: { act: 1, check: (s) => s.flags.quiz.air === true },
  6: { act: 1, check: (s) => solOf(s.tick) === 6 && (s.flags.recycledThisSol > 0 || obs(s, 'water', 6)) },
  7: { act: 1, check: (s) => s.flags.planSaved[7] && obs(s, 'energy', 7) },
  8: { act: 1, check: (s) => !!s.flags.decisions.E_DUST1 && s.flags.observed.energy >= T(8, 10) },
  9: { act: 1, check: (s) => (s.flags.calmTicks9 || 0) >= 6 },
  10: { act: 1, check: (s) => obs(s, 'panels', 10) },
  11: { act: 2, check: (s) => s.tick >= T(11, 4) && (s.lastScrub || 0) > 0 && (s.eq.scrubMode === 'emergency' || s.eq.scrubMain) },
  12: { act: 2, check: (s) => s.flags.inspected.scrubber >= T(11, 4) && obs(s, 'scrubber', 12) },
  13: { act: 2, check: (s) => !!s.flags.decisions.E_SEP1 && s.flags.observed.dose >= T(13, 3) },
  14: { act: 2, carry: true, check: (s) => s.flags.harvests > 0 },
  15: { act: 2, check: (s) => s.flags.waterServiced >= T(15, 6) },
  16: { act: 2, check: (s) => s.flags.cacheRecovered != null || s.flags.decisions.cache === 'skip' },
  17: { act: 2, check: (s) => obs(s, 'heat', 17) && s.flags.observed.heat < T(17, 15) },
  18: { act: 2, check: (s) => (s.flags.thawed != null && s.flags.waterTested != null) || s.flags.decisions.ice === 'postpone' },
  19: { act: 2, check: (s) => s.flags.sensorFaultTick != null && s.flags.calibrated >= s.flags.sensorFaultTick },
  20: { act: 2, check: (s) => obs(s, 'forecast', 20) },
  21: { act: 3, check: (s) => s.flags.feederRepaired != null },
  22: { act: 3, check: (s) => obs(s, 'reserve', 22) && (s.energy.reserve.maintDue == null || s.flags.reserveServiced >= T(22, 0)) },
  23: { act: 3, check: (s) => !!s.flags.decisions.E_SEP2 && s.flags.observed.dose >= T(23, 0) },
  24: { act: 3, check: (s) => Object.values(s.flags.tech).some((t) => solOf(t) === 24) || s.flags.decisions.upgrade === 'decline' },
  25: { act: 3, check: (s) => s.flags.landCheckTick != null && s.flags.landingConfirmed },
  26: { act: 3, check: (s) => inSol(s.flags.planChangedTick, 26) && obs(s, 'forecast', 26) },
  27: { act: 3, check: (s) => obs(s, 'supplies', 27) },
  28: { act: 3, check: (s) => s.flags.landingConfirmed && obs(s, 'greenhouse', 28) },
  29: { act: 3, atClose: (s) => !s.flags.airAlarm29 && s.status === 'active' },
  30: { act: 3, atClose: (s) => s.status !== 'stopped' },
};

export function missionStatus(s, sol) { return s.missions[sol] || 'open'; }

export function evaluateMissions(s) {
  const sol = solOf(s.tick);
  // calm-tick counter for sol 9, alarm flag for sol 29
  const airBad = ['pO2', 'pCO2', 'P'].some((k) => s.alarms.active[k] != null);
  if (sol === 9) s.flags.calmTicks9 = airBad ? 0 : (s.flags.calmTicks9 || 0) + 1;
  if (sol === 29 && airBad) s.flags.airAlarm29 = true;
  for (const [k, m] of Object.entries(MISSIONS)) {
    const n = +k;
    if (s.missions[n] === 'done' || !m.check) continue;
    if (n === sol || (m.carry && n < sol && s.missions[n] === 'carry')) {
      if (m.check(s)) { s.missions[n] = 'done'; notify(s, 'log.missionDone', { sol: n }, { type: 'mission' }); }
    }
  }
}

export function closeSolMissions(s, sol) {
  const m = MISSIONS[sol];
  if (!m || s.missions[sol] === 'done') return;
  if (m.atClose) { s.missions[sol] = m.atClose(s) ? 'done' : 'missed'; return; }
  s.missions[sol] = m.carry ? 'carry' : 'missed';
}
