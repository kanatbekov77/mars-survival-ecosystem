// Gas, humidity and heat formulas (GDD §4.2–4.3). Pure functions.
import { R } from './config.js';

export const EPS = 1e-8;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// partial pressure kPa from mass kg
export function partial(gas, kg, Tc, V) {
  return (kg * R[gas] * (Tc + 273.15)) / (1000 * V);
}
// mass kg from partial pressure kPa
export function massFor(gas, kPa, Tc, V) {
  return (kPa * 1000 * V) / (R[gas] * (Tc + 273.15));
}

export function psat(Tc) {
  const t = clamp(Tc, -20, 50);
  return 0.61078 * Math.exp((17.2694 * t) / (t + 237.3));
}

export function zoneReadings(z) {
  const pO2 = partial('O2', z.gas.O2, z.T, z.V);
  const pN2 = partial('N2', z.gas.N2, z.T, z.V);
  const pCO2 = partial('CO2', z.gas.CO2, z.T, z.V);
  const pH2O = partial('H2O', z.gas.H2O, z.T, z.V);
  const P = pO2 + pN2 + pCO2 + pH2O;
  const RH = pH2O / psat(z.T);
  return { pO2, pN2, pCO2, pH2O, P, RH, T: z.T };
}

export function makeZone(spec) {
  return {
    V: spec.V,
    T: spec.T,
    gas: {
      O2: massFor('O2', spec.pO2, spec.T, spec.V),
      N2: massFor('N2', spec.pN2, spec.T, spec.V),
      CO2: massFor('CO2', spec.pCO2, spec.T, spec.V),
      H2O: spec.H2O,
    },
    leak: 0,
    kExtra: 0,
    condensate: false,
  };
}

// fraction of every gas lost per tick through a leak
export function leakFraction(leakPerHour, P, h) {
  return Math.min(0.2, leakPerHour * h * Math.max(0, (P - 0.6) / 85));
}
