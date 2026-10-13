const { remote } = require('webdriverio');

function recoveryCapabilities(capabilities, platform) {
    const result = structuredClone(capabilities);
    const values = {
        noReset: true,
        fullReset: false,
        forceAppLaunch: false,
        shouldTerminateApp: false,
        ...(platform === 'android' ? { dontStopAppOnReset: true } : {}),
    };
    const clearOverrides = target => {
        for (const name of Object.keys(values)) {
            delete target[name];
            delete target['appium:' + name];
            if (target['appium:options']) {
                delete target['appium:options'][name];
                delete target['appium:options']['appium:' + name];
            }
        }
    };
    const apply = target => {
        clearOverrides(target);
        for (const [name, value] of Object.entries(values)) target['appium:' + name] = value;
    };
    if (result.alwaysMatch || result.firstMatch) {
        result.alwaysMatch ??= {};
        apply(result.alwaysMatch);
        for (const match of result.firstMatch || []) clearOverrides(match);
    } else {
        apply(result);
    }
    return result;
}

function createMobileCancellationCheck(context) {
    const router = context.mobileDriver;
    const steps = context.testRunnerSteps;
    return () => {
        context.throwIfCancellationRequested?.();
        context.ensureNotCanceled?.();
        if (context.mobileDriver !== router || context.testRunnerSteps !== steps) {
            const error = new Error('execution_canceled');
            error.code = 'RUN_CANCELED';
            throw error;
        }
    };
}

async function ensureMobileSession(router, checkCancellation = () => {}) {
    checkCancellation();
    const platform = router.platform;
    const provider = platform === 'ios' ? router.ios : router.android;
    const previous = provider.sessionReadiness || Promise.resolve();
    const readiness = previous.catch(() => {}).then(async () => {
        checkCancellation();
        let valid = false;
        if (provider.driver?.sessionId) {
            try {
                await provider.driver.getTimeouts();
                valid = true;
            } catch (_) {}
        }
        checkCancellation();
        if (valid) {
            router._syncDriver();
            return;
        }
        if (!provider.sessionOptions) {
            throw new Error('Mobile execution requires an active Appium session. Run mobileOpenApp with device capabilities before executing mobile steps.');
        }
        try {
            const options = structuredClone(provider.sessionOptions);
            options.capabilities = recoveryCapabilities(options.capabilities, platform);
            const driver = await remote(options);
            if (!driver?.sessionId) throw new Error('Appium did not establish a session.');
            provider.driver = driver;
            router._syncDriver();
            await driver.setTimeout({ implicit: 10000 });
        } catch (error) {
            checkCancellation();
            throw new Error('Mobile session recovery failed. Check the connected device and Appium server: ' + (error?.message || String(error)));
        }
        checkCancellation();
    });
    provider.sessionReadiness = readiness;
    try {
        await readiness;
        checkCancellation();
    } finally {
        if (provider.sessionReadiness === readiness) provider.sessionReadiness = null;
    }
}

module.exports = { recoveryCapabilities, ensureMobileSession, createMobileCancellationCheck };
