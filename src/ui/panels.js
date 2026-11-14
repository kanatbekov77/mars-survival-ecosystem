// System cabinets: cause → readings → trend → modes → jobs with cost/effect/reason.
import { h, sparkline } from './dom.js';
import { t, num } from '../i18n/index.js';
import { zoneReadings } from '../engine/physics.js';
import { solOf, slotOf, T, CROPS, DEFAULT_PLAN, FIXED_PLAN, H } from '../engine/config.js';
import { sensorView } from '../engine/sim.js';
import { forecast, PRESETS } from '../engine/run.js';
import { TECH } from '../engine/actions.js';
import { tickLabel, dose24, foodKcal, energyForecast } from './status.js';

const fmt = (v, d = 1) => num(v, d);
const hist = (s, k, n = 24) => s.history.slice(-n).map((x) => x[k]);

function row(label, value, cls = '') { return h('div', { class: `kv ${cls}` }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value)); }
function band(v, lo, hi) { return v < lo ? 'low' : v > hi ? 'high' : 'work'; }
function bandRow(label, v, unit, lo, hi, digits = 1, cadet) {
  const b = band(v, lo, hi);
  const word = t(`panel.${b === 'work' ? 'work' : b}`);
  return h('div', { class: `kv band-${b}` }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, `${fmt(v, digits)} ${unit}`, h('small', { class: 'bandword' }, ` ${b === 'work' ? '●' : b === 'low' ? '▼' : '▲'} ${cadet || b !== 'work' ? word : ''}`)));
}
function section(title, ...kids) { return h('section', { class: 'psec' }, h('h3', {}, title), ...kids); }

function matText(mat) {
  const e = Object.entries(mat || {});
  return e.length ? t('panel.mat', { m: e.map(([k, v]) => `${v} × ${t(`mat.${k}`)}`).join(', ') }) : '';
}

// One job row: name, cost, effect, unavailable reason — the button is the confirmation.
export function jobRow(ui, action, target, payload, labelKey) {
  const p = ui.run.preview(action, target, payload);
  const disabled = !!p.reason;
  const name = labelKey ? t(labelKey) : `${t(`act.${action}.name`)}${target != null && action !== 'install' ? ` · ${targetName(action, target)}` : ''}`;
  return h('div', { class: `job ${disabled ? 'disabled' : ''}` },
    h('button', { class: 'btn job-btn', disabled: disabled || null, 'aria-describedby': `jd-${action}-${target}`, onclick: () => ui.exec({ type: 'startJob', action, target, payload }) }, name),
    h('div', { class: 'job-meta', id: `jd-${action}-${target}` },
      h('span', { class: 'cost' }, `${t('panel.cost', { kwh: fmt(p.kWh, 2), ticks: p.ticks })} · ${p.token ? t('panel.token') : t('panel.noToken')}${matText(p.mat) ? ` · ${matText(p.mat)}` : ''}`),
      h('span', { class: 'effect' }, `→ ${t(action === 'install' ? `tech.${target}.d` : p.effectKey)}`),
      p.riskKey ? h('span', { class: 'risk' }, `⚠ ${t(p.riskKey)}`) : null,
      disabled ? h('span', { class: 'reason' }, t('panel.unavailable', { r: t(p.reason) })) : null));
}
function targetName(action, target) {
  if (action === 'cleanPV') return `${target + 1}`;
  if (['ghP', 'habP', 'scrubber', 'pv', 'water', 'dose', 'air', 'ice'].includes(target)) return { ghP: t('sys.greenhouse'), habP: t('v.P'), scrubber: t('v.scrub'), pv: t('sys.panels'), water: t('sys.water'), dose: t('v.dose'), air: t('hud.air'), ice: t('v.quarantine') }[target];
  if (target === 'gh') return t('sys.greenhouse');
  if (target === 'hab') return t('sys.habitat');
  return target;
}

function modeButtons(ui, system, values, current) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': t(`load.${system}`) || system }, values.map((v) => h('button', { class: `segbtn ${current === v ? 'on' : ''}`, 'aria-pressed': current === v ? 'true' : 'false', onclick: () => ui.exec({ type: 'setMode', system, value: v }) }, t(v))));
}

function jobStatus(ui) {
  const j = ui.s.job;
  if (!j) return null;
  return h('div', { class: 'jobnow' }, j.status === 'waiting' ? t('hud.jobWait', { name: t(`act.${j.action}.name`) }) : t('hud.job', { name: t(`act.${j.action}.name`), left: j.remaining }),
    h('button', { class: 'btn small ghost', onclick: () => ui.exec({ type: 'cancelJob' }) }, t('panel.cancelJob')));
}

function causeBox(lines) {
  const l = lines.filter(Boolean);
  return l.length ? h('div', { class: 'cause', role: 'note' }, h('strong', {}, `${t('panel.cause')}: `), l.slice(0, 2).join(' · ')) : null;
}

function firstAid(...items) {
  const list = items.flat().filter(Boolean);
  return list.length ? h('section', { class: 'psec firstaid', 'aria-label': t('panel.firstAid') }, h('h3', {}, t('panel.firstAid')), list) : null;
}

// ------------- habitat -------------
function habitat(ui) {
  const s = ui.s, cadet = s.profile === 'cadet';
  const v = sensorView(s);
  const r = zoneReadings(s.zones.hab);
  const unverified = s.sensors.habPOffset !== 0;
  const insp = s.flags.inspected.habP != null && s.tick - s.flags.inspected.habP <= 24;
  const scrubState = s.eq.scrubMode === 'emergency' && s.eq.cartridgeInserted ? 'emergency' : s.eq.scrubMain && s.eq.fan ? 'main' : 'none';
  const causes = [
    !s.eq.scrubMain ? t('ev.E_SCRUB.title') : null, !s.eq.fan ? t('ev.L_FAN.title') : null, s.eq.airlockLeak ? t('ev.L_SEAL.title') : null,
    unverified && !s.sensors.habPChecked ? `${t('v.P')}: ${t('alarm.unverified')}` : null, r.pCO2 > 0.2 ? t('alarm.pCO2') : null,
  ];
  const fc = forecast(s, Math.min(24, 26 - slotOf(s.tick) + 3)).filter((x) => !x.blocked);
  const minT = fc.length ? Math.min(...fc.map((x) => x.T)) : r.T;
  const air = section(t('panel.values'),
    bandRow(t('v.pO2'), v.pO2, t('units.kPa'), 17, 23, 1, cadet),
    bandRow(t('v.pCO2'), v.pCO2, t('units.kPa'), 0, 0.25, 3, cadet),
    h('div', { class: `kv band-${band(v.Pshown, 72, 110)}` }, h('span', { class: 'k' }, t('v.P')), h('span', { class: 'v' }, `${fmt(v.Pshown)} ${t('units.kPa')}`, unverified && !s.sensors.habPChecked ? h('small', { class: 'flag' }, ` ⚑ ${t('alarm.unverified')}`) : null,
      insp ? h('small', { class: 'truth' }, ` · ${t('panel.truth', { v: `${fmt(r.P)} ${t('units.kPa')}` })}`) : null)),
    bandRow(t('v.T'), r.T, t('units.C'), 17, 28, 1, cadet),
    bandRow(t('v.RH'), r.RH * 100, t('units.pct'), 20, 80, 0, cadet),
    row(t('v.tankO2'), `${fmt(s.tanks.O2)} ${t('units.kg')} · ${fmt(s.tanks.O2 / 3.36)} ${t('units.sol')}`),
    row(t('v.tankN2'), `${fmt(s.tanks.N2)} ${t('units.kg')}`),
    row(t('v.scrub'), `${t(`scrub.${scrubState}`)}${s.eq.scrubSwitchAt != null ? ' …' : ''}`, scrubState === 'none' ? 'bad' : ''),
    s.eq.cartridgeInserted ? row(t('v.cartridge'), `${fmt(s.eq.cartridge, 2)} / 3 ${t('units.kg')} CO₂`) : null,
    row(t('v.fatigue'), `${s.fatigue} / 3`),
    row(t('v.tout'), `${fmt(s.Tout, 0)} ${t('units.C')}`),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, t('tab.heat')), h('span', { class: 'v' }, t('heat.forecast', { t: fmt(minT) }))));
  const trends = section(t('panel.trend'),
    h('div', { class: 'spark-label' }, `CO₂ (${t('units.kPa')})`), sparkline(hist(s, 'pCO2'), { hi: 0.25, min: 0, label: 'CO2', forecast: fc.slice(0, 3).map((x) => x.pCO2) }),
    h('div', { class: 'spark-label' }, `O₂ (${t('units.kPa')})`), sparkline(hist(s, 'pO2'), { lo: 17, label: 'O2' }),
    h('div', { class: 'spark-label' }, `T (${t('units.C')})`), sparkline(hist(s, 'habT'), { lo: 17, hi: 28, label: 'T', forecast: fc.slice(0, 6).map((x) => x.T) }));
  const modes = section(t('panel.modes'),
    h('div', { class: 'modeline' }, h('span', {}, t('v.electrolysis')), modeButtons(ui, 'electrolysis', ['auto', 'off', 'on'], s.eq.electrolysis)),
    h('div', { class: 'modeline' }, h('span', {}, t('v.scrub')),
      h('div', { class: 'seg' },
        h('button', { class: `segbtn ${s.eq.scrubMode === 'main' ? 'on' : ''}`, onclick: () => ui.exec({ type: 'switchScrub', to: 'main' }) }, t('scrub.main')),
        h('button', { class: `segbtn ${s.eq.scrubMode === 'emergency' ? 'on' : ''}`, onclick: () => ui.exec({ type: 'switchScrub', to: 'emergency' }) }, t('scrub.emergency')))));
  const jobs = section(t('panel.actions'), jobStatus(ui),
    jobRow(ui, 'inspect', 'air'), jobRow(ui, 'inspect', 'scrubber'), jobRow(ui, 'inspect', 'habP'), jobRow(ui, 'calibrate', 'habP'),
    jobRow(ui, 'replaceCartridge'), jobRow(ui, 'repairScrub'), jobRow(ui, 'repairFan'),
    s.eq.airlockLeak ? [jobRow(ui, 'repairSeal', 'hab'), jobRow(ui, 'patch', 'hab')] : null, jobRow(ui, 'rest'));
  const quiz = solOf(s.tick) === 5 && !s.flags.quiz.air ? airQuiz(ui) : null;
  const aid = firstAid(
    (!s.eq.scrubMain || !s.eq.fan) && s.eq.scrubMode !== 'emergency' ? h('button', { class: 'btn primary', onclick: () => ui.exec({ type: 'switchScrub', to: 'emergency' }) }, `${t('v.scrub')}: ${t('scrub.emergency')}`) : null,
    !s.eq.scrubMain ? jobRow(ui, 'repairScrub') : null, !s.eq.fan ? jobRow(ui, 'repairFan') : null,
    s.eq.cartridgeInserted && s.eq.cartridge < 0.6 ? jobRow(ui, 'replaceCartridge') : null,
    s.eq.airlockLeak ? jobRow(ui, 'repairSeal', 'hab') : null,
    unverified && !(s.flags.calibrated >= (s.flags.sensorFaultTick ?? 1e9)) ? [jobRow(ui, 'inspect', 'habP'), jobRow(ui, 'calibrate', 'habP')] : null);
  return [causeBox(causes), aid, quiz, air, trends, modes, jobs];
}

function airQuiz(ui) {
  const opts = ['', 'scrubber', 'electrolysis'];
  const sel = (id, label) => h('label', { class: 'quizrow' }, label, h('select', { id }, opts.map((o) => h('option', { value: o }, o ? t(`quiz.${o}`) : '—'))));
  const out = h('p', { class: 'quiz-out', 'aria-live': 'polite' });
  return section(t('quiz.air.q'),
    h('svg', { class: 'airdiagram', viewBox: '0 0 300 90', role: 'img', 'aria-label': t('quiz.air.q'), html: '<rect x="8" y="20" width="110" height="50" rx="8" class="dg"/><text x="63" y="50" text-anchor="middle" class="dgt">A: H₂O → O₂ + H₂</text><rect x="182" y="20" width="110" height="50" rx="8" class="dg"/><text x="237" y="50" text-anchor="middle" class="dgt">B: CO₂ ⇢ ✕</text><path d="M118 45 H182" class="dgl"/>' }),
    sel('q-co2', t('quiz.air.co2')), sel('q-o2', t('quiz.air.o2')),
    h('button', { class: 'btn', onclick: () => {
      const ok = document.getElementById('q-co2').value === 'scrubber' && document.getElementById('q-o2').value === 'electrolysis';
      out.textContent = ok ? t('quiz.right') : t('quiz.wrong');
      if (ok) ui.exec({ type: 'quiz', key: 'air', correct: true });
    } }, t('quiz.check')), out);
}

// ------------- greenhouse -------------
function greenhouse(ui) {
  const s = ui.s, cadet = s.profile === 'cadet';
  const g = zoneReadings(s.zones.gh);
  const causes = [s.zones.gh.leak > 0 ? t('ev.E_PROBE.title') : null, !s.eq.pump ? t('ev.L_PUMP.title') : null, !s.eq.led ? t('log.ledFault') : null,
    ...s.crops.filter((c) => c.limit && c.state === 'growing').map((c) => `${t('v.tray', { id: c.id })}: ${t('v.limit')} — ${t(`limit.${c.limit}`)}`)];
  const vals = section(t('panel.values'),
    bandRow(t('v.P'), g.P, t('units.kPa'), 65, 110, 1, cadet), bandRow(t('v.T'), g.T, t('units.C'), 17, 25, 1, cadet),
    bandRow(t('v.RH'), g.RH * 100, t('units.pct'), 40, 80, 0, cadet), bandRow(t('v.pCO2'), g.pCO2, t('units.kPa'), 0.05, 0.16, 3, cadet),
    row(t('v.co2tank'), `${fmt(s.tanks.CO2gh, 2)} ${t('units.kg')}`),
    s.zones.gh.leak > 0 ? row(t('v.leak'), `${fmt(s.zones.gh.leak * 1000, 1)} ‰/h`, 'bad') : null);
  const trays = section(t('sys.greenhouse'), s.crops.map((c) => h('div', { class: `tray-card st-${c.state}` },
    h('h4', {}, `${t('v.tray', { id: c.id })} · ${c.species ? t(`species.${c.species}`) : ''} · ${t(`tray.${c.state}`)}${c.halved ? ' ×½' : ''}`),
    c.state !== 'empty' ? [
      h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': CROPS[c.species].sols, 'aria-valuenow': c.eff.toFixed(1), 'aria-label': t('v.age', { a: fmt(c.eff), n: CROPS[c.species].sols }) },
        h('span', { style: { width: `${Math.min(100, (100 * c.eff) / CROPS[c.species].sols)}%` } })),
      h('small', {}, t('v.age', { a: fmt(c.eff), n: CROPS[c.species].sols })),
      row(t('v.rootWater'), `${fmt(c.water, 2)} ${t('units.kg')}`), row(t('v.nutrients'), fmt(c.nutrients, 2)),
      row(t('v.stress'), `${fmt(c.stress, 0)}${c.stress >= 18 ? ' ▲' : ''}`, c.stress >= 45 ? 'bad' : c.stress >= 18 ? 'warn' : ''),
      c.limit ? row(t('v.limit'), t(`limit.${c.limit}`), 'warn') : null] : null,
    c.state === 'empty' ? [jobRow(ui, 'plant', c.id, { species: 'radish' }, 'plant.radish'), jobRow(ui, 'plant', c.id, { species: 'lettuce' }, 'plant.lettuce'),
      c.id === 'B' && solOf(s.tick) === 2 && !s.flags.decisions.trayB ? h('button', { class: 'btn ghost', onclick: () => ui.exec({ type: 'decide', key: 'trayB', value: 'empty' }) }, t('dec.trayB.emptyBtn')) : null] : null,
    c.state === 'growing' || c.state === 'ripe' ? jobRow(ui, 'feed', c.id) : null,
    c.state === 'ripe' ? jobRow(ui, 'harvest', c.id) : null,
    c.state === 'lost' ? jobRow(ui, 'clearTray', c.id) : null)));
  const modes = section(t('panel.modes'),
    h('div', { class: 'modeline' }, h('span', {}, t('sys.greenhouse')), h('div', { class: 'seg' },
      h('button', { class: `segbtn ${s.ghMode === 'normal' ? 'on' : ''}`, onclick: () => ui.exec({ type: 'ghMode', value: 'normal' }) }, t('gh.normal')),
      h('button', { class: `segbtn ${s.ghMode === 'preserve' ? 'on' : ''}`, onclick: () => ui.exec({ type: 'ghMode', value: 'preserve' }) }, t('gh.preserve')))),
    h('button', { class: `btn ${s.eq.ghIsolated ? 'ghost' : ''}`, onclick: () => ui.exec({ type: 'isolate', zone: 'gh', value: !s.eq.ghIsolated }) }, s.eq.ghIsolated ? t('unisolate.gh') : t('isolate.gh')));
  const jobs = section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'inspect', 'ghP'), jobRow(ui, 'patch', 'gh'), jobRow(ui, 'greenhouseFill'), jobRow(ui, 'exchangeGas'), jobRow(ui, 'repairPump'), jobRow(ui, 'repairLED'));
  const trend = section(t('panel.trend'), h('div', { class: 'spark-label' }, `P (${t('units.kPa')})`), sparkline(hist(s, 'ghP'), { lo: 65, label: 'P' }));
  const aid = firstAid(
    s.zones.gh.leak > 0 ? [jobRow(ui, 'inspect', 'ghP'), !s.eq.ghIsolated ? h('button', { class: 'btn primary', onclick: () => ui.exec({ type: 'isolate', zone: 'gh', value: true }) }, t('isolate.gh')) : null, jobRow(ui, 'patch', 'gh')] : null,
    !s.eq.pump ? jobRow(ui, 'repairPump') : null, !s.eq.led ? jobRow(ui, 'repairLED') : null,
    s.crops.filter((c) => c.state === 'ripe').map((c) => jobRow(ui, 'harvest', c.id)));
  return [causeBox(causes), aid, vals, trend, trays, modes, jobs];
}

// ------------- battery / grid -------------
function battery(ui) {
  const s = ui.s, E = s.energy;
  const fc = energyForecast(s);
  const rej = Object.entries(E.rejected || {}).filter(([, why]) => why === 'power' || why === 'bus').map(([id]) => t(`load.${id}`));
  const causes = [!E.mainBus ? t('ev.E_FEEDER.title') : null, E.L < 1 ? `${t('v.L')} ${fmt(E.L * 100, 0)}%` : null, rej.length ? t('plan.rejected', { list: rej.join(', ') }) : null];
  const vals = section(t('panel.values'),
    h('div', { class: 'meter big', role: 'meter', 'aria-label': t('v.soc'), 'aria-valuemin': 0, 'aria-valuemax': 120, 'aria-valuenow': E.soc.toFixed(0) }, h('span', { style: { width: `${(100 * E.soc) / 120}%` } })),
    row(t('v.soc'), `${fmt(E.soc)} / 120 ${t('units.kWh')} · ${fmt(E.soc / 10)} ${t('hud.cubes', { c: '' }).trim()}`),
    row(t('v.pv'), `${fmt(E.lastPV, 2)} ${t('units.kW')}`), row(t('v.reserve'), `${fmt(E.lastReserve || 0, 2)} ${t('units.kW')}`),
    row(t('v.use'), `${fmt(E.lastUse, 2)} ${t('units.kW')}`), row(t('v.net'), `${E.lastNet >= -0.005 ? '+' : ''}${fmt(Math.abs(E.lastNet) < 0.005 ? 0 : E.lastNet, 2)} ${t('units.kW')}`),
    row(t('v.mainBus'), E.mainBus ? t('ok') : t('broken'), E.mainBus ? '' : 'bad'),
    row(t('timeline.title'), `${fmt(fc.soc)} ${t('units.kWh')} · min ${fmt(fc.minSoc)}`));
  const trend = section(t('timeline.title'), sparkline(hist(s, 'soc'), { lo: 18, min: 0, max: 120, label: 'SoC', forecast: fc.series.filter((x) => !x.blocked).map((x) => x.soc) }));
  const order = E.plan;
  const plan = section(t('plan.title'),
    h('ol', { class: 'plan' },
      FIXED_PLAN.map((id) => h('li', { class: 'fixed' }, `🔒 ${t(`load.${id}`)}`)),
      order.map((id, i) => h('li', {}, h('span', {}, t(`load.${id}`)),
        h('span', { class: 'planbtns' },
          h('button', { class: 'btn small', disabled: i === 0 || null, 'aria-label': `${t('plan.up')}: ${t(`load.${id}`)}`, onclick: () => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; ui.exec({ type: 'setPlan', order: o }); } }, '↑'),
          h('button', { class: 'btn small', disabled: i === order.length - 1 || null, 'aria-label': `${t('plan.down')}: ${t(`load.${id}`)}`, onclick: () => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; ui.exec({ type: 'setPlan', order: o }); } }, '↓'))))),
    h('small', {}, t('plan.fixed')),
    h('button', { class: 'btn', onclick: () => ui.exec({ type: 'savePlan' }) }, t('plan.save')));
  const presets = section(t('presets.title'), h('div', { class: 'presets' }, Object.keys(PRESETS).map((id) => h('button', { class: `btn preset ${s.profile === 'cadet' && id === 'storm' && s.energy.L < 1 ? 'suggest' : ''}`, onclick: () => ui.exec({ type: 'preset', id }) },
    h('strong', {}, t(`preset.${id}.name`)), h('small', {}, t(`preset.${id}.desc`))))));
  return [causeBox(causes), vals, trend, reserveModes(ui), presets, plan];
}

function reserveModes(ui) {
  const r = ui.s.energy.reserve;
  const locked = r.lockUntil > ui.s.tick;
  return section(t('sys.reserve'), h('div', { class: 'seg' }, ['standby', 'assist', 'continuous'].map((m) => h('button', { class: `segbtn ${r.mode === m && !r.startingTo ? 'on' : ''} ${r.startingTo === m ? 'pending' : ''}`, onclick: () => ui.exec({ type: 'setReserve', mode: m }) }, t(`mode.${m}`), r.startingTo === m ? ` (${t('mode.starting')})` : ''))),
    locked ? h('small', { class: 'reason' }, t('req.reserveLock')) : null);
}

// ------------- panels -------------
function panels(ui) {
  const s = ui.s, E = s.energy;
  const causes = [E.L < 1 ? `${t('v.L')} ${fmt(E.L * 100, 0)}%` : null, E.clean.some((c) => c < 0.6) ? t('log.panelDirty', { panel: E.clean[0] < E.clean[1] ? 1 : 2 }) : null];
  const vals = section(t('panel.values'), row(t('v.L'), `${fmt(E.L * 100, 0)} %`),
    [0, 1].map((i) => h('div', {}, row(t('v.clean', { n: i + 1 }), `${fmt(E.clean[i] * 100, 0)} %${E.folded[i] ? ` · ${t('log.fold')}` : ''}`, E.clean[i] < 0.55 ? 'warn' : ''),
      h('div', { class: 'meter' }, h('span', { style: { width: `${E.clean[i] * 100}%` } })),
      row('PV', `${fmt(E.lastPanels?.[i] || 0, 2)} ${t('units.kW')}`),
      h('button', { class: 'btn small', onclick: () => ui.exec({ type: 'fold', panel: i, value: !E.folded[i] }) }, E.folded[i] ? t('unfold.panel', { n: i + 1 }) : t('fold.panel', { n: i + 1 })))));
  const trend = section(t('panel.trend'), h('div', { class: 'spark-label' }, t('v.L')), sparkline(hist(s, 'L', 72), { min: 0, max: 1, label: 'L' }),
    h('div', { class: 'spark-label' }, t('v.clean', { n: '1/2' })), sparkline(hist(s, 'clean0', 72), { min: 0, max: 1, label: 'clean' }));
  const jobs = section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'cleanPV', 0), jobRow(ui, 'cleanPV', 1), jobRow(ui, 'sample', 'pv'), jobRow(ui, 'install', 'T_DUST', null, 'tech.T_DUST'));
  const aid = firstAid(E.clean.map((c, i) => (c < 0.6 ? jobRow(ui, 'cleanPV', i) : null)));
  return [causeBox(causes), aid, vals, trend, jobs];
}

function reserve(ui) {
  const s = ui.s, r = s.energy.reserve;
  const causes = [!s.energy.mainBus ? t('ev.E_FEEDER.title') : null, r.limited ? t('v.limited') : r.maintDue != null ? t('v.maint', { t: tickLabel(r.maintDue) }) : null];
  const vals = section(t('panel.values'), row(t('v.reserve'), `${t(`mode.${r.mode}`)}${r.startingTo ? ` → ${t(`mode.${r.startingTo}`)}` : ''}`),
    row(t('v.hours'), `${fmt(r.hours, 0)} h · ${r.contTicks} / 24`), r.maintDue != null ? row(t('v.maint', { t: tickLabel(r.maintDue) }), '', 'warn') : null,
    r.limited ? row(t('v.limited'), '', 'bad') : null, row(t('v.mainBus'), s.energy.mainBus ? t('ok') : t('broken'), s.energy.mainBus ? '' : 'bad'));
  const aid = firstAid(!s.energy.mainBus ? jobRow(ui, 'resetFeeder') : null, r.maintDue != null || r.limited ? jobRow(ui, 'serviceReserve') : null);
  return [causeBox(causes), aid, vals, reserveModes(ui), section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'serviceReserve'), jobRow(ui, 'resetFeeder'), jobRow(ui, 'install', 'T_ISOLATION', null, 'tech.T_ISOLATION'))];
}

// ------------- water -------------
function water(ui) {
  const s = ui.s, W = s.water;
  const slot = slotOf(s.tick);
  const why = s.eq.recycle === 'off' ? t('off') : (s.energy.dispatch?.recycle || 0) > 0 ? t('water.why.run') : W.grey <= 1e-6 ? t('water.why.empty') : W.clean >= 219.9 ? t('water.why.full') : (slot < 3 || slot > 14) ? t('water.why.grey') : t('water.why.power');
  const causes = [!s.eq.cassetteOk ? t('ev.E_WATER.title') : null, W.clean < 30 ? t('alarm.water') : null];
  const vals = section(t('panel.values'),
    bandRow(t('v.clean.water'), W.clean, t('units.kg'), 24, 220, 1, s.profile === 'cadet'), row(t('v.grey'), `${fmt(W.grey)} / 60 ${t('units.kg')}`),
    row(t('v.quarantine'), `${fmt(W.quarantine)} ${t('units.kg')} · ${t(`quarantine.${W.quarantineState}`)}`),
    row(t('v.eff'), `${fmt(s.eq.recycleEff * 100, 0)} %`, s.eq.recycleEff < 0.88 ? 'bad' : ''), row(t('v.recycle'), why));
  const trend = section(t('panel.trend'), sparkline(hist(s, 'water', 72), { lo: 24, label: 'water' }));
  const modes = section(t('panel.modes'), h('div', { class: 'modeline' }, h('span', {}, t('v.recycle')), modeButtons(ui, 'recycle', ['auto', 'off'], s.eq.recycle)),
    h('div', { class: 'modeline' }, h('span', {}, t('v.electrolysis')), modeButtons(ui, 'electrolysis', ['auto', 'off', 'on'], s.eq.electrolysis)));
  const jobs = section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'waterService'), jobRow(ui, 'thawCore'), jobRow(ui, 'waterTest'), jobRow(ui, 'install', 'T_LOOP', null, 'tech.T_LOOP'),
    solOf(s.tick) === 18 && !s.flags.decisions.ice && !s.flags.thawed ? h('button', { class: 'btn ghost', onclick: () => ui.exec({ type: 'decide', key: 'ice', value: 'postpone' }) }, t('dec.ice.postponeBtn')) : null);
  const aid = firstAid(!s.eq.cassetteOk ? jobRow(ui, 'waterService') : null, W.quarantineState === 'untested' ? jobRow(ui, 'waterTest') : null);
  return [causeBox(causes), aid, vals, trend, modes, jobs];
}

// ------------- shelter -------------
function shelter(ui) {
  const s = ui.s;
  const causes = [s.sepWarning ? t(s.tick < T(20, 0) ? 'ev.E_SEP1.title' : 'ev.E_SEP2.title') : null];
  const crew = section(t('crew.title'), h('table', { class: 'crew' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, t('v.dose')), h('th', {}, t('v.dose24')), h('th', {}, t('v.loc')))),
    h('tbody', {}, s.crew.map((c) => h('tr', { class: dose24(c) >= 5 ? 'bad' : '' }, h('td', {}, t(`crew.${c.id}`)), h('td', {}, `${fmt(c.dose, 2)} / 28`), h('td', {}, fmt(dose24(c), 2)), h('td', {}, t(`loc.${c.loc}`) + (c.evaBanUntil >= s.tick ? ' ⛔' : '')))))));
  const trend = section(t('panel.trend'), sparkline(hist(s, 'dose', 72), { hi: 28, min: 0, label: 'dose' }));
  const aid = firstAid(s.sepWarning && !s.shelter ? h('button', { class: 'btn primary', onclick: () => ui.exec({ type: 'shelter', value: true }) }, t('shelter.go')) : null);
  const ctl = section(t('panel.modes'), h('button', { class: 'btn', onclick: () => ui.exec({ type: 'shelter', value: !s.shelter }) }, s.shelter ? t('shelter.leave') : t('shelter.go')), jobRow(ui, 'inspect', 'dose'));
  return [causeBox(causes), aid, crew, trend, ctl];
}

// ------------- comms -------------
function comms(ui) {
  const s = ui.s;
  const sol = solOf(s.tick);
  const causes = [!s.eq.relay ? t('ev.L_RELAY.title') : null, sol >= 25 && !s.flags.landingConfirmed ? t('ev.E_LANDING_CHECK.title') : null];
  const vals = section(t('panel.values'), row(t('v.relay'), s.eq.relay ? t('ok') : t('broken'), s.eq.relay ? '' : 'bad'),
    row(t('v.landCheck'), s.flags.landCheckTick != null ? tickLabel(s.flags.landCheckTick) : '—'), row(t('v.landing'), s.flags.landingConfirmed ? '✓' : '—'));
  const inbox = section(t('v.mcc'), s.inbox.length ? h('ul', { class: 'inbox' }, s.inbox.slice(-5).reverse().map((m) => h('li', {}, h('small', {}, tickLabel(m.tick)), ' ', t(m.key)))) : h('p', {}, t('log.empty')));
  const aid = firstAid(!s.eq.relay ? jobRow(ui, 'relayRepair') : null, sol >= 25 && s.flags.landCheckTick == null ? jobRow(ui, 'landCheck') : null, s.flags.landCheckTick != null && !s.flags.landingConfirmed ? jobRow(ui, 'send') : null);
  return [causeBox(causes), aid, vals, inbox, section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'send'), jobRow(ui, 'landCheck'), jobRow(ui, 'relayRepair'))];
}

// ------------- storage -------------
function storage(ui) {
  const s = ui.s;
  const kcal = foodKcal(s);
  const fresh = s.food.fresh[0];
  const vals = section(t('panel.values'), row(t('v.packs'), `${fmt(s.food.packs, 0)} ${t('units.kcal')} · ${fmt(s.food.packs / 9600)} ${t('units.sol')}`),
    row(t('v.fresh'), fresh ? `${fmt(fresh.kcal, 0)} ${t('units.kcal')} → ${tickLabel(fresh.expiresTick)}` : '—'),
    h('div', { class: 'modeline' }, h('span', {}, t('v.ration')), h('div', { class: 'seg' },
      h('button', { class: `segbtn ${s.ration === 1 ? 'on' : ''}`, onclick: () => ui.exec({ type: 'ration', value: 1 }) }, t('ration.full')),
      h('button', { class: `segbtn ${s.ration < 1 ? 'on' : ''}`, onclick: () => ui.exec({ type: 'ration', value: 0.9 }) }, t('ration.save')))));
  const sup = section(t('supplies.title'),
    row(t('hud.food'), `${fmt(kcal / 9600)} ${t('units.sol')}`, kcal / 9600 < 3 ? 'bad' : ''), row(t('v.tankO2'), `${fmt(s.tanks.O2 / 3.36)} ${t('units.sol')}`, s.tanks.O2 / 3.36 < 3 ? 'warn' : ''),
    row(t('v.clean.water'), `${fmt(s.water.clean)} ${t('units.kg')}`, s.water.clean < 36 ? 'warn' : ''));
  const st = section(t('stores'), h('ul', { class: 'stores' }, Object.entries(s.stores).map(([k, v]) => h('li', {}, `${t(`mat.${k}`)}: ${v}`))));
  const wh = section(t('warehouse'), row(t('hud.food'), `${fmt(s.warehouse.kcal, 0)} ${t('units.kcal')}`), row(t('v.clean.water'), `${fmt(s.warehouse.water)} ${t('units.kg')}`), row(t('mat.parts'), `${s.warehouse.parts}`), jobRow(ui, 'unload'));
  const tech = section(t('upgrade.title'), Object.keys(TECH).filter((k) => !['T_DUST', 'T_LOOP', 'T_ISOLATION'].includes(k)).map((k) => jobRow(ui, 'install', k, null, `tech.${k}`)),
    Object.entries(s.flags.tech).map(([k, at]) => h('div', { class: 'kv' }, h('span', { class: 'k' }, `✓ ${t(`tech.${k}`)}`), h('span', { class: 'v' }, tickLabel(at)))),
    solOf(s.tick) === 24 && !s.flags.decisions.upgrade ? h('button', { class: 'btn ghost', onclick: () => ui.exec({ type: 'decide', key: 'upgrade', value: 'decline' }) }, t('upgrade.decline')) : null);
  return [vals, sup, st, wh, tech];
}

// ------------- rover -------------
function rover(ui) {
  const s = ui.s;
  const vals = section(t('panel.values'), row(t('v.cache'), t(`cache.${s.cache}`)), row(t('mat.evaKits'), s.stores.evaKits));
  return [vals, section(t('panel.actions'), jobStatus(ui), jobRow(ui, 'recoverCache'),
    s.cache === 'field' && !s.flags.decisions.cache ? h('button', { class: 'btn ghost', onclick: () => ui.exec({ type: 'decide', key: 'cache', value: 'skip' }) }, t('dec.cache.skipBtn')) : null)];
}

export const PANELS = { habitat, greenhouse, battery, panels, reserve, water, shelter, comms, storage, rover };

// Observations recorded when a cabinet is opened (viewing counts as reading the instrument).
export const OBSERVES = {
  habitat: ['oxygen', 'air', 'scrubber', 'heat'], greenhouse: ['greenhouse'], battery: ['energy'], panels: ['panels'], reserve: ['reserve'],
  water: ['water'], shelter: ['dose'], comms: ['comms'], storage: ['supplies', 'food'], rover: ['rover'],
};

export function forecastView(ui) {
  const s = ui.s;
  const f = forecast(s, 3).filter((x) => !x.blocked);
  return h('div', { class: 'forecast' }, h('h2', {}, t('panel.forecast3')),
    h('table', { class: 'crew' }, h('thead', {}, h('tr', {}, h('th', {}, ''), ...f.map((x) => h('th', {}, tickLabel(x.t))))),
      h('tbody', {},
        h('tr', {}, h('td', {}, t('v.pO2')), ...f.map((x) => h('td', {}, fmt(x.pO2)))),
        h('tr', {}, h('td', {}, t('v.pCO2')), ...f.map((x) => h('td', {}, fmt(x.pCO2, 3)))),
        h('tr', {}, h('td', {}, t('v.T')), ...f.map((x) => h('td', {}, fmt(x.T)))),
        h('tr', {}, h('td', {}, t('v.soc')), ...f.map((x) => h('td', {}, fmt(x.soc)))),
        h('tr', {}, h('td', {}, t('v.clean.water')), ...f.map((x) => h('td', {}, fmt(x.water)))),
        h('tr', {}, h('td', {}, t('hud.food')), ...f.map((x) => h('td', {}, fmt(x.food / 9600, 2)))))),
    h('small', {}, t('timeline.title')));
}

export { H, DEFAULT_PLAN };
