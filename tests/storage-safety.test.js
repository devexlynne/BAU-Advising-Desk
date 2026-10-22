const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8');

function loadStore(allowOfflineDemo) {
  const values = new Map();
  const context = {
    location: { protocol: 'file:' },
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    },
    window: { OFFLINE_DEMO: allowOfflineDemo, crypto: {} },
    fetch: async () => { throw new Error('unexpected network request'); }
  };
  context.self = context;
  vm.runInNewContext(source, context);
  return { Store: context.Store, values };
}

(async () => {
  const blocked = loadStore(false).Store;
  await assert.rejects(blocked.init(), /Offline storage is disabled/);

  const demo = loadStore(true);
  await demo.Store.init();
  await demo.Store.saveSettings('synthetic-demo', { dismissed: [], term: null });
  assert.deepStrictEqual(
    await demo.Store.getSettings('synthetic-demo'),
    { dismissed: [], term: null });
  assert.strictEqual(demo.values.size, 0, 'demo data was persisted to localStorage');

  console.log('  ok  browser persistence requires explicit offline-demo mode');
  console.log('  ok  offline-demo data remains in memory and never reaches localStorage');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
