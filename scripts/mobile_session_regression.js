const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const originalLoad = Module._load;
let connect;
Module._load = function (name, ...args) {
    if (name === 'webdriverio') return { remote: options => connect(options) };
    return originalLoad.call(this, name, ...args);
};
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const { recoveryCapabilities } = require('../src/ui/automation/mobileSession');
const engines = require('../src/ui/automation');
const Automation = engines.FastTrackAutomation || engines.QafOnPremAutomation;
Module._load = originalLoad;

function fixture(platform) {
    const events = [];
    const driver = {
        sessionId: 'live-session',
        getTimeouts: async () => { events.push('probe'); return { implicit: 10000 }; },
        setTimeout: async () => events.push('timeout'),
        deleteSession: async () => events.push('delete'),
        terminateApp: async () => events.push('terminate'),
        $: async () => ({ click: async () => events.push('action') }),
    };
    const router = new MobileActionsRouter();
    router.platform = platform;
    router[platform].driver = driver;
    router[platform].sessionOptions = { hostname: 'saved-host', port: 4723, capabilities: { platformName: platform, 'appium:deviceName': 'saved-device', 'appium:noReset': false } };
    router._syncDriver();
    connect = async () => { throw new Error('Unexpected connection'); };
    return { router, provider: router[platform], driver, events };
}

function engine(router) {
    const automation = new Automation({
        testRunnerStepDataOriginal: [],
        testRunner: { id: 20 },
        mainWindow: { webContents: { send: () => {} } },
        token: '',
        mobileDriver: router,
    });
    automation.webDriver.hasValidSession = async () => false;
    automation.setExecutionDelay(0);
    return automation;
}

const tap = { keyword: { name: 'mobileTap' }, xPath: 'id=button', value: '' };

async function checks(platform) {
    const context = fixture(platform);
    const automation = engine(context.router);
    try {
        await automation.runStep(tap);
        assert.deepEqual(context.events, ['probe', 'action']);
        context.events.length = 0;
        const saved = structuredClone(context.provider.sessionOptions);
        context.driver.getTimeouts = async () => { context.events.push('lost'); throw new Error('invalid session id'); };
        let connections = 0;
        const recovered = { ...context.driver, sessionId: 'recovered', getTimeouts: async () => { context.events.push('probe'); return {}; } };
        connect = async options => {
            connections++;
            assert.equal(options.hostname, saved.hostname);
            assert.equal(options.port, saved.port);
            assert.equal(options.capabilities['appium:noReset'], true);
            assert.equal(options.capabilities['appium:fullReset'], false);
            assert.equal(options.capabilities['appium:forceAppLaunch'], false);
            assert.equal(options.capabilities['appium:shouldTerminateApp'], false);
            assert.equal(options.capabilities['appium:dontStopAppOnReset'], platform === 'android' ? true : undefined);
            context.events.push('reconnect');
            return recovered;
        };
        await automation.runStep(tap);
        assert.deepEqual(context.events, ['lost', 'reconnect', 'timeout', 'action']);
        assert.equal(connections, 1);
        const originalLookup = recovered.$;
        recovered.$ = async () => ({ click: async () => { throw new Error('Action failed'); } });
        await assert.rejects(automation.runStep(tap), /Action failed/);
        assert.equal(connections, 1);
        recovered.$ = originalLookup;
        assert.equal(context.router.driver, recovered);
        assert.equal(context.provider.driver, recovered);
        assert.deepEqual(context.provider.sessionOptions, saved);
        context.provider.driver = null;
        await Promise.all([context.router.ensureSession(), context.router.ensureSession()]);
        assert.equal(connections, 2);
        context.events.length = 0;
        context.provider.driver = null;
        connect = async () => { throw new Error('Device disconnected'); };
        await assert.rejects(automation.runStep(tap), /Mobile session recovery failed.*Device disconnected/);
        assert.deepEqual(context.events, []);
        connect = async () => recovered;
        await automation.runStep(tap);
        assert.deepEqual(context.events, ['timeout', 'action']);
        context.events.length = 0;
        let release;
        let started;
        const connecting = new Promise(resolve => { started = resolve; });
        connect = async () => { started(); return new Promise(resolve => { release = resolve; }); };
        context.provider.driver = null;
        let canceled = false;
        const pending = context.router.ensureSession(() => { if (canceled) throw new Error('execution_canceled'); });
        await connecting;
        canceled = true;
        release(recovered);
        await assert.rejects(pending, /execution_canceled/);
        assert.equal(context.provider.driver, recovered);
        assert.deepEqual(context.events, ['timeout']);
        context.events.length = 0;
        await assert.rejects(context.router.ensureSession(() => { throw new Error('execution_canceled'); }), /execution_canceled/);
        assert.deepEqual(context.events, []);
        automation.webDriver.driver = { quit: async () => context.events.push('web-quit') };
        await automation.destoryDrivers();
        assert.deepEqual(context.events, ['web-quit']);
        assert.equal(context.provider.driver, recovered);
        await automation.destorySession();
        assert.equal(context.provider.driver, recovered);
        assert.deepEqual(context.provider.sessionOptions, saved);
        const next = engine(context.router);
        try {
            context.events.length = 0;
            await next.runStep(tap);
            assert.deepEqual(context.events, ['probe', 'action']);
            context.events.length = 0;
            connect = async () => recovered;
            await context.router.mobileOpenApp({ value: JSON.stringify(saved.capabilities) });
            assert.equal(context.events.includes('delete'), false);
            assert.deepEqual(context.provider.sessionOptions.capabilities, saved.capabilities);
            context.events.length = 0;
            await next.runStep({ keyword: { name: 'mobileCloseApp' }, value: 'example.app' });
            assert.deepEqual(context.events, ['probe', 'terminate', 'delete']);
            assert.equal(context.provider.driver, null);
            assert.equal(context.provider.sessionOptions, null);
            assert.equal(context.router.driver, null);
            await assert.rejects(next.runStep(tap), /active Appium session/);
        } finally {
            await next.stepStatusReporter?.shutdown?.();
        }
    } finally {
        await automation.stepStatusReporter?.shutdown?.();
    }
}

async function cancellationChecks(platform) {
    for (const mode of ['stop', 'destroy', 'probe']) {
        const context = fixture(platform);
        const automation = engine(context.router);
        automation.testRunnerSteps = [{ steps: [] }];
        let release;
        let started;
        const connecting = new Promise(resolve => { started = resolve; });
        if (mode === 'probe') {
            context.driver.getTimeouts = async () => {
                started();
                return new Promise(resolve => { release = () => resolve({}); });
            };
        } else {
            context.provider.driver = null;
            connect = async () => {
                started();
                return new Promise(resolve => { release = () => resolve(context.driver); });
            };
        }
        const pending = automation.runStep(tap);
        const rejected = assert.rejects(pending, /execution_canceled|canceled/i);
        await connecting;
        try {
            if (mode === 'destroy') {
                await automation.destorySession();
            } else if (automation.requestCancel) {
                automation.requestCancel('canceled');
            } else {
                await automation.requestCancelAndReset({ immediate: true, waitMs: 1 });
            }
            release();
            await rejected;
            assert.equal(context.provider.driver, context.driver);
            assert.equal(context.events.includes('action'), false);
            assert.equal(context.events.includes('delete'), false);
            assert.equal(context.events.includes('terminate'), false);
        } finally {
            await automation.stepStatusReporter?.shutdown?.();
        }
    }
}

async function main() {
    for (const platform of ['android', 'ios']) {
        for (const caps of [
            { noReset: false, 'appium:fullReset': true, 'appium:options': { noReset: false, forceAppLaunch: true, deviceName: 'keep' } },
            { alwaysMatch: { 'appium:noReset': false }, firstMatch: [{ 'appium:options': { noReset: false, shouldTerminateApp: true, deviceName: 'keep' } }] },
        ]) {
            const original = structuredClone(caps);
            const result = recoveryCapabilities(caps, platform);
            const effective = result.alwaysMatch || result;
            assert.equal(effective['appium:noReset'], true);
            assert.equal(effective['appium:shouldTerminateApp'], false);
            assert.equal(effective['appium:fullReset'], false);
            assert.equal(effective['appium:forceAppLaunch'], false);
            const nested = result.firstMatch?.[0]?.['appium:options'] || result['appium:options'];
            assert.equal(nested.noReset, undefined);
            assert.equal(nested.deviceName, 'keep');
            assert.deepEqual(caps, original);
        }
        await checks(platform);
        await cancellationChecks(platform);
    }
    for (const file of ['src/index.js', 'src/ui/automation/index.js']) {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.doesNotMatch(source, /\.deleteSession\s*\(/);
    }
    const mainSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    assert.match(mainSource, /mobileDriver: playerMobileDriver/);
    console.log('PASS mobile session probing, recovery, cancellation, preservation, explicit close and capability isolation');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
