const assert = require('node:assert/strict');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const legacy = require('../src/utils/appiumKeywordFunctions');

async function check(invoke) {
    const step = { xPath: '//field' };
    for (const count of [0, 1, 2]) {
        let queries = 0;
        const driver = {
            sessionId: 'test-session',
            $$: async selector => {
                assert.equal(selector, step.xPath);
                queries += 1;
                return Array.from({ length: count }, () => ({}));
            },
        };
        if (count === 0) await invoke(driver, step);
        else await assert.rejects(invoke(driver, step), /^Error: Element Exists$/);
        assert.equal(queries, 1);
    }
    for (const driver of [null, {}, { sessionId: '' }]) {
        await assert.rejects(invoke(driver, step), /active Android Appium session/);
    }
    for (const locator of [undefined, '', '   ']) {
        await assert.rejects(invoke({ sessionId: 'test-session' }, { xPath: locator }), /requires a locator/);
    }
    for (const message of ['invalid selector', 'invalid session id', 'Appium connection failed', 'unsupported locator strategy']) {
        const failure = new Error(message);
        await assert.rejects(invoke({
            sessionId: 'stale-session',
            $$: async () => { throw failure; },
        }, step), error => error === failure);
    }
}

async function main() {
    const router = new MobileActionsRouter();
    router.platform = 'android';
    router.ios.mobileElementNotExistIOS = async () => { throw new Error('Wrong platform'); };
    await check(async (driver, step) => {
        router.android.driver = driver;
        return router.mobileElementNotExist(step);
    });
    await check(legacy.mobileElementNotExist);
    console.log('PASS Android mobileElementNotExist: absent passes; present, missing locator, inactive session and lookup errors fail in active and legacy paths');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
