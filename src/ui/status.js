// Derived view model: system status for the map, HUD values, formatting.
import { zoneReadings } from '../engine/physics.js';
import { solOf, slotOf, THRESH } from '../engine/config.js';
import { sensorView } from '../engine/sim.js';
import { forecastEndOfSol } from '../engine/run.js';

export const SYSTEMS = ['habitat', 'greenhouse', 'battery', 'panels', 'reserve', 'water', 'shelter', 'comms', 'storage', 'rover'];

export const tickLabel = (t) => `S${String(solOf(t)).padStart(2, '0')}.${String(slotOf(t)).padStart(2, '0')}`;
export const phaseOf = (slot) => (slot <= 2 ? 'morning' : slot <= 17 ? 'day' : slot <= 21 ? 'evening' : 'night');
export const dose24 = (c) => c.dose24.reduce((a, b) => a + b, 0);
export const foodKcal = (s) => s.food.packs + s.food.fresh.reduce((a, f) => a + f.kcal, 0);

export function airAlarm(s) {
  const v = sensorView(s);
  const A = THRESH.alarm;
  return v.pO2 < A.pO2 || v.pCO2 > A.pCO2 || v.Pshown < A.P;
}

export function systemStatus(s, fc) {
  const st = {};
  const v = sensorView(s);
  const A = THRESH.alarm;
  const g = zoneReadings(s.zones.gh);
  const active = (k) => s.alarms.active[k] != null;
  st.habitat = active('pO2') || active('pCO2') || active('P') || active('Tlo') || active('Thi') ? 'bad'
    : (active('RH') || !s.eq.scrubMain || !s.eq.fan || s.eq.airlockLeak || (s.sensors.habPOffset !== 0) || v.pCO2 > 0.18) ? 'warn' : 'ok';
  st.greenhouse = s.zones.gh.leak > 0 || s.crops.some((c) => c.state === 'lost') || g.P < 65 ? 'bad'
    : (s.crops.some((c) => c.stress >= 18 || c.state === 'ripe') || !s.eq.pump || !s.eq.led || s.ghMode === 'preserve') ? 'warn' : 'ok';
  const endSoc = fc ? fc.soc : s.energy.soc;
  st.battery = !s.energy.mainBus || s.energy.soc < A.socFrac * 120 ? 'bad' : endSoc < 30 ? 'warn' : 'ok';
  st.panels = s.energy.L <= 0.25 ? 'bad' : (s.energy.clean.some((c) => c < 0.6) || s.energy.folded.some(Boolean) || s.energy.L < 1) ? 'warn' : 'ok';
  const r = s.energy.reserve;
  st.reserve = !s.energy.mainBus && r.mode === 'standby' && !r.startingTo ? 'bad' : (r.maintDue != null || r.limited) ? 'warn' : r.mode === 'standby' ? 'off' : 'ok';
  st.water = s.water.clean < A.water ? 'bad' : (!s.eq.cassetteOk || s.water.quarantineState === 'untested' || s.water.clean < 45) ? 'warn' : 'ok';
  st.shelter = s.crew.some((c) => dose24(c) >= A.dose24) || (s.sep > 0 && !s.shelter) ? 'bad' : s.sepWarning ? 'warn' : 'ok';
  const sol = solOf(s.tick);
  st.comms = !s.eq.relay ? 'bad' : (sol >= 25 && !s.flags.landingConfirmed) ? 'warn' : 'ok';
  st.storage = foodKcal(s) / 9600 < 3 ? 'bad' : (s.warehouse.kcal + s.warehouse.water + s.warehouse.parts > 0) ? 'warn' : 'ok';
  st.rover = s.cache === 'field' ? 'warn' : 'ok';
  return st;
}

export function energyForecast(s) {
  try { return forecastEndOfSol(s); } catch { return { soc: s.energy.soc, minSoc: s.energy.soc, series: [] }; }
}

// Map a notice/alarm key to the system that explains it (≤ 2 openings from warning to first reaction).
export function systemForKey(key = '') {
  const m = [
    [/alarm\.(pO2|pCO2|P|Tlo|Thi|RH|o2Low)|E_SCRUB|E_FROST|L_FAN|L_SEAL|cartridge|coldFatigue|E_SENSOR/, 'habitat'],
    [/alarm\.soc|E_DUST2_FORECAST|E_FORECAST|E_DUST/, 'battery'],
    [/alarm\.water|E_WATER|E_ICE/, 'water'],
    [/alarm\.dose|E_SEP|evaBan/, 'shelter'],
    [/E_PROBE|L_PUMP|ripe|crop|leakEscalated|ledFault/, 'greenhouse'],
    [/E_CACHE/, 'rover'],
    [/E_LANDING|L_RELAY|msg\./, 'comms'],
    [/L_PV|panelDirty/, 'panels'],
    [/reserve|E_FEEDER/, 'reserve'],
    [/foodLow|spoiled/, 'storage'],
  ];
  for (const [re, sys] of m) if (re.test(key)) return sys;
  return null;
}
