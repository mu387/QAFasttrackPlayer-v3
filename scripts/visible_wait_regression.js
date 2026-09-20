const assert = require('node:assert/strict');
const { waitVisible, progress, lookup } = require('../src/utils/visibleWait');

const element = (shown, text = '') => ({ isDisplayed: async () => shown, getText: async () => text });
function driver(limit = 4) {
  return {
    polls: 0,
    executeScript: async (_script, root) => root ? [root] : [],
    async wait(predicate, timeout, message, interval) {
      assert.equal(interval, 200);
      assert.equal(timeout, 1000);
      while (this.polls++ < limit) if (await predicate()) return;
      throw new Error(message);
    },
  };
}
async function main() {
  const events = [];
  progress.on('waiting', event => events.push(event));
  const config = { state: 'exist', timeout: 1000 };
  let d = driver();
  await waitVisible(d, config, async () => d.polls < 3 ? [element(false)] : [element(true)]);
  assert.equal(d.polls, 3);
  d = driver();
  await waitVisible(d, { ...config, state: 'notexist' }, async () => [element(false)]);
  assert.equal(d.polls, 1);
  d = driver();
  await waitVisible(d, { ...config, text: 'Ready', match: 'exact', scope: 'id=scope' }, async () => d.polls === 1 ? [] : [element(true, 'Ready')]);
  assert.equal(d.polls, 2);
  d = driver();
  await waitVisible(d, { ...config, text: 'Ready', match: 'contains', state: 'notexist', scope: 'id=scope' }, async () => []);
  d = driver();
  await waitVisible(d, config, async () => {
    if (d.polls === 1) throw Object.assign(new Error('stale'), { name: 'StaleElementReferenceError' });
    return [element(true)];
  });
  for (const name of ['InvalidSelectorError', 'InvalidSessionIdError', 'NoSuchWindowError']) {
    await assert.rejects(waitVisible(driver(), { ...config, state: 'notexist' }, async () => { throw Object.assign(new Error(name), { name }); }), { name });
  }
  await assert.rejects(waitVisible(driver(), config, async () => []), /timed out/);
  for (let i = 0; i < events.length; i += 2) {
    assert.equal(events[i].reason, 'helper_waiting');
    assert.equal(events[i + 1].reason, 'helper_waiting_done');
    assert.equal(events[i].id, events[i + 1].id);
  }
  const a = element(true), b = element(true);
  assert.deepEqual(await lookup({}, { findElements: async () => [a, b] }, 'css=div[1]', value => value), [b]);
  console.log('PASS visibility polling, scope absence, stale retry, fatal errors, timeout, progress pairing, indexing');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
