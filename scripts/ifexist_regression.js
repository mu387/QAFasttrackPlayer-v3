const assert = require('node:assert/strict');
const { WebActions } = require('../src/ui/automation/webActions');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const lookup = require('../src/ui/automation/helperLookup');
const stepLog = require('../src/utils/stepLog');
const logged = [];
stepLog.stepLogCall = async payload => logged.push(payload);
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

function fixture(target, matches = [{}], failure = null) {
    const calls = [];
    let implicit = 10000;
    const query = async selector => {
        calls.push(selector);
        assert.equal(implicit, 0);
        if (failure) throw failure;
        return matches;
    };
    const timeouts = [];
    const setTimeout = async value => {
        implicit = value.implicit;
        timeouts.push(implicit);
    };
    const driver = {
        sessionId: 'test-session',
        getSession: async () => ({ id: 'test-session' }),
        getTimeouts: async () => ({ implicit }),
        setTimeout,
        $$: query,
        findElements: query,
        manage: () => ({ getTimeouts: async () => ({ implicit }), setTimeouts: setTimeout }),
        quit: async () => {},
    };
    const webDriver = Object.create(WebActions.prototype);
    webDriver.driver = target === 'web' ? driver : null;
    webDriver.currentContext = null;
    const mobileDriver = new MobileActionsRouter();
    mobileDriver.platform = target === 'web' ? 'android' : target;
    if (target !== 'web') {
        mobileDriver[target].driver = driver;
        mobileDriver.driver = driver;
    }
    return { webDriver, mobileDriver, calls, timeouts, driver, implicit: () => implicit };
}

async function providerChecks() {
    for (const target of ['web', 'android', 'ios']) {
        const main = { executionTarget: target, keyword: { name: target === 'web' ? 'click' : 'mobileTap' }, xPath: 'xpath=//button' };
        for (const count of [0, 1, 2]) {
            const context = fixture(target, Array.from({ length: count }, () => ({})));
            assert.equal(await helpers.runBeforeHelper(context, main, { keyword: 'ifExist' }), count > 0);
            assert.equal(context.calls.length, 1);
            assert.deepEqual(context.timeouts, [0, 10000]);
            assert.equal(context.implicit(), 10000);
            main.__explicitTargetIndex = 2;
            assert.equal(await helpers.runBeforeHelper(context, main, { keyword: 'ifExist' }), count >= 2);
            delete main.__explicitTargetIndex;
        }
        for (const failure of [
            new Error('invalid selector'),
            new Error('invalid session id'),
            new Error('Appium connection failed'),
        ]) {
            const context = fixture(target, [], failure);
            await assert.rejects(helpers.runBeforeHelper(context, main, { keyword: 'ifExist' }), error => error === failure);
            assert.equal(context.implicit(), 10000);
        }
        const context = fixture(target);
        const provider = helpers.resolveHelperProvider(context, main, 'ifExist');
        await assert.rejects(provider.ifExist({ xPath: '' }), /locator/i);
        await assert.rejects(provider.ifExist({ xPath: 'unsupported=thing' }), /Unsupported/);
        for (const index of [0, -1, 1.5, 'bad']) {
            await assert.rejects(provider.ifExist({ xPath: '//button', __explicitTargetIndex: index }), /positive integer/);
        }
        provider.driver = null;
        await assert.rejects(provider.ifExist({ xPath: '//button' }), /active .*session/i);
    }
    for (const target of ['android', 'ios']) {
        const context = fixture(target);
        const main = { executionTarget: target, keyword: 'mobileTap', xPath: '//parent', __explicitTargetIndex: 4 };
        const inputs = target === 'android'
            ? [['id=close', 'id=close'], ['accessibilityId=Close', '~Close'], ['android=new UiSelector()', 'android=new UiSelector()']]
            : [['id=close', 'id=close'], ['accessibilityId=Close', '~Close'], ['iosPredicate=name == "Close"', '-ios predicate string:name == "Close"'], ['iosClassChain=**/Button', '-ios class chain:**/Button']];
        for (const [value, expected] of inputs) {
            assert.equal(await helpers.runBeforeHelper(context, main, { keyword: 'ifExist', value }), true);
            assert.equal(context.calls.at(-1), expected);
        }
        for (const value of ['target=xpath=//override', 'scope=//override', 'xpath=//override', '//override']) {
            assert.equal(await helpers.runBeforeHelper(context, main, { keyword: 'ifExist', value }), true);
            assert.equal(context.calls.at(-1), '//override');
        }
    }
    const web = fixture('web');
    const contextSelectors = [];
    web.webDriver.currentContext = { findElements: async selector => { contextSelectors.push(selector); return [{}]; } };
    assert.equal(await helpers.runBeforeHelper(web, { keyword: 'click', xPath: '//button[2]' }, { keyword: 'ifExist' }), true);
    assert.equal(contextSelectors[0].value, '//button[2]');
    assert.equal(web.calls.length, 0);
}

async function dispatchChecks() {
    const context = fixture('ios');
    assert.equal(helpers.resolveExecutionTarget(context, { keyword: 'mobileTap' }), 'ios');
    context.mobileDriver.press = async () => {};
    assert.equal(helpers.resolveExecutionTarget(context, { keyword: 'press' }), 'ios');
    assert.equal(helpers.resolveExecutionTarget(context, { keyword: 'click' }), 'web');
    for (const field of ['executionTarget', 'execution_target', 'target']) {
        assert.equal(helpers.resolveExecutionTarget(context, { [field]: 'web', keyword: 'mobileTap' }), 'web');
    }
    for (const target of ['windows', 'api', 'unknown']) {
        await assert.rejects(helpers.runBeforeHelper(context, { executionTarget: target, xPath: '//x' }, { keyword: 'ifExist' }), /not supported/);
    }
    await assert.rejects(helpers.runBeforeHelper(context, { keyword: 'apiCall', xPath: '//x' }, { keyword: 'ifExist' }), /api/);
    await assert.rejects(helpers.runBeforeHelper(context, { executionTarget: 'android', xPath: '//x' }, { keyword: 'ifExist' }), /does not match/);
    assert.throws(() => helpers.resolveExecutionTarget(context, { keyword: 'undefinedAction' }), /Cannot resolve/);
    const prepared = helpers.prepareIfExist({ xPath: '//parent', __explicitTargetIndex: 2 }, { value: '', xPath: '//own' });
    assert.equal(prepared.xPath, '//own');
    assert.equal(prepared.__explicitTargetIndex, undefined);
    assert.equal(helpers.prepareIfExist({ xPath: '//parent', __explicitTargetIndex: 2 }, {}).__explicitTargetIndex, 2);
    assert.throws(() => helpers.prepareIfExist({}, {}), /requires/);
    const interpolation = helpers.prepareIfExist({ xPath: '{{locator}}' }, {}, value => value === '{{locator}}' ? 'id=close' : value);
    assert.equal(interpolation.xPath, 'id=close');
    await assert.rejects(lookup.immediateLookup(async () => ({}), async () => {}, async () => []), /timeout/);
}

async function runnerCheck(target, outcome, helperValue = '') {
    logged.length = 0;
    const steps = [
        { id: 1, dataset_id: 11, keyword: { name: target === 'web' ? 'click' : 'mobileTap' }, executionTarget: target,
            xPath: 'xpath=//button', value: '', before_step: [{ ifExist: helperValue }], after_step: [{ wait: '0' }] },
        { id: 2, dataset_id: 11, keyword: { name: 'click' }, xPath: '//next', value: '' },
    ];
    const automation = new Automation({
        testRunnerStepDataOriginal: [{ id: 10, test_suite: { id: 10 }, steps }],
        testRunner: { id: 20 },
        mainWindow: { webContents: { send: () => {} } },
        token: '',
        isReExecuteFlag: false,
    });
    const failure = outcome === 'error' ? new Error('invalid selector') : null;
    const context = fixture(target, outcome === 'absent' ? [] : [{}], failure);
    automation.webDriver = context.webDriver;
    automation.mobileDriver = context.mobileDriver;
    automation.webDriver.getFramePathSnapshot = () => [];
    automation.webDriver.setVisibleOnlyLookup = () => {};
    automation.webDriver.getVisibleOnlyLookup = () => false;
    automation.webDriver.resetFrameContextIfNeeded = async () => {};
    automation.saveAndCloseSuite = async () => {};
    automation.canPersistRunnerLogs = () => true;
    const oldReporter = automation.stepStatusReporter;
    automation.stepStatusReporter = { enqueue: payload => logged.push(payload), flushAll: async () => {} };
    const actions = [];
    automation.runStep = async step => { actions.push(step.id || step.keyword.name); };
    automation.setExecutionDelay(0);
    await automation.iterateSteps();
    assert.equal(actions.includes(1), outcome === 'exists');
    assert.equal(actions.includes('wait'), outcome === 'exists');
    assert.equal(actions.includes(2), true);
    assert.equal(logged.length, 2);
    assert.equal(Boolean(logged[0].error), outcome === 'error');
    assert.equal(logged[0].stepOverrides?.comment, outcome === 'absent' ? helpers.IF_EXIST_COMMENT : undefined);
    assert.equal(logged[1].stepOverrides?.comment, undefined);
    assert.equal(automation.testRunnerSteps[0].steps[0].execution, outcome === 'error' ? 3 : 2);
    assert.equal(automation.testRunnerSteps[0].steps[1].execution, 2);
    if (stepLog.buildStepStatusEvent) {
        const payload = stepLog.buildStepStatusEvent(logged[0]);
        assert.equal(payload.step.is_passed, outcome !== 'error');
        assert.equal(payload.step.comment, outcome === 'absent' ? helpers.IF_EXIST_COMMENT : undefined);
    }
    await oldReporter?.shutdown?.();
}

async function main() {
    await providerChecks();
    await dispatchChecks();
    for (const target of ['web', 'android', 'ios']) {
        for (const outcome of ['exists', 'absent', 'error']) await runnerCheck(target, outcome);
        await runnerCheck(target, 'exists', 'target=xpath=//override');
    }
    console.log('PASS ifExist providers, routing, input inheritance, error propagation, main-step reporting and skip isolation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
