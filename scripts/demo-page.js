/*
 * Builds the offline demo page: the normal portal build with the demo flag,
 * the seed students and a small label added to <head>. Used by demo.js,
 * private-demo.js (through demo.js) and public-demo.js.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function loadSeed(seedFile) {
  const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  if (!seed.students.every(s => s.demo === true && /^20\d\d99\d{3}$/.test(s.id))) {
    throw new Error(path.basename(seedFile) + ' must contain demo records only (demo: true, IDs in the 99xxx block).');
  }
  return seed;
}

function buildPage(seed, label) {
  execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'inherit' });
  const built = fs.readFileSync(path.join(ROOT, 'build', 'index.html'), 'utf8');
  const data = JSON.stringify({ advisor: seed.advisor, students: seed.students }).replace(/</g, '\\u003c');
  const head = '<script>window.OFFLINE_DEMO=true;window.DEMO_DATA=' + data + ';' +
    'sessionStorage.setItem("bau.session",' + JSON.stringify(seed.advisor) + ');' +
    // a small label so nobody mistakes the demo for the live portal
    'document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.id="demo-ribbon";' +
    'd.textContent=' + JSON.stringify(label).replace(/</g, '\\u003c') + ';document.body.appendChild(d)});</script>' +
    '<style>#demo-ribbon{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;' +
    'background:#A8842C;color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:6px 14px;border-radius:999px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none}</style>';
  return built.replace('<head>', '<head>' + head);
}

module.exports = { ROOT, loadSeed, buildPage };
