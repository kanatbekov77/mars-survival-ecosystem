// Debug one run: node tools/debug-run.mjs <strategy> <profile> <seed>
import { Run } from '../src/engine/run.js';
import { STRATEGIES, playRun } from '../src/engine/strategies.js';
const [name = 'control', profile = 'engineer', seed = '0'] = process.argv.slice(2);
const run = playRun(Run, { profile, seed: +seed }, STRATEGIES[name]);
const s = run.state;
console.log('ending', s.ending?.id, s.ending?.cause, 'tick', s.tick, 'landing', s.flags.landingConfirmed, 'landCheck', s.flags.landCheckTick, 'local', JSON.stringify(s.events.local));
for (const h of s.history.filter((x) => x.t % 48 === 47 || x.t === s.history.length - 1)) console.log(h.t, 'w', h.water.toFixed(1), 'grey', h.grey.toFixed(1), 'o2', h.o2.toFixed(1), 'soc', h.soc.toFixed(0), 'T', h.habT.toFixed(1), 'ghT', h.ghT.toFixed(1), 'ghP', h.ghP.toFixed(1), 'food', (h.food / 9600).toFixed(1), 'dose', h.dose.toFixed(1));
console.log('sinks', JSON.stringify(s.sinks, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
console.log('jobs', s.log.filter((e) => e.type === 'jobDone').map((e) => `${e.tick}:${e.action}`).join(' '));
console.log('missions', JSON.stringify(s.missions));
console.log('protocols', JSON.stringify(s.flags.protocols), 'crops', s.crops.map((c) => `${c.id}:${c.species}:${c.state}:${c.eff.toFixed(1)}:${c.stress.toFixed(0)}`).join(' '));
