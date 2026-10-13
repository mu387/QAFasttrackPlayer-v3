const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const home = fs.readFileSync(path.join(__dirname, '../src/ui/home.js'), 'utf8');
const callbacks = {};
const elements = Object.fromEntries(
    ['automationWaitStrip', 'automationWaitText', 'automationHelperFailure'].map(name => [
        name, { hidden: true, textContent: '', title: '' },
    ]),
);
const sandbox = {
    document: { getElementById: name => elements[name] },
    express: {
        automationHelperWaiting: callback => { callbacks.feedback = callback; },
        testExecuteOutput: callback => { callbacks.manual = callback; },
        testRunnerStepData: callback => { callbacks.steps = callback; },
        noActiveTest: callback => { callbacks.inactive = callback; },
    },
    pauseBtn: {}, stopExecutionBtn: {}, resumeBtn: {}, nextStepBtn: {},
    setSidebarActionVisible: () => {},
    tableBody: { innerHTML: '' },
    reExecuteFlowModule: { clearPendingState: () => {} },
    alert: () => {},
};
const context = vm.createContext(sandbox);
const controlsStart = home.indexOf('const setExecutionControlState =');
const controlsEnd = home.indexOf('\n};', controlsStart) + 3;
const feedbackStart = home.indexOf('let activeHelperWaitId =');
const stepsStart = home.indexOf('express.testRunnerStepData(');
const stepsEnd = home.indexOf('  console.log(!runner', stepsStart);
const inactiveStart = home.indexOf('express.noActiveTest(');
const inactiveEnd = home.indexOf('\n});', inactiveStart) + 4;
vm.runInContext(
    'let automationRunning = false; let hasExecutionRows = false; let executionControlMode = null;\n' +
    home.slice(controlsStart, controlsEnd) + '\n' +
    home.slice(feedbackStart) + '\n' +
    home.slice(stepsStart, stepsEnd) + '\n});\n' +
    home.slice(inactiveStart, inactiveEnd),
    context,
);

const send = (reason, extra = {}) => callbacks.feedback(null, {
    reason, phase: 'after', keyword: 'switchToIframe', stepNumber: 28, ...extra,
});
const start = () => vm.runInContext("automationRunning = true; setExecutionControlState('running');", context);
const assertCleared = () => {
    assert.equal(elements.automationWaitStrip.hidden, true);
    assert.equal(elements.automationHelperFailure.hidden, true);
    for (const name of ['automationWaitText', 'automationHelperFailure']) {
        assert.equal(elements[name].textContent, '');
        assert.equal(elements[name].title, '');
    }
    assert.equal(vm.runInContext('activeHelperWaitId', context), null);
    assert.equal(vm.runInContext('activeStripAction', context), null);
    assert.equal(vm.runInContext('helperFailureCount', context), 0);
    assert.equal(vm.runInContext('latestHelperFailure', context), '');
};
for (const finish of [
    () => callbacks.steps(null, []),
    () => callbacks.inactive(null, { message: 'Queue canceled' }),
    () => vm.runInContext("automationRunning = false; setExecutionControlState('idle');", context),
]) {
    start();
    send('action_started');
    send('action_failed', { error: 'Helper failed' });
    assert.equal(elements.automationWaitStrip.hidden, false);
    assert.match(elements.automationHelperFailure.textContent, /Helper failed/);
    finish();
    assertCleared();
    for (const reason of ['action_started', 'action_passed', 'action_failed', 'helper_waiting', 'helper_waiting_done']) {
        send(reason, { id: 1, error: 'Late event' });
        assertCleared();
    }
}
start();
send('action_step_started');
send('action_started', { phase: 'before' });
assert.equal(elements.automationWaitStrip.hidden, false);
assert.match(elements.automationWaitText.textContent, /Before helper/);
vm.runInContext("setExecutionControlState('paused');", context);
assert.equal(elements.automationWaitStrip.hidden, false);
send('reset');
assertCleared();
send('action_started');
assert.equal(elements.automationWaitStrip.hidden, false);
callbacks.steps(null, []);
callbacks.manual(null, { output: '' });
send('helper_waiting', { id: 2, keyword: 'waitforelement', target: '//label', timeout: 1000, state: 'exist' });
assert.equal(elements.automationWaitStrip.hidden, false);
callbacks.manual(null, { output: 'waitForElement completed.' });
assertCleared();
send('helper_waiting_done', { id: 2 });
assertCleared();
console.log('PASS action strip clears on completion, Stop and queue cancellation; ignores late events; preserves active/manual feedback');
