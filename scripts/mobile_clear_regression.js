const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const stepLog = require('../src/utils/stepLog');
const logged = [];
stepLog.stepLogCall = async payload => logged.push(payload);
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

function fixture(platform, count = 2, failure = null) {
    const calls = [];
    const selectors = [];
    const mobileDriver = new MobileActionsRouter();
    mobileDriver.platform = platform;
    mobileDriver[platform].driver = {
        sessionId: 'test-session',
        getTimeouts: async () => ({ implicit: 10000 }),
        $$: async selector => {
            selectors.push(selector);
            return Array.from({ length: count }, (_, index) => ({
                clearValue: async () => {
                    calls.push(index + 1);
                    if (failure) throw failure;
                },
            }));
        },
    };
    return { mobileDriver, calls, selectors };
}

async function providerChecks() {
    for (const platform of ['android', 'ios']) {
        const context = fixture(platform);
        const main = { keyword: 'mobileFill', xPath: 'id=field', __explicitTargetIndex: 2 };
        assert.equal(await helpers.runBeforeHelper(context, main, { keyword: 'mobileClear' }), true);
        assert.deepEqual(context.calls, [2]);
        assert.deepEqual(context.selectors, ['id=field']);
        for (const value of ['target=xpath=//override', 'scope=//override', 'xpath=//override', '//override']) {
            await helpers.runBeforeHelper(context, main, { keyword: 'mobileClear', value });
            assert.equal(context.calls.at(-1), 1);
            assert.equal(context.selectors.at(-1), '//override');
        }
        const strategies = platform === 'android'
            ? [['android=new UiSelector()', 'android=new UiSelector()']]
            : [['iosPredicate=name == "Field"', '-ios predicate string:name == "Field"'], ['iosClassChain=**/TextField', '-ios class chain:**/TextField']];
        for (const [value, expected] of [['accessibilityId=Field', '~Field'], ...strategies]) {
            await helpers.runBeforeHelper(context, main, { keyword: 'mobileClear', value });
            assert.equal(context.selectors.at(-1), expected);
        }
        const provider = context.mobileDriver[platform];
        await context.mobileDriver.mobileClear({ xPath: '//field' });
        assert.equal(context.calls.at(-1), 1);
        await assert.rejects(provider.mobileClear({ xPath: '' }), /mobileClear requires a locator/);
        await assert.rejects(provider.mobileClear({ xPath: 'unsupported=field' }), /Unsupported mobileClear/);
        for (const index of [0, -1, 1.5, 'bad']) {
            await assert.rejects(provider.mobileClear({ xPath: '//field', __explicitTargetIndex: index }), /positive integer/);
        }
        await assert.rejects(provider.mobileClear({ xPath: '//field', __explicitTargetIndex: 3 }), /not found/);
        const absent = fixture(platform, 0);
        await assert.rejects(helpers.runBeforeHelper(absent, main, { keyword: 'mobileClear' }), /not found/);
        for (const message of ['invalid selector', 'invalid session id', 'Appium connection failed', 'clear failed']) {
            const failure = new Error(message);
            const broken = fixture(platform, 1, failure);
            await assert.rejects(broken.mobileDriver.mobileClear({ xPath: '//field' }), error => error === failure);
            broken.mobileDriver[platform].driver.$$ = async () => { throw failure; };
            await assert.rejects(broken.mobileDriver.mobileClear({ xPath: '//field' }), error => error === failure);
        }
        provider.driver = null;
        await assert.rejects(provider.mobileClear({ xPath: '//field' }), /active .*Appium session/);
        for (const target of ['web', 'api', 'windows']) {
            await assert.rejects(helpers.runBeforeHelper(context, { ...main, executionTarget: target }, { keyword: 'mobileClear' }), /not supported/);
        }
        await assert.rejects(helpers.runBeforeHelper(context, { ...main, executionTarget: platform === 'ios' ? 'android' : 'ios' }, { keyword: 'mobileClear' }), /does not match/);
        assert.throws(() => helpers.prepareIfExist({}, {}, value => value, 'mobileClear'), /mobileClear requires/);
    }
}

async function fillChecks() {
    for (const platform of ['android', 'ios']) {
        const router = new MobileActionsRouter();
        router.platform = platform;
        router[platform].driver = { sessionId: 'test-session', getTimeouts: async () => ({ implicit: 10000 }) };
        const values = [];
        router[platform][platform === 'ios' ? 'mobileFillIOS' : 'mobileFill'] = async step => values.push(step.value);
        assert.equal(router.mobileFll, undefined);
        await router.mobileFill({ value: 'correct' });
        assert.deepEqual(values, ['correct']);
        assert.equal(helpers.resolveExecutionTarget({ mobileDriver: router }, { keyword: 'mobileFill' }), platform);
        const automation = new Automation({
            testRunnerStepDataOriginal: [],
            testRunner: { id: 20 },
            mainWindow: { webContents: { send: () => {} } },
            token: '',
        });
        automation.mobileDriver = router;
        automation.webDriver.hasValidSession = async () => false;
        automation.setExecutionDelay(0);
        await automation.runStep({ keyword: { name: 'mobileFill' }, xPath: '//field', value: 'queued correct' });
        assert.deepEqual(values, ['correct', 'queued correct']);
        await automation.stepStatusReporter?.shutdown?.();
    }
    const catalog = fs.readFileSync(path.join(__dirname, '../src/ui/home.js'), 'utf8');
    assert.match(catalog, /name: 'Mobile Fill',\s+value: 'mobileFill'/);
    assert.doesNotMatch(catalog, /value: 'mobileFll'/);
    const legacy = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    assert.match(legacy, /case 'mobilefill':/);
    assert.doesNotMatch(legacy, /case 'mobilefll':/);
}

async function runnerCheck(platform, fails, override = '', phase = 'before') {
    logged.length = 0;
    const context = fixture(platform, fails ? 0 : 2);
    const steps = [
        { id: 1, dataset_id: 11, keyword: { name: 'mobileFill' }, xPath: 'id=field', value: 'new text', before_step: [{ mobileClear: override }], after_step: [{ wait: '0' }] },
        { id: 2, dataset_id: 11, keyword: { name: 'mobileFill' }, xPath: 'id=next', value: 'next' },
    ];
    if (phase === 'after') {
        steps[0].before_step = [];
        steps[0].after_step = [{ mobileClear: '' }];
    }
    const automation = new Automation({
        testRunnerStepDataOriginal: [{ id: 10, test_suite: { id: 10 }, steps }],
        testRunner: { id: 20 },
        mainWindow: { webContents: { send: () => {} } },
        token: '',
        isReExecuteFlag: false,
    });
    automation.mobileDriver = context.mobileDriver;
    automation.webDriver.getFramePathSnapshot = () => [];
    automation.webDriver.resetFrameContextIfNeeded = async () => {};
    automation.saveAndCloseSuite = async () => {};
    automation.canPersistRunnerLogs = () => true;
    const reporter = automation.stepStatusReporter;
    automation.stepStatusReporter = { enqueue: payload => logged.push(payload), flushAll: async () => {} };
    const actions = [];
    automation.runStep = async step => {
        if (step.id === 1) assert.deepEqual(context.calls, fails || phase === 'after' ? [] : [1]);
        actions.push(step.id || step.keyword.name);
    };
    automation.setExecutionDelay(0);
    await automation.iterateSteps();
    assert.equal(actions.includes(1), true);
    assert.equal(actions.includes('wait'), phase !== 'after');
    assert.equal(actions.includes(2), true);
    assert.equal(logged.length, 2);
    assert.equal(Boolean(logged[0].error), false);
    assert.equal(logged[0].stepOverrides?.comment, undefined);
    assert.equal(automation.testRunnerSteps[0].steps[0].execution, 2);
    assert.equal(automation.testRunnerSteps[0].steps[1].execution, 2);
    assert.equal(context.selectors[0], phase === 'after' ? undefined : override ? '//override' : 'id=field');
    if (stepLog.buildStepStatusEvent) {
        assert.equal(stepLog.buildStepStatusEvent(logged[0]).step.is_passed, true);
    }
    await reporter?.shutdown?.();
}

async function main() {
    await fillChecks();
    await providerChecks();
    for (const platform of ['android', 'ios']) {
        await runnerCheck(platform, false);
        await runnerCheck(platform, true);
        await runnerCheck(platform, false, 'target=xpath=//override');
        await runnerCheck(platform, true, '', 'after');
    }
    console.log('PASS mobileFill and mobileClear providers, helper routing, locator inheritance and failure reporting');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
