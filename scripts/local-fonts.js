/* The sandbox that takes the manual's screenshots cannot reach Google Fonts,
   so the page would fall back to other typefaces. This serves the very same
   families (IBM Plex Sans, Plex Sans Arabic, Plex Mono, Source Serif 4) from
   the Fontsource copies on disk, answering the page's own Google Fonts request. */
const fs = require('fs'), path = require('path');
const NM = process.env.FONTS_NM || '/tmp/fonts/node_modules';
const SETS = [
  ['@fontsource/ibm-plex-sans', ['400', '500', '600', '700']],
  ['@fontsource/ibm-plex-mono', ['400', '500', '600']],
  ['@fontsource/ibm-plex-sans-arabic', ['400', '500', '600']],
  ['@fontsource-variable/source-serif-4', ['opsz']]
];
function css() {
  let out = '';
  for (const [pkg, files] of SETS) for (const f of files) {
    const p = path.join(NM, pkg, f + '.css');
    if (!fs.existsSync(p)) continue;
    out += fs.readFileSync(p, 'utf8')
      .replace(/url\(\.\/files\//g, `url(https://fonts.local/${pkg}/files/`)
      .replace(/Source Serif 4 Variable/g, 'Source Serif 4');
  }
  return out;
}
module.exports = async function useLocalFonts(ctx) {
  const sheet = css();
  await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: sheet }));
  await ctx.route(/fonts\.local\//, r => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname).slice(1);
    const file = path.join(NM, rel);
    if (!fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(file), headers: { 'access-control-allow-origin': '*' } });
  });
};
