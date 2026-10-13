const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let connect;
Module._load = function (name, ...args) {
    if (name === 'webdriverio') return { remote: options => connect(options) };
    return originalLoad.call(this, name, ...args);
};
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;
Module._load = originalLoad;

function fixture(platform) {
    const calls = [];
    const element = {
        getRect: async () => ({ x: 100, y: 200, width: 80, height: 40 }),
        getText: async () => 'Saved successfully',
    };
    const router = new MobileActionsRouter();
    router.platform = platform;
    const driver = {
        sessionId: 'active',
        getTimeouts: async () => ({}),
        setTimeout: async () => {},
        $$: async selector => { calls.push(['lookup', selector]); return [element]; },
        execute: async (...args) => calls.push(args),
        deleteSession: async () => { throw new Error('Unexpected session deletion'); },
    };
    router[platform].driver = driver;
    router[platform].sessionOptions = { capabilities: { platformName: platform } };
    router._syncDriver();
    return { router, driver, element, calls };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
    return { promise, resolve, reject };
}

async function keywordChecks(platform) {
    const { router, driver, element, calls } = fixture(platform);
    const command = platform === 'android' ? 'mobile: clickGesture' : 'mobile: tap';
    const locator = 'id=label';
    for (const [value, point] of [
        ['LEFT_20', { x: 80, y: 220 }], ['RIGHT_30', { x: 210, y: 220 }],
        ['UP_10', { x: 140, y: 190 }], ['DOWN_15', { x: 140, y: 255 }],
        [' right_30 ', { x: 210, y: 220 }], ['LEFT_0', { x: 100, y: 220 }],
    ]) {
        await router.mobileTapOffset({ xPath: locator, value });
        assert.deepEqual(calls.at(-1), [command, point]);
    }
    for (const value of [undefined, null, '', ' ', 'NI', 'ni', 'null', 'anything', 'RIGHT', 'RIGHT_bad', 'SIDE_30', 'RIGHT_-2', 'UP_1.5', 'RIGHT_20_extra', 'LEFT_99999999999999999999']) {
        await router.mobileTapOffset({ xPath: locator, value });
        assert.deepEqual(calls.at(-1), [command, { x: 80, y: 220 }]);
    }
    element.getLocation = async () => ({ x: 100, y: 200 });
    element.getSize = async () => ({ width: 80, height: 40 });
    delete element.getRect;
    await router.mobileTapOffset({ xPath: locator, value: 'RIGHT_30' });
    assert.deepEqual(calls.at(-1), [command, { x: 210, y: 220 }]);
    element.getRect = async () => { throw new Error('unsupported command'); };
    await router.mobileTapOffset({ xPath: locator, value: 'NI' });
    assert.deepEqual(calls.at(-1), [command, { x: 80, y: 220 }]);
    const stale = new Error('stale element reference');
    element.getRect = async () => { throw stale; };
    await assert.rejects(router.mobileTapOffset({ xPath: locator }), error => error === stale);
    element.getRect = async () => ({ x: NaN, y: 200, width: 80, height: 40 });
    await assert.rejects(router.mobileTapOffset({ xPath: locator }), /rectangle/);
    element.getRect = async () => ({ x: 100, y: 200, width: 80, height: 40 });
    for (const value of ['Saved', 'successfully', 'Saved successfully']) {
        await router.mobileToastExist({ xPath: locator, value });
    }
    for (const value of ['saved', 'unsaved', null]) {
        await assert.rejects(router.mobileToastExist({ xPath: locator, value }), /expected step value/);
    }
    for (const actual of ['', null, undefined]) {
        element.getText = async () => actual;
        await assert.rejects(router.mobileToastExist({ xPath: locator, value: '' }), /expected step value/);
    }
    element.getText = async () => 'Saved successfully';
    const failure = new Error('Appium text lookup failed');
    element.getText = async () => { throw failure; };
    await assert.rejects(router.mobileToastExist({ xPath: locator, value: 'Saved' }), error => error === failure);
    element.getText = async () => 'Saved successfully';
    for (const keyword of ['mobileTapOffset', 'mobileToastExist']) {
        await assert.rejects(router[keyword]({ xPath: '', value: 'NI' }), /requires a locator/);
        await assert.rejects(router[keyword]({ xPath: 'unknown=label', value: 'NI' }), /Unsupported/);
        driver.$$ = async () => [];
        await assert.rejects(router[keyword]({ xPath: locator, value: 'Saved' }), /element not found/);
        driver.$$ = async selector => { calls.push(['lookup', selector]); return [{}, element]; };
        await router[keyword]({ xPath: 'accessibilityId=label', value: keyword === 'mobileTapOffset' ? 'NI' : 'Saved', __explicitTargetIndex: 2 });
        assert(calls.some(call => call[0] === 'lookup' && call[1] === '~label'));
        driver.$$ = async () => [element];
    }
    const automation = new Automation({
        testRunnerStepDataOriginal: [], testRunner: { id: 20 },
        mainWindow: { webContents: { send: () => {} } }, token: '', mobileDriver: router,
    });
    automation.webDriver.hasValidSession = async () => false;
    automation.setExecutionDelay(0);
    try {
        await automation.runStep({ keyword: { name: 'mobileTapOffset' }, xPath: locator, value: 'RIGHT_30' });
        assert.deepEqual(calls.at(-1), [command, { x: 210, y: 220 }]);
        await automation.runStep({ keyword: { name: 'mobileToastExist' }, xPath: locator, value: 'Saved' });
        await assert.rejects(automation.runStep({ keyword: { name: 'mobileToastExist' }, xPath: locator, value: 'Wrong' }), /expected step value/);
    } finally {
        await automation.stepStatusReporter?.shutdown?.();
    }
}

async function raceChecks(platform) {
    const { router, driver } = fixture(platform);
    const probe = deferred();
    const started = deferred();
    let oldProbes = 0;
    let newProbes = 0;
    let connections = 0;
    driver.getTimeouts = async () => {
        oldProbes++;
        started.resolve();
        return probe.promise;
    };
    const recovered = { ...driver, sessionId: 'recovered', getTimeouts: async () => { newProbes++; return {}; } };
    connect = async () => { connections++; return recovered; };
    const first = router.ensureSession();
    const second = router.ensureSession();
    await started.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(oldProbes, 1);
    probe.reject(new Error('invalid session id'));
    await Promise.all([first, second]);
    assert.equal(connections, 1);
    assert.equal(oldProbes, 1);
    assert.equal(newProbes, 1);
    assert.equal(router.driver, recovered);
    assert.equal(router[platform].sessionReadiness, null);

    const blocked = deferred();
    const probing = deferred();
    let canceled = false;
    recovered.getTimeouts = async () => { probing.resolve(); return blocked.promise; };
    const active = router.ensureSession();
    const waiting = router.ensureSession(() => { if (canceled) throw new Error('execution_canceled'); });
    const rejected = assert.rejects(waiting, /execution_canceled/);
    await probing.promise;
    canceled = true;
    blocked.resolve({});
    await active;
    await rejected;
    assert.equal(router.driver, recovered);

    router[platform].driver = null;
    connect = async () => { throw new Error('device unavailable'); };
    await assert.rejects(router.ensureSession(), /device unavailable/);
    assert.equal(router[platform].sessionReadiness, null);
    recovered.getTimeouts = async () => ({});
    connect = async () => recovered;
    await router.ensureSession();
    assert.equal(router.driver, recovered);
}

async function main() {
    for (const platform of ['android', 'ios']) {
        await keywordChecks(platform);
        await raceChecks(platform);
    }
    console.log('PASS mobile offset defaults/coordinates, native taps, toast matching, runner wiring and serialized session readiness');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
