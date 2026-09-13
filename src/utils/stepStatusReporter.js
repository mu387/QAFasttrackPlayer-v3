const { api } = require('./api');
const { getStepLogBulkUrl, getStepLogUrl } = require('./endpoint');

const DEFAULT_BATCH_SIZE = Number(process.env.STEP_STATUS_BATCH_SIZE || 10);
const DEFAULT_FLUSH_MS = Number(process.env.STEP_STATUS_FLUSH_MS || 200);

let queue = [];
let flushTimer = null;
let bulkDisabled = false;
let isFlushing = false;

const chunk = (arr, size) => {
  if (!Array.isArray(arr) || !arr.length || size <= 0) {
    return [];
  }
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const groupByRunnerSuite = entries => {
  const map = new Map();
  entries.forEach(entry => {
    const key = `${entry.runnerId}:${entry.testSuiteId}`;
    const existing = map.get(key);
    if (existing) {
      existing.steps.push(entry.step);
      return;
    }
    map.set(key, {
      runnerId: entry.runnerId,
      testSuiteId: entry.testSuiteId,
      token: entry.token,
      steps: [entry.step],
    });
  });
  return Array.from(map.values());
};

const sendSingles = async entries => {
  for (const entry of entries) {
    await api.request({
      url: getStepLogUrl(),
      method: 'post',
      data: {
        test_runner_id: entry.runnerId,
        test_suite_id: entry.testSuiteId,
        steps: [entry.step],
      },
      token: entry.token,
    });
  }
};

const sendBulk = async entries => {
  const grouped = groupByRunnerSuite(entries);
  for (const group of grouped) {
    const stepChunks = chunk(group.steps, DEFAULT_BATCH_SIZE);
    for (const steps of stepChunks) {
      await api.request({
        url: getStepLogBulkUrl(),
        method: 'post',
        data: {
          test_runner_id: group.runnerId,
          test_suite_id: group.testSuiteId,
          steps,
        },
        token: group.token,
      });
    }
  }
};

const shouldDisableBulk = status => status === 404 || status === 405;

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(err => {
      console.log('[step-status] scheduled flush failed', err?.message || err);
    });
  }, DEFAULT_FLUSH_MS);
};

const enqueue = ({ runnerId, testSuiteId, step, token, urgent = false }) => {
  if (!runnerId || !testSuiteId || !step) {
    return;
  }
  queue.push({ runnerId, testSuiteId, step, token });
  if (urgent || queue.length >= DEFAULT_BATCH_SIZE) {
    flush().catch(err => {
      console.log('[step-status] urgent flush failed', err?.message || err);
    });
    return;
  }
  scheduleFlush();
};

const flush = async () => {
  if (isFlushing || !queue.length) {
    return;
  }
  isFlushing = true;
  const pending = queue;
  queue = [];
  try {
    if (!bulkDisabled) {
      try {
        await sendBulk(pending);
        return;
      } catch (err) {
        const status = err?.response?.status;
        if (shouldDisableBulk(status)) {
          bulkDisabled = true;
        }
        // Mirror TestFlow resiliency: on any bulk failure, fall back to single updates.
        await sendSingles(pending);
        return;
      }
    }
    await sendSingles(pending);
  } finally {
    isFlushing = false;
    if (queue.length) {
      scheduleFlush();
    }
  }
};

module.exports = {
  enqueue,
  flush,
};
