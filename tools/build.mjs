// Bundle ES modules + CSS into one self-contained offline file: dist/mars.html
import { fileURLToPath } from 'node:url';
// No dependencies. Supports `import {a, b as c} from './x.js'`, `export function/const/class`, `export { a, b }`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = resolve(root, 'src/ui/main.js');
const mods = new Map();
const order = [];
function load(file) {
  if (mods.has(file)) return;
  mods.set(file, null);
  let src = readFileSync(file, 'utf8');
  const deps = [];
  src = src.replace(/^import\s+\{([^}]*)\}\s+from\s+['"](.+?)['"];?/gm, (_, names, p) => {
    const dep = resolve(dirname(file), p); deps.push(dep);
    const list = names.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${list} } = __m[${JSON.stringify(relative(root, dep))}];`;
  });
  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"](.+?)['"];?/gm, (_, n, p) => { const dep = resolve(dirname(file), p); deps.push(dep); return `const ${n} = __m[${JSON.stringify(relative(root, dep))}];`; });
  const exportsList = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+(\w+)/gm, (_, kw, name) => { exportsList.push(name); return `${kw} ${name}`; });
  src = src.replace(/^export\s+\{([^}]*)\};?/gm, (_, names) => { exportsList.push(...names.split(',').map((x) => x.trim()).filter(Boolean)); return ''; });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`Unsupported module syntax in ${relative(root, file)}`);
  for (const d of deps) load(d);
  mods.set(file, { src, exportsList });
  order.push(file);
}
load(entry);
let js = '(function(){"use strict";\nconst __m = {};\n';
for (const f of order) {
  const { src, exportsList } = mods.get(f);
  js += `// ---- ${relative(root, f)}\n__m[${JSON.stringify(relative(root, f))}] = (function(){\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}
js += '})();\n';
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="styles.css">/, `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="src\/ui\/main.js"><\/script>/, () => `<script>\n${js.replace(/<\/script/g, '<\\/script')}\n</script>`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/mars.html'), html);
console.log(`dist/mars.html · ${order.length} modules · ${(html.length / 1024).toFixed(0)} KB`);
