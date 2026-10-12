const assert = require('node:assert/strict');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const mobileWait = require('../src/ui/automation/mobileWait');
const stepLog = require('../src/utils/stepLog');
const logged = [];
stepLog.stepLogCall = async payload => logged.push(payload);
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

function element(text = 'Ready', flags = {}) {
    return {
        isDisplayed: async () => flags.visible ?? true,
        isEnabled: async () => flags.enabled ?? true,
        isSelected: async () => flags.selected ?? false,
        getText: async () => text,
        getAttribute: async name => flags[name] ?? '',
    };
}

function fixture(platform, query = () => [element()]) {
    const selectors = [];
    const timeouts = [];
    let implicit = 10000;
    const driver = {
        sessionId: 'test-session',
        getTimeouts: async () => ({ implicit }),
        setTimeout: async value => { implicit = value.implicit; timeouts.push(implicit); },
        $$: async selector => {
            assert.equal(implicit, 0);
            selectors.push(selector);
            return query(selectors.length);
        },
    };
    const mobileDriver = new MobileActionsRouter();
    mobileDriver.platform = platform;
    mobileDriver[platform].driver = driver;
    return { mobileDriver, driver, selectors, timeouts, implicit: () => implicit };
}

async function providerChecks() {
    for (const platform of ['android', 'ios']) {
        const main = { keyword: 'mobileFill', xPath: 'id=field' };
        for (const [state, matches] of [
            ['exist', [element()]], ['notexist', []], ['visible', [element()]],
            ['hidden', []], ['hidden', [element('', { visible: false })]],
            ['enabled', [element()]], ['disabled', [element('', { enabled: false })]],
            ['selected', [element('', { selected: true })]], ['notselected', [element()]],
        ]) {
            const context = fixture(platform, () => matches);
            await helpers.runWaitHelper(context, main, { keyword: 'waitForElement', value: state });
            assert.deepEqual(context.selectors, ['id=field']);
            assert.deepEqual(context.timeouts, [0, 10000]);
        }
        for (const state of ['exist', 'visible', 'enabled', 'disabled', 'selected', 'notselected']) {
            const context = fixture(platform, () => []);
            await assert.rejects(helpers.runWaitHelper(context, main, { keyword: 'waitForElement', value: state + ' >> timeout=1' }), /timed out/);
            assert.equal(context.implicit(), 10000);
        }
        const delayed = fixture(platform, count => count === 1 ? [] : [element()]);
        await helpers.runWaitHelper(delayed, main, { keyword: 'waitForElement', value: 'exist >> timeout=500' });
        assert.equal(delayed.selectors.length, 2);
        const index = fixture(platform, () => [element('Wrong'), element('Ready')]);
        await helpers.runWaitHelper(index, { ...main, __explicitTargetIndex: 2 }, { keyword: 'waitForText', value: 'text=Ready >> match=exact' });
        await assert.rejects(helpers.runWaitHelper(index, { ...main, __explicitTargetIndex: 3 }, { keyword: 'waitForElement', value: 'exist >> timeout=1' }), /timed out/);
        await helpers.runWaitHelper(index, { ...main, __explicitTargetIndex: 3 }, { keyword: 'waitForElement', value: 'exist >> target=accessibilityId=Other' });
        assert.equal(index.selectors.at(-1), '~Other');
        const native = platform === 'ios'
            ? [['iosPredicate=name == "Ready"', '-ios predicate string:name == "Ready"'], ['iosClassChain=**/TextField', '-ios class chain:**/TextField']]
            : [['android=new UiSelector()', 'android=new UiSelector()']];
        for (const [locator, expected] of native) {
            await helpers.runWaitHelper(index, main, { keyword: 'waitForElement', value: 'exist >> scope=' + locator });
            assert.equal(index.selectors.at(-1), expected);
        }
        for (const [text, value, flags] of [
            [' Ready\n now ', 'text=Ready now >> match=exact', {}],
            ['Ready now', 'Ready', {}],
            ['', 'Ready', { value: 'Ready' }],
            ['Missing', 'text=Ready >> state=notexist', {}],
            ['Ready', 'text=Ready >> state=notexist', { visible: false }],
        ]) {
            const context = fixture(platform, () => [element(text, flags)]);
            await helpers.runWaitHelper(context, main, { keyword: 'waitForText', value });
        }
        await assert.rejects(helpers.runWaitHelper(fixture(platform), main, { keyword: 'waitForText', value: 'text=ready >> match=exact >> timeout=1' }), /timed out/);
        for (const helper of ['waitForElement', 'waitForText']) {
            const value = helper === 'waitForText' ? 'Ready' : 'exist';
            for (const message of ['invalid selector', 'invalid session id', 'Appium unavailable']) {
                const error = new Error(message);
                const context = fixture(platform, () => { throw error; });
                await assert.rejects(helpers.runWaitHelper(context, main, { keyword: helper, value }), caught => caught === error);
                assert.equal(context.implicit(), 10000);
            }
            const canceled = fixture(platform);
            const error = new Error('execution_canceled');
            canceled.ensureNotCanceled = () => { throw error; };
            await assert.rejects(helpers.runWaitHelper(canceled, main, { keyword: helper, value }), caught => caught === error);
            assert.deepEqual(canceled.timeouts, []);
            const invalid = fixture(platform);
            invalid.driver.sessionId = '';
            await assert.rejects(helpers.runWaitHelper(invalid, main, { keyword: helper, value }), /active .*Appium session/);
            await assert.rejects(helpers.runWaitHelper(fixture(platform), { ...main, xPath: '' }, { keyword: helper, value }), /requires a locator/);
            await assert.rejects(helpers.runWaitHelper(fixture(platform), { ...main, xPath: 'unsupported=field' }, { keyword: helper, value }), /Unsupported/);
        }
    }
    for (const timeout of ['0', '-1', 'bad', 'Infinity']) {
        assert.throws(() => mobileWait.parseConfig({ value: 'exist >> timeout=' + timeout }, 'waitForElement'), /positive number/);
    }
    for (const [helper, value] of [['waitForElement', 'bogus'], ['waitForText', 'text=Ready >> match=regex'], ['waitForText', ''], ['waitForElement', 'exist >> unknown=x']]) {
        assert.throws(() => mobileWait.parseConfig({ value }, helper));
    }
    assert.equal(mobileWait.parseConfig({ value: 'exist >> target=xpath=//field[@label="a>>b"]' }, 'waitForElement').target, 'xpath=//field[@label="a>>b"]');
}

async function routingChecks() {
    const context = fixture('ios');
    const calls = [];
    context.webDriver = { click() {}, waitForElement() {}, waitForText() {} };
    context.runStep = async step => calls.push(step);
    for (const name of ['waitForElement', 'waitForText']) {
        const helper = { keyword: { name }, xPath: '//web', value: 'unchanged' };
        await helpers.runWaitHelper(context, { keyword: 'click' }, helper);
        assert.equal(calls.at(-1), helper);
        for (const target of ['windows', 'api']) {
            await assert.rejects(helpers.runWaitHelper(context, { executionTarget: target }, helper), /not supported/);
        }
        await assert.rejects(helpers.runWaitHelper(context, { executionTarget: 'android' }, helper), /does not match/);
    }
    context.resolveRuntimeValue = value => value === '{{locator}}' ? 'id=resolved' : value === '{{state}}' ? 'exist' : value;
    await helpers.runWaitHelper(context, { keyword: 'mobileTap', xPath: '{{locator}}' }, { keyword: 'waitForElement', value: '{{state}}' });
    assert.equal(context.selectors.at(-1), 'id=resolved');
}

async function runnerCheck(platform, phase, helperName, fails) {
    logged.length = 0;
    const context = fixture(platform, () => fails ? [] : [element()]);
    const messages = [];
    const helperValue = (helperName === 'waitForText' ? 'Ready' : 'exist') + ' >> timeout=1';
    const steps = [
        { id: 1, dataset_id: 11, keyword: { name: 'mobileFill' }, xPath: 'id=field', value: 'new', [phase + '_step']: [{ [helperName]: helperValue }] },
        { id: 2, dataset_id: 11, keyword: { name: 'mobileFill' }, xPath: 'id=next', value: 'next' },
    ];
    const automation = new Automation({
        testRunnerStepDataOriginal: [{ id: 10, test_suite: { id: 10 }, steps }],
        testRunner: { id: 20 }, mainWindow: { webContents: { send: (...args) => messages.push(args) } }, token: '', isReExecuteFlag: false,
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
        if (step.id === 1) assert.equal(context.selectors.length > 0, phase === 'before');
        actions.push(step.id || step.keyword.name);
    };
    automation.setExecutionDelay(0);
    await automation.iterateSteps();
    assert.deepEqual(actions, [1, 2]);
    assert.equal(context.selectors.length > 0, true);
    assert.equal(context.implicit(), 10000);
    assert.equal(logged.length, 2);
    assert.equal(Boolean(logged[0].error), false);
    assert.equal(automation.testRunnerSteps[0].steps[0].execution, 2);
    assert.equal(automation.testRunnerSteps[0].steps[1].execution, 2);
    if (stepLog.buildStepStatusEvent) assert.equal(stepLog.buildStepStatusEvent(logged[0]).step.is_passed, true);
    await reporter?.shutdown?.();
}

async function main() {
    await providerChecks();
    await routingChecks();
    for (const platform of ['android', 'ios']) {
        for (const phase of ['before', 'after']) {
            for (const helper of ['waitForElement', 'waitForText']) {
                for (const fails of [false, true]) await runnerCheck(platform, phase, helper, fails);
            }
        }
    }
    console.log('PASS shared mobile wait routing, native conditions, timeout restoration, and non-failing before/after helper reporting');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
