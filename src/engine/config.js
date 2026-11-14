// CONFIG · MARS: Survival Ecosystem. All values are game assumptions (GDD §3–4)
// unless a provenance entry says otherwise. One CONFIG, explicit profile overrides.

export const CONFIG_VERSION = 'mars-config-0.1.0';
export const ENGINE_VERSION = 'mars-engine-0.1.0';

export const SOL_HOURS = 24.6597;
export const TICKS_PER_SOL = 24;
export const SOLS = 30;
export const TOTAL_TICKS = SOLS * TICKS_PER_SOL; // 720
export const H = SOL_HOURS / TICKS_PER_SOL; // model hours per tick

export const R = { O2: 259.8, N2: 296.8, CO2: 188.9, H2O: 461.5 };

const BASE = {
  zones: {
    hab: { V: 150, T: 21, pO2: 19, pN2: 65, pCO2: 0.07, H2O: 1.2, C: 4, K: 0.03, heatMax: 2.8, rhSet: 0.48, dehumMax: 0.18, dehumKW: 0.45 },
    gh: { V: 40, T: 21, pO2: 19, pN2: 65, pCO2: 0.10, H2O: 0.37, C: 1.2, K: 0.014, heatMax: 1.2, rhSet: 0.60, dehumMax: 0.12, dehumKW: 0.28 },
  },
  tanks: { O2: 44, O2cap: 80, N2: 25, N2cap: 35, CO2gh: 4, CO2ghCap: 4 },
  water: { clean: 170, cleanCap: 220, grey: 18, greyCap: 60, quarantine: 0, quarantineCap: 25 },
  food: { kcal: 307200, kcalCap: 500000, perSol: 9600 },
  energy: { panelPeakKW: 7, soc: 90, socCap: 120, chargeKW: 8, dischargeKW: 10, etaIn: 0.95, etaOut: 0.92, reserveKW: 5, reserveLimitedKW: 3.5 },
  stores: {
    patches: 4, parts: 7, seals: 2, pads: 6, seedsRadish: 2, seedsLettuce: 1, nutrients: 6, liners: 2,
    evaKits: 8, cartridges: 4, spareFans: 1, cassettes: 2, tests: 4, cores: 1,
  },
  cartridgeKg: 3,
  tokens: 2,
  electrolysisThreshold: 42,
  stormTimer: 10,
  localSlots: [[9, 5], [14, 5], [20, 5], [24, 5], [27, 5]],
  localP: 0.40,
  localPool: ['L_PV', 'L_PUMP', 'L_FAN', 'L_RELAY', 'L_SEAL', 'L_ADVICE', 'L_LAB'],
  hintMode: 'situational',
};

const CADET = {
  tanks: { O2: 52 },
  water: { clean: 195 },
  food: { kcal: 345600 },
  energy: { soc: 110 },
  stores: { patches: 5, parts: 9, evaKits: 10, cartridges: 6, cassettes: 3 },
  tokens: 3,
  electrolysisThreshold: 50,
  stormTimer: 15,
  localSlots: [[14, 5], [24, 5]],
  localP: 0.30,
  localPool: ['L_PV', 'L_PUMP', 'L_FAN', 'L_RELAY'],
  hintMode: 'active',
};

function merge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (k in a && typeof a[k] === 'object' && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k];
  return out;
}

export function getConfig(profile = 'engineer') {
  const cfg = profile === 'cadet' ? merge(BASE, CADET) : merge(BASE, {});
  cfg.profile = profile;
  cfg.version = CONFIG_VERSION;
  return cfg;
}

export const THRESH = {
  alarm: { pO2: 17, pCO2: 0.25, P: 72, Tlo: 17, Thi: 28, RH: 0.80, socFrac: 0.15, water: 24, dose24: 5 },
  stop: { pO2: [15, 3], pCO2: [0.65, 3], P: [60, 2], T: [10, 35, 6], water: [0.5, 12], food: [0.75, 24], dose: 28 },
};

export const LOADS = {
  habFan: 0.8, habFanOnly: 0.2, habEmergency: 0.35, electrolysis: 1.2, recycle: 0.7, recycleLoop: 0.8,
  ghPump: 0.25, ghLED: 1.8, radiator: 0.2,
};

// Priority: first four are fixed (habitat life support), the rest may be reordered.
export const FIXED_PLAN = ['habFan', 'habHeat', 'habDehum'];
export const DEFAULT_PLAN = ['electrolysis', 'recycle', 'greenhouse', 'job'];
export const SECONDARY_BUS = new Set(['habFan', 'habHeat', 'habDehum', 'habRadiator', 'reserveStart']);

export const DOSE = { base: 0.03, factors: { eva: [1.0, 1.0], hab: [0.8, 0.65], shelter: [0.65, 0.18] } };

export const CROPS = {
  lettuce: { sols: 32, kcal: 750 },
  radish: { sols: 27, kcal: 1500 },
};

export const CREW = [
  { id: 'aliya', role: 'engineer' },
  { id: 'dana', role: 'commander' },
  { id: 'ilyas', role: 'medic' },
  { id: 'mark', role: 'botanist' },
];

// t(sol, slot) -> global tick
export const T = (sol, slot) => (sol - 1) * TICKS_PER_SOL + slot;
export const solOf = (tick) => Math.floor(tick / TICKS_PER_SOL) + 1;
export const slotOf = (tick) => tick % TICKS_PER_SOL;
export const isLightSlot = (slot) => slot >= 3 && slot <= 14;
export const isLedSlot = (slot) => slot >= 3 && slot <= 16;
export const isNightSlot = (slot) => slot >= 18 || slot <= 2;
