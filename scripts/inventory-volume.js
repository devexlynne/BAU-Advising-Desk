const fs = require('fs');
const path = require('path');

const railwayDeployment = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID);
const dataDir = process.env.DATA_DIR
  || (railwayDeployment ? '/data' : path.join(__dirname, '..', 'data-store'));
const storeFile = path.join(dataDir, 'store.json');
const backupDir = path.join(dataDir, 'backups');
const auditFile = path.join(dataDir, 'audit.log');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(storeFile)) {
  fail('No store.json found in DATA_DIR. No data was read or changed.');
} else {
  try {
    const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (!store || typeof store !== 'object' || Array.isArray(store)) {
      throw new Error('store.json must contain an object');
    }

    const keys = Object.keys(store);
    const advisorSlugs = new Set();
    let accounts = 0, studentRecords = 0, otherAdvisorEntries = 0, otherEntries = 0;
    keys.forEach(key => {
      const advisor = /^advisors\/([^/]+)\//.exec(key);
      if (/^advisors\/[^/]+\/account$/.test(key)) accounts++;
      else if (/^advisors\/[^/]+\/students\/[^/]+$/.test(key)) studentRecords++;
      else if (advisor) {
        advisorSlugs.add(advisor[1]);
        otherAdvisorEntries++;
      } else if (!/^_(sessions|resets|verifies)$/.test(key)) otherEntries++;
      if (advisor) advisorSlugs.add(advisor[1]);
    });

    const countBag = key => {
      const value = store[key];
      return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
    };
    const backups = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter(name => /^store-.*\.json$/.test(name))
      : [];
    const backupBytes = backups.reduce((total, name) => total
      + fs.statSync(path.join(backupDir, name)).size, 0);
    const auditBytes = fs.existsSync(auditFile) ? fs.statSync(auditFile).size : 0;
    const auditLines = auditBytes
      ? fs.readFileSync(auditFile, 'utf8').split(/\r?\n/).filter(Boolean).length
      : 0;

    console.log(JSON.stringify({
      storeEntries: keys.length,
      advisors: advisorSlugs.size,
      advisorAccounts: accounts,
      studentRecords: studentRecords,
      otherAdvisorEntries,
      otherEntries,
      sessions: countBag('_sessions'),
      resetTokens: countBag('_resets'),
      verificationTokens: countBag('_verifies'),
      backups: backups.length,
      backupBytes,
      auditLines,
      auditBytes
    }, null, 2));
  } catch (error) {
    fail('Could not inventory the volume: ' + error.message);
  }
}
