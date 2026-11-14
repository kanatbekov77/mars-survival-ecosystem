// SVG base map: systems, power/water links, weather and day/night.
import { s, h, clear } from './dom.js';
import { t } from '../i18n/index.js';
import { slotOf, isLightSlot } from '../engine/config.js';
import { SYSTEMS } from './status.js';
import { renderIso } from './isomap.js';

const POS = {
  panels: [130, 92], reserve: [300, 78], battery: [300, 196], habitat: [470, 232], greenhouse: [668, 214],
  water: [470, 366], shelter: [300, 336], comms: [640, 74], storage: [672, 366], rover: [120, 352],
};
// links: [from, to, kind, systems that highlight it]
const LINKS = [
  ['panels', 'battery', 'power', ['panels', 'battery']], ['reserve', 'battery', 'power', ['reserve', 'battery']], ['reserve', 'habitat', 'secondary', ['reserve', 'habitat']],
  ['battery', 'habitat', 'power', ['battery', 'habitat']], ['battery', 'greenhouse', 'power', ['battery', 'greenhouse']], ['battery', 'water', 'power', ['battery', 'water']],
  ['battery', 'comms', 'power', ['battery', 'comms']], ['water', 'habitat', 'water', ['water', 'habitat']], ['water', 'greenhouse', 'water', ['water', 'greenhouse']],
  ['habitat', 'shelter', 'air', ['habitat', 'shelter']], ['storage', 'habitat', 'supply', ['storage', 'habitat']], ['rover', 'storage', 'supply', ['rover', 'storage']],
];

const ICON = { ok: '●', warn: '▲', bad: '■', off: '○' };

function art(id, st) {
  const E = st.energy;
  switch (id) {
    case 'panels': return s('g', {}, [0, 1].map((i) => {
      const x = -58 + i * 62;
      const folded = E.folded[i];
      const dirt = 1 - E.clean[i];
      return s('g', { transform: `translate(${x},0)` },
        s('line', { x1: 26, y1: 18, x2: 26, y2: 34, class: 'mast' }),
        folded ? s('rect', { x: 14, y: 4, width: 24, height: 14, rx: 2, class: 'pv folded' })
          : s('g', {}, s('rect', { x: 0, y: -14, width: 52, height: 32, rx: 2, class: 'pv' }),
            s('path', { d: 'M13 -14V18M26 -14V18M39 -14V18M0 2H52', class: 'pv-grid' }),
            s('rect', { x: 0, y: -14, width: 52, height: 32, rx: 2, class: 'pv-dust', 'fill-opacity': Math.min(0.85, dirt * 1.1).toFixed(2) })),
      );
    }));
    case 'reserve': return s('g', {}, s('rect', { x: -24, y: -18, width: 48, height: 36, rx: 6, class: 'box reserve-box' }), s('path', { d: 'M-6 -8 L4 -8 L-2 2 L6 2 L-4 14 L0 4 L-8 4 Z', class: 'bolt' }), s('path', { d: 'M24 -10h10M24 0h10M24 10h10', class: 'fins' }));
    case 'battery': return s('g', {}, s('rect', { x: -30, y: -20, width: 60, height: 40, rx: 6, class: 'box' }),
      s('rect', { x: -24, y: -14, width: Math.max(1, 48 * E.soc / 120), height: 28, rx: 3, class: E.soc < 18 ? 'soc low' : 'soc' }), s('rect', { x: 30, y: -7, width: 5, height: 14, rx: 1, class: 'box' }));
    case 'habitat': return s('g', {}, s('path', { d: 'M-70 26 A70 58 0 0 1 70 26 Z', class: 'dome' }), s('path', { d: 'M-46 26 A46 36 0 0 1 46 26', class: 'dome-rib' }),
      s('rect', { x: -14, y: 4, width: 28, height: 22, rx: 3, class: 'door' }), s('circle', { cx: -34, cy: 2, r: 6, class: 'window' }), s('circle', { cx: 34, cy: 2, r: 6, class: 'window' }));
    case 'greenhouse': return s('g', {}, s('path', { d: 'M-62 24 V-6 A62 30 0 0 1 62 -6 V24 Z', class: st.ghMode === 'preserve' || !st.eq.led ? 'gh dark' : (isLightSlot(slotOf(st.tick)) || (slotOf(st.tick) >= 3 && slotOf(st.tick) <= 16)) ? 'gh lit' : 'gh' }),
      st.crops.map((c, i) => s('g', { transform: `translate(${-30 + i * 60},14)` }, c.state === 'empty' ? s('rect', { x: -18, y: 0, width: 36, height: 6, class: 'tray' })
        : s('g', {}, s('rect', { x: -18, y: 0, width: 36, height: 6, class: 'tray' }), [-12, -4, 4, 12].map((dx) => s('path', { d: `M${dx} 0 q-4 -${6 + Math.min(10, c.eff / 3)} 0 -${8 + Math.min(12, c.eff / 3)} q4 ${3} 0 ${8 + Math.min(12, c.eff / 3)}`, class: c.state === 'lost' ? 'leaf lost' : c.state === 'ripe' ? 'leaf ripe' : 'leaf' }))))));
    case 'water': return s('g', {}, [['clean', -26, 220], ['grey', 4, 60]].map(([k, x, cap]) => s('g', { transform: `translate(${x},0)` },
      s('rect', { x: 0, y: -22, width: 22, height: 44, rx: 6, class: 'tank' }),
      s('rect', { x: 2, y: 20 - 40 * Math.min(1, (k === 'clean' ? st.water.clean : st.water.grey) / cap), width: 18, height: 40 * Math.min(1, (k === 'clean' ? st.water.clean : st.water.grey) / cap), rx: 4, class: `liquid ${k}` }))));
    case 'shelter': return s('g', {}, s('path', { d: 'M-40 22 L-30 -8 H30 L40 22 Z', class: 'bunker' }), s('path', { d: 'M-20 -8 V-16 H20 V-8', class: 'bunker' }), st.shelter ? s('text', { x: 0, y: 10, class: 'crew-in', 'text-anchor': 'middle' }, '4') : null);
    case 'comms': return s('g', {}, s('path', { d: 'M0 28 L0 -2', class: 'mast' }), s('path', { d: 'M-22 -14 A26 26 0 0 0 22 -14 Z', class: st.eq.relay ? 'dish' : 'dish broken', transform: 'rotate(-20)' }), st.eq.relay ? s('path', { d: 'M18 -26 a10 10 0 0 1 10 10 M22 -34 a18 18 0 0 1 18 18', class: 'waves' }) : null);
    case 'storage': return s('g', {}, s('rect', { x: -34, y: -4, width: 30, height: 26, class: 'crate' }), s('rect', { x: 2, y: -4, width: 30, height: 26, class: 'crate' }), s('rect', { x: -16, y: -26, width: 30, height: 22, class: 'crate' }));
    case 'rover': return s('g', {}, s('rect', { x: -32, y: -12, width: 56, height: 20, rx: 5, class: 'rover' }), s('circle', { cx: -20, cy: 12, r: 8, class: 'wheel' }), s('circle', { cx: 12, cy: 12, r: 8, class: 'wheel' }),
      st.cache === 'field' ? s('g', { transform: 'translate(48,-6)' }, s('path', { d: 'M0 18 V-10 l14 6 l-14 6', class: 'flag' })) : null);
    default: return null;
  }
}

function renderSchema(st, status, { selected, onSelect, highlight = [] }) {
  const slot = slotOf(st.tick);
  const night = !isLightSlot(slot);
  const L = st.energy.L;
  const svg = s('svg', { class: `basemap ${night ? 'night' : 'day'}`, viewBox: '0 0 800 450', role: 'group', 'aria-label': t('map.title') },
    s('defs', {},
      s('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', class: 'sky-top' }), s('stop', { offset: '1', class: 'sky-bot' })),
      s('linearGradient', { id: 'ground', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', class: 'ground-top' }), s('stop', { offset: '1', class: 'ground-bot' }))),
    s('rect', { x: 0, y: 0, width: 800, height: 450, fill: 'url(#sky)' }),
    s('path', { d: 'M0 140 Q120 110 230 132 T470 120 T800 128 V450 H0 Z', fill: 'url(#ground)' }),
    s('path', { d: 'M0 150 Q160 130 300 150 T620 140 T800 152', class: 'ridge' }),
    night ? s('g', { class: 'stars' }, [[60, 30], [200, 50], [420, 22], [560, 46], [720, 30], [760, 70], [330, 40]].map(([x, y]) => s('circle', { cx: x, cy: y, r: 1.4 }))) : s('circle', { cx: 730, cy: 48, r: 16, class: 'sun', opacity: (0.25 + 0.75 * L).toFixed(2) }),
  );
  // links
  for (const [a, b, kind, sys] of LINKS) {
    const [x1, y1] = POS[a], [x2, y2] = POS[b];
    const hot = highlight.length ? sys.some((x) => highlight.includes(x)) : false;
    const dead = kind === 'power' && !st.energy.mainBus && a !== 'reserve';
    svg.append(s('path', { d: `M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.max(y1, y2) + 18} ${x2} ${y2}`, class: `link ${kind}${hot ? ' hot' : ''}${dead ? ' dead' : ''}` }));
  }
  for (const id of SYSTEMS) {
    const [x, y] = POS[id];
    const stt = status[id];
    const label = `${t(`sys.${id}`)}: ${t(`status.${stt}`)}`;
    const g = s('g', { class: `node st-${stt}${selected === id ? ' selected' : ''}`, transform: `translate(${x},${y})`, role: 'button', tabindex: '0', 'aria-label': label, 'data-sys': id,
      onclick: () => onSelect(id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } } },
      s('title', {}, label),
      s('ellipse', { cx: 0, cy: 6, rx: 78, ry: 52, class: 'hit' }),
      stt === 'warn' || stt === 'bad' ? s('ellipse', { cx: 0, cy: 6, rx: 74, ry: 48, class: `ring ${stt}` }) : null,
      art(id, st),
      s('g', { transform: 'translate(0,50)' },
        s('rect', { x: -66, y: -12, width: 132, height: 22, rx: 11, class: `tag ${stt}` }),
        s('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'tag-text' }, `${ICON[stt]} ${t(`sys.${id}`)}`)));
    svg.append(g);
  }
  // dust overlay: opacity grows as light drops
  svg.append(s('rect', { x: 0, y: 0, width: 800, height: 450, class: 'dust', opacity: Math.max(0, (1 - L) * 0.75).toFixed(2), 'pointer-events': 'none' }));
  if (night) svg.append(s('rect', { x: 0, y: 0, width: 800, height: 450, class: 'nightshade', 'pointer-events': 'none' }));
  return svg;
}

// Map view: 'iso' (pseudo-3D, default) or 'schema'. Same ids, statuses and handlers in both.
export function renderMap(container, st, status, { selected, onSelect, highlight = [], view = 'iso', onView }) {
  const hadToggleFocus = container.contains(document.activeElement) && document.activeElement.dataset.view;
  clear(container);
  const toggle = h('div', { class: 'mapbar' },
    h('span', { class: 'mapbar-title', id: 'map-view-label' }, t('map.view')),
    h('div', { class: 'seg', role: 'group', 'aria-labelledby': 'map-view-label' }, ['schema', 'iso'].map((v) => h('button', {
      class: `segbtn ${view === v ? 'on' : ''}`, 'aria-pressed': view === v ? 'true' : 'false', 'data-view': v,
      onclick: () => { if (view !== v) onView?.(v); },
    }, t(`map.view.${v}`)))));
  container.append(toggle);
  const scene = h('div', { class: `mapscene view-${view}` });
  scene.append(view === 'iso' ? renderIso(st, status, { selected, onSelect }) : renderSchema(st, status, { selected, onSelect, highlight }));
  container.append(scene);
  if (hadToggleFocus) container.querySelector(`[data-view="${hadToggleFocus}"]`)?.focus();
  // keyboard/list fallback
  const list = h('ul', { class: 'syslist', 'aria-label': t('map.list') }, SYSTEMS.map((id) => h('li', {},
    h('button', { class: `sysbtn st-${status[id]}${selected === id ? ' selected' : ''}`, onclick: () => onSelect(id), 'aria-pressed': selected === id ? 'true' : 'false' },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[status[id]]), ` ${t(`sys.${id}`)} · ${t(`status.${status[id]}`)}`))));
  container.append(list);
}
