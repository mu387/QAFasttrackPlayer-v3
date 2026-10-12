const assert = require('node:assert/strict');
const { mobileScroll, parseScroll } = require('../src/ui/automation/mobileScroll');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const helpers = require('../src/ui/automation/helperDispatch');
const stepLog = require('../src/utils/stepLog');
const logged = [];
stepLog.stepLogCall = async payload => logged.push(payload);
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;

function fixture(platform, failure = null) {
    const calls = [];
    const driver = {
        sessionId: 'test-session',
        getTimeouts: async () => ({ implicit: 10000 }),
        getWindowSize: async () => ({ width: 1000, height: 2000 }),
        performActions: async actions => { calls.push(['actions', actions]); if (failure) throw failure; },
        releaseActions: async () => calls.push(['release']),
        execute: async (...args) => { calls.push(args); if (failure) throw failure; },
    };
    const router = new MobileActionsRouter();
    router.platform = platform;
    router[platform].driver = driver;
    return { router, driver, calls };
}

async function providerChecks() {
    for (const platform of ['android', 'ios']) {
        for (const direction of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
            for (const pixels of [1, 200, 301]) {
                const { router, calls } = fixture(platform);
                await router.mobileScroll({ value: direction + '_' + pixels });
                assert.equal(helpers.resolveExecutionTarget({ mobileDriver: router }, { keyword: 'mobileScroll' }), platform);
                const vertical = ['UP', 'DOWN'].includes(direction);
                if (platform === 'ios') {
                    assert.deepEqual(calls, [['mobile: scroll', { direction: direction.toLowerCase(), distance: pixels / (vertical ? 2000 : 1000) }]]);
                } else {
                    const pointer = calls[0][1][0];
                    assert.equal(pointer.parameters.pointerType, 'touch');
                    assert.deepEqual(pointer.actions.map(action => action.type), ['pointerMove', 'pointerDown', 'pointerMove', 'pointerUp']);
                    const start = pointer.actions[0];
                    const end = pointer.actions[2];
                    const delta = vertical ? end.y - start.y : end.x - start.x;
                    assert.equal(delta, ['UP', 'LEFT'].includes(direction) ? pixels : -pixels);
                    assert.equal(end.duration, 300);
                    assert.equal(start.origin, 'viewport');
                    assert.ok([start, end].every(point => point.x >= 0 && point.x < 1000 && point.y >= 0 && point.y < 2000));
                    assert.deepEqual(calls[1], ['release']);
                }
            }
        }
        const { driver, calls } = fixture(platform);
        for (const value of ['', 'SIDE_20', 'UP', 'UP_0', 'DOWN_-2', 'LEFT_1.5', 'UP_20_more', 'UP_9007199254740992']) {
            await assert.rejects(mobileScroll(driver, { value }, platform));
        }
        for (const value of ['UP_2000', 'DOWN_2001', 'LEFT_1000', 'RIGHT_2000']) {
            await assert.rejects(mobileScroll(driver, { value }, platform), /less than/);
        }
        assert.equal(calls.length, 0);
        await assert.rejects(mobileScroll(null, { value: 'UP_300' }, platform), /active/);
        driver.getWindowSize = async () => ({ width: 0, height: 2000 });
        await assert.rejects(mobileScroll(driver, { value: 'UP_300' }, platform), /dimensions/);
        const failure = new Error('Appium gesture failed');
        const broken = fixture(platform, failure);
        await assert.rejects(broken.router.mobileScroll({ value: 'UP_300' }), error => error === failure);
        if (platform === 'android') assert.deepEqual(broken.calls.at(-1), ['release']);
    }
    assert.deepEqual(parseScroll(' down_300 '), { direction: 'down', pixels: 300 });
    await assert.rejects(mobileScroll({}, { value: 'DOWN_300' }, 'windows'), /Unsupported/);
    const cleanup = fixture('android');
    const error = new Error('Release failed');
    cleanup.driver.releaseActions = async () => { throw error; };
    await assert.rejects(cleanup.router.mobileScroll({ value: 'DOWN_300' }), caught => caught === error);
}

async function runnerCheck(platform, phase, failureKind) {
    logged.length = 0;
    const nativeError = failureKind === 'driver' ? new Error('Appium unavailable') : null;
    const context = fixture(platform, nativeError);
    const steps = [
        { id: 1, dataset_id: 11, keyword: { name: 'mobileTap' }, xPath: 'id=field', value: '', [phase + '_step']: [{ mobileScroll: failureKind === 'input' ? 'BAD' : 'DOWN_300' }] },
        { id: 2, dataset_id: 11, keyword: { name: 'mobileTap' }, xPath: 'id=next', value: '' },
    ];
    const automation = new Automation({
        testRunnerStepDataOriginal: [{ id: 10, test_suite: { id: 10 }, steps }],
        testRunner: { id: 20 }, mainWindow: { webContents: { send: () => {} } }, token: '', isReExecuteFlag: false,
    });
    automation.mobileDriver = context.router;
    automation.webDriver.hasValidSession = async () => false;
    automation.webDriver.getFramePathSnapshot = () => [];
    automation.webDriver.resetFrameContextIfNeeded = async () => {};
    automation.saveAndCloseSuite = async () => {};
    automation.canPersistRunnerLogs = () => true;
    const reporter = automation.stepStatusReporter;
    automation.stepStatusReporter = { enqueue: payload => logged.push(payload), flushAll: async () => {} };
    const actions = [];
    const runStep = automation.runStep.bind(automation);
    automation.runStep = async step => {
        if (step.id) actions.push(step.id);
        else {
            actions.push('helper');
            await runStep(step);
        }
    };
    automation.setExecutionDelay(0);
    await automation.iterateSteps();
    assert.deepEqual(actions, phase === 'before' ? ['helper', 1, 2] : [1, 'helper', 2]);
    assert.equal(logged.length, 2);
    assert.ok(logged.every(payload => !payload.error));
    assert.equal(automation.testRunnerSteps[0].steps[0].execution, 2);
    if (stepLog.buildStepStatusEvent) assert.equal(stepLog.buildStepStatusEvent(logged[0]).step.is_passed, true);
    await reporter?.shutdown?.();
}

async function main() {
    await providerChecks();
    for (const platform of ['android', 'ios']) {
        for (const phase of ['before', 'after']) {
            for (const failure of [null, 'input', 'driver']) await runnerCheck(platform, phase, failure);
        }
    }
    console.log('PASS mobileScroll directions, distances, input validation, cleanup and non-failing before/after helper execution');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
