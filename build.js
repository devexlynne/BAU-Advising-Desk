/*
 * Builds build/index.html: web/shell.html with the data and client scripts
 * inlined at the placeholder markers.
 *
 * Client code is minified (whitespace and comments removed; names are kept
 * because the scripts share one global scope). Student records are never
 * embedded in the page; the authenticated server supplies them after sign-in.
 */
const fs = require('fs');
const esbuild = require('esbuild');

const read = p => fs.readFileSync(p, 'utf8');
// JSON inside <script>: escape '<' so a value like '</script>' can never end the tag
const json = p => JSON.stringify(JSON.parse(read(p))).replace(/</g, '\\u003c');
const minifyJs = code => esbuild.transformSync(code, { loader: 'js', minifyWhitespace: true, legalComments: 'none' }).code;
const minifyCss = code => esbuild.transformSync(code, { loader: 'css', minify: true, legalComments: 'none' }).code;

const data = [
  'window.CATALOG=' + json('data/catalog.json') + ';',
  'window.RULES=' + json('data/rules.json') + ';',
  'window.OFFERING=' + json('data/offering.json') + ';',
  'window.BRAND=' + json('data/brand.json') + ';',
  // public sign-in directory: faculties, departments and academic staff as listed on www.bau.edu.lb
  'window.BAU_DIRECTORY=' + json('data/directory.json') + ';',
  // faculties, programmes and study plans read from the 2020-2021 catalogue, loaded on request by a superadmin
  'window.CATALOGUE_SEED=' + json('data/catalogue-2020.json') + ';',
  // what the study-plan files sent to departments contain (scripts/build-intake-workbooks.py)
  'window.INTAKE_SPEC=' + json('data/intake-rules.json') + ';'
].join('\n');

const app = read('src/programme.js') + '\n' + read('src/intake.js') + '\n' + read('src/app.js')
  .replace('/*__DIRECTORY__*/', () => read('src/directory.js'))
  .replace('/*__ASKME__*/', () => read('src/askme.js'))
  .replace('/*__RULES__*/', () => read('src/rulesadmin.js') + '\n' + read('src/structure.js') + '\n' + read('src/exceptions.js') + '\n' + read('src/admin.js'))
  .replace('/*__I18N__*/', () => read('src/i18n.js'));

const PLACEHOLDER = /\/\*__[A-Z]+__\*\//;
let html = read('web/shell.html')
  // the shell's own comments, styles and small scripts
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => '<style>' + minifyCss(css) + '</style>')
  .replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => (PLACEHOLDER.test(js) ? m : '<script>' + minifyJs(js) + '</script>'))
  // then the placeholders
  .replace('/*__ENGINE__*/', () => minifyJs(read('src/engine.js')))
  .replace('/*__DATA__*/', () => data)
  .replace('/*__MERGE__*/', () => minifyJs(read('src/merge.js')))
  .replace('/*__PDF__*/', () => minifyJs(read('src/pdfimport.js')))
  .replace('/*__STORE__*/', () => minifyJs(read('src/store.js')))
  .replace('/*__APP__*/', () => minifyJs(app));

// pdf.js is inlined (reader + worker) when web/vendor has it, so importing
// works offline and under the server's Content-Security-Policy.
const CDN_PDF = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>';
if (fs.existsSync('web/vendor/pdf.min.js') && fs.existsSync('web/vendor/pdf.worker.min.js')) {
  html = html.replace(CDN_PDF, () => '<script>' + read('web/vendor/pdf.min.js') + '</script>\n<script>' + read('web/vendor/pdf.worker.min.js') + '</script>');
}

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/index.html', html);
console.log('built build/index.html  ' + (html.length / 1024).toFixed(0) + ' KB');
