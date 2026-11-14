// Pseudo-3D (isometric) base map in plain SVG: fixed camera, roofs, side walls, ground shadows.
// Same system ids, statuses and select handler as the schematic map. No render loop of its own.
import { s } from './dom.js';
import { t } from '../i18n/index.js';
import { slotOf, isLightSlot, isLedSlot } from '../engine/config.js';
import { SYSTEMS } from './status.js';

const TILE = 34;
const CX = Math.cos(Math.PI / 6) * TILE; // ≈29.4
const CY = Math.sin(Math.PI / 6) * TILE; // 17
const OX = 340, OY = 58;
export const ISO_VIEWBOX = '0 0 700 480';

// world (x, y on the ground, z up, in tiles) → screen
export const P = (x, y, z = 0) => [OX + (x - y) * CX, OY + (x + y) * CY - z * TILE];
const pts = (...ps) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// Layout in world tiles: centre (x, y), footprint radius for the selection ring.
const LAYOUT = {
  panels: { x: 2.4, y: 1.6, r: 1.7 }, reserve: { x: 5.6, y: 1.3, r: 0.9 }, comms: { x: 9.4, y: 1.4, r: 0.9 },
  battery: { x: 3.4, y: 4.6, r: 1.0 }, habitat: { x: 6.4, y: 4.6, r: 1.6 }, greenhouse: { x: 9.6, y: 4.8, r: 1.6 },
  shelter: { x: 3.4, y: 7.8, r: 1.1 }, water: { x: 6.6, y: 8.0, r: 1.0 }, storage: { x: 9.6, y: 8.0, r: 1.1 }, rover: { x: 1.2, y: 9.2, r: 1.0 },
};
const LINKS = [
  ['panels', 'battery', 'power'], ['reserve', 'battery', 'power'], ['reserve', 'habitat', 'secondary'], ['battery', 'habitat', 'power'],
  ['battery', 'greenhouse', 'power'], ['battery', 'water', 'power'], ['battery', 'comms', 'power'], ['water', 'habitat', 'water'],
  ['water', 'greenhouse', 'water'], ['habitat', 'shelter', 'air'], ['storage', 'habitat', 'supply'], ['rover', 'storage', 'supply'],
];
const HL = { panels: ['panels', 'battery'], reserve: ['reserve'], battery: ['battery'], habitat: ['habitat'], greenhouse: ['greenhouse'], water: ['water'], shelter: ['shelter'], comms: ['comms'], storage: ['storage'], rover: ['rover'] };
const ICON = { ok: '●', warn: '▲', bad: '■', off: '○' };

// ---------- primitives ----------
function box(x, y, z, w, d, hgt, cls = '') {
  // x,y = back corner; w along +x, d along +y
  const a = P(x, y, z + hgt), b = P(x + w, y, z + hgt), c = P(x + w, y + d, z + hgt), e = P(x, y + d, z + hgt);
  const b0 = P(x + w, y, z), c0 = P(x + w, y + d, z), e0 = P(x, y + d, z);
  return s('g', { class: `iso-box ${cls}` },
    s('polygon', { points: pts(e, c, c0, e0), class: 'face-left' }),
    s('polygon', { points: pts(c, b, b0, c0), class: 'face-right' }),
    s('polygon', { points: pts(a, b, c, e), class: 'face-top' }));
}
function shadow(x, y, w, d, dx = 0.35, dy = 0.25) {
  return s('polygon', { points: pts(P(x + dx, y + dy), P(x + w + dx, y + dy), P(x + w + dx, y + d + dy), P(x + dx, y + d + dy)), class: 'iso-shadow' });
}
function cylinder(x, y, r, hgt, cls = '', fill = null) {
  const [bx, by] = P(x, y, 0), [tx, ty] = P(x, y, hgt);
  const rx = r * CX * Math.SQRT2, ry = r * CY * Math.SQRT2;
  const g = s('g', { class: `iso-cyl ${cls}` },
    s('path', { d: `M${bx - rx} ${by} L${tx - rx} ${ty} A${rx} ${ry} 0 0 1 ${tx + rx} ${ty} L${bx + rx} ${by} A${rx} ${ry} 0 0 1 ${bx - rx} ${by} Z`, class: 'cyl-side' }),
    s('ellipse', { cx: tx, cy: ty, rx, ry, class: 'cyl-top' }));
  if (fill != null) {
    const lvl = Math.max(0, Math.min(1, fill));
    const [, fy] = P(x, y, hgt * lvl);
    g.append(s('path', { d: `M${bx - rx * 0.92} ${by} L${bx - rx * 0.92} ${fy} A${rx * 0.92} ${ry * 0.92} 0 0 0 ${bx + rx * 0.92} ${fy} L${bx + rx * 0.92} ${by} A${rx * 0.92} ${ry * 0.92} 0 0 1 ${bx - rx * 0.92} ${by} Z`, class: 'cyl-fill' }));
  }
  return g;
}
function groundEllipse(x, y, r, cls) {
  const [cx, cy] = P(x, y);
  return s('ellipse', { cx, cy, rx: r * CX * Math.SQRT2, ry: r * CY * Math.SQRT2, class: cls });
}

// ---------- objects ----------
function habitat(L, st, night) {
  const { x, y } = L;
  const [bx, by] = P(x, y, 0);
  const r = 1.35, hgt = 1.15;
  const rx = r * CX * Math.SQRT2, ry = r * CY * Math.SQRT2, dh = hgt * TILE;
  return s('g', {},
    groundEllipse(x + 0.35, y + 0.3, r * 1.05, 'iso-shadow'),
    box(x - 0.35, y + 1.05, 0, 0.7, 0.9, 0.55, 'airlock'),
    s('path', { d: `M${bx - rx} ${by} A${rx} ${dh + ry * 0.2} 0 0 1 ${bx + rx} ${by} A${rx} ${ry} 0 0 1 ${bx - rx} ${by} Z`, class: 'dome-body' }),
    s('path', { d: `M${bx - rx * 0.62} ${by - dh * 0.55} A${rx * 0.62} ${ry * 0.5} 0 0 0 ${bx + rx * 0.62} ${by - dh * 0.55}`, class: 'dome-ring' }),
    s('path', { d: `M${bx - rx * 0.25} ${by - dh * 0.98} Q${bx - rx * 0.7} ${by - dh * 0.7} ${bx - rx * 0.86} ${by - dh * 0.2}`, class: 'dome-shine' }),
    [-0.45, 0.45].map((k) => s('ellipse', { cx: bx + k * rx, cy: by - dh * 0.28, rx: 6, ry: 4.5, class: night ? 'win lit' : 'win' })),
    st.shelter ? null : s('text', { x: bx, y: by - dh * 0.45, 'text-anchor': 'middle', class: 'iso-crew', 'aria-hidden': 'true' }, '4'));
}

function greenhouse(L, st) {
  const { x, y } = L;
  const len = 2.6, half = 0.75, hgt = 0.95;
  const lit = st.ghMode !== 'preserve' && st.eq.led && isLedSlot(slotOf(st.tick)) && st.crops.some((c) => c.state === 'growing' || c.state === 'ripe');
  const g = s('g', { class: `gh-iso ${lit ? 'lit' : st.ghMode === 'preserve' || !st.eq.led ? 'dark' : ''}` }, shadow(x - len / 2, y - half, len, half * 2, 0.4, 0.35));
  // barrel vault along +x: draw ribs back→front
  const x0 = x - len / 2, steps = 7;
  const arc = (xx) => {
    const ps = [];
    for (let i = 0; i <= 10; i++) { const a = Math.PI * (i / 10); ps.push(P(xx, y - half * Math.cos(a), Math.sin(a) * hgt)); }
    return ps;
  };
  // far side wall (ground line) and glass skin
  const back = arc(x0), front = arc(x0 + len);
  g.append(s('polygon', { points: pts(...back, ...front.slice().reverse()), class: 'gh-glass' }));
  // planted trays visible through glass
  st.crops.forEach((c, i) => {
    const ty = y - 0.4 + i * 0.8;
    g.append(box(x0 + 0.3, ty - 0.18, 0, len - 0.6, 0.36, 0.12, 'tray-iso'));
    if (c.state !== 'empty') for (let k = 0; k < 5; k++) {
      const [px, py] = P(x0 + 0.5 + k * ((len - 1) / 4), ty, 0.12);
      const hh = 4 + Math.min(10, c.eff / 3);
      g.append(s('path', { d: `M${px} ${py} q-4 -${hh} 0 -${hh + 3} q4 3 0 ${hh + 3}`, class: c.state === 'lost' ? 'leaf lost' : c.state === 'ripe' ? 'leaf ripe' : 'leaf' }));
    }
  });
  for (let i = 0; i <= steps; i++) g.append(s('polyline', { points: pts(...arc(x0 + (len * i) / steps)), class: 'gh-rib' }));
  g.append(s('polygon', { points: pts(...front), class: 'gh-end' }));
  if (st.zones.gh.leak > 0) { const [lx, ly] = P(x0 + len * 0.7, y + half * 0.6, hgt * 0.6); g.append(s('text', { x: lx, y: ly, class: 'iso-leak', 'aria-hidden': 'true' }, '≋')); }
  return g;
}

function panels(L, st) {
  const { x, y } = L;
  const g = s('g', {});
  [0, 1].forEach((i) => {
    const px = x - 1.4 + i * 1.6, py = y - 0.6;
    const folded = st.energy.folded[i];
    const dirt = 1 - st.energy.clean[i];
    g.append(shadow(px, py + 0.2, 1.3, 1.0, 0.45, 0.4));
    const [m0x, m0y] = P(px + 0.65, py + 0.6, 0), [m1x, m1y] = P(px + 0.65, py + 0.6, 0.45);
    g.append(s('line', { x1: m0x, y1: m0y, x2: m1x, y2: m1y, class: 'iso-mast' }));
    if (folded) { g.append(box(px + 0.35, py + 0.45, 0.4, 0.6, 0.3, 0.12, 'pv-folded')); return; }
    // tilted panel: back edge higher
    const a = P(px, py, 0.95), b = P(px + 1.3, py, 0.95), c = P(px + 1.3, py + 1.1, 0.45), d = P(px, py + 1.1, 0.45);
    g.append(s('polygon', { points: pts(a, b, c, d), class: 'pv-iso' }));
    for (let k = 1; k < 4; k++) { const u = k / 4; g.append(s('line', { x1: a[0] + (b[0] - a[0]) * u, y1: a[1] + (b[1] - a[1]) * u, x2: d[0] + (c[0] - d[0]) * u, y2: d[1] + (c[1] - d[1]) * u, class: 'pv-grid' })); }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    g.append(s('line', { x1: mid(a, d)[0], y1: mid(a, d)[1], x2: mid(b, c)[0], y2: mid(b, c)[1], class: 'pv-grid' }));
    g.append(s('polygon', { points: pts(a, b, c, d), class: 'pv-dust', 'fill-opacity': Math.min(0.85, dirt * 1.1).toFixed(2) }));
  });
  return g;
}

function reserve(L, st) {
  const on = st.energy.reserve.mode !== 'standby' || st.energy.reserve.startingTo;
  const [lx, ly] = P(L.x, L.y, 0.95);
  return s('g', {}, shadow(L.x - 0.55, L.y - 0.45, 1.1, 0.9), box(L.x - 0.55, L.y - 0.45, 0, 1.1, 0.9, 0.8, 'reserve-iso'),
    [0.15, 0.4, 0.65].map((k) => box(L.x + 0.55, L.y - 0.45 + k, 0.15, 0.25, 0.08, 0.5, 'fin-iso')),
    s('path', { d: `M${lx - 4} ${ly - 8} l8 0 l-5 7 l6 0 l-9 11 l3 -8 l-6 0 Z`, class: on ? 'bolt on' : 'bolt' }));
}

function battery(L, st) {
  const frac = Math.max(0, Math.min(1, st.energy.soc / 120));
  const g = s('g', {}, shadow(L.x - 0.7, L.y - 0.45, 1.4, 0.9), box(L.x - 0.7, L.y - 0.45, 0, 1.4, 0.9, 0.55, 'battery-iso'));
  // charge bar painted on the roof
  const a = P(L.x - 0.55, L.y - 0.2, 0.56), b = P(L.x - 0.55 + 1.1 * frac, L.y - 0.2, 0.56), c = P(L.x - 0.55 + 1.1 * frac, L.y + 0.2, 0.56), d = P(L.x - 0.55, L.y + 0.2, 0.56);
  g.append(s('polygon', { points: pts(P(L.x - 0.55, L.y - 0.2, 0.56), P(L.x + 0.55, L.y - 0.2, 0.56), P(L.x + 0.55, L.y + 0.2, 0.56), P(L.x - 0.55, L.y + 0.2, 0.56)), class: 'soc-track' }));
  g.append(s('polygon', { points: pts(a, b, c, d), class: st.energy.soc < 18 ? 'soc low' : 'soc' }));
  return g;
}

function comms(L, st) {
  const [bx, by] = P(L.x, L.y, 0), [tx, ty] = P(L.x, L.y, 1.6);
  return s('g', {}, groundEllipse(L.x + 0.3, L.y + 0.3, 0.45, 'iso-shadow'), box(L.x - 0.3, L.y - 0.3, 0, 0.6, 0.6, 0.2, 'pad-iso'),
    s('line', { x1: bx, y1: by - 6, x2: tx, y2: ty, class: 'iso-mast' }),
    s('path', { d: `M${tx - 16} ${ty - 2} A18 11 0 0 0 ${tx + 14} ${ty - 12} Z`, class: st.eq.relay ? 'dish' : 'dish broken' }),
    st.eq.relay ? s('path', { d: `M${tx + 12} ${ty - 22} a10 10 0 0 1 10 10 M${tx + 16} ${ty - 30} a18 18 0 0 1 18 18`, class: 'waves' }) : s('text', { x: tx + 10, y: ty - 14, class: 'iso-x', 'aria-hidden': 'true' }, '✕'));
}

function shelter(L, st) {
  const g = s('g', {}, shadow(L.x - 0.9, L.y - 0.6, 1.8, 1.2, 0.3, 0.2));
  // earth berm: trapezoid box + roof
  g.append(box(L.x - 0.9, L.y - 0.6, 0, 1.8, 1.2, 0.35, 'berm'));
  g.append(box(L.x - 0.5, L.y - 0.3, 0.35, 1.0, 0.6, 0.25, 'bunker-top'));
  const [dx, dy] = P(L.x - 0.1, L.y + 0.6, 0.18);
  g.append(s('rect', { x: dx - 7, y: dy - 9, width: 14, height: 11, rx: 2, class: 'door' }));
  if (st.shelter) { const [tx, ty] = P(L.x, L.y, 0.8); g.append(s('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'iso-crew', 'aria-hidden': 'true' }, '4')); }
  return g;
}

function water(L, st) {
  return s('g', {}, groundEllipse(L.x + 0.3, L.y + 0.3, 0.95, 'iso-shadow'),
    cylinder(L.x - 0.45, L.y - 0.15, 0.42, 1.25, 'tank-clean', st.water.clean / 220),
    cylinder(L.x + 0.45, L.y + 0.2, 0.36, 0.9, 'tank-grey', st.water.grey / 60));
}

function storage(L, st) {
  const full = st.warehouse.kcal + st.warehouse.water + st.warehouse.parts > 0;
  return s('g', {}, shadow(L.x - 0.9, L.y - 0.7, 1.8, 1.4),
    box(L.x - 0.9, L.y - 0.7, 0, 0.85, 0.8, 0.6, 'crate-iso'), box(L.x, L.y - 0.6, 0, 0.8, 0.75, 0.55, 'crate-iso'),
    box(L.x - 0.55, L.y + 0.15, 0, 0.8, 0.7, 0.5, 'crate-iso'), box(L.x - 0.6, L.y - 0.55, 0.6, 0.7, 0.65, 0.45, 'crate-iso'),
    full ? box(L.x + 0.35, L.y + 0.3, 0, 0.6, 0.5, 0.45, 'cache-crate') : null);
}

function rover(L, st) {
  const g = s('g', {}, shadow(L.x - 0.6, L.y - 0.35, 1.2, 0.7), box(L.x - 0.6, L.y - 0.35, 0.18, 1.2, 0.7, 0.32, 'rover-iso'), box(L.x - 0.2, L.y - 0.25, 0.5, 0.5, 0.5, 0.18, 'rover-cab'));
  for (const [wx, wy] of [[-0.45, 0.38], [0.45, 0.38]]) { const [cx, cy] = P(L.x + wx, L.y + wy, 0.12); g.append(s('ellipse', { cx, cy, rx: 6, ry: 7, class: 'wheel' })); }
  if (st.cache === 'field') {
    const [fx, fy] = P(L.x - 0.6, L.y - 2.4, 0), [tx, ty] = P(L.x - 0.6, L.y - 2.4, 1.1);
    g.append(groundEllipse(L.x - 0.6, L.y - 2.4, 0.25, 'iso-shadow'), s('line', { x1: fx, y1: fy, x2: tx, y2: ty, class: 'iso-mast' }), s('path', { d: `M${tx} ${ty} l16 6 l-16 6 Z`, class: 'flag-iso' }));
  }
  return g;
}
const ART = { habitat, greenhouse, panels, reserve, battery, comms, shelter, water, storage, rover };

// ---------- scene ----------
export function renderIso(st, status, { selected, onSelect }) {
  const slot = slotOf(st.tick);
  const night = !isLightSlot(slot);
  const L = st.energy.L;
  const storm = L <= 0.25;
  const svg = s('svg', { class: `isomap ${night ? 'night' : 'day'}${storm ? ' storm' : L < 1 ? ' haze' : ''}`, viewBox: ISO_VIEWBOX, role: 'group', 'aria-label': t('map.title') },
    s('defs', {},
      s('linearGradient', { id: 'iso-sky', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', class: 'sky-top' }), s('stop', { offset: '1', class: 'sky-bot' })),
      s('linearGradient', { id: 'iso-ground', x1: 0, y1: 0, x2: 1, y2: 1 }, s('stop', { offset: '0', class: 'ground-top' }), s('stop', { offset: '1', class: 'ground-bot' }))),
    s('rect', { x: 0, y: 0, width: 700, height: 480, fill: 'url(#iso-sky)' }));
  // ground plate with a raised rim (side walls show depth)
  const g0 = [P(-0.4, -0.4), P(11.6, -0.4), P(11.6, 10.6), P(-0.4, 10.6)];
  svg.append(s('polygon', { points: pts(g0[3], g0[2], P(11.6, 10.6, -0.35), P(-0.4, 10.6, -0.35)), class: 'ground-side-l' }));
  svg.append(s('polygon', { points: pts(g0[2], g0[1], P(11.6, -0.4, -0.35), P(11.6, 10.6, -0.35)), class: 'ground-side-r' }));
  svg.append(s('polygon', { points: pts(...g0), fill: 'url(#iso-ground)', class: 'ground-top-face' }));
  for (const [cx, cy, r] of [[1.2, 5.6, 0.7], [10.9, 2.6, 0.45], [7.8, 9.9, 0.55], [0.5, 2.2, 0.4], [11.0, 9.6, 0.4]]) {
    svg.append(groundEllipse(cx, cy, r, 'crater'), groundEllipse(cx + 0.06, cy + 0.06, r * 0.72, 'crater-in'));
  }
  for (const [rx, ry] of [[2.2, 6.6], [10.6, 6.6], [5.2, 10.4], [8.2, 2.8], [0.6, 7.2]]) svg.append(box(rx, ry, 0, 0.25, 0.2, 0.15, 'rock'));
  // links on the ground
  const hot = new Set(selected ? HL[selected] || [selected] : []);
  for (const [a, b, kind] of LINKS) {
    const [x1, y1] = P(LAYOUT[a].x, LAYOUT[a].y), [x2, y2] = P(LAYOUT[b].x, LAYOUT[b].y);
    const dead = kind === 'power' && !st.energy.mainBus && a !== 'reserve';
    svg.append(s('path', { d: `M${x1} ${y1} L${x2} ${y2}`, class: `link iso-link ${kind}${hot.has(a) || hot.has(b) ? ' hot' : ''}${dead ? ' dead' : ''}` }));
  }
  // objects back-to-front (painter's order by x + y)
  const order = [...SYSTEMS].sort((a, b) => (LAYOUT[a].x + LAYOUT[a].y) - (LAYOUT[b].x + LAYOUT[b].y));
  const labels = s('g', { class: 'iso-labels' });
  for (const id of order) {
    const Ld = LAYOUT[id];
    const stt = status[id];
    const label = `${t(`sys.${id}`)}: ${t(`status.${stt}`)}`;
    const ringPts = pts(P(Ld.x - Ld.r, Ld.y - Ld.r), P(Ld.x + Ld.r, Ld.y - Ld.r), P(Ld.x + Ld.r, Ld.y + Ld.r), P(Ld.x - Ld.r, Ld.y + Ld.r));
    const g = s('g', { class: `node iso-node st-${stt}${selected === id ? ' selected' : ''}`, role: 'button', tabindex: '0', 'aria-label': label, 'aria-pressed': selected === id ? 'true' : 'false', 'data-sys': id,
      onclick: () => onSelect(id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } } },
      s('title', {}, label),
      s('polygon', { points: ringPts, class: 'hit iso-hit' }),
      stt === 'warn' || stt === 'bad' ? s('polygon', { points: ringPts, class: `ring iso-ring ${stt}` }) : null,
      selected === id ? s('polygon', { points: ringPts, class: 'iso-selected' }) : null,
      ART[id](Ld, st, night));
    svg.append(g);
    // horizontal label pill above the object (drawn last, never rotated)
    const [lx, ly] = P(Ld.x, Ld.y, id === 'comms' ? 2.1 : id === 'habitat' ? 2.0 : id === 'panels' ? 1.25 : 1.1);
    const text = `${ICON[stt]} ${t(`sys.${id}`)}`;
    const w = Math.max(74, text.length * 7.2 + 16);
    labels.append(s('g', { class: `iso-tag st-${stt}${selected === id ? ' selected' : ''}`, transform: `translate(${lx.toFixed(1)},${(ly - 6).toFixed(1)})`, 'aria-hidden': 'true', onclick: () => onSelect(id) },
      s('rect', { x: -w / 2, y: -13, width: w, height: 22, rx: 11, class: `tag ${stt}` }),
      s('text', { x: 0, y: 3, 'text-anchor': 'middle', class: 'tag-text' }, text)));
  }
  svg.append(labels);
  // light overlays: night tint and dust haze (opacity follows simulated L)
  svg.append(s('rect', { x: 0, y: 0, width: 700, height: 480, class: 'dust', opacity: Math.max(0, (1 - L) * 0.45).toFixed(2), 'pointer-events': 'none' }));
  if (storm) svg.append(s('g', { class: 'dust-streaks', 'pointer-events': 'none' }, [60, 150, 240, 330, 420].map((y, i) => s('path', { d: `M-40 ${y} q170 -${20 + i * 4} 340 0 t340 0 t340 0`, class: 'streak' }))));
  if (night) svg.append(s('rect', { x: 0, y: 0, width: 700, height: 480, class: 'nightshade', 'pointer-events': 'none' }));
  return svg;
}
