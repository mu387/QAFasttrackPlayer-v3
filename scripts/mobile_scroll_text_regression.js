const assert = require('node:assert/strict');
const { MobileActionsRouter } = require('../src/ui/automation/mobileActionsRouter');
const legacy = require('../src/utils/appiumKeywordFunctionsIOS');

async function check(invoke) {
    for (const text of ['Order Status', 'Order_Status', 'Order_Status_Pending', '2_0_Order Status', '_Order_Status_', "Customer's_Order_Status"]) {
        const selectors = [];
        const scrolls = [];
        const driver = {
            $: async selector => {
                selectors.push(selector);
                return { isExisting: async () => selectors.length === 2 };
            },
            execute: async (...args) => scrolls.push(args),
        };
        await invoke(driver, { value: text });
        const escaped = text.replace(/'/g, "\\'");
        const expected = `-ios predicate string:(label CONTAINS '${escaped}' OR name CONTAINS '${escaped}' OR value CONTAINS '${escaped}')`;
        assert.deepEqual(selectors, [expected, expected]);
        assert.deepEqual(scrolls, [['mobile: scroll', { direction: 'down' }]]);
    }
    let scrolls = 0;
    let queries = 0;
    await assert.rejects(invoke({
        $: async () => {
            queries += 1;
            return { isExisting: async () => false };
        },
        execute: async () => { scrolls += 1; },
    }, { value: 'Order_Status_Pending' }), /^Error: Text not found: Order_Status_Pending$/);
    assert.equal(queries, 10);
    assert.equal(scrolls, 10);
    const failure = new Error('Appium lookup failed');
    await assert.rejects(invoke({
        $: async () => { throw failure; },
    }, { value: 'Order_Status' }), error => error === failure);
}

async function main() {
    const router = new MobileActionsRouter();
    router.platform = 'ios';
    router.android.mobileScrollToText = async () => { throw new Error('Wrong platform'); };
    await check(async (driver, step) => {
        router.ios.driver = driver;
        return router.mobileScrollToText(step);
    });
    await check(legacy.mobileScrollToTextIOS);
    const android = new MobileActionsRouter();
    let selector;
    android.android.driver = { $: async value => { selector = value; return {}; } };
    await android.mobileScrollToText({ value: '2_0_Order_Status' });
    assert.match(selector, /scrollable\(true\)\.instance\(2\)/);
    assert.match(selector, /text\("Order_Status"\)\.instance\(0\)/);
    console.log('PASS iOS full scroll text in active and legacy paths; Android indexed input unchanged');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
