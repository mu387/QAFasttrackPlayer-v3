const assert = require('node:assert/strict');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

async function checkDirection(platform, direction) {
    const router = new MobileActionsRouter();
    router.platform = platform;
    const selectors = [];
    const gestures = [];
    let lookups = 0;
    const container = {
        elementId: 'container-2',
        $$: async selector => {
            selectors.push(selector);
            lookups += 1;
            return lookups === 2 ? [{ isDisplayed: async () => true }] : [];
        },
    };
    const driver = {
        sessionId: 'test-session',
        getTimeouts: async () => ({ implicit: 10000 }),
        $$: async selector => { selectors.push(selector); return [container]; },
        $: async selector => {
            selectors.push(selector);
            lookups += 1;
            return { isExisting: async () => lookups === 2 };
        },
        execute: async (...args) => { gestures.push(args); return false; },
    };
    router[platform].driver = driver;
    const keyword = direction === 'up' ? 'mobileScrollToTextUp' : 'mobileScrollToTextDown';
    assert.equal(helpers.resolveExecutionTarget({ mobileDriver: router }, { keyword }), platform);
    const automation = new Automation({
        testRunnerStepDataOriginal: [], testRunner: { id: 20 },
        mainWindow: { webContents: { send: () => {} } }, token: '',
    });
    automation.mobileDriver = router;
    automation.webDriver.hasValidSession = async () => false;
    automation.setExecutionDelay(0);
    await automation.runStep({
        keyword: { name: keyword }, value: platform === 'android' ? '2_0_Order_Status' : 'Order_Status',
    });
    assert.equal(lookups, 2);
    if (platform === 'android') {
        assert.equal(selectors[0], 'android=new UiSelector().scrollable(true).instance(2)');
        assert.equal(selectors[1], 'android=new UiSelector().text("Order_Status").instance(0)');
        assert.deepEqual(gestures, [['mobile: scrollGesture', { elementId: 'container-2', direction, percent: 0.8 }]]);
        container.$$ = async () => [];
        gestures.length = 0;
        await assert.rejects(router[keyword]({ value: '2_0_Missing' }), /Text not found/);
        assert.equal(gestures.length, 1);
        driver.execute = async (...args) => { gestures.push(args); return true; };
        gestures.length = 0;
        await assert.rejects(router[keyword]({ value: '2_0_Missing' }), /Text not found/);
        assert.equal(gestures.length, 10);
        await assert.rejects(router[keyword]({ value: '2_0_' }), /requires text/);
        driver.$$ = async () => [];
        await assert.rejects(router[keyword]({ value: '2_0_Missing' }), /container not found/);
    } else {
        assert.ok(selectors.every(selector => selector.includes("CONTAINS 'Order_Status'")));
        assert.deepEqual(gestures, [['mobile: scroll', { direction }]]);
        driver.$ = async () => ({ isExisting: async () => false });
        gestures.length = 0;
        await assert.rejects(router[keyword]({ value: 'Missing_Text' }), /Text not found: Missing_Text/);
        assert.equal(gestures.length, 10);
    }
    const failure = new Error('Appium unavailable');
    driver.$$ = driver.$ = async () => { throw failure; };
    await assert.rejects(router[keyword]({ value: '2_0_Text' }), error => error === failure);
    await automation.stepStatusReporter?.shutdown?.();
}

async function main() {
    for (const platform of ['android', 'ios']) {
        for (const direction of ['up', 'down']) await checkDirection(platform, direction);
    }
    console.log('PASS Up/Down active runner routing, platform inputs, directions, bounded search and error propagation');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
