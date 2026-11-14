// RU/EN parity, key coverage, sources and scenario coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ru } from '../src/i18n/ru.js';
import { en } from '../src/i18n/en.js';
import { Run } from '../src/engine/run.js';
import { STRATEGIES, playRun } from '../src/engine/strategies.js';
import { ACTIONS, TECH } from '../src/engine/actions.js';
import { MISSIONS } from '../src/engine/missions.js';
import { SOURCES, ARCHIVE, CARDS } from '../src/data/sources.js';

test('RU and EN have identical key sets and no empty strings', () => {
  const a = Object.keys(ru).sort(), b = Object.keys(en).sort();
  assert.deepEqual(a.filter((k) => !(k in en)), [], 'missing in EN');
  assert.deepEqual(b.filter((k) => !(k in ru)), [], 'missing in RU');
  for (const k of a) { assert.ok(ru[k].trim(), `empty ru ${k}`); assert.ok(en[k].trim(), `empty en ${k}`); }
  // placeholders match
  for (const k of a) {
    const pr = (ru[k].match(/\{\w+\}/g) || []).sort().join(), pe = (en[k].match(/\{\w+\}/g) || []).sort().join();
    assert.equal(pr, pe, `placeholders differ for ${k}`);
  }
});

test('every engine log/notice key used in campaign runs is translated', () => {
  const keys = new Set();
  for (const name of Object.keys(STRATEGIES)) for (const profile of ['cadet', 'engineer']) for (let seed = 0; seed < 12; seed++) {
    const r = playRun(Run, { profile, seed }, STRATEGIES[name]);
    for (const e of r.state.log) if (e.key) keys.add(e.key);
    for (const c of r.state.ending?.chains || []) keys.add(c.alt);
    if (r.state.ending?.id) { keys.add(`end.${r.state.ending.id}.title`); if (r.state.ending.cause) keys.add(`stop.${r.state.ending.cause}`); }
    for (const m of r.state.inbox) keys.add(m.key);
  }
  const missing = [...keys].filter((k) => !(k in ru) || !(k in en));
  assert.deepEqual(missing, []);
});

test('static t() keys in UI code exist', () => {
  const dir = new URL('../src/ui/', import.meta.url);
  const missing = [];
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in ru)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('catalog keys: actions, reasons, techs, missions, Beep lines, cards', () => {
  const need = [];
  for (const a of Object.keys(ACTIONS)) need.push(`act.${a}.name`, `act.${a}.effect`, `done.${a}`);
  for (const k of Object.keys(TECH)) need.push(`tech.${k}`, `tech.${k}.d`);
  for (const n of Object.keys(MISSIONS)) need.push(`m.${n}.t`, `m.${n}.g`, `beep.${n}`);
  for (const c of CARDS) need.push(`card.${c.id}.t`, `card.${c.id}.b`, `label.${c.label}`);
  for (const ev of ['E_DUST1', 'E_DUST2', 'E_SEP1', 'E_SEP2', 'E_FEEDER']) need.push(`ev.${ev}.title`, `ev.${ev}.body`);
  const src = readFileSync(new URL('../src/engine/actions.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/engine/events.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/engine/run.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/'(req\.[a-zA-Z.]+)'/g)) need.push(m[1]);
  for (const m of src.matchAll(/`req\.mat\.\$\{k\}`/g)) void m;
  for (const k of ['parts', 'patches', 'seals', 'pads', 'seedsRadish', 'seedsLettuce', 'nutrients', 'liners', 'evaKits', 'cartridges', 'spareFans', 'cassettes', 'tests', 'cores']) need.push(`req.mat.${k}`, `mat.${k}`);
  assert.deepEqual(need.filter((k) => !(k in ru)), []);
});

test('sources: every card source exists; archive records carry id, time, unit, retrieval date', () => {
  const ids = new Set(SOURCES.map((s) => s.id));
  for (const c of CARDS) for (const s of c.sources) assert.ok(ids.has(s), s);
  for (const a of ARCHIVE) {
    assert.ok(ids.has(a.sourceId));
    assert.ok(a.retrievedUTC);
    if (a.type === 'FLR') { assert.equal(a.recordId, '2024-05-14T16:46:00-FLR-001'); assert.equal(a.classType, 'X8.7'); assert.ok(a.peakUTC.startsWith('2024-05-14T16:51')); }
    if (a.type === 'RAD') { assert.equal(a.unit, 'µGy'); assert.equal(a.value, 8100); }
  }
  for (const s of SOURCES) { assert.ok(['observed', 'reference', 'model', 'game'].includes(s.category)); assert.ok(s.limitations in ru, s.limitations); }
});

test('the simulation never touches the network', () => {
  const dir = new URL('../src/engine/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(src), f);
  }
});

test('four endings are reachable', () => {
  const seen = new Set();
  for (let seed = 0; seed < 8; seed++) {
    seen.add(playRun(Run, { seed }, STRATEGIES.control).state.ending.id);
    seen.add(playRun(Run, { seed }, STRATEGIES.compromiseB).state.ending.id);
    seen.add(playRun(Run, { seed }, STRATEGIES.error).state.ending.id);
  }
  // remote landing: control strategy that never sends the landing plan
  const noLanding = (r) => { const s = r.state; if (s.tick >= 24 * 24 && !s.flags.landCheckTick) { s.flags.__skip = true; } if (!s.flags.__skip || s.decision) STRATEGIES.control(r); else if (s.decision) r.exec({ type: 'choose', choiceId: 'safe' }); };
  seen.add(playRun(Run, { seed: 1 }, noLanding).state.ending.id);
  assert.deepEqual([...seen].sort(), ['remote', 'stop', 'survived', 'sustainable']);
});

test('error strategies: a visible alarm precedes every training stop', () => {
  const map = { pCO2: 'alarm.pCO2', pO2: 'alarm.pO2', P: 'alarm.P', T: 'alarm.Tlo', water: 'alarm.water', dose: 'alarm.dose', food: 'alarm.foodLow' };
  for (const name of ['error', 'random']) for (let seed = 0; seed < 30; seed++) {
    const s = playRun(Run, { seed }, STRATEGIES[name]).state;
    if (s.ending.id !== 'stop') continue;
    const stopTick = s.ending.tick;
    const warned = s.log.some((e) => e.type === 'alarm' && e.tick < stopTick && (e.key === map[s.ending.cause] || (s.ending.cause === 'T' && e.key === 'alarm.Thi')));
    assert.ok(warned, `${name} seed ${seed}: no alarm before stop.${s.ending.cause}`);
  }
});
