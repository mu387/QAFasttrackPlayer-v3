const fs = require('fs');
const path = require('path');

const nowIso = () => new Date().toISOString();

const readJsonSafe = filePath => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
};

const writeJsonAtomic = (filePath, payload) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
};

const clearFileSafe = filePath => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (_) {
    return false;
  }
};

const buildInitialJournal = ({ payload, meta = {}, recoveryEnabled = false }) => ({
  version: 1,
  state: 'running',
  created_at: nowIso(),
  updated_at: nowIso(),
  recovery_enabled: !!recoveryEnabled,
  meta: {
    source: meta.source || 'unknown',
    queue_id: meta.queue?.id ?? null,
    queue_item_id: meta.item?.id ?? null,
    claim_token: meta.claimToken || meta.claim_token || null,
    attempt_no: Number(meta.item?.attempts || 0) || null,
    test_suite_id: Number(meta.item?.test_suite_id || 0) || null,
    test_plan_item_id: Number(meta.item?.test_plan_item_id || 0) || null,
    configuration_id: Number(meta.item?.configuration_id || 0) || null,
    test_design_dataset_id: Number(meta.item?.test_design_dataset_id || 0) || null,
    queue_run_id: Number(meta.item?.queue_run_id || 0) || null,
  },
  payload: payload || null,
  progress: {
    current_runner: 0,
    current_step: 0,
    is_paused: false,
    reason: 'initialized',
    steps_snapshot: null,
    runtime_variables: {},
    last_email_sandbox_result: null,
  },
});

module.exports = {
  nowIso,
  readJsonSafe,
  writeJsonAtomic,
  clearFileSafe,
  buildInitialJournal,
};
