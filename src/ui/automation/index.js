const { stepLogCall } = require('../../utils/stepLog');
const { api } = require('../../utils/api');
const { getSaveCloseUrl } = require('../../utils/endpoint');
const { getRuntimeConfig } = require('../../utils/runtimeConfig');
const { WebActions, removeActiveWebDriver, quitWithTimeout } = require('./webActions');
const { MobileActionsRouter } = require('./mobileActionsRouter');
const runtimeVariables = require('./runtimeVariables');
const sessionPolicy = require('./sessionPolicy');
const keywordHandlers = require('./keywordHandlers');

const resolveStepKeyword = (step) => {
    const candidates = [
        step?.keyword?.name,
        step?.keyword,
        step?.keyword_name,
        step?.keywordName,
    ];
    for (const candidate of candidates) {
        if (candidate == null) {
            continue;
        }
        const text = String(candidate).trim();
        if (text !== '') {
            return candidate;
        }
    }
    return null;
};

const execution = {
    NOT_EXECUTED: 0,
    EXECUTING: 1,
    EXECUTED: 2,
    FAILED: 3,
};
class FastTrackAutomation {
    testRunnerStepDataOriginal = null;
    testRunnerStepData = null;
    testRunnerSteps = null;
    mainWindow = null;
    testRunner = null;
    token = null;
    currentRunner = 0;
    currentStep = 0;
    isPaused = false;
    selectedScreen = null;
    isReExecuteFlag = false;
    webDriver = null;
    mobileDriver = null;
    testRunnerData = null;
    capturedData = null;
    runtimeVariables = {};
    executionDelayMs = 200;
    isDraftRun = false;
    onProgress = null;
    onInterrupted = null;
    recoveryState = null;
    runStepStats = null;
    pendingStepResolution = null;
    pendingStepResolutionData = null;
    cancelRequested = false;
    cancelCompletionPromise = null;
    cancelCompletionResolve = null;
    lastApiResult = null;
    lastEmailSandboxResult = null;
    perfLogSeq = 0;
    perfEnabled = process.env.DEBUG_PERF === 'true' || process.env.DEBUG_PERF === '1';
    loopState = null;

    perfNow() {
        return Date.now();
    }

    perfStamp() {
        return new Date().toISOString();
    }

    formatPerfStep(step = {}) {
        const keyword = resolveStepKeyword(step) || 'unknown';
        const id = step?.id ?? step?.parent ?? 'na';
        const description = String(step?.description || '').trim();
        return {
            keyword,
            id,
            description: description.slice(0, 140),
        };
    }

    perfStart(label, details = {}) {
        if (!this.perfEnabled) return null;
        const seq = ++this.perfLogSeq;
        const startedAtMs = this.perfNow();
        const stamp = this.perfStamp();
        console.log(`[perf][${stamp}][#${seq}] START ${label}`, details);
        return { seq, label, startedAtMs, details };
    }

    perfEnd(handle, outcome = 'ok', extra = {}) {
        if (!handle) return;
        const endedAtMs = this.perfNow();
        const elapsedMs = endedAtMs - (handle.startedAtMs || endedAtMs);
        const stamp = this.perfStamp();
        const payload = { ...handle.details, ...extra, elapsedMs };
        console.log(`[perf][${stamp}][#${handle.seq}] END ${handle.label} outcome=${outcome}`, payload);
    }

    constructor({ testRunnerStepDataOriginal, testRunner, mainWindow, token, selectedScreen, isReExecuteFlag, testPlanItemId, recoveryState, onProgress, onInterrupted }) {
        this.testRunnerStepDataOriginal = structuredClone(testRunnerStepDataOriginal);
        this.testRunnerSteps = structuredClone(testRunnerStepDataOriginal);
        this.testRunner = structuredClone(testRunner);
        this.isDraftRun = !this.testRunner?.id;
        this.token = token;
        this.testPlanItemId = testPlanItemId || testRunner?.test_plan_item_id || testRunner?.testPlanItemId || null;
        this.mainWindow = mainWindow;
        if (this.testRunnerSteps) {
            this.testRunnerData = this.testRunner || null;
            this.testRunnerStepData = this.splitGroupedKeywords(
                this.formatBeforeAfterSteps(this.makeConfigStep(this.markLastStep(this.testRunnerSteps))),
            );
        }
        this.webDriver = new WebActions();
        this.mobileDriver = new MobileActionsRouter();
        this.selectedScreen = selectedScreen;
        this.isReExecuteFlag = isReExecuteFlag;
        this.onProgress = typeof onProgress === 'function' ? onProgress : null;
        this.onInterrupted = typeof onInterrupted === 'function' ? onInterrupted : null;
        this.recoveryState = recoveryState && typeof recoveryState === 'object' ? recoveryState : null;
        this.runStepStats = {
            attempted: 0,
            failed: 0,
        };
        this.runtimeVariables = {};
        this.pendingStepResolution = null;
        this.pendingStepResolutionData = null;
        this.cancelRequested = false;
        this.cancelCompletionPromise = null;
        this.cancelCompletionResolve = null;
        this.lastApiResult = null;
        this.lastEmailSandboxResult = null;
        this.loopState = null;
        if (this.recoveryState) {
            const rr = Number(this.recoveryState.current_runner);
            const rs = Number(this.recoveryState.current_step);
            if (Number.isFinite(rr) && rr >= 0) {
                this.currentRunner = rr;
            }
            if (Number.isFinite(rs) && rs >= 0) {
                this.currentStep = rs;
            }
            if (
                this.recoveryState.runtime_variables &&
                typeof this.recoveryState.runtime_variables === 'object' &&
                !Array.isArray(this.recoveryState.runtime_variables)
            ) {
                this.runtimeVariables = { ...this.recoveryState.runtime_variables };
            }
            if (
                this.recoveryState.last_email_sandbox_result &&
                typeof this.recoveryState.last_email_sandbox_result === 'object'
            ) {
                this.lastEmailSandboxResult = { ...this.recoveryState.last_email_sandbox_result };
            }
        }
    }

    emitProgress(patch = {}, includeSnapshot = false) {
        if (!this.onProgress) return;
        const payload = {
            current_runner: this.currentRunner,
            current_step: this.currentStep,
            is_paused: this.isPaused,
            runtime_variables: { ...(this.runtimeVariables || {}) },
            last_email_sandbox_result: this.lastEmailSandboxResult
                ? { ...this.lastEmailSandboxResult }
                : null,
            ...(patch || {}),
        };
        if (includeSnapshot) {
            try {
                payload.steps_snapshot = structuredClone(this.testRunnerStepData);
            } catch (_) {
                payload.steps_snapshot = null;
            }
        }
        try {
            this.onProgress(payload);
        } catch (err) {
            console.log('[automation] onProgress callback failed', err?.message || err);
        }
    }

    normalizeRuntimeValue(value) {
        return runtimeVariables.normalizeRuntimeValue(value);
    }

    setRuntimeVariable(name, value) {
        runtimeVariables.setRuntimeVariable(this, name, value);
    }

    setFlattenedRuntimeVariables(prefix, value) {
        runtimeVariables.setFlattenedRuntimeVariables(this, prefix, value);
    }

    resolveRuntimeToken(token) {
        return runtimeVariables.resolveRuntimeToken(this, token);
    }

    resolveRuntimeValue(value) {
        return runtimeVariables.resolveRuntimeValue(this, value);
    }

    parseExplicitIndexedStepValue(rawValue) {
        const value = String(rawValue ?? '');
        const match = value.match(/^(\d+)\[\](.*)$/s);
        if (!match) {
            return null;
        }

        return {
            explicitTargetIndex: Number(match[1]),
            value: match[2],
        };
    }

    helperUsesOwnLocator(keywordName, rawValue) {
        const normalizedKeyword = String(keywordName || '').trim().toLowerCase();
        const value = String(rawValue || '');
        const entries = value
            .split('>>')
            .map(part => String(part || '').trim())
            .filter(Boolean)
            .map(part => {
                const separatorIndex = part.indexOf('=');
                return separatorIndex > 0
                    ? part.slice(0, separatorIndex).trim().toLowerCase()
                    : '';
            });
        const hasAnyKey = keys => keys.some(key => entries.includes(key));

        if (normalizedKeyword === 'waitforelement' || normalizedKeyword === 'waitfortext') {
            return hasAnyKey(['target', 'scope', 'xpath']);
        }

        if (normalizedKeyword === 'sendkey') {
            return hasAnyKey(['locator']);
        }

        if (normalizedKeyword === 'switchtoiframe') {
            return value.trim().length > 0;
        }

        return false;
    }

    applyExplicitTargetIndexToHelpers(stepCollection, explicitTargetIndex) {
        if (!Array.isArray(stepCollection) || explicitTargetIndex == null) {
            return;
        }

        stepCollection.forEach(helperStep => {
            if (!helperStep || this.helperUsesOwnLocator(helperStep?.keyword?.name, helperStep?.value)) {
                return;
            }
            helperStep.__explicitTargetIndex = explicitTargetIndex;
        });
    }

    normalizeExplicitIndexedStepValue(step) {
        if (!step || typeof step !== 'object') {
            return;
        }

        const parsed = this.parseExplicitIndexedStepValue(step.value);
        if (!parsed) {
            return;
        }

        step.value = parsed.value;
        step.__explicitTargetIndex = parsed.explicitTargetIndex;
        this.applyExplicitTargetIndexToHelpers(step.before_step, parsed.explicitTargetIndex);
        this.applyExplicitTargetIndexToHelpers(step.after_step, parsed.explicitTargetIndex);
    }

    normalizeKeywordName(keywordName) {
        return String(keywordName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    isContextSwitchStep(step) {
        const normalized = this.normalizeKeywordName(resolveStepKeyword(step));
        return normalized === 'switchtoiframe' || normalized === 'switchtodom';
    }

    getStepLoopDirective(step) {
        if (!step || typeof step !== 'object') {
            return null;
        }

        const candidateValues = [
            step.Loop,
            step?.loop?.value,
            step.loop,
            step.loop_value,
            step.loopValue,
            step.loop_directive,
            step.loopDirective,
        ];
        const rawValue = candidateValues.find(value => value !== undefined && value !== null && String(value).trim() !== '');
        if (rawValue === undefined || rawValue === null) {
            return null;
        }

        const text = String(rawValue).trim().replace(/^loop\s*=\s*/i, '').trim();
        const startMatch = text.match(/^:?Start-(.+)$/i);
        if (startMatch) {
            const arg = startMatch[1].trim();
            if (!arg) {
                return null;
            }
            return {
                type: 'start',
                raw: String(rawValue).trim(),
                arg,
                countSource: /^\d+$/.test(arg) ? 'fixed' : 'locator',
            };
        }

        if (/^:?End$/i.test(text)) {
            return {
                type: 'end',
                raw: String(rawValue).trim(),
            };
        }

        return null;
    }

    getHelperLoopDirective(step) {
        const keyword = this.normalizeKeywordName(resolveStepKeyword(step));
        if (keyword !== 'loop') {
            return null;
        }
        return this.getStepLoopDirective({ Loop: step?.value });
    }

    findLoopEndStepIndex(steps, startStepIndex) {
        for (let index = startStepIndex + 1; index < steps.length; index += 1) {
            const directive = this.getStepLoopDirective(steps[index]);
            if (directive?.type === 'start') {
                throw new Error(`Nested loops are not supported. Loop start at step ${index + 1} is inside loop starting at step ${startStepIndex + 1}.`);
            }
            if (directive?.type === 'end') {
                return index;
            }
        }
        throw new Error(`Loop end is missing for loop starting at step ${startStepIndex + 1}.`);
    }

    findHelperLoopEndStepIndex(steps, startStepIndex) {
        for (let index = startStepIndex; index < steps.length; index += 1) {
            const step = steps[index];
            if (index > startStepIndex) {
                const directive = this.getStepLoopDirective(step);
                if (directive?.type === 'start') {
                    throw new Error(`Nested loops are not supported. Loop start at step ${index + 1} is inside loop starting at step ${startStepIndex + 1}.`);
                }
                if (directive?.type === 'end') {
                    return index;
                }
            }

            const helpers = [
                ...(Array.isArray(step?.before_step) ? step.before_step : []),
                ...(Array.isArray(step?.after_step) ? step.after_step : []),
            ];
            for (const helperStep of helpers) {
                const helperDirective = this.getHelperLoopDirective(helperStep);
                if (helperDirective?.type === 'start' && index > startStepIndex) {
                    throw new Error(`Nested loops are not supported. Loop start at step ${index + 1} is inside loop starting at step ${startStepIndex + 1}.`);
                }
                if (helperDirective?.type === 'end') {
                    return index;
                }
            }
        }
        throw new Error(`Loop end is missing for loop starting at step ${startStepIndex + 1}.`);
    }

    async resolveLoopMaxCount(directive) {
        if (directive?.countSource === 'fixed') {
            return Number.parseInt(directive.arg, 10) || 0;
        }

        const locator = this.resolveRuntimeValue(directive?.arg || '');
        if (!locator || typeof this.webDriver?.countVisibleElements !== 'function') {
            return 0;
        }

        return Number(await this.webDriver.countVisibleElements(locator)) || 0;
    }

    async initializeLoopIfNeeded({ directive, runner, stepIndex, endStepIndex = null }) {
        if (!directive || directive.type !== 'start') {
            return;
        }

        if (this.loopState?.active) {
            if (this.loopState.startStepIndex !== stepIndex) {
                throw new Error(`Nested loops are not supported. Step ${stepIndex + 1} attempted to start a second loop.`);
            }
            return;
        }

        const maxCount = await this.resolveLoopMaxCount(directive);
        this.loopState = {
            active: true,
            startStepIndex: stepIndex,
            endStepIndex: Number.isFinite(endStepIndex) ? endStepIndex : this.findLoopEndStepIndex(runner.steps, stepIndex),
            currentIteration: 1,
            maxCount,
            countSource: directive.countSource,
            countLocator: directive.countSource === 'locator' ? this.resolveRuntimeValue(directive.arg) : null,
        };
        console.log('[automation] loop initialized', this.loopState);
    }

    async handleHelperLoopIfNeeded({ helperStep, phase, runner, stepIndex }) {
        const directive = this.getHelperLoopDirective(helperStep);
        if (!directive) {
            return null;
        }

        if (directive.type === 'start') {
            if (phase !== 'before') {
                throw new Error('Loop Start is only supported in before_step.');
            }
            await this.initializeLoopIfNeeded({
                directive,
                runner,
                stepIndex,
                endStepIndex: this.findHelperLoopEndStepIndex(runner.steps, stepIndex),
            });
            return { type: 'start' };
        }

        if (phase !== 'after') {
            throw new Error('Loop End is only supported in after_step.');
        }

        return {
            type: 'end',
            nextStepIndex: this.handleLoopEndIfNeeded({ directive, stepIndex }),
        };
    }

    handleLoopEndIfNeeded({ directive, stepIndex }) {
        if (!directive || directive.type !== 'end') {
            return null;
        }

        if (!this.loopState?.active) {
            throw new Error(`Loop end at step ${stepIndex + 1} does not have an active loop start.`);
        }

        if (this.loopState.endStepIndex !== stepIndex) {
            throw new Error(`Loop end at step ${stepIndex + 1} does not match the active loop ending at step ${this.loopState.endStepIndex + 1}.`);
        }

        if (this.loopState.currentIteration < this.loopState.maxCount) {
            this.loopState.currentIteration += 1;
            console.log('[automation] loop continuing', {
                currentIteration: this.loopState.currentIteration,
                maxCount: this.loopState.maxCount,
                startStepIndex: this.loopState.startStepIndex,
            });
            return this.loopState.startStepIndex;
        }

        console.log('[automation] loop completed', this.loopState);
        this.loopState = null;
        return stepIndex + 1;
    }

    async resetBrowserContextToDefault(reason = 'unspecified') {
        const driver = this.webDriver?.driver;
        if (!driver || typeof this.webDriver?.hasValidSession !== 'function') {
            return false;
        }

        let hasSession = false;
        try {
            hasSession = await this.webDriver.hasValidSession();
        } catch (_) {
            hasSession = false;
        }
        if (!hasSession) {
            return false;
        }

        try {
            await driver.switchTo().defaultContent();
            await driver.executeScript('window.__qaCurrentShadowRoot = null;');
            console.log(`[automation] browser context reset to default (${reason})`);
            return true;
        } catch (error) {
            console.log('[automation] browser context reset failed', reason, error?.message || error);
            return false;
        }
    }

    isEmailSandboxIssueAliasKeyword(keywordName) {
        const normalized = this.normalizeKeywordName(keywordName);
        return normalized === 'issuealias' || normalized === 'emailsandboxissuealias' || normalized === 'emailissuealias';
    }

    isEmailSandboxWaitExtractKeyword(keywordName) {
        const normalized = this.normalizeKeywordName(keywordName);
        return normalized === 'waitaliasemail' || normalized === 'emailsandboxwaitextract' || normalized === 'emailwaitextract';
    }

    parseStepKeyValueArgs(rawValue) {
        const text = String(rawValue ?? '').trim();
        if (!text) return {};

        if (text.startsWith('{') && text.endsWith('}')) {
            try {
                const parsed = JSON.parse(text);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_) {}
        }

        const result = {};
        const segments = text
            .split(/[,|]/)
            .map(part => part.trim())
            .filter(Boolean);

        for (const segment of segments) {
            const idx = segment.indexOf('=');
            if (idx === -1) continue;
            const key = segment.slice(0, idx).trim();
            const value = segment.slice(idx + 1).trim();
            if (!key) continue;
            result[key] = value;
        }

        return result;
    }

    toIntOrNull(value) {
        if (value == null || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? Math.trunc(num) : null;
    }

    async callEmailSandboxAssertions(path, payload) {
        return await api.request({
            url: `/email-sandbox/assertions/${path}`,
            method: 'post',
            data: payload,
            token: this.token,
            runtimeConfig: getRuntimeConfig(),
        });
    }

    buildEmailSandboxError(error, actionLabel) {
        const status = Number(error?.response?.status || 0);
        const responseData = error?.response?.data || {};
        const backendMessage = String(responseData?.message || error?.message || '').trim();

        if (status === 401 || status === 403) {
            return `${actionLabel} failed: unauthorized runner session. Re-authenticate runner/backend connection and retry.`;
        }
        if (status === 404) {
            if (/No matching email found/i.test(backendMessage)) {
                return `${actionLabel} failed: no matching email found before timeout window.`;
            }
            return `${actionLabel} failed: requested email profile/scope resource not found.`;
        }
        if (status === 422) {
            if (/rules failed/i.test(backendMessage)) {
                return `${actionLabel} failed: email matched but required extraction/assertion rules did not pass.`;
            }
            return `${actionLabel} failed: invalid helper configuration or request payload.`;
        }
        if (status >= 500) {
            return `${actionLabel} failed: backend server error (${status}).`;
        }
        if (backendMessage) {
            return `${actionLabel} failed: ${backendMessage}`;
        }
        return `${actionLabel} failed: unexpected error.`;
    }

    async executeEmailSandboxIssueAliasStep(step) {
        const keywordPerf = this.perfStart('keyword', {
            keyword: resolveStepKeyword(step) || 'emailSandboxIssueAlias',
            channel: 'backend',
        });
        this.lastEmailSandboxResult = {
            action: 'issue_alias',
            status: 'running',
        };
        this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
            phase: 'issue_alias_started',
            status: 'running',
        });
        const args = this.parseStepKeyValueArgs(step?.value);
        const payload = {};

        const profileId = this.toIntOrNull(args.profile_id);
        const inboxId = this.toIntOrNull(args.inbox_id);
        const ttlMinutes = this.toIntOrNull(args.ttl_minutes);
        const runReference = String(args.run_reference || this.resolveRuntimeToken('email.run_reference') || '').trim();
        const prefix = String(args.prefix || '').trim();

        if (profileId) payload.profile_id = profileId;
        if (inboxId) payload.inbox_id = inboxId;
        if (ttlMinutes) payload.ttl_minutes = ttlMinutes;
        if (runReference) payload.run_reference = runReference;
        if (prefix) payload.prefix = prefix;

        let data = {};
        try {
            const response = await this.callEmailSandboxAssertions('runtime-alias/issue', payload);
            data = response?.data ?? {};
        } catch (error) {
            const message = this.buildEmailSandboxError(error, 'emailSandboxIssueAlias');
            this.lastEmailSandboxResult = {
                action: 'issue_alias',
                status: 'failed',
                error: message,
            };
            this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
                phase: 'issue_alias_failed',
                status: 'failed',
                error: message,
            });
            this.perfEnd(keywordPerf, 'error', { error: message });
            throw new Error(message);
        }

        this.setRuntimeVariable('email.runtime_alias.id', data.id ?? '');
        this.setRuntimeVariable('email.runtime_alias.full_address', data.full_address ?? '');
        this.setRuntimeVariable('email.runtime_alias.run_reference', data.run_reference ?? '');
        this.setRuntimeVariable('email.runtime_alias.expires_at', data.expires_at ?? '');
        this.setRuntimeVariable('email.runtime_alias.status', data.status ?? '');
        this.setRuntimeVariable('email.run_reference', data.run_reference ?? '');
        // User-friendly aliases for direct step usage.
        this.setRuntimeVariable('runtimeAlias', data.full_address ?? '');
        this.setRuntimeVariable('runtime_alias', data.full_address ?? '');
        this.setRuntimeVariable('runtimeAlias.runId', data.run_reference ?? '');
        this.setRuntimeVariable('runtime_alias_run_id', data.run_reference ?? '');
        this.capturedData = data.full_address ?? '';
        this.lastEmailSandboxResult = {
            action: 'issue_alias',
            status: data.status || 'ok',
            run_reference: data.run_reference ?? '',
            runtime_alias: data.full_address ?? '',
        };
        this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
            phase: 'issue_alias_done',
            status: 'ok',
            run_reference: data.run_reference ?? '',
            runtime_alias: data.full_address ?? '',
        });

        this.perfEnd(keywordPerf, 'ok', { runReference: data.run_reference || '', status: data.status || '' });
    }

    async executeEmailSandboxWaitExtractStep(step) {
        const keywordPerf = this.perfStart('keyword', {
            keyword: resolveStepKeyword(step) || 'emailSandboxWaitExtract',
            channel: 'backend',
        });
        this.lastEmailSandboxResult = {
            action: 'wait_extract',
            status: 'running',
        };
        this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
            phase: 'wait_extract_started',
            status: 'running',
        });
        const args = this.parseStepKeyValueArgs(step?.value);
        const payload = {};

        const profileId = this.toIntOrNull(args.profile_id);
        const profileName = String(args.profile || args.profile_name || '').trim();
        const ruleId = this.toIntOrNull(args.rule_id);
        const ruleName = String(args.rule || '').trim();
        const extractSpec = String(args.extract || '').trim();
        if (!profileId && !profileName && !ruleId && !ruleName && !extractSpec) {
            this.lastEmailSandboxResult = {
                action: 'wait_extract',
                status: 'failed',
                error: 'profile/profile_id or rule/extract is required.',
            };
            this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
                phase: 'wait_extract_failed',
                status: 'failed',
                error: 'profile/profile_id or rule/extract is required.',
            });
            this.perfEnd(keywordPerf, 'error', { error: 'profile/profile_id or rule/extract is required.' });
            throw new Error('waitAliasEmail requires profile/profile_id or rule/extract.');
        }
        if (profileId) payload.profile_id = profileId;
        if (profileName) payload.profile = profileName;
        if (ruleId) payload.rule_id = ruleId;
        if (ruleName) payload.rule = ruleName;
        if (extractSpec) payload.extract = extractSpec;

        const inboxId = this.toIntOrNull(args.inbox_id);
        const withinMinutes = this.toIntOrNull(args.within_minutes);
        const timeoutSeconds = this.toIntOrNull(args.timeout_seconds);
        const pollIntervalMs = this.toIntOrNull(args.poll_interval_ms);

        const runReference = String(args.run_reference || this.resolveRuntimeToken('email.run_reference') || this.resolveRuntimeToken('email.runtime_alias.run_reference') || '').trim();
        const runtimeAlias = String(args.runtime_alias || this.resolveRuntimeToken('email.runtime_alias.full_address') || '').trim();
        const profileInboxId = this.toIntOrNull(args.profile_inbox_id);

        if (!runReference && !runtimeAlias && !inboxId && !profileInboxId) {
            const message = 'emailSandboxWaitExtract requires at least one scope: run_reference, runtime_alias, or inbox_id.';
            this.lastEmailSandboxResult = {
                action: 'wait_extract',
                status: 'failed',
                error: message,
            };
            this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
                phase: 'wait_extract_failed',
                status: 'failed',
                error: message,
            });
            this.perfEnd(keywordPerf, 'error', { error: message });
            throw new Error(message);
        }

        if (runReference) payload.run_reference = runReference;
        if (runtimeAlias) payload.runtime_alias = runtimeAlias;
        if (inboxId) payload.inbox_id = inboxId;
        if (withinMinutes) payload.within_minutes = withinMinutes;
        if (timeoutSeconds) payload.timeout_seconds = timeoutSeconds;
        if (pollIntervalMs) payload.poll_interval_ms = pollIntervalMs;

        let data = {};
        try {
            const response = await this.callEmailSandboxAssertions('wait-extract', payload);
            data = response?.data ?? {};
        } catch (error) {
            const message = this.buildEmailSandboxError(error, 'emailSandboxWaitExtract');
            this.lastEmailSandboxResult = {
                action: 'wait_extract',
                status: 'failed',
                error: message,
                run_reference: runReference,
                runtime_alias: runtimeAlias,
            };
            this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
                phase: 'wait_extract_failed',
                status: 'failed',
                error: message,
            });
            this.perfEnd(keywordPerf, 'error', { error: message });
            throw new Error(message);
        }
        const outputs = data?.outputs && typeof data.outputs === 'object' ? data.outputs : {};

        for (const [key, value] of Object.entries(outputs)) {
            this.setRuntimeVariable(key, value);
            this.setRuntimeVariable(`email.output.${key}`, value);
            this.setRuntimeVariable(`runtimeAlias.Output.${key}`, value);
            this.setRuntimeVariable(`runtime_alias_output.${key}`, value);
            // Local test variable alias for downstream steps that expect l_* naming.
            if (!String(key).startsWith('l_')) {
                this.setRuntimeVariable(`l_${key}`, value);
            }
        }

        this.setRuntimeVariable('email.snapshot_id', data.snapshot_id ?? '');
        this.setRuntimeVariable('email.message_id', data.message_id ?? '');
        this.setRuntimeVariable('email.extract_status', data.status ?? '');
        this.setRuntimeVariable('email.last_outputs', outputs);
        this.setFlattenedRuntimeVariables('email.outputs', outputs);
        this.capturedData = this.normalizeRuntimeValue(outputs);
        this.lastEmailSandboxResult = {
            action: 'wait_extract',
            status: data.status || 'ok',
            run_reference: runReference,
            runtime_alias: runtimeAlias,
            snapshot_id: data.snapshot_id ?? '',
            message_id: data.message_id ?? '',
            outputs,
        };
        this.mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
            phase: 'wait_extract_done',
            status: data.status || 'ok',
            snapshot_id: data.snapshot_id ?? '',
            message_id: data.message_id ?? '',
            outputs,
        });

        this.perfEnd(keywordPerf, 'ok', {
            status: data.status || '',
            outputKeys: Object.keys(outputs).length,
            snapshotId: data.snapshot_id || '',
        });
    }

    parseApiResult(rawValue) {
        if (rawValue == null || rawValue === '') {
            return {
                ok: false,
                status: 0,
                statusText: 'EMPTY_RESPONSE',
                headers: {},
                body: '',
                json: null,
                url: '',
                raw: '',
            };
        }
        if (typeof rawValue === 'object') {
            return { ...rawValue, raw: this.normalizeRuntimeValue(rawValue) };
        }
        try {
            const parsed = JSON.parse(String(rawValue));
            return { ...parsed, raw: String(rawValue) };
        } catch (_) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: {},
                body: String(rawValue),
                json: null,
                url: '',
                raw: String(rawValue),
            };
        }
    }

    getPrimaryApiCaptureValue(apiResult) {
        if (typeof apiResult?.body === 'string' && apiResult.body !== '') {
            return apiResult.body;
        }
        if (apiResult?.json != null) {
            return this.normalizeRuntimeValue(apiResult.json);
        }
        return apiResult?.raw ?? '';
    }

    registerApiRuntimeVariables(apiResult) {
        const primaryValue = this.getPrimaryApiCaptureValue(apiResult);

        this.setRuntimeVariable('api_capture', primaryValue);
        this.setRuntimeVariable('api_capture.body', apiResult?.body ?? '');
        this.setRuntimeVariable('api_capture.status', apiResult?.status ?? 0);
        this.setRuntimeVariable('api_capture.statusText', apiResult?.statusText ?? '');
        this.setRuntimeVariable('api_capture.url', apiResult?.url ?? '');
        this.setRuntimeVariable('api_capture.raw', apiResult?.raw ?? '');
        this.setFlattenedRuntimeVariables('api_capture.response', {
            status: apiResult?.status ?? 0,
            statusText: apiResult?.statusText ?? '',
            ok: apiResult?.ok ?? false,
            url: apiResult?.url ?? '',
            body: apiResult?.body ?? '',
            json: apiResult?.json ?? null,
            headers: apiResult?.headers ?? {},
            raw: apiResult?.raw ?? '',
        });
        if (apiResult?.json != null) {
            this.setFlattenedRuntimeVariables('api_capture.json', apiResult.json);
        }
        if (apiResult?.headers) {
            this.setFlattenedRuntimeVariables('api_capture.headers', apiResult.headers);
        }
    }

    redactApiEvidenceHeaders(headers) {
        const sensitiveHeaderNames = new Set([
            'authorization',
            'cookie',
            'set-cookie',
            'x-csrf-token',
            'x-xsrf-token',
            'proxy-authorization',
        ]);
        const source = headers && typeof headers === 'object' ? headers : {};
        const result = {};
        for (const [key, value] of Object.entries(source)) {
            const normalized = String(key || '').trim().toLowerCase();
            result[key] = sensitiveHeaderNames.has(normalized) ? '[REDACTED]' : value;
        }
        return result;
    }

    isSensitiveApiEvidenceKey(key) {
        const text = String(key || '').trim().toLowerCase();
        return /(authorization|cookie|csrf|xsrf|password|secret|token|api[_-]?key|jwt|session)/i.test(text);
    }

    redactApiEvidenceValue(value, parentKey = '') {
        if (this.isSensitiveApiEvidenceKey(parentKey)) {
            return '[REDACTED]';
        }
        if (Array.isArray(value)) {
            return value.map(item => this.redactApiEvidenceValue(item, parentKey));
        }
        if (value && typeof value === 'object') {
            const sanitized = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                sanitized[key] = this.redactApiEvidenceValue(nestedValue, key);
            }
            return sanitized;
        }
        return value;
    }

    redactApiEvidenceText(rawText) {
        const text = String(rawText ?? '');
        if (!text.trim()) return text;

        try {
            const parsed = JSON.parse(text);
            return JSON.stringify(this.redactApiEvidenceValue(parsed), null, 2);
        } catch (_) {}

        return text
            .replace(/(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi, '$1[REDACTED]')
            .replace(/((?:access|refresh|id)?_?token\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
            .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
            .replace(/(api[_-]?key\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
            .replace(/(secret\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
            .replace(/(cookie\s*[:=]\s*)([^\n]+)/gi, '$1[REDACTED]');
    }

    buildApiEvidenceComment(apiResult) {
        if (!apiResult || typeof apiResult !== 'object') return null;
        const redactedHeaders = this.redactApiEvidenceHeaders(apiResult?.headers ?? {});
        const redactedJson = this.redactApiEvidenceValue(apiResult?.json ?? null);
        const redactedBody = this.redactApiEvidenceText(apiResult?.body ?? '');
        const redactedRaw = this.redactApiEvidenceText(apiResult?.raw ?? '');
        return `__QAF_EVIDENCE__${JSON.stringify({
            type: 'api_response',
            captured_at: new Date().toISOString(),
            mode: apiResult?.mode ?? '',
            ok: apiResult?.ok ?? false,
            status: apiResult?.status ?? 0,
            statusText: apiResult?.statusText ?? '',
            url: apiResult?.url ?? '',
            headers: redactedHeaders,
            body: redactedBody,
            json: redactedJson,
            raw: redactedRaw,
        })}`;
    }

    buildEmailSandboxEvidenceComment(emailResult) {
        if (!emailResult || typeof emailResult !== 'object') return null;
        const outputs = emailResult.outputs && typeof emailResult.outputs === 'object' ? emailResult.outputs : {};
        const redactedOutputs = {};
        for (const [key, value] of Object.entries(outputs)) {
            const sensitive = /(otp|token|secret|password|auth|session|cookie|key)/i.test(String(key || ''));
            redactedOutputs[key] = sensitive ? '[REDACTED]' : this.normalizeRuntimeValue(value);
        }

        return `__QAF_EVIDENCE__${JSON.stringify({
            type: 'email_sandbox',
            captured_at: new Date().toISOString(),
            action: emailResult.action || '',
            status: emailResult.status || '',
            run_reference: emailResult.run_reference || '',
            runtime_alias: emailResult.runtime_alias || '',
            snapshot_id: emailResult.snapshot_id || '',
            message_id: emailResult.message_id || '',
            output_keys: Object.keys(outputs),
            outputs: redactedOutputs,
            error: emailResult.error || '',
        })}`;
    }

    buildStepLogOverrides(step) {
        const keywordName = String(resolveStepKeyword(step) || '').toLowerCase();
        if (keywordName === 'apicall' && this.lastApiResult) {
            const comment = this.buildApiEvidenceComment(this.lastApiResult);
            return comment ? { comment } : null;
        }
        if (
            (
                keywordName === 'issuealias' ||
                keywordName === 'waitaliasemail' ||
                keywordName === 'emailsandboxissuealias' ||
                keywordName === 'emailissuealias' ||
                keywordName === 'emailsandboxwaitextract' ||
                keywordName === 'emailwaitextract'
            )
            && this.lastEmailSandboxResult
        ) {
            const comment = this.buildEmailSandboxEvidenceComment(this.lastEmailSandboxResult);
            return comment ? { comment } : null;
        }
        return null;
    }

    parseApiExpectedOutput(rawExpectedOutput) {
        const text = String(rawExpectedOutput || '').trim();
        if (!text) return [];
        return text
            .split('||')
            .map(part => part.trim())
            .filter(Boolean)
            .map((part) => {
                const idx = part.indexOf('=');
                if (idx === -1) {
                    return { key: 'body_contains', expected: part };
                }
                return {
                    key: part.slice(0, idx).trim(),
                    expected: part.slice(idx + 1).trim(),
                };
            });
    }

    parseApiExpectedValue(raw) {
        const trimmed = String(raw ?? '').trim();
        if (trimmed === '') return '';
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null') return null;
        if (!Number.isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
        try {
            return JSON.parse(trimmed);
        } catch (_) {
            return trimmed;
        }
    }

    getApiAssertionActualValue(apiResult, key) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return undefined;
        if (normalizedKey === 'status') return apiResult?.status;
        if (normalizedKey === 'statusText') return apiResult?.statusText;
        if (normalizedKey === 'ok') return apiResult?.ok;
        if (normalizedKey === 'body') return apiResult?.body ?? '';
        if (normalizedKey === 'url') return apiResult?.url ?? '';
        if (normalizedKey === 'raw') return apiResult?.raw ?? '';
        if (normalizedKey === 'soap_fault') return !!apiResult?.soapFault;
        if (normalizedKey === 'soap_fault_code') return apiResult?.soapFaultCode ?? '';
        if (normalizedKey === 'soap_fault_string') return apiResult?.soapFaultString ?? '';
        if (normalizedKey.startsWith('json.')) {
            const path = normalizedKey.slice(5).split('.').filter(Boolean);
            return path.reduce((acc, segment) => (acc == null ? undefined : acc[segment]), apiResult?.json);
        }
        if (normalizedKey.startsWith('header.') || normalizedKey.startsWith('headers.')) {
            const headerName = normalizedKey.replace(/^headers?\./, '').toLowerCase();
            const headers = apiResult?.headers || {};
            const match = Object.keys(headers).find((name) => name.toLowerCase() === headerName);
            return match ? headers[match] : undefined;
        }
        return undefined;
    }

    isLikelyXmlText(value) {
        const text = String(value || '').trim();
        return text.startsWith('<') && text.endsWith('>');
    }

    async evaluateXmlAssertion(apiResult, key, expectedRaw) {
        const xmlBody = String(apiResult?.body || '').trim();
        if (!this.isLikelyXmlText(xmlBody)) {
            return { pass: false, actual: '', message: 'Response body is not XML.' };
        }

        if (!(this.webDriver?.driver?.executeScript)) {
            return { pass: false, actual: '', message: 'XML assertion requires an active browser session.' };
        }

        const result = await this.webDriver.driver.executeScript(
            (xmlText, assertionKey, assertionValue) => {
                const parseXml = () => {
                    try {
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
                        const parserError = xmlDoc.querySelector('parsererror');
                        if (parserError) {
                            return { error: parserError.textContent || 'Invalid XML body.', document: null };
                        }
                        return { error: '', document: xmlDoc };
                    } catch (error) {
                        return { error: error?.message || 'Failed to parse XML body.', document: null };
                    }
                };

                const evaluateXPath = (xmlDoc, xpathExpression) => {
                    const expression = String(xpathExpression || '').trim();
                    if (!expression) return { error: 'XPath expression is empty.', nodes: [] };
                    try {
                        const resolver = prefix =>
                            xmlDoc.lookupNamespaceURI(prefix) ||
                            xmlDoc.documentElement?.getAttribute?.(`xmlns:${prefix}`) ||
                            null;
                        const evaluated = xmlDoc.evaluate(
                            expression,
                            xmlDoc,
                            resolver,
                            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                            null,
                        );
                        const nodes = [];
                        for (let index = 0; index < evaluated.snapshotLength; index += 1) {
                            nodes.push(evaluated.snapshotItem(index));
                        }
                        return { error: '', nodes };
                    } catch (error) {
                        return { error: error?.message || 'Invalid XPath expression.', nodes: [] };
                    }
                };

                const parsed = parseXml();
                if (!parsed.document) {
                    return { pass: false, actual: '', message: parsed.error || 'Unable to parse XML response body.' };
                }

                if (assertionKey === 'xml_exists') {
                    const lookup = evaluateXPath(parsed.document, assertionValue);
                    if (lookup.error) return { pass: false, actual: '', message: lookup.error };
                    return {
                        pass: lookup.nodes.length > 0,
                        actual: lookup.nodes.length,
                        message:
                            lookup.nodes.length > 0
                                ? `XPath matched ${lookup.nodes.length} node(s).`
                                : `XPath did not match any node: ${assertionValue}`,
                    };
                }

                if (assertionKey === 'xml_count') {
                    const [xpathExpression, expectedCountRaw] = String(assertionValue || '').split('|');
                    const lookup = evaluateXPath(parsed.document, xpathExpression);
                    if (lookup.error) return { pass: false, actual: '', message: lookup.error };
                    const expectedCount = Number(String(expectedCountRaw || '').trim());
                    if (!Number.isFinite(expectedCount)) {
                        return { pass: false, actual: lookup.nodes.length, message: 'xml_count requires format: xml_count=<xpath>|<number>' };
                    }
                    return {
                        pass: lookup.nodes.length === expectedCount,
                        actual: lookup.nodes.length,
                        message:
                            lookup.nodes.length === expectedCount
                                ? `XPath count matched ${expectedCount}.`
                                : `Expected ${expectedCount} node(s), found ${lookup.nodes.length}.`,
                    };
                }

                if (assertionKey === 'xml_value') {
                    const [xpathExpression, expectedTextRaw] = String(assertionValue || '').split('|');
                    const lookup = evaluateXPath(parsed.document, xpathExpression);
                    if (lookup.error) return { pass: false, actual: '', message: lookup.error };
                    if (lookup.nodes.length === 0) {
                        return { pass: false, actual: '', message: `XPath did not match any node: ${xpathExpression}` };
                    }
                    const actualText = String(lookup.nodes[0]?.textContent || '').trim();
                    const expectedText = String(expectedTextRaw || '').trim();
                    return {
                        pass: actualText === expectedText,
                        actual: actualText,
                        message:
                            actualText === expectedText
                                ? 'XPath text value matched.'
                                : `Expected XPath text "${expectedText}" but found "${actualText}".`,
                    };
                }

                return { pass: false, actual: '', message: `Unsupported XML assertion key "${assertionKey}".` };
            },
            xmlBody,
            key,
            expectedRaw,
        );

        return result || { pass: false, actual: '', message: 'Unknown XML assertion failure.' };
    }

    async assertApiResult(apiResult, rawExpectedOutput) {
        const clauses = this.parseApiExpectedOutput(rawExpectedOutput);
        if (clauses.length === 0) return;

        for (const clause of clauses) {
            const key = clause.key;
            const expected = clause.expected;

            if (key === 'body_contains') {
                const body = String(apiResult?.body ?? '');
                if (!body.includes(expected)) {
                    throw new Error(`apiCall assertion failed: expected body to contain "${expected}"`);
                }
                continue;
            }

            if (key === 'body_equals') {
                const body = String(apiResult?.body ?? '');
                if (body !== expected) {
                    throw new Error(`apiCall assertion failed: expected body to equal "${expected}" but found "${body}"`);
                }
                continue;
            }

            if (key === 'xml_exists' || key === 'xml_value' || key === 'xml_count') {
                const xmlResult = await this.evaluateXmlAssertion(apiResult, key, expected);
                if (!xmlResult.pass) {
                    throw new Error(`apiCall assertion failed: ${xmlResult.message}`);
                }
                continue;
            }

            const actual = this.getApiAssertionActualValue(apiResult, key);
            if (actual === undefined) {
                throw new Error(`apiCall assertion failed: unsupported assertion key "${key}"`);
            }

            const expectedTyped = this.parseApiExpectedValue(expected);
            if (actual !== expectedTyped) {
                throw new Error(`apiCall assertion failed: expected ${key}=${expected} but found ${this.normalizeRuntimeValue(actual)}`);
            }
        }
    }

    openReExecuteDecision(step) {
        this.pendingStepResolutionData = {
            step,
            promise: null,
            resolve: null,
        };
        this.pendingStepResolutionData.promise = new Promise((resolve) => {
            this.pendingStepResolutionData.resolve = resolve;
        });
        return this.pendingStepResolutionData.promise;
    }

    resolveReExecuteDecision(decision) {
        const pending = this.pendingStepResolutionData;
        if (!pending?.resolve) return false;
        const resolve = pending.resolve;
        this.pendingStepResolutionData = null;
        this.pendingStepResolution = null;
        resolve(decision);
        return true;
    }

    clearReExecuteModal() {
        try {
            this.mainWindow.webContents.send('openReExecuteDataModal', null);
        } catch (err) {
            console.log('[automation] failed to close re-execute modal', err?.message || err);
        }
    }

    setExecutionDelay(ms) {
        const value = Number(ms);
        this.executionDelayMs = Number.isFinite(value) && value >= 0 ? value : 0;
    }

    async maybeDelay() {
        if (this.executionDelayMs <= 0) return;
        await new Promise(resolve => setTimeout(resolve, this.executionDelayMs));
    }

    buildEffectiveRunSummary() {
        const runners = Array.isArray(this.testRunnerStepData) ? this.testRunnerStepData : [];
        let attempted = 0;
        let passed = 0;
        let failed = 0;

        for (const runner of runners) {
            const steps = Array.isArray(runner?.steps) ? runner.steps : [];
            for (const step of steps) {
                if (!step?.actual_step) {
                    continue;
                }
                if (step.execution === execution.EXECUTED) {
                    attempted += 1;
                    passed += 1;
                } else if (step.execution === execution.FAILED) {
                    attempted += 1;
                    failed += 1;
                }
            }
        }

        return {
            attempted,
            failed,
            passed,
            canceled: this.cancelRequested,
            interrupted: this.isPaused,
        };
    }

    async destoryDrivers() {
        if (this.webDriver?.driver) {
            try {
                await quitWithTimeout(this.webDriver.driver);
            } catch (error) {
                console.log('web driver quit failed (ignored)', error.message || error);
            } finally {
                removeActiveWebDriver(this.webDriver.driver);
                this.webDriver.driver = null;
            }
        }
        if (this.mobileDriver?.driver && this?.mobileDriver?.driver?.capabilities) {
            try {
                await this.mobileDriver.driver.deleteSession();
            } catch (error) {
                console.log('mobile driver quit failed (ignored)', error.message || error);
            } finally {
                this.mobileDriver.driver = null;
            }
        }
    }
    async destorySession() {
        await this.destoryDrivers();
        this.testRunnerStepDataOriginal = null;
        this.testRunnerStepData = null;
        this.testRunnerSteps = null;
        this.mainWindow = null;
        this.testRunner = null;
        this.token = null;
        this.currentRunner = 0;
        this.currentStep = 0;
        this.isPaused = false;
        this.selectedScreen = null;
        this.isReExecuteFlag = false;
        this.webDriver = null;
        this.mobileDriver = null;
        this.testRunnerData = null;
        this.isReExecuteFlag = false;
        this.isDraftRun = false;
        this.capturedData = null;
    }

    canPersistRunnerLogs() {
        return !!this.testRunnerData?.id && !this.isDraftRun;
    }

    markLastStep(testRunnerSteps) {
        return testRunnerSteps.map(runner => {
            runner.steps = runner.steps.map((step, i) => {
                if (i === runner.steps.length - 1) {
                    return { ...step, lastStep: true };
                }
                return step;
            });
            return runner;
        });
    }

    splitGroupedKeywords(testRunnerSteps) {
        return testRunnerSteps.map(runner => {
            runner.steps = runner.steps.reduce((prev, curr) => {
                const { keyword_combination_names } = curr.keyword;
                if (keyword_combination_names && keyword_combination_names !== '') {
                    const newGroup = keyword_combination_names
                        .split(',')
                        .map((keyword, i) => {
                            return {
                                after_step: curr.after_step,
                                before_step: curr.before_step,
                                description: curr.description,
                                expected_output: curr.expected_output,
                                keyword: { name: keyword },
                                value: curr.value.split('||')[i],
                                xPath: curr.xPath.split('||')[i],
                                dataset_id: curr.dataset_id,
                                ...(i === 0 && { id: curr.id }),
                                ...(i === 0 && { actual_step: true }),
                                ...(i === 0 && { execution: execution.NOT_EXECUTED }),
                                ...(i !== 0 && { parent: curr.id }),
                            };
                        });
                    return [...prev, ...newGroup];
                }
                return [...prev, curr];
            }, []);
            return runner;
        });
    }

    formatBeforeAfterSteps(testRunnerSteps) {
        let x = testRunnerSteps.map(runner => {
            runner.steps = runner.steps.map(step => {
                const helperUsesOwnLocator = (keywordName, rawValue) => {
                    const normalizedKeyword = String(keywordName || '').trim().toLowerCase();
                    const value = String(rawValue || '');
                    const entries = value
                        .split('>>')
                        .map(part => String(part || '').trim())
                        .filter(Boolean)
                        .map(part => {
                            const separatorIndex = part.indexOf('=');
                            return separatorIndex > 0
                                ? part.slice(0, separatorIndex).trim().toLowerCase()
                                : '';
                        });
                    const hasAnyKey = keys => keys.some(key => entries.includes(key));

                    if (normalizedKeyword === 'waitforelement' || normalizedKeyword === 'waitfortext') {
                        return hasAnyKey(['target', 'scope', 'xpath']);
                    }

                    if (normalizedKeyword === 'sendkey') {
                        return hasAnyKey(['locator']);
                    }

                    if (normalizedKeyword === 'switchtoiframe') {
                        return value.trim().length > 0;
                    }

                    return false;
                };
                const mapStep = (stepProperty, xPath, explicitTargetIndex) => {
                    if (stepProperty && stepProperty.length > 0) {
                        return stepProperty.map(sp => {
                            const [name, value] = Object.entries(sp)[0];
                            const mappedStep = { keyword: { name }, value, xPath };
                            if (
                                explicitTargetIndex !== undefined
                                && explicitTargetIndex !== null
                                && !helperUsesOwnLocator(name, value)
                            ) {
                                mappedStep.__explicitTargetIndex = explicitTargetIndex;
                            }
                            return mappedStep;
                        });
                    }
                    return stepProperty;
                };
                step.before_step = mapStep(step.before_step, step.xPath, step.__explicitTargetIndex);
                step.after_step = mapStep(step.after_step, step.xPath, step.__explicitTargetIndex);
                step.actual_step = true;
                step.execution = execution.NOT_EXECUTED;
                return step;
            });
            return runner;
        });
        this.mainWindow.webContents.send('testRunnerStepData', x);
        return x;
    }

    makeConfigStep(testRunnerSteps) {
        let x = testRunnerSteps.map(runner => {
            const suite = this.getSuite(runner);
            if (suite?.configuration) {
                const { configuration_variables } = suite?.configuration;
                const configSteps = [];
                const overrideStepValue = (keywordName, value) => {
                    const targets = runner.steps.filter(
                        step => step?.keyword?.name?.toLowerCase() === keywordName.toLowerCase(),
                    );
                    if (!targets.length) return false;
                    targets.forEach((step) => {
                        step.value = value;
                    });
                    return true;
                };
                const isBrowserVar = (name) =>
                    typeof name === 'string' && name.toLowerCase().includes('browser');
                const isMobileVar = (name) =>
                    typeof name === 'string' && name.toLowerCase().includes('mobile');
                configuration_variables.forEach(({ variable, value }) => {
                    const variableName = variable?.name ?? '';
                    if (isBrowserVar(variableName)) {
                        const browserValue = value?.name ?? value?.value ?? value;
                        if (overrideStepValue('launchBrowser', browserValue)) {
                            return;
                        }
                        const step = {
                            keyword: { name: 'launchBrowser' },
                            value: browserValue,
                            xPath: null,
                            actual_step: true,
                            execution: execution.NOT_EXECUTED,
                            description: 'Launch Browser',
                        };
                        configSteps.push(step);
                    }
                    if (isMobileVar(variableName)) {
                        const mobileValue = value?.name ?? value?.value ?? value;
                        if (overrideStepValue('launchMobile', mobileValue)) {
                            return;
                        }
                        const step = {
                            keyword: { name: 'launchMobile' },
                            value: mobileValue,
                            xPath: null,
                            actual_step: true,
                            execution: execution.NOT_EXECUTED,
                            description: 'Launch Mobile',
                        };
                        configSteps.push(step);
                    }
                });
                runner.steps.unshift(...configSteps);
                return runner;
            } else {
                return runner;
            }
        });
        return x;
    }

    getSuite(runner) {
        return runner?.test_suite ?? runner?.testSuite ?? null;
    }

    getSuiteId(runner) {
        const suite = this.getSuite(runner);
        return suite?.id ?? suite?.test_suite_id ?? suite?.testSuiteId ?? null;
    }
    shouldAbortForCancellation() {
        return this.cancelRequested === true;
    }

    ensureNotCanceled() {
        if (this.shouldAbortForCancellation()) {
            throw new Error('execution_canceled');
        }
    }
    async saveAndCloseSuite(runner) {
        const testPlanItemId = this.testPlanItemId;
        const suiteId = this.getSuiteId(runner);
        if (!testPlanItemId || !this.testRunnerData?.id || !suiteId) {
            console.log('[automation] save/close skipped (missing ids)');
            return;
        }
        try {
            await api.request({
                url: getSaveCloseUrl(),
                method: 'post',
                data: {
                    test_runner_id: this.testRunnerData.id,
                    test_suite_id: suiteId,
                    test_plan_item_id: testPlanItemId,
                },
                token: this.token,
                    runtimeConfig: getRuntimeConfig(),
            });
            console.log('[automation] save/close ok', suiteId);
        } catch (err) {
            const status = err?.response?.status ?? 'unknown';
            console.log('[automation] save/close failed', status);
        }
    }
    async runAutomation() {
        console.log(`[automation] starting runAutomation with ${this.testRunnerSteps?.length || 0} runner(s)`);
        this.emitProgress({ reason: 'run_started' }, false);
        try {
            await this.iterateSteps();
            const summary = this.buildEffectiveRunSummary();
            if (this.cancelRequested) {
                await this.finalizeCanceledExecution();
            } else if (!this.isPaused) {
                this.resetAutomationValues();
                console.log('[automation] completed all runners');
                this.emitProgress({ reason: 'run_completed', is_paused: false }, false);
            }
            return summary;
        } finally {
            if (!this.cancelRequested) {
                this.resolveCancelCompletion();
            }
        }
    }

    async iterateSteps() {
        for (let i = this.currentRunner; i < this.testRunnerSteps.length; i++) {
            console.log(`[automation] runner index ${i} start`);
            if (this.isPaused) {
                console.log('[automation] paused; breaking runner loop');
                break;
            }
            this.currentRunner = i;
            const startStepIndex = this.currentStep || 0;
            if (this.selectedScreen && this.canPersistRunnerLogs()) {
                const suiteId = this.getSuiteId(this.testRunnerSteps[this.currentRunner]);
                this.mainWindow.webContents.send('startScreenRecording', {
                    selectedScreen: this.selectedScreen,
                    testRunnerId: this.testRunnerData.id,
                    suiteId,
                    token: this.token,
                    runtimeConfig: getRuntimeConfig(),
                });
            }

            const runner = this.testRunnerSteps[i];
            this.loopState = null;
            const runnerPerf = this.perfStart('runner', {
                runnerIndex: i,
                stepCount: runner?.steps?.length || 0,
            });
            console.log('\n\n' + 'TEST CASE: ' + (this.currentRunner + 1));

            for (let j = startStepIndex; j < runner.steps.length; j++) {
                console.log(i, j);
                this.currentStep = j;
                this.emitProgress({ reason: 'step_started' }, false);
                const step = runner.steps[j];
                const stepPerf = this.perfStart('step', {
                    runnerIndex: i,
                    stepIndex: j,
                    ...this.formatPerfStep(step),
                });
                const isLastRunner = i === this.testRunnerSteps.length - 1;
                const isLastStepInRunner = j === runner.steps.length - 1;
                step.isLastStepInRunner = isLastStepInRunner;
                step.isLastTestCaseStep = isLastRunner && isLastStepInRunner;
                step.isLastRunner = isLastRunner;
                console.log(
                    'step : ' +
                        j +
                        '___Is_Actual____' +
                        (step.actual_step || false) +
                        '__ID___' +
                        step?.id +
                        '___' +
                        step?.description,
                );
                const keywordNameForLog = resolveStepKeyword(step) ?? 'undefined';
                console.log(
                    `[automation] executing step ${j} keyword=${keywordNameForLog} paused=${this.isPaused}`,
                );

                if (this.cancelRequested) {
                    console.log('[automation] cancel requested; breaking step loop');
                    break;
                }

                const loopDirective = this.getStepLoopDirective(step);
                if (loopDirective?.type === 'start') {
                    await this.initializeLoopIfNeeded({ directive: loopDirective, runner, stepIndex: j });
                }
                if (loopDirective?.type === 'end') {
                    const nextStepIndex = this.handleLoopEndIfNeeded({ directive: loopDirective, stepIndex: j });
                    if (step.actual_step || step.parent) {
                        step.execution = execution.EXECUTED;
                        this.mainWindow?.webContents?.send?.('testRunnerStepData', {
                            runner: this.testRunnerSteps,
                            currentRunner: this.currentRunner,
                        });
                    }
                    this.perfEnd(stepPerf, 'ok', {
                        loopAction: nextStepIndex <= j ? 'continue' : 'complete',
                    });
                    j = nextStepIndex - 1;
                    continue;
                }

                if (step.actual_step) {
                    step.execution = execution.EXECUTING;
                    this.mainWindow?.webContents?.send?.('testRunnerStepData', {
                        runner: this.testRunnerSteps,
                        currentRunner: this.currentRunner,
                    });
                }

                const previousVisibleOnlyLookup = this.webDriver?.getVisibleOnlyLookup?.() ?? false;
                let stepFailed = false;
                let stepFailureError = null;
                let afterLoopNextStepIndex = null;

                step.value = this.resolveRuntimeValue(step.value);
                this.normalizeExplicitIndexedStepValue(step);

                if (step.before_step && step.before_step.length > 0) {
                    const beforeSteps = step.before_step;
                    for (let beforeStepIndex = 0; beforeStepIndex < beforeSteps.length; beforeStepIndex++) {
                        const beforeStep = beforeSteps[beforeStepIndex];
                        beforeStep.isLastTestCaseStep = step.isLastTestCaseStep;
                        const beforePerf = this.perfStart('before_step', {
                            runnerIndex: i,
                            stepIndex: j,
                            beforeStepIndex,
                            ...this.formatPerfStep(beforeStep),
                        });
                        try {
                            const loopControlResult = await this.handleHelperLoopIfNeeded({
                                helperStep: beforeStep,
                                phase: 'before',
                                runner,
                                stepIndex: j,
                            });
                            if (loopControlResult) {
                                this.perfEnd(beforePerf, 'ok', { loopAction: loopControlResult.type });
                                continue;
                            }
                            await this.runStep({ ...beforeStep, highlight: false });
                            if (this.shouldAbortForCancellation()) {
                                console.log('[automation] cancel requested after before-step execution');
                                break;
                            }
                            this.perfEnd(beforePerf, 'ok');
                        } catch (error) {
                            console.log(error);
                            if (this.shouldAbortForCancellation()) {
                                console.log('[automation] cancel requested during before-step unwind');
                                break;
                            }
                            this.perfEnd(beforePerf, 'error', {
                                error: error?.message || String(error),
                            });
                        }
                    }
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested after before-step loop');
                        break;
                    }
                }

                try {
                    await this.runStep(step);
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested after main step execution');
                        break;
                    }
                    if (this.canPersistRunnerLogs()) {
                        const suiteId = this.getSuiteId(runner);
                        await stepLogCall({
                            runnerId: this.testRunnerData.id,
                            testSuiteId: suiteId,
                            stepId: step.id,
                            datasetId: step.dataset_id,
                            testRunnerSteps: this.testRunnerStepDataOriginal,
                            runnerIndex: this.currentRunner,
                            stepIndex: this.currentStep,
                            token: this.token,
                            stepOverrides: this.buildStepLogOverrides(step),
                            runtimeConfig: getRuntimeConfig(),
                        });
                        if (this.shouldAbortForCancellation()) {
                            console.log('[automation] cancel requested after step log save');
                            break;
                        }
                    }
                } catch (error) {
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested during step unwind');
                        break;
                    }
                    console.log('[automation] step error', error);
                    stepFailed = true;
                    stepFailureError = error;
                    if (step.parent) {
                        const parentStep = runner.steps.find(({ id }) => id === step.parent);
                        if (parentStep) {
                            parentStep.execution = execution.FAILED;
                        }
                    }
                    step.execution = execution.FAILED;
                    this.mainWindow?.webContents?.send?.('testRunnerStepData', {
                        runner: this.testRunnerSteps,
                        currentRunner: this.currentRunner,
                    });
                    if (this.canPersistRunnerLogs()) {
                        const suiteId = this.getSuiteId(runner);
                        try {
                            await stepLogCall({
                                runnerId: this.testRunnerData.id,
                                testSuiteId: suiteId,
                                stepId: step.id,
                                datasetId: step.dataset_id,
                                testRunnerSteps: this.testRunnerStepDataOriginal,
                                runnerIndex: this.currentRunner,
                                stepIndex: this.currentStep,
                                error,
                                token: this.token,
                                stepOverrides: this.buildStepLogOverrides(step),
                                runtimeConfig: getRuntimeConfig(),
                            });
                            if (this.shouldAbortForCancellation()) {
                                console.log('[automation] cancel requested after failed step log save');
                                break;
                            }
                        } catch (logErr) {
                            console.log('step fail log call failed', logErr);
                        }
                    }

                    if (this.isReExecuteFlag) {
                        if (this.onInterrupted) {
                            try {
                                await this.onInterrupted('paused_by_user');
                            } catch (interruptErr) {
                                console.log('[automation] interrupted callback failed', interruptErr?.message || interruptErr);
                            }
                        }
                        this.isPaused = true;
                        this.mainWindow?.webContents?.send?.('openReExecuteDataModal', {
                            step,
                            runnerIndex: this.currentRunner,
                            stepIndex: this.currentStep,
                        });
                        this.emitProgress({ reason: 'paused' }, true);
                        const decision = await this.openReExecuteDecision(step);
                        this.isPaused = false;
                        this.emitProgress({ reason: 'resumed', is_paused: false }, false);
                        if (decision?.action === 'reexecute') {
                            this.webDriver?.setVisibleOnlyLookup?.(previousVisibleOnlyLookup);
                            await this.resetBrowserContextToDefault('reexecute_step');
                            if (step.parent) {
                                const parentStep = runner.steps.find(({ id }) => id === step.parent);
                                if (parentStep) parentStep.execution = execution.NOT_EXECUTED;
                            }
                            step.execution = execution.NOT_EXECUTED;
                            this.mainWindow?.webContents?.send?.('testRunnerStepData', {
                                runner: this.testRunnerStepData,
                                currentRunner: this.currentRunner,
                            });
                            j -= 1;
                            continue;
                        }
                        if (decision?.action === 'pass') {
                            await this.resetBrowserContextToDefault('manual_pass_recovery');
                            stepFailed = false;
                        }
                    }

                    this.emitProgress({ reason: 'step_failed', error: stepFailureError?.message || null }, true);
                    this.perfEnd(stepPerf, 'error', {
                        error: stepFailureError?.message || 'step_failed',
                    });
                }

                if (step.after_step && step.after_step.length > 0) {
                    const afterSteps = step.after_step;
                    for (let afterStepIndex = 0; afterStepIndex < afterSteps.length; afterStepIndex++) {
                        const afterStep = afterSteps[afterStepIndex];
                        try {
                            const loopControlResult = await this.handleHelperLoopIfNeeded({
                                helperStep: afterStep,
                                phase: 'after',
                                runner,
                                stepIndex: j,
                            });
                            if (loopControlResult) {
                                afterLoopNextStepIndex = loopControlResult.nextStepIndex;
                                continue;
                            }
                            await this.runStep({ ...afterStep, highlight: false });
                            if (this.shouldAbortForCancellation()) {
                                console.log('[automation] cancel requested after after-step execution');
                                break;
                            }
                        } catch (error) {
                            console.log(error);
                            if (this.shouldAbortForCancellation()) {
                                console.log('[automation] cancel requested during after-step unwind');
                                break;
                            }
                        }
                    }
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested after after-step loop');
                        break;
                    }
                }
                this.webDriver?.setVisibleOnlyLookup?.(previousVisibleOnlyLookup);

                if (!stepFailed && this.isContextSwitchStep(step)) {
                    await this.resetBrowserContextToDefault('post_context_step');
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested after context reset');
                        break;
                    }
                }

                if (step.actual_step || step.parent) {
                    this.runStepStats.attempted += 1;
                }

                // teardown only after the final step of the final test case
                const shouldTeardownDrivers =
                    !this.isPaused &&
                    step.actual_step &&
                    // tear down at the end of every test case (runner), not just the final one
                    (step.isLastStepInRunner || step.isLastTestCaseStep || (step.lastStep && isLastRunner));
                if (shouldTeardownDrivers) {
                    try {
                        await this.destoryDrivers();
                    } catch (err) {
                        console.log('driver cleanup failed', err);
                    }
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested after driver teardown');
                        break;
                    }
                    this.mainWindow?.webContents?.send?.('stopScreenRecording');
                }

                if ((step.actual_step || step.parent) && !stepFailed) {
                    if (this.shouldAbortForCancellation()) {
                        console.log('[automation] cancel requested before step completion UI update');
                        break;
                    }
                    if (step.parent) {
                        runner.steps.find(({ id }) => id === step.parent).execution = execution.EXECUTED;
                    }
                    step.execution = execution.EXECUTED;
                    this.mainWindow?.webContents?.send?.('testRunnerStepData', {
                        runner: this.testRunnerSteps,
                        currentRunner: this.currentRunner,
                    });
                }
                if (!stepFailed) {
                    this.perfEnd(stepPerf, 'ok');
                }
                if (Number.isFinite(afterLoopNextStepIndex)) {
                    j = afterLoopNextStepIndex - 1;
                    continue;
                }
                if (this.isPaused) {
                    this.emitProgress({ reason: 'run_interrupted' }, true);
                    break;
                }
            }

            // Fallback stop recording when the runner ends
            try {
                this.mainWindow?.webContents?.send?.('stopScreenRecording');
            } catch (err) {
                console.log('failed to stop recording', err);
            }
            console.log(`[automation] runner index ${i} end`);
            if (!this.isPaused && !this.cancelRequested) {


                await this.saveAndCloseSuite(runner);


            }
            // reset step index for next runner unless we paused mid-run
            if (!this.isPaused) {
                this.currentStep = 0;
                this.loopState = null;
            }
            this.emitProgress({ reason: this.isPaused ? 'paused' : 'runner_completed' }, this.isPaused);
            this.perfEnd(runnerPerf, this.isPaused ? 'paused' : 'ok', {
                runnerIndex: i,
            });

            if (this.cancelRequested) {
                console.log('[automation] cancel requested; breaking runner loop');
                break;
            }
        }
    }

    async runStep(step) {
        const stepCallPerf = this.perfStart('runStep', this.formatPerfStep(step));
        await this.maybeDelay();
        const keywordNameRaw = resolveStepKeyword(step);
        console.log(`[automation] runStep keyword=${keywordNameRaw}`);
        // ensure recorder is not intercepting clicks during normal execution
        if (this.webDriver?.recorderActive && this.webDriver?.stopXPathRecorder) {
            try {
                await this.webDriver.stopXPathRecorder();
            } catch (err) {
                console.log('runStep recorder cleanup failed (ignored)', err?.message || err);
            }
        }
        if (!keywordNameRaw) {
            console.log('[automation] missing keyword for step', step);
            this.perfEnd(stepCallPerf, 'error', { error: 'Step keyword is missing.' });
            throw new Error('Step keyword is missing.');
        }
        const keywordName = String(keywordNameRaw).toLowerCase();
        const keywordMethod = String(keywordNameRaw);
        this.lastApiResult = null;
        const resolvedStepValue = this.resolveRuntimeValue(step.value);
        step.value = resolvedStepValue;
        this.normalizeExplicitIndexedStepValue(step);
        const policy = sessionPolicy.resolveKeywordSessionPolicy(keywordName, step.value);
        try {
            const sessionDecision = await sessionPolicy.enforceKeywordSessionPolicy(this, keywordNameRaw, keywordName, policy);
            if (sessionDecision?.skip) {
                this.perfEnd(stepCallPerf, 'skip', { reason: sessionDecision.reason });
                return;
            }
        } catch (error) {
            this.perfEnd(stepCallPerf, 'error', {
                error: 'WebDriver session is not active.',
            });
            throw error;
        }
        console.log(keywordName.bgGreen);
        step.xPath = this.resolveRuntimeValue(step.xPath);
        step.expected_output = this.resolveRuntimeValue(step.expected_output);
        step.before_step = this.resolveRuntimeValue(step.before_step);
        step.after_step = this.resolveRuntimeValue(step.after_step);

        try {
            await keywordHandlers.executeKeywordStep(this, keywordNameRaw, keywordName, keywordMethod, step);
            this.perfEnd(stepCallPerf, 'ok');
        } catch (error) {
            this.perfEnd(stepCallPerf, 'error', {
                error: error?.message || String(error),
            });
            throw error;
        }
    }

    resetAutomationValues() {
        this.currentStep = 0;
        this.currentRunner = 0;
        this.isPaused = false;
        this.cancelRequested = false;
        this.pendingStepResolution = null;
        this.pendingStepResolutionData = null;
        this.testRunnerStepData = null;
        this.mainWindow?.webContents?.send?.('testRunnerStepData', []);
        this.capturedData = null;
        this.runtimeVariables = {};
        this.lastApiResult = null;
        this.loopState = null;
        this.emitProgress({ reason: 'reset', is_paused: false }, false);
    }

    resolveCancelCompletion() {
        const resolve = this.cancelCompletionResolve;
        this.cancelCompletionPromise = null;
        this.cancelCompletionResolve = null;
        if (typeof resolve === 'function') {
            resolve();
        }
    }

    async finalizeCanceledExecution() {
        try {
            this.clearReExecuteModal();
        } catch (_) {}
        try {
            this.mainWindow?.webContents?.send('stopScreenRecording');
        } catch (_) {}
        try {
            await this.destoryDrivers();
        } catch (err) {
            console.log('cancel driver cleanup failed', err?.message || err);
        }
        this.resetAutomationValues();
        this.testRunnerStepDataOriginal = null;
        this.testRunnerSteps = null;
        this.testRunner = null;
        this.testRunnerData = null;
        this.token = null;
        this.capturedData = null;
        this.loopState = null;
        this.runtimeVariables = {};
        this.lastEmailSandboxResult = null;
        this.emitProgress({ reason: 'canceled', is_paused: false }, false);
        this.resolveCancelCompletion();
    }

    async requestCancelAndReset(options = {}) {
        if (!Array.isArray(this.testRunnerSteps) || this.testRunnerSteps.length === 0) {
            return false;
        }
        if (!this.cancelCompletionPromise) {
            this.cancelCompletionPromise = new Promise((resolve) => {
                this.cancelCompletionResolve = resolve;
            });
        }
        this.cancelRequested = true;
        this.isPaused = true;
        this.clearReExecuteModal();
        this.emitProgress({ reason: 'run_interrupted', is_paused: true }, true);

        if (options?.immediate) {
            try {
                this.mainWindow?.webContents?.send('stopScreenRecording');
            } catch (_) {}
            try {
                await this.destoryDrivers();
            } catch (err) {
                console.log('immediate cancel driver cleanup failed', err?.message || err);
            }
        }

        const waitMs = Number(options?.waitMs || 0);
        if (waitMs > 0) {
            await Promise.race([
                this.cancelCompletionPromise,
                new Promise((resolve) => setTimeout(resolve, waitMs)),
            ]);
            return true;
        }

        await this.cancelCompletionPromise;
        return true;
    }

    pauseExecution() {
        if (this.isPaused) return;
        console.log(
            'paused at: \ntest case: ' +
                this.currentRunner +
                '\nstep number: ' +
                this.currentStep,
        );
        this.currentStep++;
        this.isPaused = true;
        console.log(this.isPaused);
        this.emitProgress({ reason: 'paused' }, true);
    }
    resumeExecution() {
        console.log('in resume', this.isPaused);
        if (!this.isPaused) return;
        console.log(
            'resume from: \ntest case: ' +
                this.currentRunner +
                '\nstep number: ' +
                this.currentStep,
        );
        this.isPaused = false;
        this.emitProgress({ reason: 'resumed', is_paused: false }, false);
        this.runAutomation();
    }

    reExecuteStep() {
        if (!this.isPaused) return;
        this.isPaused = false;
        this.clearReExecuteModal();
        this.emitProgress({ reason: 'resumed', is_paused: false }, false);
        this.resolveReExecuteDecision({ action: 'reexecute' });
    }

    dataToReExecuteStep({ xPath, keyword, value }) {
        const currentStepObj = this.testRunnerStepData[this.currentRunner].steps[this.currentStep];
        const { parent } = currentStepObj;
        const updateStep = (step, idx) => {
            if (xPath) {
                const parts = xPath.split('||');
                step.xPath = parts[idx] || parts[0];
            }
            if (keyword) {
                if (step.keyword && typeof step.keyword === 'object') {
                    step.keyword.name = keyword;
                } else {
                    step.keyword = keyword;
                }
            }
            if (typeof value === 'string') {
                step.value = value;
            }
        };

        if (parent) {
            this.testRunnerStepData[this.currentRunner].steps
                .filter(step => step.id === parent || step.parent === parent)
                .forEach((step, i) => updateStep(step, i));
        } else {
            updateStep(currentStepObj, 0);
        }
        this.mainWindow.webContents.send('testRunnerStepData', {
            runner: this.testRunnerStepData,
            currentRunner: this.currentRunner,
        });
    }

    async markStepAsPass() {
        if (this.webDriver && !(await this.webDriver.hasValidSession?.())) {
            console.log('markStepAsPass aborted: no valid WebDriver session');
        }
        const wasPaused = this.isPaused;
        const runner = this.testRunnerStepData?.[this.currentRunner];
        const step = runner?.steps?.[this.currentStep];
        if (!runner || !step) return;

        const runtimeFlag = (getRuntimeConfig()?.enableMockUiFallback === true) || (getRuntimeConfig()?.enableMockUiFallback === 'true');
        const envFlag = (process.env.ENABLE_MOCK_UI_FALLBACK === 'true');
        const allowFallback = runtimeFlag || envFlag;
        const stepsForLog = allowFallback ? this.testRunnerStepData : this.testRunnerStepDataOriginal;

        const stepIdForLog = step.id ?? step.parent;
        const datasetIdForLog = step.dataset_id ?? runner?.steps?.find(({ id }) => id === step.parent)?.dataset_id;
        const shouldLog = !!stepIdForLog || (allowFallback && this.currentStep !== null && this.currentStep !== undefined);
        if (shouldLog && this.canPersistRunnerLogs()) {
            try {
                await stepLogCall({
                    runnerId: this.testRunnerData?.id,
                    testSuiteId: this.getSuiteId(runner),
                    stepId: stepIdForLog,
                    datasetId: datasetIdForLog,
                    testRunnerSteps: stepsForLog,
                    runnerIndex: this.currentRunner,
                    stepIndex: this.currentStep,
                    token: this.token,
                    stepOverrides: this.buildStepLogOverrides(step),
                    runtimeConfig: getRuntimeConfig(),
                });
            } catch (err) {
                console.log('step pass log call failed', err);
            }
        }

        if (step.parent) {
            const parentStep = runner.steps.find(({ id }) => id === step.parent);
            if (parentStep) parentStep.execution = execution.EXECUTED;
        }
        step.execution = execution.EXECUTED;
        this.mainWindow.webContents.send('testRunnerStepData', {
            runner: this.testRunnerStepData,
            currentRunner: this.currentRunner,
        });
        this.clearReExecuteModal();
        this.emitProgress({ reason: 'marked_pass' }, true);
        if (wasPaused) {
            this.isPaused = false;
            this.resolveReExecuteDecision({ action: 'pass' });
        }
    }

    async markStepAsFail() {
        const wasPaused = this.isPaused;
        const runner = this.testRunnerStepData?.[this.currentRunner];
        const step = runner?.steps?.[this.currentStep];
        if (!runner || !step) return;

        if (this.canPersistRunnerLogs()) {
            try {
                await stepLogCall({
                    runnerId: this.testRunnerData?.id,
                    testSuiteId: this.getSuiteId(runner),
                    stepId: step.id ?? step.parent,
                    datasetId: step.dataset_id ?? runner?.steps?.find(({ id }) => id === step.parent)?.dataset_id,
                    testRunnerSteps: this.testRunnerStepDataOriginal,
                    runnerIndex: this.currentRunner,
                    stepIndex: this.currentStep,
                    error: new Error('Marked as failed by user'),
                    token: this.token,
                    stepOverrides: this.buildStepLogOverrides(step),
                    runtimeConfig: getRuntimeConfig(),
                });
            } catch (err) {
                console.log('step fail log call failed', err);
            }
        }

        if (step.parent) {
            const parentStep = runner.steps.find(({ id }) => id === step.parent);
            if (parentStep) parentStep.execution = execution.FAILED;
        }
        step.execution = execution.FAILED;
        this.mainWindow.webContents.send('testRunnerStepData', {
            runner: this.testRunnerStepData,
            currentRunner: this.currentRunner,
        });
        this.clearReExecuteModal();
        this.emitProgress({ reason: 'marked_fail' }, true);

        if (wasPaused) {
            this.isPaused = false;
            this.resolveReExecuteDecision({ action: 'fail' });
        }
    }
}

module.exports = {
    FastTrackAutomation,
};













