// App controller: screens, HUD, time loop, autopause queue, decisions, saves, demo, debrief.
import { h, clear, openModal, closeAllModals, modalOpen, download } from './dom.js';
import { t, setLang, getLang, num } from '../i18n/index.js';
import { Run } from '../engine/run.js';
import { playRun, controlStrategy } from '../engine/strategies.js';
import { T, solOf, slotOf, TOTAL_TICKS, CROPS } from '../engine/config.js';
import { zoneReadings } from '../engine/physics.js';
import { MISSIONS } from '../engine/missions.js';
import { SOURCES, ARCHIVE, CARDS, sourceById, archiveById } from '../data/sources.js';
import { renderMap } from './map.js';
import { PANELS, OBSERVES, forecastView } from './panels.js';
import { systemStatus, energyForecast, airAlarm, tickLabel, phaseOf, foodKcal, systemForKey, SYSTEMS } from './status.js';

const TICK_MS = 5000; // ×1: 5 s per tick, 120 s per sol
const SAVE_KEY = { campaign: 'mars.v1.campaign', demo: 'mars.v1.demo' };
const PREFS_KEY = 'mars.v1.prefs';
const fmt = (v, d = 1) => num(v, d);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

class App {
  constructor(root) {
    this.root = root;
    this.prefs = { lang: 'ru', scale: 100, motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full', sound: 'on', subtitles: 'on', ...(store.get(PREFS_KEY) || {}) };
    this.applyPrefs();
    this.run = null; this.speed = 1; this.running = false; this.acc = 0; this.last = 0;
    this.selected = null; this.queue = []; this.decisionUI = null; this.logOpen = false;
    this.live = h('div', { class: 'sr-only', 'aria-live': 'assertive', role: 'status' });
    document.body.append(this.live);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.hiddenPause(); } });
    document.addEventListener('keydown', (e) => this.hotkeys(e));
    requestAnimationFrame((ts) => this.loop(ts));
    this.menu();
  }

  applyPrefs() {
    setLang(this.prefs.lang);
    document.documentElement.style.fontSize = `${this.prefs.scale}%`;
    document.documentElement.dataset.motion = this.prefs.motion;
    store.set(PREFS_KEY, this.prefs);
  }

  // ---------------- screens ----------------
  screen(...kids) { closeAllModals(); this.running = false; clear(this.root); this.root.append(h('div', { class: 'screen' }, ...kids)); const hd = this.root.querySelector('h1,h2'); if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); } else this.root.querySelector('button')?.focus(); }

  menu() {
    this.mode = null;
    const save = store.get(SAVE_KEY.campaign);
    this.screen(h('main', { class: 'menu' },
      h('div', { class: 'menu-art', 'aria-hidden': 'true', html: MENU_ART }),
      h('h1', {}, t('app.title')), h('p', { class: 'subtitle' }, t('app.subtitle')),
      h('nav', { class: 'menu-buttons' },
        h('button', { class: 'btn primary big', onclick: () => this.setup() }, t('menu.new')),
        h('button', { class: 'btn big', disabled: save ? null : true, onclick: () => this.continueSave() }, t('menu.continue'), save ? h('small', {}, ` · ${t('menu.saveInfo', { sol: solOf(save.lastCommittedTick), profile: t(`profile.${save.meta.profile}`) })}`) : h('small', {}, ` · ${t('menu.noSave')}`)),
        h('button', { class: 'btn big', onclick: () => this.demoMenu() }, t('menu.demo')),
        h('button', { class: 'btn big', onclick: () => this.sources() }, t('menu.sources')),
        h('button', { class: 'btn big', onclick: () => this.accessibility() }, t('menu.access')),
        h('label', { class: 'menu-file btn big' }, t('menu.import'), h('input', { type: 'file', accept: 'application/json', class: 'sr-only', onchange: (e) => this.importSave(e) }))),
      h('div', { class: 'lang', role: 'group', 'aria-label': t('menu.lang') }, ['ru', 'en'].map((l) => h('button', { class: `segbtn ${getLang() === l ? 'on' : ''}`, 'aria-pressed': getLang() === l ? 'true' : 'false', onclick: () => { this.prefs.lang = l; this.applyPrefs(); this.menu(); } }, l.toUpperCase()))),
      h('p', { class: 'disclaimer' }, t('app.disclaimer'))));
  }

  setup() {
    let profile = 'cadet', timer = 'on';
    const seed = Math.floor(Math.random() * 1e6);
    const pick = (name, val, cur, set, label, desc) => h('label', { class: `choice ${cur === val ? 'on' : ''}` }, h('input', { type: 'radio', name, value: val, checked: cur === val || null, onchange: () => { set(val); } }), h('strong', {}, label), desc ? h('small', {}, desc) : null);
    const seedIn = h('input', { type: 'number', min: 0, value: seed, id: 'seed' });
    const form = h('form', { class: 'setup', onsubmit: (e) => { e.preventDefault(); this.newCampaign({ profile, timer, seed: +seedIn.value || 0 }); } },
      h('h2', {}, t('setup.title')),
      h('fieldset', {}, h('legend', {}, t('setup.profile')),
        pick('profile', 'cadet', profile, (v) => { profile = v; }, t('profile.cadet'), t('profile.cadet.desc')),
        pick('profile', 'engineer', profile, (v) => { profile = v; }, t('profile.engineer'), t('profile.engineer.desc'))),
      h('fieldset', {}, h('legend', {}, t('setup.timer')),
        pick('timer', 'on', timer, (v) => { timer = v; }, t('timer.on')), pick('timer', 'off', timer, (v) => { timer = v; }, t('timer.off'))),
      h('fieldset', {}, h('legend', {}, t('menu.lang')), ['ru', 'en'].map((l) => pick('lang', l, getLang(), (v) => { this.prefs.lang = v; this.applyPrefs(); }, l === 'ru' ? 'Русский' : 'English'))),
      h('label', { class: 'seedrow' }, t('setup.seed'), seedIn),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => this.menu() }, t('menu.back')), h('button', { type: 'submit', class: 'btn primary' }, t('menu.start'))));
    form.addEventListener('change', () => form.querySelectorAll('.choice').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked)));
    this.screen(form);
  }

  accessibility(back = () => this.menu()) {
    const P = this.prefs;
    const seg = (key, vals, label) => h('div', { class: 'modeline' }, h('span', {}, label), h('div', { class: 'seg', role: 'group', 'aria-label': label }, vals.map(([v, l]) => h('button', { class: `segbtn ${P[key] === v ? 'on' : ''}`, 'aria-pressed': P[key] === v ? 'true' : 'false', onclick: () => { P[key] = v; this.applyPrefs(); this.accessibility(back); } }, l))));
    this.screen(h('main', { class: 'setup' }, h('h2', {}, t('access.title')),
      seg('scale', [[100, '100%'], [125, '125%'], [150, '150%'], [200, '200%']], t('access.scale')),
      seg('motion', [['full', t('access.off')], ['reduced', t('access.on')]], t('access.motion')),
      seg('sound', [['on', t('access.on')], ['off', t('access.off')]], t('access.sound')),
      seg('subtitles', [['on', t('access.on')], ['off', t('access.off')]], t('access.subtitles')),
      h('button', { class: 'btn', onclick: back }, t('menu.back'))));
  }

  intro(done) {
    let i = 1;
    const frame = h('div', { class: 'intro-frame' });
    const show = () => {
      clear(frame);
      frame.append(h('div', { class: 'intro-art', 'aria-hidden': 'true', html: INTRO_ART[i - 1] }), h('p', { class: 'intro-text', 'aria-live': 'polite' }, t(`intro.${i}`)), h('div', { class: 'dots', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map((k) => h('span', { class: k === i ? 'on' : '' }))));
    };
    const next = () => { if (i >= 5) { clearInterval(timer); done(); } else { i++; show(); } };
    const timer = setInterval(next, 7000);
    this.screen(h('main', { class: 'intro' }, frame, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { clearInterval(timer); done(); } }, t('intro.skip')), h('button', { class: 'btn primary', 'data-autofocus': true, onclick: next }, t('intro.next')))));
    show();
  }

  newCampaign({ profile, timer, seed }) {
    this.intro(() => { this.mode = 'campaign'; this.run = new Run({ profile, timer, seed, mode: 'campaign' }); this.speed = 1; this.startGame(true); });
  }

  continueSave(key = SAVE_KEY.campaign) {
    const env = store.get(key);
    try { this.run = Run.fromSave(env); } catch { this.toast(t('save.loadFail')); return; }
    this.mode = this.run.meta.mode;
    this.startGame(false);
  }

  importSave(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((txt) => { try { this.run = Run.fromSave(JSON.parse(txt)); this.mode = this.run.meta.mode; this.startGame(false); } catch { this.toast(t('save.loadFail')); } });
  }

  demoMenu() {
    const ep = (k, tick) => h('button', { class: 'btn big', onclick: () => this.startDemo(tick) }, t(`demo.${k}`));
    this.screen(h('main', { class: 'setup' }, h('h2', {}, t('demo.title')), h('p', {}, t('demo.intro')),
      ep('ep1', T(8, 9)), ep('ep2', T(13, 2)), ep('ep3', T(29, 2)), h('button', { class: 'btn', onclick: () => this.menu() }, t('menu.back'))));
  }

  // Demo states come from real engine runs of the fixed control strategy (seed 2026).
  startDemo(tick) {
    const run = playRun(Run, { profile: 'engineer', seed: 2026, mode: 'campaign', timer: 'on', id: `demo-${tick}` }, controlStrategy, tick);
    run.meta.mode = 'demo'; run.state.mode = 'demo';
    this.mode = 'demo'; this.run = run; this.speed = 4;
    this.startGame(true);
  }

  // ---------------- game screen ----------------
  startGame(fresh) {
    closeAllModals();
    clear(this.root);
    this.selected = null;
    this.els = {};
    const E = this.els;
    E.hud = h('header', { class: 'hud', role: 'banner' });
    E.map = h('div', { class: 'map', role: 'region', 'aria-label': t('map.title') });
    E.panel = h('aside', { class: 'panel', role: 'region', 'aria-label': t('panel.values'), hidden: true });
    E.mission = h('section', { class: 'mission', role: 'region', 'aria-label': t('mission.title') });
    E.log = h('section', { class: 'log', role: 'log', 'aria-label': t('log.title'), hidden: !this.logOpen });
    E.foot = h('footer', { class: 'foot' }, E.mission, E.log);
    this.root.append(h('div', { class: `game ${this.mode === 'demo' ? 'demo' : ''}` }, E.hud, h('main', { class: 'stage' }, E.map, E.panel), E.foot));
    this.running = fresh;
    this.acc = 0;
    this.lastSaveTick = -1;
    if (this.run.state.decision) { this.running = false; this.openDecision(this.run.remainingDecisionMs); }
    this.update(true);
    if (this.run.state.status !== 'active') this.debrief();
  }

  exec(cmd) {
    const r = this.run.exec(cmd);
    if (r) this.toast(t(r));
    this.update();
    return r;
  }

  select(id) {
    this.selected = this.selected === id && !this.els.panel.hidden ? null : id;
    if (this.selected) for (const o of OBSERVES[this.selected] || []) this.run.exec({ type: 'observe', target: o });
    this.update(true);
    if (this.selected) this.els.panel.querySelector('h2')?.focus();
  }

  update(full = false) {
    if (!this.run || !this.els) return;
    const s = this.run.state;
    const fc = energyForecast(s);
    const status = systemStatus(s, fc);
    this.renderHud(s, fc);
    renderMap(this.els.map, s, status, { selected: this.selected, onSelect: (id) => this.select(id), highlight: this.selected ? [this.selected] : [] });
    this.renderPanel(s);
    this.renderMission(s);
    if (this.logOpen) this.renderLog(s);
    void full;
  }

  ui() { return { run: this.run, s: this.run.state, exec: (c) => this.exec(c) }; }

  renderHud(s, fc) {
    const E = this.els;
    clear(E.hud);
    const sol = solOf(s.tick), slot = slotOf(s.tick);
    const o2sols = s.tanks.O2 / 3.36;
    const hab = zoneReadings(s.zones.hab);
    const kcal = foodKcal(s);
    const fresh = s.food.fresh.reduce((a, f) => a + f.kcal, 0);
    const air = airAlarm(s);
    const gauge = (id, label, frac, main, sub, cls, onclick) => h('button', { class: `gauge ${cls}`, onclick, 'aria-label': `${label}: ${main}. ${sub}` },
      h('span', { class: 'g-label' }, label), h('span', { class: 'g-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.max(0, Math.min(100, frac * 100))}%` } })),
      h('span', { class: 'g-main' }, main), h('span', { class: 'g-sub' }, sub));
    const cls = (v, lo, mid) => (v < lo ? 'bad' : v < mid ? 'warn' : 'ok');
    const cargoIn = 30 - sol;
    E.hud.append(
      h('div', { class: 'gauges' },
        gauge('oxygen', t('hud.oxygen'), s.tanks.O2 / 80, `${fmt(o2sols)} ${t('units.sol')}`, s.tanks.O2 <= 0.01 ? t('hud.tankEmpty', { p: fmt(hab.pO2) }) : t('hud.tank', { kg: fmt(s.tanks.O2), sols: fmt(o2sols) }), cls(o2sols, 3, 6), () => this.select('habitat')),
        h('button', { class: `airbadge ${air ? 'bad' : 'ok'}`, onclick: () => this.select('habitat'), 'aria-label': air ? t('hud.airBad') : t('hud.airOk') }, h('span', { 'aria-hidden': 'true' }, air ? '■' : '●'), ` ${t('hud.air')}`),
        gauge('food', t('hud.food'), kcal / 345600, `${fmt(kcal / 9600)} ${t('units.sol')}`, t('hud.foodSub', { sols: fmt(kcal / 9600), fresh: fmt(fresh, 0) }), cls(kcal / 9600, 3, 6), () => this.select('storage')),
        gauge('energy', t('hud.energy'), s.energy.soc / 120, `${fmt(s.energy.soc, 0)} ${t('units.kWh')}`, t('hud.energySub', { soc: fmt(fc.soc, 0), net: s.profile === 'cadet' ? t('hud.cubes', { c: fmt(s.energy.lastNet * 2.4659 / 10, 1) }) : t('hud.net', { kw: `${s.energy.lastNet >= 0 ? '+' : ''}${fmt(s.energy.lastNet, 1)}` }) }), cls(s.energy.soc, 18, 36), () => this.select('battery'))),
      h('div', { class: 'clock' },
        h('strong', {}, t('hud.solOf', { sol: Math.min(30, sol) })), h('span', {}, ` · ${t(`phase.${phaseOf(slot)}`)} · ${t('hud.slot', { slot })}`),
        h('span', { class: 'cargo' }, cargoIn > 0 ? t('hud.cargo', { n: cargoIn }) : t('hud.cargoToday')),
        h('span', { class: 'tokens' }, t('hud.tokens', { n: s.tokens })),
        this.mode === 'demo' ? h('span', { class: 'demo-badge' }, t('demo.badge')) : null),
      h('div', { class: 'timectl', role: 'toolbar', 'aria-label': 'time' },
        h('button', { class: 'btn icon', onclick: () => this.toggleRun(), 'aria-label': this.running ? t('time.pause') : t('time.play'), title: `${this.running ? t('time.pause') : t('time.play')} (Space)` }, this.running ? '❚❚' : '▶'),
        h('button', { class: 'btn icon', onclick: () => this.stepOnce(), 'aria-label': t('time.step'), title: `${t('time.step')} (.)` }, '⏭'),
        [1, 2, 4].map((x) => h('button', { class: `btn icon ${this.speed === x ? 'on' : ''}`, 'aria-pressed': this.speed === x ? 'true' : 'false', onclick: () => { this.speed = x; this.update(); }, 'aria-label': t('time.speed', { x }) }, `×${x}`)),
        h('button', { class: 'btn', onclick: () => this.fastForward('decision'), title: t('time.toDecision') }, t('time.toDecision')),
        h('button', { class: 'btn', onclick: () => this.fastForward('sol') }, t('time.endSol')),
        h('button', { class: 'btn', onclick: () => this.showForecast() }, t('forecast.check')),
        h('button', { class: 'btn', onclick: () => { this.logOpen = !this.logOpen; this.els.log.hidden = !this.logOpen; this.update(); }, 'aria-expanded': this.logOpen ? 'true' : 'false' }, t('log.title')),
        h('button', { class: 'btn', onclick: () => this.pauseMenu() }, t('time.menu'))),
      h('div', { class: 'runstate', 'aria-live': 'off' }, this.running ? t('time.running', { x: this.speed }) : t('time.paused')));
  }

  renderPanel(s) {
    const P = this.els.panel;
    clear(P);
    if (!this.selected) { P.hidden = true; return; }
    P.hidden = false;
    P.append(h('div', { class: 'panel-head' }, h('h2', { tabindex: '-1' }, t(`sys.${this.selected}`)), h('button', { class: 'btn icon', 'aria-label': t('panel.close'), onclick: () => { this.selected = null; this.update(); } }, '✕')));
    const body = h('div', { class: 'panel-body' }, PANELS[this.selected](this.ui()));
    P.append(body);
  }

  renderMission(s) {
    const M = this.els.mission;
    clear(M);
    const sol = Math.min(30, solOf(s.tick));
    const m = MISSIONS[sol];
    const st = s.missions[sol] || 'open';
    const carry = Object.entries(s.missions).filter(([n, v]) => v === 'carry').map(([n]) => +n);
    const card = CARDS.find((c) => c.sol === sol) || CARDS.filter((c) => c.sol <= sol).slice(-1)[0];
    const cadet = s.profile === 'cadet';
    const hintShown = cadet || this.hintSol === sol || ['bad'].some(() => airAlarm(s));
    M.append(
      h('div', { class: 'mission-head' }, h('span', { class: 'act' }, `${t('mission.act', { n: m.act })} · ${t(`act.${m.act}`)}`), h('span', { class: `mstatus ${st}` }, t(`mission.${st}`))),
      h('h2', {}, `${sol}. ${t(`m.${sol}.t`)}`), h('p', {}, t(`m.${sol}.g`)),
      carry.length ? h('p', { class: 'carry' }, carry.map((n) => `↻ ${n}. ${t(`m.${n}.t`)}`).join(' · ')) : null,
      h('div', { class: 'beep' }, h('span', { class: 'beep-face', 'aria-hidden': 'true', html: BEEP_SVG }),
        hintShown && this.prefs.subtitles === 'on' ? h('p', {}, h('strong', {}, `${t('beep.name')}: `), t(`beep.${sol}`)) : h('button', { class: 'btn small', onclick: () => { this.hintSol = sol; this.update(); } }, t('mission.hint'))),
      h('div', { class: 'row' }, card ? h('button', { class: 'btn small', onclick: () => this.showCard(card.id) }, `📘 ${t('card.open')}`) : null, s.job ? h('span', { class: 'jobpill' }, s.job.status === 'waiting' ? t('hud.jobWait', { name: t(`act.${s.job.action}.name`) }) : t('hud.job', { name: t(`act.${s.job.action}.name`), left: s.job.remaining })) : null));
  }

  renderLog(s) {
    const L = this.els.log;
    clear(L);
    L.append(h('h2', {}, t('log.title')));
    const items = s.log.filter((e) => !['localRoll', 'mode'].includes(e.type)).slice(-40).reverse();
    L.append(items.length ? h('ol', { class: 'loglist' }, items.map((e) => h('li', { class: `lt-${e.type} sev-${e.severity || 'info'}` }, h('small', {}, tickLabel(e.tick)), ' ', logText(e)))) : h('p', {}, t('log.empty')));
    const pend = s.pending.filter((p) => p.status === 'pending');
    if (pend.length) L.append(h('h3', {}, '⏳'), h('ul', {}, pend.map((p) => h('li', {}, `${t(`pending.${p.effect}`)} → ${tickLabel(p.dueTick)}`))));
  }

  // ---------------- time ----------------
  loop(ts) {
    const dt = this.last ? Math.min(1000, ts - this.last) : 0;
    this.last = ts;
    if (this.decisionUI) this.decisionUI.tick();
    if (this.run && this.running && !modalOpen() && this.run.state.status === 'active') {
      this.acc += dt * this.speed;
      if (this.acc >= TICK_MS) { this.acc -= TICK_MS; this.advance(1); }
    }
    requestAnimationFrame((x) => this.loop(x));
  }

  // advance up to n ticks; stop at any auto-pause. Same engine rules at every speed.
  advance(n, until) {
    let steps = 0;
    while (steps < n && this.run.state.status === 'active') {
      const res = this.run.step();
      steps++;
      const pauses = this.run.state.pauses || [];
      if (res.blocked === 'decision') { this.resumeAfter = false; this.running = false; this.update(); this.autosave(); this.openDecision(); return; }
      if (this.run.state.status !== 'active') { this.update(); this.autosave(); this.debrief(); return; }
      if (pauses.length) { this.resumeAfter = this.resumeAfter || this.running; this.queue.push(...pauses); this.running = false; this.update(); this.showQueue(); return; }
      if (slotOf(this.run.state.tick) === 0) { this.autosave(); this.announce(t('sol.start', { sol: solOf(this.run.state.tick) })); }
      if (until && until(this.run.state)) break;
    }
    this.update();
  }

  toggleRun() { if (modalOpen()) return; this.running = !this.running; this.acc = 0; this.update(); }
  stepOnce() { if (modalOpen()) return; this.running = false; this.advance(1); }
  fastForward(kind) {
    if (modalOpen()) return;
    const startSol = solOf(this.run.state.tick);
    this.running = false;
    this.advance(TOTAL_TICKS, kind === 'sol' ? (st) => solOf(st.tick) !== startSol : null);
  }
  hiddenPause() { if (this.running) { this.wasRunning = true; this.running = false; this.update(); } this.decisionUI?.pause(true); this.autosave(); }

  hotkeys(e) {
    if (!this.run || !this.els || e.target.matches('input, select, textarea')) return;
    if (modalOpen()) return;
    if (e.key === ' ') { e.preventDefault(); this.toggleRun(); }
    else if (e.key === '.') this.stepOnce();
    else if (['1', '2', '4'].includes(e.key)) { this.speed = +e.key; this.update(); }
    else if (e.key === 'Escape') { this.running = false; this.update(); this.pauseMenu(); }
    else if (e.key.toLowerCase() === 'l') { this.logOpen = !this.logOpen; this.els.log.hidden = !this.logOpen; this.update(); }
  }

  // ---------------- notices / decisions ----------------
  showQueue() {
    if (!this.queue.length) { if (this.resumeAfter) { this.running = true; this.resumeAfter = false; } this.update(); return; }
    const p = this.queue.shift();
    if (p.kind === 'ending') { this.queue = []; this.debrief(); return; }
    const key = p.key || '';
    const sev = p.severity || 'info';
    const body = t(key, { ...(p.params || {}), tray: p.params?.tray, crew: p.params?.crew ? t(`crew.${p.params.crew}`) : undefined, panel: p.params?.panel != null ? p.params.panel + 1 : undefined, sol: p.params?.sol });
    const sys = systemForKey(key);
    if (sev === 'critical') { this.announce(t('live.alarm', { msg: body })); this.beepSound(); }
    const bodyKey = key.replace(/\.title$/, '.body');
    const more = bodyKey !== key && t(bodyKey) !== bodyKey ? t(bodyKey) : null;
    const left = this.queue.filter((x) => x.kind !== 'ending').length;
    const m = openModal(h('div', { class: `notice sev-${sev}` },
      h('p', { class: 'sev' }, h('span', { 'aria-hidden': 'true' }, sev === 'critical' ? '■ ' : sev === 'warning' ? '▲ ' : '● '), t(`notice.${sev}`), ` · ${tickLabel(p.tick)}`),
      h('h2', {}, body), more ? h('p', {}, more) : null,
      key.includes('unverified') || p.params?.unverified ? h('p', { class: 'flag' }, `⚑ ${t('alarm.unverified')}`) : null,
      h('div', { class: 'row' },
        sys ? h('button', { class: 'btn', onclick: () => { m.close(); this.selected = sys; for (const o of OBSERVES[sys] || []) this.run.exec({ type: 'observe', target: o }); this.update(); this.showQueue(); } }, `${t('alarm.open')}: ${t(`sys.${sys}`)}`) : null,
        h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => { m.close(); this.showQueue(); } }, left ? t('notice.next', { n: left }) : t('notice.ok')))),
    { label: t('notice.title'), dismissable: true });
  }

  openDecision(remainingMs) {
    const s = this.run.state;
    const d = s.decision;
    if (!d) return;
    const id = d.eventId;
    const famKey = id.startsWith('E_DUST') ? 'dust' : id.startsWith('E_SEP') ? 'sep' : 'feeder';
    const timed = d.timerSeconds != null;
    let left = remainingMs ?? (timed ? d.timerSeconds * 1000 : null);
    let paused = false;
    let lastNow = performance.now();
    const timerEl = h('p', { class: 'timer', 'aria-live': 'off' });
    const pauseBtn = timed ? h('button', { class: 'btn small', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? t('decision.resume') : t('decision.pauseTimer'); } }, t('decision.pauseTimer')) : null;
    const choose = (c, expired = false) => {
      this.decisionUI = null;
      modal.close();
      const r = this.run.exec({ type: 'choose', choiceId: c, expired });
      if (r) this.toast(t(r));
      if (expired) this.queue.unshift({ kind: 'notice', key: 'decision.expired', tick: s.tick, severity: 'warning' });
      this.autosave();
      this.resumeAfter = true;
      this.advance(1);
      if (this.queue.length && !modalOpen()) { this.running = false; this.showQueue(); return; }
      if (!modalOpen() && this.run.state.status === 'active') { this.running = true; this.resumeAfter = false; }
      this.update();
    };
    const modal = openModal(h('div', { class: 'decision' },
      h('p', { class: 'sev' }, '■ ', t('notice.critical'), ` · ${tickLabel(s.tick)}`),
      h('h2', {}, t(`ev.${id}.title`)), h('p', {}, t(`ev.${id}.body`)),
      timed ? [timerEl, pauseBtn] : h('p', { class: 'timer' }, t('decision.noTimer')),
      h('div', { class: 'choices' }, d.choices.map((c) => h('button', { class: `btn choice-btn ${c === d.defaultChoiceId ? 'primary' : ''}`, 'data-autofocus': c === d.defaultChoiceId || null, onclick: () => choose(c) },
        h('strong', {}, t(`ch.${id}.${c}`)), c === d.defaultChoiceId ? h('small', { class: 'tagline' }, ` · ${t('decision.default')}`) : null, h('small', {}, t(`chd.${famKey}.${c}`)))))),
    { label: t(`ev.${id}.title`), dismissable: false, className: 'decision-modal' });
    this.decisionUI = {
      remaining: () => left,
      pause: (v) => { paused = v; if (pauseBtn) pauseBtn.textContent = paused ? t('decision.resume') : t('decision.pauseTimer'); },
      tick: () => {
        const now = performance.now();
        const dt = now - lastNow; lastNow = now;
        if (!timed) return;
        if (!paused && !document.hidden) left -= dt;
        timerEl.textContent = t('decision.timer', { s: Math.max(0, Math.ceil(left / 1000)) });
        timerEl.classList.toggle('urgent', left < 4000);
        if (left <= 0) choose(d.defaultChoiceId, true);
      },
    };
    this.announce(t(`ev.${id}.title`));
    this.beepSound();
  }

  showForecast() {
    this.run.exec({ type: 'observe', target: 'forecast' });
    const m = openModal(h('div', {}, forecastView(this.ui()), h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => m.close() }, t('notice.ok'))), { label: t('panel.forecast3') });
    this.update();
  }

  showCard(id) {
    const c = CARDS.find((x) => x.id === id);
    const m = openModal(h('article', { class: 'card' },
      h('p', { class: 'sev' }, t('card.title')), h('h2', {}, t(`card.${id}.t`)), h('p', {}, t(`card.${id}.b`)),
      h('p', { class: 'label' }, `${t('card.label')}: `, h('span', { class: `lbl lbl-${c.label}` }, t(`label.${c.label}`))),
      c.gameNote ? h('p', { class: 'label' }, h('span', { class: 'lbl lbl-game' }, t('label.game')), ' ', t('card.gameNote')) : null,
      (c.archive || []).map((a) => archiveBlock(archiveById(a))),
      h('h3', {}, t('card.sources')), h('ul', {}, c.sources.map((sid) => { const src = sourceById(sid); return h('li', {}, h('a', { href: src.sourceURL, target: '_blank', rel: 'noopener' }, src.title), ` — ${src.publisher}`); })),
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => m.close() }, t('notice.ok'))), { label: t(`card.${id}.t`) });
  }

  pauseMenu() {
    this.running = false; this.update();
    const m = openModal(h('div', { class: 'pausemenu' }, h('h2', {}, t('time.paused')),
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => m.close() }, t('time.play')),
      h('button', { class: 'btn', onclick: () => { this.autosave(true); } }, t('save.ok')),
      h('button', { class: 'btn', onclick: () => download(`mars-save-${this.run.meta.id}-S${solOf(this.run.state.tick)}.json`, JSON.stringify(this.run.toSave(this.decisionUI?.remaining?.()))) }, t('menu.export')),
      h('button', { class: 'btn', onclick: () => { m.close(); this.sources(() => this.startGame(false)); } }, t('menu.sources')),
      h('button', { class: 'btn', onclick: () => { m.close(); this.accessibility(() => this.startGame(false)); } }, t('menu.access')),
      h('div', { class: 'lang' }, ['ru', 'en'].map((l) => h('button', { class: `segbtn ${getLang() === l ? 'on' : ''}`, onclick: () => { this.prefs.lang = l; this.applyPrefs(); m.close(); this.startGame(false); } }, l.toUpperCase()))),
      h('button', { class: 'btn', onclick: () => { this.autosave(); m.close(); this.menu(); } }, t('time.menu'))), { label: t('time.paused') });
  }

  // ---------------- saves ----------------
  autosave(manual = false) {
    if (!this.run) return;
    const key = SAVE_KEY[this.mode === 'demo' ? 'demo' : 'campaign'];
    const env = this.run.toSave(this.decisionUI?.remaining?.() ?? null);
    const ok = store.set(key, env);
    if (!ok) { this.toast(t('save.fail')); if (manual) download(`mars-save-${this.run.meta.id}.json`, JSON.stringify(env)); }
    else if (manual) this.toast(t('save.ok'));
  }

  // ---------------- sources ----------------
  sources(back = () => this.menu()) {
    this.screen(h('main', { class: 'sources' }, h('h2', {}, t('src.title')), h('p', {}, t('src.intro')),
      !navigator.onLine ? h('p', { class: 'flag' }, t('src.offline', { d: '2026-11-14' })) : null,
      h('h3', {}, t('src.archive')), ARCHIVE.map((a) => archiveBlock(a)),
      h('h3', {}, t('src.catalog')),
      h('ul', { class: 'srclist' }, SOURCES.map((x) => h('li', {}, h('a', { href: x.sourceURL, target: '_blank', rel: 'noopener' }, x.title), h('small', {}, ` — ${x.publisher} · ${t('src.category')}: `),
        h('span', { class: `lbl lbl-${x.category}` }, t(`label.${x.category}`)), h('small', {}, ` · ${t('src.acq')}: ${t(`acq.${x.acquisition}`)}`), h('p', {}, t(x.limitations))))),
      h('button', { class: 'btn', onclick: back }, t('menu.back'))));
  }

  // ---------------- debrief ----------------
  debrief() {
    closeAllModals();
    this.running = false;
    this.decisionUI = null;
    const s = this.run.state;
    const e = s.ending || {};
    const id = e.id || 'stop';
    if (this.mode === 'campaign') this.autosave();
    const chainEl = (c) => h('li', { class: 'chain' }, h('h4', {}, t(`chain.${c.kind}`)),
      h('ol', {}, c.steps.map((st) => h('li', {}, h('small', {}, tickLabel(st.tick)), ' ', logText(st)))),
      h('p', { class: 'alt' }, h('strong', {}, t('end.alt')), ' ', t(c.alt)));
    const sus = e.sustainability || {};
    const missionsDone = Object.values(s.missions).filter((x) => x === 'done').length;
    const sel = h('select', { id: 'branch-sol', 'aria-label': t('end.replay') }, Array.from({ length: Math.max(1, Math.min(30, solOf(Math.max(0, s.tick - 1)))) }, (_, i) => h('option', { value: i + 1 }, `${i + 1}`)));
    this.screen(h('main', { class: 'debrief' },
      h('p', { class: 'sev' }, t('end.title')),
      h('h1', {}, t(`end.${id}.title`)), h('p', {}, t(`end.${id}.body`, { cause: t(`stop.${e.cause}`) })),
      h('p', { class: 'stars', 'aria-label': t('end.stars', { n: e.stars || 0 }) }, '★'.repeat(e.stars || 0) + '☆'.repeat(3 - (e.stars || 0)), ' ', t('end.stars', { n: e.stars || 0 }), ' · ', t('end.protocols', { n: e.protocols || 0 })),
      h('ul', { class: 'protocols' }, Object.entries(s.flags.protocols).map(([k, v]) => h('li', { class: v ? 'ok' : 'no' }, `${v ? '✓' : '✗'} ${t(`prot.${k}`)}`))),
      e.cargo ? h('p', {}, t(`end.cargo.${e.cargo}`)) : null,
      h('h2', {}, t('end.chains')), h('ol', { class: 'chains' }, (e.chains || []).map(chainEl)),
      id !== 'stop' ? [h('h2', {}, t('end.sus')), h('ul', { class: 'sus' }, Object.entries(sus).map(([k, v]) => h('li', { class: v ? 'ok' : 'no' }, `${v ? '✓' : '✗'} ${t(`sus.${k}`)}`)))] : null,
      h('h2', {}, t('end.stats')), h('ul', { class: 'stats' },
        h('li', {}, `${t('stat.minSoC')}: ${fmt(s.stats.minSoC)} ${t('units.kWh')}`), h('li', {}, `${t('stat.minWater')}: ${fmt(s.stats.minClean)} ${t('units.kg')}`),
        h('li', {}, `${t('stat.parts')}: ${s.stats.partsUsed}`), h('li', {}, `${t('stat.harvest')}: ${fmt(s.stats.harvestKcal, 0)} ${t('units.kcal')}`),
        h('li', {}, `${t('stat.maxDose')}: ${fmt(s.stats.maxDose, 2)} ${t('units.EU')}`), h('li', {}, `${t('stat.missions')}: ${missionsDone} / 30`)),
      h('h2', {}, t('end.cards')), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.showCard('CMOXIE') }, `📘 ${t('card.CMOXIE.t')}`), h('button', { class: 'btn', onclick: () => this.showCard('CMELISSA') }, `📘 ${t('card.CMELISSA.t')}`)),
      h('div', { class: 'row branch' }, h('label', { for: 'branch-sol' }, t('end.replay')), sel,
        h('button', { class: 'btn', onclick: () => { const b = this.run.branchFromSol(+sel.value); this.run = b; this.mode = b.meta.mode === 'demo' ? 'demo' : 'campaign'; this.startGame(false); } }, t('end.replayBtn'))),
      h('button', { class: 'btn primary', onclick: () => this.menu() }, t('end.menu'))));
  }

  // ---------------- feedback ----------------
  toast(msg) {
    const el = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(el);
    setTimeout(() => el.remove(), 3200);
  }
  announce(msg) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = msg; }, 30); }
  beepSound() {
    if (this.prefs.sound !== 'on') return;
    try {
      this.ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.frequency.value = 660; g.gain.value = 0.05;
      o.connect(g); g.connect(this.ac.destination); o.start(); o.stop(this.ac.currentTime + 0.18);
    } catch { /* audio unavailable */ }
  }
}

export function logText(e) {
  const p = { ...(e.params || {}) };
  if (p.crew) p.crew = t(`crew.${p.crew}`);
  if (p.panel != null) p.panel = p.panel + 1;
  if (e.type === 'jobStart') return `▶ ${t(e.key)}`;
  if (e.type === 'jobDone') return `✓ ${t(e.key)}`;
  if (e.type === 'jobCancel') return `✕ ${t(e.key)}`;
  if (e.type === 'choice') return `➜ ${t(e.key)}${e.expired ? ` (${t('decision.expired')})` : ''}`;
  if (e.type === 'decisionOpen') return `⚑ ${t(e.key)}`;
  if (e.type === 'pending') return `⏳ ${t(e.key)}`;
  if (e.type === 'terminal') return `■ ${t(e.key)}`;
  return t(e.key, p);
}

function archiveBlock(a) {
  if (!a) return h('p', {}, t('src.unavailable'));
  const rows = a.type === 'FLR'
    ? [[t('arch.id'), a.recordId], [t('arch.peak'), a.peakUTC], [t('arch.class'), a.classType], [t('arch.instrument'), a.instrument]]
    : [[t('arch.platform'), `${a.platform} · ${t('arch.rad.place')}`], ['UTC', a.dateUTC], [t('arch.value'), `≈ ${a.value} ${a.unit} (${t('arch.rad.metric')})`]];
  const src = sourceById(a.sourceId);
  return h('div', { class: 'archive' }, h('h4', {}, t(a.type === 'FLR' ? 'arch.flr.title' : 'arch.rad.title')),
    h('p', {}, h('span', { class: 'lbl lbl-observed' }, t('label.observed')), ' ', h('span', { class: 'lbl' }, t(`acq.${a.acquisition}`)), ' ', h('small', {}, t('src.retrieved', { d: a.retrievedUTC }))),
    h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), h('p', {}, t(a.noteKey)),
    h('p', {}, h('a', { href: src.sourceURL, target: '_blank', rel: 'noopener' }, src.title), a.queryURL ? [' · ', h('a', { href: a.queryURL, target: '_blank', rel: 'noopener' }, t('arch.query'))] : null));
}

const BEEP_SVG = '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="6" y="9" width="28" height="22" rx="8" fill="#e8eef5" stroke="#1d2b3a" stroke-width="2"/><circle cx="15" cy="20" r="3.2" fill="#1d2b3a"/><circle cx="25" cy="20" r="3.2" fill="#1d2b3a"/><path d="M15 26 q5 3 10 0" stroke="#1d2b3a" stroke-width="2" fill="none"/><path d="M20 9 V4" stroke="#1d2b3a" stroke-width="2"/><circle cx="20" cy="3.5" r="2.2" fill="#ff7a45"/></svg>';
const MENU_ART = '<svg viewBox="0 0 400 140" width="100%"><defs><linearGradient id="ms" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1030"/><stop offset="1" stop-color="#d0643a"/></linearGradient></defs><rect width="400" height="140" fill="url(#ms)"/><circle cx="330" cy="40" r="14" fill="#ffd9a8"/><path d="M0 100 Q100 80 200 98 T400 92 V140 H0Z" fill="#8a3a1e"/><path d="M150 100 A40 32 0 0 1 230 100Z" fill="#e8eef5"/><path d="M240 100 V86 A30 14 0 0 1 300 86 V100Z" fill="#9fe6b8" opacity=".85"/><rect x="70" y="78" width="40" height="16" fill="#2a4a7a" stroke="#cfe" stroke-width="1"/><path d="M90 94 V104" stroke="#ccc"/></svg>';
const INTRO_ART = [
  '<svg viewBox="0 0 400 160"><rect width="400" height="160" fill="#2a1626"/><path d="M0 120 Q200 96 400 118 V160H0Z" fill="#8a3a1e"/><rect x="60" y="80" width="60" height="40" rx="6" fill="#c9d3dd"/><rect x="160" y="70" width="80" height="50" rx="6" fill="#c9d3dd"/><rect x="270" y="86" width="50" height="34" rx="6" fill="#c9d3dd"/><circle cx="140" cy="122" r="6" fill="#ffb347"/><path d="M134 116 l-10 -10" stroke="#ffb347" stroke-width="3"/></svg>',
  '<svg viewBox="0 0 400 160"><rect width="400" height="160" fill="#132033"/><rect x="140" y="30" width="120" height="110" rx="20" fill="#3a4e66"/><rect x="160" y="50" width="80" height="90" rx="10" fill="#0d1520"/>' + [0, 1, 2, 3].map((i) => `<circle cx="${170 + i * 20}" cy="95" r="7" fill="#e8eef5"/><rect x="${163 + i * 20}" y="104" width="14" height="30" rx="5" fill="#e8eef5"/>`).join('') + '</svg>',
  '<svg viewBox="0 0 400 160"><rect width="400" height="160" fill="#101a26"/><circle cx="110" cy="80" r="44" fill="none" stroke="#5ad1a0" stroke-width="10" stroke-dasharray="200 80"/><text x="110" y="86" fill="#e8eef5" font-size="18" text-anchor="middle">O₂ 19</text><circle cx="290" cy="80" r="44" fill="none" stroke="#5ab0ff" stroke-width="10" stroke-dasharray="230 50"/><text x="290" y="86" fill="#e8eef5" font-size="18" text-anchor="middle">90 kWh</text></svg>',
  '<svg viewBox="0 0 400 160"><rect width="400" height="160" fill="#0b0f1e"/><circle cx="60" cy="40" r="2" fill="#fff"/><circle cx="300" cy="30" r="2" fill="#fff"/><circle cx="80" cy="120" r="34" fill="#3d6fd1"/><circle cx="330" cy="110" r="22" fill="#c45a2c"/><path d="M114 116 Q220 40 308 104" stroke="#ffd36a" stroke-width="2" stroke-dasharray="6 6" fill="none"/><rect x="200" y="62" width="18" height="10" fill="#ddd"/></svg>',
  '<svg viewBox="0 0 400 160"><rect width="400" height="160" fill="#162436"/><g transform="translate(160,30) scale(2.4)">' + '<rect x="6" y="9" width="28" height="22" rx="8" fill="#e8eef5" stroke="#1d2b3a" stroke-width="2"/><circle cx="15" cy="20" r="3.2" fill="#1d2b3a"/><circle cx="25" cy="20" r="3.2" fill="#1d2b3a"/><path d="M15 26 q5 3 10 0" stroke="#1d2b3a" stroke-width="2" fill="none"/><path d="M20 9 V4" stroke="#1d2b3a" stroke-width="2"/><circle cx="20" cy="3.5" r="2.2" fill="#ff7a45"/>' + '</g></svg>',
];

void SYSTEMS; void CROPS;
window.addEventListener('DOMContentLoaded', () => { window.marsApp = new App(document.getElementById('app')); });
