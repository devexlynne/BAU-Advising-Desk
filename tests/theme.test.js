/**
 * Light and dark.
 *
 * Reads the colours straight out of the stylesheet and checks that text is
 * readable in both themes, to the WCAG AA standard of 4.5 to 1. A colour
 * that looks fine to one person at one brightness can be hard work for
 * someone else, so this is measured rather than judged by eye.
 */
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'shell.html'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); passed++; }
  catch (e) { console.log('  FAILED  ' + name + '\n     ' + e.message); failed++; }
}

function tokens(block) {
  const o = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)) o[m[1]] = m[2];
  return o;
}
const blockAt = start => css.slice(start, css.indexOf('}', start));
const light = tokens(css.slice(css.indexOf(':root{'), css.indexOf('@media (prefers-color-scheme:dark)')));
const darkChosen = Object.assign({}, light, tokens(blockAt(css.indexOf(':root[data-theme="dark"]{'))));
const darkSystem = Object.assign({}, light, tokens(blockAt(css.indexOf('@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){'))));
const printStart = css.indexOf(':root:root:root{');
const paper = Object.assign({}, light, tokens(blockAt(printStart)));

const lum = h => {
  const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const PAIRS = [
  ['ink', 'ground', 'body text'], ['ink', 'surface', 'text on cards'], ['ink2', 'surface', 'secondary text'],
  ['muted', 'surface', 'notes on cards'], ['muted', 'ground', 'notes on the page'], ['muted', 'sunk', 'notes on grey panels'],
  ['brand', 'surface', 'links'], ['brand', 'brand-soft', 'selected chips'], ['on-brand', 'brand', 'primary buttons'],
  ['ok', 'ok-soft', 'reviewed line'], ['watch', 'watch-soft', 'watch tags'], ['urgent', 'urgent-soft', 'urgent tags'],
  ['surface', 'urgent', 'critical tag and red badge'], ['urgent', 'surface', 'critical text'],
  ['on-topbar', 'topbar', 'the top bar']
];

console.log('\n--- readable in every theme ---');
[['light', light], ['dark, chosen in the portal', darkChosen], ['dark, from the computer', darkSystem], ['printed', paper]]
  .forEach(([name, t]) => test(name + ': every pair at least 4.5 to 1', () => {
    const low = PAIRS.filter(([f, b]) => t[f] && t[b] && ratio(t[f], t[b]) < 4.5)
      .map(([f, b, what]) => what + ' ' + ratio(t[f], t[b]).toFixed(2));
    if (low.length) throw new Error(low.join('; '));
  }));

test('the two dark themes are the same colours', () => {
  const diff = Object.keys(darkChosen).filter(k => darkChosen[k] !== darkSystem[k]);
  if (diff.length) throw new Error('differ on ' + diff.join(', '));
});

console.log('\n--- the details that make it work ---');
test('form controls, dropdowns and scrollbars follow the theme', () => {
  const n = (css.match(/color-scheme:(light|dark)/g) || []).length;
  if (n < 4) throw new Error('color-scheme set in only ' + n + ' places');
});
test('printing from dark mode prints dark ink on white paper', () => {
  if (printStart < 0) throw new Error('no print override');
  if (lum(paper.ink) > 0.1 || lum(paper.surface) < 0.9) throw new Error('paper colours are not light');
});
test('the theme is chosen before the page draws, so there is no flash', () => {
  const head = css.slice(0, css.indexOf('<style>'));
  if (!/localStorage\.getItem\('bau\.theme'\)/.test(head)) throw new Error('no theme script ahead of the stylesheet');
});
test('the initials circles have a dark version', () => {
  if (!/:root\[data-theme="dark"\] :is\(\.av,\.bigav,\.face\.drawn\)/.test(css)) throw new Error('no dark rule for the circles');
});

console.log('\n--- the notifications sit above the page ---');
test('the top bar does not clip what hangs out of it', () => {
  const bar = /\.top\{[^}]*\}/.exec(css);
  if (!bar) throw new Error('no rule for the top bar');
  if (/overflow:hidden/.test(bar[0])) throw new Error('the bar clips its own notifications');
  if (!/z-index:\s*\d/.test(bar[0])) throw new Error('the bar has no place in the stack');
});
test('the popup is above the floating buttons and the toasts', () => {
  const pop = /\.bell-pop\{[^}]*\}/.exec(css);
  const z = pop && /z-index:(\d+)/.exec(pop[0]);
  if (!z) throw new Error('the popup has no z-index');
  const others = [...css.matchAll(/z-index:(\d+)/g)].map(m => +m[1]);
  if (+z[1] < Math.max(...others)) throw new Error('something else sits above the popup');
});

console.log('\n--- the design holds together ---');
test('the type sizes are a scale, not a scatter', () => {
  const body = [...css.matchAll(/font-size:([0-9.]+)px/g)].map(m => +m[1]).filter(v => v <= 15);
  const distinct = [...new Set(body)].sort((a, b) => a - b);
  // Body text should sit on a handful of steps, not fourteen near-identical ones.
  if (distinct.length > 7) throw new Error('body text uses ' + distinct.length + ' sizes: ' + distinct.join(', '));
  distinct.forEach((v, i) => {
    if (i && v - distinct[i - 1] < 0.9) throw new Error('two steps are a hair apart: ' + distinct[i - 1] + ' and ' + v);
  });
});
test('corners come from the scale', () => {
  const odd = [...css.matchAll(/border-radius:([0-9.]+)px/g)]
    .map(m => +m[1]).filter(v => v > 3 && v < 99);
  if (odd.length) throw new Error('radii written by hand instead of a token: ' + odd.join(', '));
});
test('a keyboard can see where it is', () => {
  if (!/:focus-visible\{[^}]*outline/.test(css)) throw new Error('no focus ring');
});
test('pressing something shows it was pressed', () => {
  if (!/:active[^{]*\{[^}]*transform/.test(css)) throw new Error('nothing responds to a press');
});
test('selected text is the portal\'s own colour', () => {
  if (!/::selection\{/.test(css)) throw new Error('no selection colour');
});

console.log('\n--- choices, not defaults ---');
test('labels are words, not tracked-out capitals', () => {
  // A panel caption and a tag both used to be set in spaced capitals, which
  // is the commonest label treatment there is and made each panel announce
  // itself before you reached its contents.
  const hd = /\.panel>\.hd\{[^}]*\}/.exec(css);
  if (!hd) throw new Error('no rule for a panel caption');
  if (/text-transform:uppercase/.test(hd[0])) throw new Error('panel captions are shouting again');
  const tag = /\n\.tag\{[^}]*\}/.exec(css);
  if (tag && /text-transform:uppercase/.test(tag[0])) throw new Error('tags are stamps again');
});
test('surfaces are told apart by how they sit', () => {
  const panel = /\n\.panel\{[^}]*\}/.exec(css);
  if (!panel) throw new Error('no panel rule');
  if (/box-shadow:var\(--shadow\)/.test(panel[0])) throw new Error('a list is floating like a dialog again');
  if (!/dialog,\.bell-pop,\.toast\{[^}]*box-shadow/.test(css)) throw new Error('nothing floats above the page');
});
test('the meta lines are not a row of dots', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const dots = (app.match(/&middot;/g) || []).length;
  if (dots) throw new Error(dots + ' dotted meta strings are back');
});
test('one entrance, not one per element', () => {
  const settle = /\.view\.settle > \*\{[^}]*\}/g;
  const all = [...css.matchAll(settle)].map(m => m[0]);
  const last = all[all.length - 1];
  if (!last) throw new Error('no view entrance');
  if (/translate/.test(last)) throw new Error('every view is sliding again');
});

console.log('\n========================================================');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('========================================================\n');
process.exit(failed ? 1 : 0);
