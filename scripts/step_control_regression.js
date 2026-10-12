const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'src/ui/automation/index.js'), 'utf8');
const onprem = source.includes('class QafOnPremAutomation');
const helpers = require(path.join(root, 'src/ui/automation/helperDispatch'));
const moduleObject = { exports: {} };
const events = [];
let logStep = async () => {};
const dependencies = {
    '../../utils/stepLog': { stepLogCall: (...args) => logStep(...args) },
    '../../utils/stepStatusReporter': {
        StepStatusReporter: class {
            async flushAll() {}
            enqueue() {}
            async flushImmediate() {}
        },
    },
    '../../utils/api': { api: {} },
    '../../utils/endpoint': { getSaveCloseUrl: () => '' },
    '../../utils/runtimeConfig': { getRuntimeConfig: () => ({}) },
    './webActions': {
        WebActions: class {
            getFramePathSnapshot() { return []; }
            getVisibleOnlyLookup() { return false; }
            setVisibleOnlyLookup() {}
            async resetFrameContextIfNeeded() {}
        },
        removeActiveWebDriver: () => {},
        quitWithTimeout: async () => {},
    },
    './mobileActionsRouter': { MobileActionsRouter: class {} },
    './mobileSession': {},
    './runtimeVariables': {},
    './sessionPolicy': {},
    './keywordHandlers': {},
    './helperDispatch': {
        ...helpers,
        runBeforeHelper: async (context, main, helper) => helper.value !== 'absent',
    },
};
vm.runInNewContext(source, {
    require: name => {
        assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency ' + name);
        return dependencies[name];
    },
    module: moduleObject,
    console: { log() {} },
    process: { env: {} },
    structuredClone, setTimeout, clearTimeout,
}, { filename: path.join(root, 'src/ui/automation/index.js') });
const Automation = moduleObject.exports.FastTrackAutomation || moduleObject.exports.QafOnPremAutomation;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const until = async (predicate, label) => {
    for (let attempt = 0; attempt < 300; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('Timed out: ' + label);
};
const step = (id, extra = {}) => ({
    id, keyword: { name: 'click' }, value: '', xPath: '//button', ...extra,
});
function fixture(steps, extraRunners = []) {
    const calls = [];
    const modes = [];
    const saved = [];
    const automation = new Automation({
        testRunnerStepDataOriginal: [
            { id: 10, test_suite: { id: 10 }, steps }, ...extraRunners,
        ],
        testRunner: {},
        mainWindow: { webContents: { send: (name, data) => {
            events.push({ name, data });
            if (name === 'executionControlState') modes.push(data.mode);
        } } },
        token: '', isReExecuteFlag: false,
    });
    automation.resolveRuntimeValue = value => value;
    automation.saveAndCloseSuite = async runner => { saved.push(runner.id); };
    automation.runStep = async current => { calls.push(current.id ?? current.keyword.name); };
    return { automation, calls, modes, saved };
}
async function pauseAtFirst(current) {
    const gate = deferred();
    const original = current.automation.runStep;
    current.automation.runStep = async action => {
        await original(action);
        if (action.id === 1) await gate.promise;
    };
    const running = current.automation.runAutomation();
    let settled = false;
    running.then(() => { settled = true; }, () => { settled = true; });
    running.catch(error => { if (error.code !== 'RUN_CANCELED') throw error; });
    await until(() => current.calls.includes(1), 'first step starts');
    assert.equal(current.automation.pauseExecution(), true);
    assert.equal(current.automation.currentStep, 0);
    assert.equal(current.automation.resumeExecution(true), false);
    gate.resolve();
    await until(() => current.automation.pauseReady, 'manual pause settles');
    assert.equal(current.automation.currentStep, 1);
    assert.equal(settled, false, 'A paused run must stay active for Stop and run status');
    return { running };
}
async function complete(current) {
    assert.equal(current.automation.resumeExecution(), true);
    await until(() => !current.automation.testRunnerStepData, 'run completes');
    assert.equal(current.modes.at(-1), 'idle');
}
async function checks() {
    for (const enabled of [false, true]) {
        const current = fixture([step(1)]);
        const reportGate = deferred();
        const eventStart = events.length;
        current.automation.isReExecuteFlag = enabled;
        current.automation.testRunnerData = { id: 1 };
        current.automation.isDraftRun = false;
        current.automation.runStep = async () => { throw new Error('Invalid browser value'); };
        const originalLog = logStep;
        let reporting = false;
        logStep = async () => {
            reporting = true;
            await reportGate.promise;
        };
        const running = current.automation.runAutomation();
        await until(() => reporting, 'failed step reporting starts');
        const popup = events.slice(eventStart).find(event => event.name === 'openReExecuteDataModal' && event.data);
        assert.equal(Boolean(popup), enabled, 'Popup must follow the checkbox before reporting finishes');
        if (enabled) {
            assert.equal(current.automation.resolveReExecuteDecision({ action: 'fail' }), true,
                'Decision listener must be registered before showing the popup');
        }
        reportGate.resolve();
        await running;
        logStep = originalLog;
    }
    {
        const current = fixture([step(1), step(2), step(3)]);
        await current.automation.runAutomation();
        assert.deepEqual(current.calls, [1, 2, 3]);
        assert.deepEqual(current.saved, [10]);
    }
    {
        const current = fixture([step(1), step(2, { before_step: [{ before: '' }], after_step: [{ after: '' }] }), step(3)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'ready before single step');
        const afterGate = deferred();
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.keyword.name === 'after') await afterGate.promise;
        };
        assert.equal(current.automation.resumeExecution(true), true);
        assert.equal(current.automation.resumeExecution(true), false);
        await until(() => current.calls.includes('after'), 'after helper starts');
        assert.equal(current.automation.pauseReady, false);
        assert.deepEqual(current.calls, [1, 'before', 2, 'after']);
        afterGate.resolve();
        await until(() => current.automation.pauseReady, 'single step settles');
        assert.deepEqual(current.calls, [1, 'before', 2, 'after']);
        assert.equal(current.automation.currentStep, 2);
        await complete(current);
        assert.deepEqual(current.calls, [1, 'before', 2, 'after', 3]);
    }
    {
        const current = fixture([step(1), step(2), step(3), step(4)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'ready to test resume overlap');
        const gate = deferred();
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.id === 2) await gate.promise;
        };
        current.automation.resumeExecution(true);
        await until(() => current.calls.includes(2), 'single step starts');
        assert.equal(current.automation.resumeExecution(), true);
        assert.equal(current.automation.resumeExecution(), false);
        assert.deepEqual(current.calls, [1, 2]);
        gate.resolve();
        await until(() => !current.automation.testRunnerStepData, 'resume completes');
        assert.deepEqual(current.calls, [1, 2, 3, 4]);
    }
    {
        const current = fixture([step(1), step(2)]);
        const gate = deferred();
        current.automation.runStep = async action => {
            current.calls.push(action.id);
            if (action.id === 1) await gate.promise;
        };
        const running = current.automation.runAutomation();
        await until(() => current.calls.length === 1, 'rapid pause/resume starts');
        current.automation.pauseExecution();
        current.automation.resumeExecution();
        assert.deepEqual(current.calls, [1]);
        gate.resolve();
        await running;
        assert.deepEqual(current.calls, [1, 2]);
    }
    {
        const current = fixture([step(1), step(2)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'final step ready');
        current.automation.resumeExecution(true);
        await until(() => !current.automation.testRunnerStepData, 'final single step completes');
        assert.deepEqual(current.calls, [1, 2]);
        assert.deepEqual(current.saved, [10]);
        assert.equal(current.automation.pauseReady, false);
    }
    {
        const current = fixture([step(1), step(2)], [{ id: 20, test_suite: { id: 20 }, steps: [step(3), step(4)] }]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'suite boundary ready');
        current.automation.resumeExecution(true);
        await until(() => current.automation.pauseReady, 'pause at next suite');
        assert.deepEqual(current.calls, [1, 2]);
        assert.deepEqual(current.saved, [10]);
        assert.equal(current.automation.currentRunner, 1);
        assert.equal(current.automation.currentStep, 0);
        current.automation.resumeExecution(true);
        await until(() => current.automation.pauseReady, 'next suite one step');
        assert.deepEqual(current.calls, [1, 2, 3]);
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 3, 4]);
        assert.deepEqual(current.saved, [10, 20]);
    }
    {
        const current = fixture([step(1), step(2, { before_step: [{ ifExist: 'absent' }] }), step(3)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'ifExist ready');
        current.automation.resumeExecution(true);
        await until(() => current.automation.pauseReady, 'ifExist skip pauses');
        assert.deepEqual(current.calls, [1]);
        const skipped = current.automation.testRunnerSteps[0].steps[1];
        assert.equal(skipped.execution, 2);
        assert.equal(skipped.comment, helpers.IF_EXIST_COMMENT);
        await complete(current);
        assert.deepEqual(current.calls, [1, 3]);
    }
    {
        const current = fixture([
            step(1),
            step(2, { before_step: [{ Loop: 'Start-2' }] }),
            step(3, { after_step: [{ Loop: 'End' }] }),
            step(4),
        ]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'loop ready');
        for (const expected of [[1, 2], [1, 2, 3], [1, 2, 3, 2], [1, 2, 3, 2, 3]]) {
            assert.equal(current.automation.resumeExecution(true), true);
            await until(() => current.automation.pauseReady, 'loop iteration pauses');
            assert.deepEqual(current.calls, expected);
        }
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 3, 2, 3, 4]);
    }
    {
        const current = fixture([step(1), step(2, {
            keyword: { name: 'group', keyword_combination_names: 'click,click' },
            value: 'one||two', xPath: '//one||//two',
        }), step(3)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'group ready');
        current.automation.resumeExecution(true);
        await until(() => current.automation.pauseReady, 'group settles');
        assert.deepEqual(current.calls, [1, 2, 'click']);
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 'click', 3]);
    }
    {
        const current = fixture([step(1), step(2), step(3)]);
        current.automation.isReExecuteFlag = true;
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'failure ready');
        let fail = true;
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.id === 2 && fail) throw new Error('expected failure');
        };
        current.automation.resumeExecution(true);
        await until(() => current.automation.pendingStepResolutionData || current.automation.recoveryActionResolver, 'failure decision');
        assert.equal(current.automation.resumeExecution(), false);
        assert.equal(current.automation.resumeExecution(true), false);
        fail = false;
        current.automation.reExecuteStep();
        await until(() => current.automation.pauseReady, 'retry settles');
        assert.deepEqual(current.calls, [1, 2, 2]);
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 2, 3]);
    }
    {
        const current = fixture([step(1), step(2), step(3)]);
        await pauseAtFirst(current);
        await until(() => current.automation.pauseReady, 'cancel ready');
        const gate = deferred();
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.id === 2) await gate.promise;
        };
        current.automation.resumeExecution(true);
        await until(() => current.calls.includes(2), 'cancel single step starts');
        const cancellation = onprem
            ? current.automation.requestCancel('test stop')
            : current.automation.requestCancelAndReset();
        assert.equal(current.automation.resumeExecution(), false);
        assert.equal(current.automation.resumeExecution(true), false);
        gate.resolve();
        await cancellation;
        await until(() => !current.automation.executionLoopActive, 'cancel unwinds');
        assert.deepEqual(current.calls, [1, 2]);
        assert.equal(current.modes.at(-1), 'idle');
    }
    {
        const current = fixture([step(1), step(2)]);
        const { running } = await pauseAtFirst(current);
        const result = running.catch(error => error);
        if (onprem) current.automation.requestCancel('paused stop');
        else await current.automation.requestCancelAndReset();
        await result;
        assert.deepEqual(current.calls, [1]);
        assert.equal(current.automation.resumeExecution(), false);
        assert.equal(current.automation.resumeExecution(true), false);
        assert.equal(current.modes.at(-1), 'idle');
    }
    {
        const current = fixture([step(1), step(2, { before_step: [{ brokenHelper: '' }] }), step(3)]);
        await pauseAtFirst(current);
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.keyword.name === 'brokenHelper') throw new Error('helper failure');
        };
        current.automation.resumeExecution(true);
        await until(() => current.automation.pauseReady, 'helper failure still finishes one main step');
        assert.deepEqual(current.calls, [1, 'brokenHelper', 2]);
        await complete(current);
    }
    for (const resolution of ['markStepAsPass', 'markStepAsFail']) {
        const current = fixture([step(1), step(2), step(3)]);
        current.automation.isReExecuteFlag = true;
        await pauseAtFirst(current);
        const original = current.automation.runStep;
        current.automation.runStep = async action => {
            await original(action);
            if (action.id === 2) throw new Error('decision test');
        };
        current.automation.resumeExecution(true);
        await until(() => current.automation.pendingStepResolutionData || current.automation.recoveryActionResolver, 'manual resolution prompt');
        await current.automation[resolution]();
        await until(() => current.automation.pauseReady, 'manual resolution pauses after one step');
        assert.deepEqual(current.calls, [1, 2]);
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 3]);
    }
    if (onprem) {
        const current = fixture([step(1), step(2)]);
        const actionGate = deferred();
        const flushGate = deferred();
        let flushing = false;
        current.automation.runStep = async action => {
            current.calls.push(action.id);
            if (action.id === 1) await actionGate.promise;
        };
        current.automation.stepStatusReporter.flushAll = async ({ timeoutMs }) => {
            if (timeoutMs === 5000 && current.automation.isPaused) {
                flushing = true;
                await flushGate.promise;
            }
        };
        const running = current.automation.runAutomation();
        await until(() => current.calls.length === 1, 'flush race starts');
        current.automation.pauseExecution();
        actionGate.resolve();
        await until(() => flushing, 'paused reporting flush');
        assert.equal(current.automation.resumeExecution(true), false);
        assert.equal(current.automation.resumeExecution(), true);
        flushGate.resolve();
        await running;
        assert.deepEqual(current.calls, [1, 2]);
    }
    {
        const current = fixture([step(1, {
            keyword: { name: 'group', keyword_combination_names: 'click,click' },
            value: 'one||two', xPath: '//one||//two',
        }), step(2)]);
        const gate = deferred();
        current.automation.runStep = async action => {
            current.calls.push(action.id ?? action.keyword.name);
            if (action.id === 1) await gate.promise;
        };
        const running = current.automation.runAutomation();
        await until(() => current.calls.includes(1), 'group pause begins');
        current.automation.pauseExecution();
        gate.resolve();
        await until(() => current.automation.pauseReady, 'group pause settles');
        assert.deepEqual(current.calls, [1, 'click']);
        assert.equal(current.automation.currentStep, 2);
        await complete(current);
        await running;
        assert.deepEqual(current.calls, [1, 'click', 2]);
    }
    for (const moreRunners of [false, true]) {
        const current = fixture([step(1)], moreRunners
            ? [{ id: 20, test_suite: { id: 20 }, steps: [step(2)] }]
            : []);
        const gate = deferred();
        current.automation.saveAndCloseSuite = async runner => {
            current.saved.push(runner.id);
            if (runner.id === 10) await gate.promise;
        };
        const running = current.automation.runAutomation();
        await until(() => current.saved.includes(10), 'suite save begins');
        current.automation.pauseExecution();
        gate.resolve();
        if (moreRunners) {
            await until(() => current.automation.pauseReady, 'suite save pause settles');
            assert.equal(current.automation.currentRunner, 1);
            assert.equal(current.automation.currentStep, 0);
            await complete(current);
        }
        await running;
        assert.deepEqual(current.calls, moreRunners ? [1, 2] : [1]);
        assert.equal(current.modes.at(-1), 'idle');
    }
    {
        const current = fixture([
            step(1), step(2, { Loop: 'Start-2' }),
            step(3), step(4, { Loop: 'End' }), step(5),
        ]);
        await pauseAtFirst(current);
        for (const expected of [[1, 2], [1, 2, 3], [1, 2, 3], [1, 2, 3, 2], [1, 2, 3, 2, 3], [1, 2, 3, 2, 3]]) {
            current.automation.resumeExecution(true);
            await until(() => current.automation.pauseReady, 'standalone loop control pauses');
            assert.deepEqual(current.calls, expected);
        }
        await complete(current);
        assert.deepEqual(current.calls, [1, 2, 3, 2, 3, 5]);
    }
}
function rendererChecks() {
    const home = fs.readFileSync(path.join(root, 'src/ui/home.js'), 'utf8');
    const listeners = {};
    const element = name => ({
        disabled: true,
        classList: { toggle: (className, hidden) => { listeners[name + ':' + className] = hidden; } },
        addEventListener: (event, callback) => { listeners[name] = callback; },
    });
    let nextCalls = 0;
    const sandbox = {
        pauseBtn: element('pause'), stopExecutionBtn: element('stop'), resumeBtn: element('resume'),
        nextStepBtn: element('next'), clearAutomationActionStrip: () => {},
        express: {
            executionControlState: callback => { listeners.control = callback; },
            nextStepExecution: async () => { nextCalls++; },
        },
        console, assert,
    };
    const controlsStart = home.indexOf('const setSidebarActionVisible =');
    const controlsEnd = home.indexOf('// Disable in-app', controlsStart);
    const handlersStart = home.indexOf('express.executionControlState?.(');
    const handlersEnd = home.indexOf("resumeBtn.addEventListener", handlersStart);
    vm.createContext(sandbox);
    vm.runInContext('let executionControlMode = null; let automationRunning = false;\n' +
        home.slice(controlsStart, controlsEnd) + '\n' +
        home.slice(handlersStart, handlersEnd), sandbox);
    const control = mode => listeners.control(null, { mode });
    control('running');
    assert.equal(listeners['next:hidden'], true);
    control('pausing');
    assert.equal(sandbox.nextStepBtn.disabled, true);
    control('paused');
    assert.equal(listeners['next:hidden'], false);
    assert.equal(sandbox.nextStepBtn.disabled, false);
    let stopped = false;
    listeners.next({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(nextCalls, 1);
    listeners.next({ stopPropagation() {} });
    assert.equal(nextCalls, 1);
    control('stepping');
    vm.runInContext("setExecutionControlState('running')", sandbox);
    assert.equal(listeners['resume:hidden'], false);
    assert.equal(sandbox.nextStepBtn.disabled, true);
    control('decision');
    assert.equal(listeners['next:hidden'], true);
    control('running');
    assert.equal(listeners['next:hidden'], true);
    control('idle');
    assert.equal(listeners['next:hidden'], true);
    const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    assert.ok(preload.includes("nextStepExecution: () => ipcRenderer.invoke('nextStepExecution')"));
    assert.ok(main.includes("ipcMain.handle('nextStepExecution', event => resumeExecution(event, true))"));
    const html = fs.readFileSync(path.join(root, 'src/ui/home.html'), 'utf8');
    const resume = html.slice(html.indexOf('id="resume"'));
    assert.ok(resume.indexOf('id="nextStepExecution"') < resume.indexOf('</li>'));
}
checks().then(() => {
    rendererChecks();
    console.log('PASS next-step execution, helpers, loops, groups, resume races, failure decisions, cancellation, completion, UI and IPC: ' + root);
}).catch(error => { console.error(error); process.exitCode = 1; });
