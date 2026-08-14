import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ===== CORE START =====([\s\S]*?)\/\/ ===== CORE END =====/);
if (!m) throw new Error('CORE section not found in index.html');
// Evaluate in the main realm (not vm) so arrays/objects share prototypes with
// the test file — deepStrictEqual compares prototypes across realms otherwise.
export const Core = new Function(m[1] + '\nreturn Core;')();
