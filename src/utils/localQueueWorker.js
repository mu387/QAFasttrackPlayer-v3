const axios = require('axios');

const DEFAULT_POLL_MS = 3000;
const DEFAULT_HEARTBEAT_MS = 10000;
const FINALIZE_RETRY_BASE_MS = 1500;
const FINALIZE_RETRY_MAX_MS = 15000;
const EXECUTE_RETRY_BASE_MS = 1200;
const EXECUTE_RETRY_MAX_MS = 8000;
const EXECUTE_RETRY_ATTEMPTS = 3;

const toBool = value => value === true || value === 'true';

const toNumber = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const normalizeBase = raw => {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.endsWith('/') ? text.slice(0, -1) : text;
};

const normalizeQueueStatus = statusName => {
  const status = String(statusName || '').toLowerCase();
  if (status.includes('pass')) return 'passed';
  if (status.includes('glitch')) return 'glitch';
  if (status.includes('fail')) return 'failed';
  if (status.includes('cancel')) return 'canceled';
  return null;
};

class LocalQueueWorker {
  constructor({ onExecute, canClaim, onQueueKilled }) {
    this.onExecute = onExecute;
    this.canClaim = canClaim || (() => true);
    this.onQueueKilled = typeof onQueueKilled === 'function' ? onQueueKilled : null;
    this.enabled = false;
    this.running = false;
    this.busy = false;
    this.pollMs = DEFAULT_POLL_MS;
    this.apiBaseUrl = '';
    this.token = '';
    this.useRunnerSession = false;
    this.deviceId = '';
    this.clientId = '';
    this.runnerId = '';
    this.runnerVersion = this.resolveLocalRunnerVersion();
    this.runnerUpdate = null;
    this.runnerSessionToken = '';
    this.registeredDevice = false;
    this.lastRegistrationAt = null;
    this.lastHeartbeatAt = null;
    this.lastHeartbeatAttemptAt = 0;
    this.heartbeatMs = DEFAULT_HEARTBEAT_MS;
    this.currentCorrelationId = '';
    this.currentQueue = null;
    this.currentItem = null;
    this.currentClaimToken = '';
    this.pendingFinalize = null;
    this.timer = null;
    this.lastError = null;
  }

  resolveLocalRunnerVersion() {
    try {
      const pkg = require('../../package.json');
      const version = String(pkg?.version || '').trim();
      if (version) return version;
    } catch (_) {}
    return String(process.env.npm_package_version || '').trim() || '';
  }

  isQueueKillError(err) {
    const status = Number(err?.response?.status || 0);
    const message = String(
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      '',
    ).toLowerCase();
    if (status !== 409) return false;
    return message.includes('cancel') || message.includes('killed');
  }

  handleQueueKilled(err) {
    if (!this.isQueueKillError(err)) return false;
    this.busy = false;
    this.currentCorrelationId = '';
    this.currentQueue = null;
    this.currentItem = null;
    this.currentClaimToken = '';
    this.lastError = `queue_killed:${this.formatError(err)}`;
    try {
      this.onQueueKilled?.({ message: this.lastError });
    } catch (_) {}
    return true;
  }

  isStaleClaimError(err) {
    const status = Number(err?.response?.status || 0);
    const message = String(
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      '',
    ).toLowerCase();
    if (status !== 409) return false;
    return message.includes('invalid or stale claim token');
  }

  buildExecutionPoint(item) {
    const testSuiteId = Number(item?.test_suite_id || 0);
    if (!testSuiteId) return null;
    const configurationId = item?.configuration_id !== undefined && item?.configuration_id !== null
      ? Number(item.configuration_id || 0) || null
      : null;
    const testDesignDatasetId = item?.test_design_dataset_id !== undefined && item?.test_design_dataset_id !== null
      ? Number(item.test_design_dataset_id || 0) || null
      : null;

    return {
      test_suite_id: testSuiteId,
      configuration_id: configurationId,
      test_design_dataset_id: testDesignDatasetId,
    };
  }

  configure(next = {}) {
    if (Object.prototype.hasOwnProperty.call(next, 'enabled')) {
      this.enabled = toBool(next.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'pollMs')) {
      this.pollMs = toNumber(next.pollMs, DEFAULT_POLL_MS);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'apiBaseUrl')) {
      this.apiBaseUrl = normalizeBase(next.apiBaseUrl);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'token')) {
      this.token = String(next.token || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(next, 'deviceKey')) {
      this.token = String(next.deviceKey || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(next, 'useRunnerSession')) {
      this.useRunnerSession = toBool(next.useRunnerSession);
      if (!this.useRunnerSession) {
        this.runnerSessionToken = '';
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'deviceId')) {
      this.deviceId = String(next.deviceId || '').trim();
      this.registeredDevice = false;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'clientId')) {
      this.clientId = String(next.clientId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(next, 'runnerId')) {
      this.runnerId = String(next.runnerId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(next, 'runnerVersion')) {
      this.runnerVersion = String(next.runnerVersion || '').trim();
    }
    return this.status();
  }

  status() {
    return {
      enabled: this.enabled,
      running: this.running,
      busy: this.busy,
      pollMs: this.pollMs,
      apiBaseUrl: this.apiBaseUrl,
      hasToken: !!this.token,
      runnerSessionEnabled: this.useRunnerSession,
      hasRunnerSession: !!this.runnerSessionToken,
      runnerId: this.runnerId || null,
      runnerVersion: this.runnerVersion || null,
      deviceId: this.deviceId || null,
      clientId: this.clientId || null,
      registeredDevice: this.registeredDevice,
      currentQueueId: this.currentQueue?.id || null,
      currentQueueItemId: this.currentItem?.id || null,
      currentClaimToken: this.currentClaimToken || null,
      lastRegistrationAt: this.lastRegistrationAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      correlationId: this.currentCorrelationId || null,
      pendingFinalize: !!this.pendingFinalize,
      runnerUpdate: this.runnerUpdate || null,
      lastError: this.lastError,
    };
  }

  clearActiveExecution(reason = '') {
    this.busy = false;
    this.currentCorrelationId = '';
    this.currentQueue = null;
    this.currentItem = null;
    this.currentClaimToken = '';
    this.pendingFinalize = null;
    if (reason) {
      this.lastError = String(reason);
    }
    return this.status();
  }

  normalizeRunnerUpdate(update) {
    if (!update || typeof update !== 'object') return null;
    return {
      mode: String(update.mode || ''),
      target_version: String(update.target_version || ''),
      runner_version: String(update.runner_version || ''),
      requires_update: Boolean(update.requires_update || update.required || update.optional || update.blocked),
      required: Boolean(update.required || update.blocked),
      optional: Boolean(update.optional),
      download_url: String(update.download_url || ''),
      message_required: String(update.message_required || ''),
      message_optional: String(update.message_optional || ''),
      message: String(update.message || ''),
    };
  }

  extractRunnerUpdate(err) {
    const update = err?.response?.data?.data?.runner_update || null;
    return this.normalizeRunnerUpdate(update);
  }

  formatError(err) {
    if (!err) return 'unknown';
    const status = err?.response?.status;
    const body = err?.response?.data;
    const code = String(body?.code || '').trim();
    if (code === 'runner_update_required') {
      const update = this.extractRunnerUpdate(err);
      if (update) {
        this.runnerUpdate = update;
      }
      const target = update?.target_version ? `:${update.target_version}` : '';
      const message = update?.message || body?.message || 'Runner update required';
      return `runner_update_required${target}:${message}`;
    }
    const bodyMessage =
      (body && (body.message || body.error)) ||
      (Array.isArray(body?.errors) ? body.errors.join(', ') : null) ||
      (body?.errors && typeof body.errors === 'object' ? JSON.stringify(body.errors) : null);
    const base = bodyMessage || err?.message || 'unknown';
    return status ? `${status}:${base}` : String(base);
  }

  isRetriableExecuteError(err) {
    const status = Number(err?.response?.status || 0);
    if (status === 429 || status >= 500) return true;
    const code = String(err?.code || '').toUpperCase();
    return [
      'ECONNABORTED',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(code);
  }

  async sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  start() {
    if (this.running) return this.status();
    this.running = true;
    this.lastError = null;
    this.scheduleNext(0);
    return this.status();
  }

  stop() {
    this.running = false;
    this.busy = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.status();
  }

  scheduleNext(ms = this.pollMs) {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } finally {
        this.scheduleNext(this.pollMs);
      }
    }, Math.max(0, ms));
  }

  async request(method, path, data = undefined) {
    const base = normalizeBase(this.apiBaseUrl);
    if (!base) throw new Error('Queue worker apiBaseUrl is missing.');
    if (!this.token) throw new Error('Queue worker device key is missing.');
    const url = `${base}${path}`;
    const response = await axios.request({
      url,
      method,
      data,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Device-Key': this.token,
        ...(this.useRunnerSession && this.runnerSessionToken
          ? { 'X-Runner-Session': this.runnerSessionToken }
          : {}),
        ...(this.currentCorrelationId
          ? { 'X-Correlation-Id': this.currentCorrelationId }
          : {}),
      },
      timeout: 15000,
    });
    return response?.data;
  }

  async ensureRunnerSession() {
    if (!this.useRunnerSession) return;
    if (this.runnerSessionToken) return;
    if (!this.runnerId) {
      throw new Error('runner_session_missing_runner_id');
    }
    const data = await this.request('post', '/runner/execution-queue/runner/bootstrap', {
      runner_id: this.runnerId,
      runner_version: this.runnerVersion || null,
    });
    this.runnerUpdate = this.normalizeRunnerUpdate(data?.data?.runner_update);
    const token = String(data?.data?.runner_session_token || '').trim();
    if (!token) {
      throw new Error('runner_session_bootstrap_failed');
    }
    this.runnerSessionToken = token;
  }

  async ensureDeviceRegistration() {
    if (!this.deviceId) return;
    if (this.registeredDevice) return;

    const data = await this.request('post', `/runner/execution-devices/${Number(this.deviceId)}/register`, {
      runner_id: this.runnerId || null,
      runner_version: this.runnerVersion || null,
      status: this.busy ? 'busy' : 'idle',
      health_status: 'ready',
      viewer_status: 'unavailable',
      capabilities_json: {
        platform: process.platform,
        hostname: require('os').hostname(),
      },
    });

    if (!data?.success) {
      throw new Error(data?.message || 'device_registration_failed');
    }

    this.registeredDevice = true;
    this.lastRegistrationAt = new Date().toISOString();
  }

  async heartbeat() {
    if (!this.deviceId) return;
    const nowTs = Date.now();
    if (this.lastHeartbeatAttemptAt && nowTs - this.lastHeartbeatAttemptAt < this.heartbeatMs) {
      return;
    }
    this.lastHeartbeatAttemptAt = nowTs;
    await this.request('post', `/runner/execution-devices/${Number(this.deviceId)}/heartbeat`, {
      status: this.busy ? 'busy' : 'idle',
      health_status: 'ready',
      runner_version: this.runnerVersion || null,
      current_queue_item_id: this.currentItem?.id || null,
      current_run_id: this.currentItem?.queue_run_id || null,
      viewer_status: 'unavailable',
      capabilities_json: {
        platform: process.platform,
        hostname: require('os').hostname(),
      },
    });
    this.lastHeartbeatAt = new Date().toISOString();
    if (this.lastError && (this.lastError.startsWith('runner_state_failed:') || this.lastError.startsWith('claim_failed:'))) {
      this.lastError = null;
    }
  }

  async claim() {
    const payload = {};
    if (this.deviceId) {
      payload.device_id = Number(this.deviceId);
    }
    const data = await this.request('post', '/runner/execution-queue/claim-local', payload);
    this.runnerUpdate = this.normalizeRunnerUpdate(data?.data?.runner_update);
    return data?.data || null;
  }

  async fetchExecutionPayload(item) {
    const testSuiteId = item?.test_suite_id;
    const testPlanItemId = item?.test_plan_item_id;
    if (!testSuiteId || !testPlanItemId) {
      throw new Error('Queue claim missing test_suite_id or test_plan_item_id.');
    }
    const suitePoint = this.buildExecutionPoint(item);
    const data = await this.request('post', '/runner/automation/get/testsuites/steps', {
      test_suites: [Number(testSuiteId)],
      suite_points: suitePoint ? [suitePoint] : undefined,
      test_plan_item_id: Number(testPlanItemId),
      invoked_via_tests: true,
    });
    const payload = data?.data || data || {};
    if (!Array.isArray(payload?.test_runner_steps)) {
      throw new Error('Automation payload missing test_runner_steps.');
    }
    return payload;
  }

  async resolveSuiteStatus(item) {
    const testPlanItemId = item?.test_plan_item_id;
    const testSuiteId = item?.test_suite_id;
    if (!testPlanItemId || !testSuiteId) return null;
    const data = await this.request(
      'get',
      `/runner/get/testsuites/against/testplanitems/${Number(testPlanItemId)}/light`,
    );
    const rows = data?.data || data || [];
    const list = Array.isArray(rows) && rows[0]?.added_suites ? rows[0].added_suites : [];
    const match = list.find(row => {
      const designId = Number(row?.test_design_id ?? row?.id ?? 0);
      return designId === Number(testSuiteId);
    });
    return normalizeQueueStatus(match?.status?.name || '');
  }

  async report(queue, item, status, claimToken) {
    const queueId = queue?.id;
    if (!queueId || !item?.test_suite_id || !status || !claimToken) return;
    const suitePoint = this.buildExecutionPoint(item);
    await this.request('post', `/runner/execution-queue/${Number(queueId)}/items/status`, {
      queue_run_id: item?.queue_run_id || null,
      claim_token: String(claimToken),
      attempt_no: Number(item?.attempts || 0) || null,
      results: [
        {
          test_suite_id: Number(item.test_suite_id),
          configuration_id: suitePoint?.configuration_id ?? null,
          test_design_dataset_id: suitePoint?.test_design_dataset_id ?? null,
          status,
        },
      ],
    });
  }

  async reportInterrupted(queue, item, claimToken, reason = 'waiting_recovery') {
    const queueId = queue?.id;
    if (!queueId || !item?.test_suite_id || !claimToken) return;
    const suitePoint = this.buildExecutionPoint(item);
    await this.request('post', `/runner/execution-queue/${Number(queueId)}/items/interrupted`, {
      queue_run_id: item?.queue_run_id || null,
      claim_token: String(claimToken),
      attempt_no: Number(item?.attempts || 0) || null,
      test_suite_id: Number(item.test_suite_id),
      configuration_id: suitePoint?.configuration_id ?? null,
      test_design_dataset_id: suitePoint?.test_design_dataset_id ?? null,
      reason: String(reason || 'waiting_recovery'),
    });
  }

  async reportInterruptedFromJournalMeta(meta = {}, reason = 'runner_restarted_recovery_disabled') {
    const queueId = Number(meta?.queue_id || 0);
    const testSuiteId = Number(meta?.test_suite_id || 0);
    const claimToken = String(meta?.claim_token || '').trim();
    if (!queueId || !testSuiteId || !claimToken) {
      throw new Error('Journal is missing queue interrupt identifiers.');
    }

    await this.request('post', `/runner/execution-queue/${Number(queueId)}/items/interrupted`, {
      queue_run_id: Number(meta?.queue_run_id || 0) || null,
      claim_token: claimToken,
      attempt_no: Number(meta?.attempt_no || 0) || null,
      test_suite_id: testSuiteId,
      configuration_id: Number(meta?.configuration_id || 0) || null,
      test_design_dataset_id: Number(meta?.test_design_dataset_id || 0) || null,
      reason: String(reason || 'runner_restarted_recovery_disabled'),
    });
  }

  async tryFinalizePending() {
    if (!this.pendingFinalize) return false;
    const pending = this.pendingFinalize;
    const nowTs = Date.now();
    if (Number(pending?.nextAttemptAt || 0) > nowTs) {
      return false;
    }
    this.currentCorrelationId = `q-${Number(pending?.queue?.id || 0)}-i-${Number(pending?.item?.id || 0)}-finalize-${Date.now()}`;
    try {
      let statusToReport = String(pending?.status || '').trim().toLowerCase();
      if (!statusToReport) {
        statusToReport = await this.resolveSuiteStatus(pending.item);
      }
      if (!statusToReport) {
        this.lastError = 'pending_finalize_waiting_terminal_status';
        return false;
      }
      await this.report(pending.queue, pending.item, statusToReport, pending.claimToken);
      this.pendingFinalize = null;
      this.lastError = null;
      return true;
    } catch (err) {
      if (this.handleQueueKilled(err)) {
        this.pendingFinalize = null;
        return false;
      }
      if (this.isStaleClaimError(err)) {
        this.pendingFinalize = null;
        this.lastError = `stale_claim_finalize_dropped:${this.formatError(err)}`;
        return false;
      }
      const attempts = Number(pending?.attempts || 0) + 1;
      const retryDelay = Math.min(FINALIZE_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)), FINALIZE_RETRY_MAX_MS);
      this.pendingFinalize = {
        ...pending,
        attempts,
        nextAttemptAt: Date.now() + retryDelay,
      };
      this.lastError = `pending_finalize_failed:${this.formatError(err)}`;
      if (this.useRunnerSession && String(this.lastError).includes('401')) {
        this.runnerSessionToken = '';
      }
      return false;
    } finally {
      this.currentCorrelationId = '';
    }
  }

  async tick() {
    if (!this.running || !this.enabled) return;
    if (!this.apiBaseUrl || !this.token) return;
    try {
      if (this.useRunnerSession) {
        await this.ensureRunnerSession();
      }
      await this.ensureDeviceRegistration();
      await this.heartbeat();
    } catch (err) {
      this.lastError = `runner_state_failed:${this.formatError(err)}`;
      if (this.useRunnerSession && String(this.lastError).includes('401')) {
        this.runnerSessionToken = '';
      }
      this.registeredDevice = false;
      return;
    }
    if (this.busy) return;
    if (this.pendingFinalize) {
      await this.tryFinalizePending();
      return;
    }
    if (!this.canClaim()) return;

    let claim = null;
    try {
      claim = await this.claim();
    } catch (err) {
      if (this.handleQueueKilled(err)) {
        return;
      }
      this.lastError = `claim_failed:${this.formatError(err)}`;
      if (this.useRunnerSession && String(this.lastError).includes('401')) {
        this.runnerSessionToken = '';
      }
      return;
    }

    const queue = claim?.queue || null;
    const item = claim?.item || null;
    const claimToken = claim?.claim_token || item?.claim_token || null;
    if (!queue || !item) {
      if (this.lastError && this.lastError.startsWith('report_failed:')) {
        return;
      }
      this.lastError = null;
      return;
    }

    this.busy = true;
    this.currentQueue = queue;
    this.currentItem = item;
    this.currentClaimToken = claimToken ? String(claimToken) : '';
    this.currentCorrelationId = `q-${Number(queue?.id || 0)}-i-${Number(item?.id || 0)}-a-${Number(item?.attempts || 0)}-${Date.now()}`;
    let status = 'failed';
    let skipFinalReport = false;
    let interruptedByRunner = false;
    try {
      for (let attempt = 1; attempt <= EXECUTE_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const payload = await this.fetchExecutionPayload(item);
          const executionResult = await this.onExecute(payload, {
            token: this.token,
            deviceKey: this.token,
            apiBaseUrl: this.apiBaseUrl,
            queue,
            item,
            claimToken,
            reportInterrupted: async reason => {
              interruptedByRunner = true;
              await this.reportInterrupted(queue, item, claimToken, reason);
            },
          });
          if (interruptedByRunner) {
            this.pendingFinalize = null;
            this.lastError = null;
            skipFinalReport = true;
            return;
          }
          const explicitStatus = normalizeQueueStatus(executionResult?.status || '');
          const resolved = explicitStatus || (await this.resolveSuiteStatus(item));
          status = resolved || 'passed';
          this.lastError = null;
          break;
        } catch (executeErr) {
          const isRetriable =
            attempt < EXECUTE_RETRY_ATTEMPTS && this.isRetriableExecuteError(executeErr);
          if (!isRetriable) throw executeErr;
          const delayMs = Math.min(
            EXECUTE_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)),
            EXECUTE_RETRY_MAX_MS,
          );
          this.lastError = `execute_retrying:${attempt}/${EXECUTE_RETRY_ATTEMPTS}:${this.formatError(executeErr)}`;
          await this.sleep(delayMs);
        }
      }
    } catch (err) {
      if (this.handleQueueKilled(err)) {
        status = 'canceled';
        skipFinalReport = true;
      } else {
        this.lastError = `execute_failed:${this.formatError(err)}`;
        status = 'failed';
      }
    } finally {
      try {
        if (!skipFinalReport) {
          await this.report(queue, item, status, claimToken);
        }
      } catch (reportErr) {
        if (this.handleQueueKilled(reportErr)) {
          return;
        }
        if (this.isStaleClaimError(reportErr)) {
          this.pendingFinalize = null;
          this.lastError = `stale_claim_finalize_dropped:${this.formatError(reportErr)}`;
          return;
        }
        this.pendingFinalize = {
          queue,
          item,
          claimToken,
          status,
          attempts: 0,
          nextAttemptAt: 0,
        };
        this.lastError = `report_failed:${this.formatError(reportErr)}`;
        if (this.useRunnerSession && String(this.lastError).includes('401')) {
          this.runnerSessionToken = '';
        }
      }
      this.busy = false;
      this.currentQueue = null;
      this.currentItem = null;
      this.currentClaimToken = '';
      this.currentCorrelationId = '';
    }
  }
}

module.exports = {
  LocalQueueWorker,
};


