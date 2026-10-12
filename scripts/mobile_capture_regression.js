const assert = require('node:assert/strict');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const stepLog = require('../src/utils/stepLog');
const logged = [];
stepLog.stepLogCall = async payload => logged.push(payload);
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

function fixture(platform, value = 'Captured', failure = null) {
    const selectors = [];
    const attributes = [];
    const element = {
        getText: async () => { if (failure) throw failure; return value; },
        isSelected: async () => false,
        isEnabled: async () => true,
        isDisplayed: async () => false,
        getAttribute: async attribute => { attributes.push(attribute); if (failure) throw failure; return value; },
    };
    const driver = {
        sessionId: 'test-session',
        getTimeouts: async () => ({ implicit: 10000 }),
        $$: async selector => { selectors.push(selector); return [element]; },
    };
    const mobileDriver = new MobileActionsRouter();
    mobileDriver.platform = platform;
    mobileDriver[platform].driver = driver;
    return { mobileDriver, driver, selectors, attributes, element, capturedData: 'old capture' };
}

async function providerChecks() {
    for (const platform of ['android', 'ios']) {
        const main = { keyword: 'mobileTap', xPath: 'id=field' };
        for (const [attribute, expected] of [['gettext', 'Captured'], ['isSelected', false], ['isEnabled', true], ['isDisplayed', false], ['custom-Attribute', 'Captured']]) {
            const context = fixture(platform);
            await helpers.runCaptureHelper(context, main, { keyword: 'getElementValue', value: attribute });
            assert.equal(context.capturedData, expected);
            assert.deepEqual(context.selectors, ['id=field']);
            if (attribute === 'custom-Attribute') assert.deepEqual(context.attributes, [attribute]);
        }
        for (const value of ['', 0, false, null]) {
            const context = fixture(platform, value);
            await helpers.runCaptureHelper(context, main, { keyword: 'getElementValue', value: 'value' });
            assert.equal(context.capturedData, value);
        }
        const multiline = fixture(platform, 'one\ntwo\r\n');
        await helpers.runCaptureHelper(multiline, main, { keyword: 'getElementValue', value: 'value' });
        assert.equal(multiline.capturedData, 'onetwo');
        await helpers.runCaptureHelper(multiline, main, { keyword: 'getElementValue', value: 'gettext' });
        assert.equal(multiline.capturedData, 'one\ntwo\r\n');
        const context = fixture(platform);
        context.driver.$$ = async selector => { context.selectors.push(selector); return [{ getText: async () => 'First' }, context.element]; };
        await helpers.runCaptureHelper(context, { ...main, __explicitTargetIndex: 2 }, { keyword: 'getElementValue', value: 'gettext' });
        assert.equal(context.capturedData, 'Captured');
        await helpers.runCaptureHelper(context, { ...main, __explicitTargetIndex: 2 }, { keyword: 'getElementValue', value: 'gettext', xPath: 'xpath=//own' });
        assert.equal(context.capturedData, 'First');
        const provider = context.mobileDriver[platform];
        const locators = platform === 'android'
            ? [['android=new UiSelector()', 'android=new UiSelector()']]
            : [['iosPredicate=name == "Field"', '-ios predicate string:name == "Field"'], ['iosClassChain=**/TextField', '-ios class chain:**/TextField']];
        for (const [locator, expected] of [['accessibilityId=Field', '~Field'], ...locators]) {
            await provider.getElementValue({ xPath: locator, value: 'gettext' });
            assert.equal(context.selectors.at(-1), expected);
        }
        for (const [step, pattern] of [
            [{ xPath: '', value: 'gettext' }, /requires a locator/],
            [{ xPath: 'unknown=field', value: 'gettext' }, /Unsupported/],
            [{ xPath: '//field', value: '' }, /requires a text/],
            [{ xPath: '//field', value: 'selection' }, /web dropdowns only/],
            [{ xPath: '//field', value: 'gettext', __explicitTargetIndex: 0 }, /positive integer/],
            [{ xPath: '//field', value: 'gettext', __explicitTargetIndex: 3 }, /not found/],
        ]) await assert.rejects(provider.getElementValue(step), pattern);
        provider.driver = null;
        await assert.rejects(provider.getElementValue({ xPath: '//field', value: 'gettext' }), /active .*Appium session/);
        const failure = new Error('Appium capture failed');
        const broken = fixture(platform, 'stale', failure);
        await assert.rejects(helpers.runCaptureHelper(broken, main, { keyword: 'getElementValue', value: 'gettext' }), error => error === failure);
        assert.equal(broken.capturedData, null);
        broken.driver.$$ = async () => { throw failure; };
        await assert.rejects(helpers.runCaptureHelper(broken, main, { keyword: 'getElementValue', value: 'value' }), error => error === failure);
        assert.equal(broken.capturedData, null);
        for (const target of ['web', 'windows', 'api', platform === 'ios' ? 'android' : 'ios']) {
            if (target === 'web') continue;
            await assert.rejects(helpers.runCaptureHelper(fixture(platform), { ...main, executionTarget: target }, { keyword: 'getElementValue', value: 'gettext' }), /not supported|does not match/);
        }
    }
    const webHelper = { keyword: 'getElementValue', value: 'selection', xPath: '//select', highlight: false };
    let forwarded;
    const context = { webDriver: { click() {} }, runStep: async step => { forwarded = step; } };
    await helpers.runCaptureHelper(context, { keyword: 'click' }, webHelper);
    assert.equal(forwarded, webHelper);
}

async function runnerCheck(platform, phase, value, fails = false) {
    logged.length = 0;
    const context = fixture(platform === 'web' ? 'android' : platform, value, fails ? new Error('Capture failed') : null);
    const steps = [
        { id: 1, dataset_id: 11, keyword: { name: platform === 'web' ? 'click' : 'mobileTap' }, xPath: 'id=field', value: '', [phase + '_step']: [{ getElementValue: 'value' }] },
        { id: 2, dataset_id: 11, keyword: { name: 'mobileFill' }, xPath: 'id=destination', value: '{{u_capture}}' },
    ];
    const automation = new Automation({
        testRunnerStepDataOriginal: [{ id: 10, test_suite: { id: 10 }, steps }],
        testRunner: { id: 20 }, mainWindow: { webContents: { send: () => {} } }, token: '', isReExecuteFlag: false,
    });
    automation.mobileDriver = context.mobileDriver;
    automation.capturedData = 'old capture';
    if (automation.setRuntimeVariable) automation.setRuntimeVariable('web_capture', 'previous web');
    const actions = [];
    automation.mobileDriver.mobileTap = async () => actions.push('main');
    automation.mobileDriver.mobileFill = async step => actions.push(step.value);
    automation.webDriver.click = async () => actions.push('main');
    automation.webDriver.findElement = async () => context.element;
    automation.webDriver.hasValidSession = async () => platform === 'web';
    automation.webDriver.getFramePathSnapshot = () => [];
    automation.webDriver.resetFrameContextIfNeeded = async () => {};
    automation.saveAndCloseSuite = async () => {};
    automation.canPersistRunnerLogs = () => true;
    const reporter = automation.stepStatusReporter;
    automation.stepStatusReporter = { enqueue: payload => logged.push(payload), flushAll: async () => {} };
    automation.setExecutionDelay(0);
    await automation.iterateSteps();
    const captured = fails ? null : value;
    assert.deepEqual(actions, ['main', captured == null ? '{{u_capture}}' : String(captured)]);
    assert.equal(automation.capturedData, captured);
    if (automation.setRuntimeVariable) assert.equal(automation.runtimeVariables.web_capture, platform === 'web' ? captured == null ? '' : String(captured) : 'previous web');
    assert.equal(logged.length, 2);
    assert.ok(logged.every(payload => !payload.error));
    assert.equal(automation.testRunnerSteps[0].steps[0].execution, 2);
    assert.equal(automation.testRunnerSteps[0].steps[1].execution, 2);
    if (stepLog.buildStepStatusEvent) assert.equal(stepLog.buildStepStatusEvent(logged[0]).step.is_passed, true);
    await reporter?.shutdown?.();
}

async function main() {
    await providerChecks();
    for (const platform of ['web', 'android', 'ios']) {
        for (const phase of ['before', 'after']) {
            for (const value of ['Captured', '', false, 0]) {
                if (platform === 'web' && (value === false || value === 0)) continue;
                await runnerCheck(platform, phase, value);
            }
            await runnerCheck(platform, phase, 'old capture', true);
        }
    }
    console.log('PASS shared getElementValue routing, native capture, later u_capture reuse, web preservation and non-failing helper errors');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
