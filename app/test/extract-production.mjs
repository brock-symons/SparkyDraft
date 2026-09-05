// ===================================================================
// PULLING FUNCTIONS OUT OF THE LIVE index.html
//
// The parity tests compare the ported core against the CURRENT product,
// not against a copy of it — a copy would drift and start agreeing with
// the port for the wrong reason. So the functions are extracted from
// index.html at run time.
//
// Extraction is by NAME with brace matching, never by line number, so
// the tests keep working as index.html is edited.
// ===================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
export const productionSource = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');

/** One top-level `function name(...) { ... }`, braces balanced. */
export function extractFunction(name, source = productionSource) {
  const start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('could not find function ' + name + ' in index.html');
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces reading ' + name);
}

/** One top-level `const NAME = ...` line. */
export function extractConst(name, source = productionSource) {
  const m = source.match(new RegExp('\\nconst ' + name + ' = [^\\n]+', ''));
  if (!m) throw new Error('could not find const ' + name + ' in index.html');
  return m[0];
}

/**
 * Builds a callable module out of extracted pieces. `prelude` supplies
 * whatever globals the extracted code closes over (SYMBOL_LIBRARY,
 * state, and so on); `exports` is the list of names to hand back.
 */
export function buildProductionModule({ prelude = [], parts = [], exports = [] }) {
  const src = [...prelude, ...parts, 'return { ' + exports.join(', ') + ' };'].join('\n');
  return new Function(src)();
}

/** Tiny assertion helper shared by the parity tests. */
export function makeComparer() {
  const state = { checks: 0, fails: 0 };
  function eq(a, b, what) {
    state.checks++;
    const same =
      typeof a === 'number' && typeof b === 'number'
        ? Math.abs(a - b) < 1e-9
        : JSON.stringify(a) === JSON.stringify(b);
    if (!same) {
      state.fails++;
      if (state.fails <= 20)
        console.log('MISMATCH', what, '\n  production:', a, '\n  ported:    ', b);
    }
  }
  function report(label) {
    console.log(
      state.fails === 0
        ? `${label}: PARITY OK — ${state.checks} comparisons, every one matched production`
        : `${label}: ${state.fails} MISMATCHES out of ${state.checks} comparisons`
    );
    return state.fails === 0;
  }
  return { eq, report, state };
}

/** Deterministic PRNG so a failing case is reproducible. */
export function makeRandom(seed = 12345) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
