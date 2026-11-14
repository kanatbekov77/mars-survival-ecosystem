// Balance runs (GDD §12): N seeds per profile and strategy.
// Usage: node tools/simulate.mjs [--seeds 200] [--strategy control] [--profile engineer] [--json out.json]
import { writeFileSync } from 'node:fs';
import { Run } from '../src/engine/run.js';
import { STRATEGIES, playRun } from '../src/engine/strategies.js';
import { CONFIG_VERSION } from '../src/engine/config.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = +opt('seeds', 200);
const strategies = opt('strategy', 'control,compromiseA,compromiseB,random,error').split(',');
const profiles = opt('profile', 'cadet,engineer').split(',');
const jsonOut = opt('json', null);

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const results = { configVersion: CONFIG_VERSION, seeds: N, generatedUTC: new Date().toISOString(), rows: [] };

for (const profile of profiles) for (const name of strategies) {
  const t0 = Date.now();
  const outcomes = {}; const terminals = {}; const minSoC = []; const minWater = []; const parts = []; const harvests = []; const pauses = []; let missed = 0; let missions = 0;
  for (let seed = 0; seed < N; seed++) {
    const run = playRun(Run, { profile, seed, mode: 'campaign', timer: 'on' }, STRATEGIES[name]);
    const s = run.state;
    const end = s.ending?.id || 'incomplete';
    outcomes[end] = (outcomes[end] || 0) + 1;
    if (s.stats.firstTerminal) terminals[s.stats.firstTerminal] = (terminals[s.stats.firstTerminal] || 0) + 1;
    minSoC.push(s.stats.minSoC); minWater.push(s.stats.minClean); parts.push(s.stats.partsUsed); harvests.push(s.flags.harvests); pauses.push(s.stats.autopauses);
    missed += s.stats.deadlinesMissed;
    missions += Object.values(s.missions).filter((x) => x === 'done').length;
  }
  const pass = N - (outcomes.stop || 0) - (outcomes.incomplete || 0);
  const row = { profile, strategy: name, passRate: pass / N, outcomes, terminals, medianMinSoC: median(minSoC), medianMinWater: median(minWater), medianPartsUsed: median(parts), medianHarvests: median(harvests), medianAutopauses: median(pauses), deadlinesMissed: missed, avgMissionsDone: missions / N, ms: Date.now() - t0 };
  results.rows.push(row);
  console.log(`${profile.padEnd(8)} ${name.padEnd(12)} pass ${(row.passRate * 100).toFixed(1).padStart(5)}%  ${JSON.stringify(outcomes)}  stops ${JSON.stringify(terminals)}  minSoC ${row.medianMinSoC.toFixed(1)}  minWater ${row.medianMinWater.toFixed(1)}  parts ${row.medianPartsUsed}  harvest ${row.medianHarvests}  missions ${row.avgMissionsDone.toFixed(1)}/30  ${row.ms}ms`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
