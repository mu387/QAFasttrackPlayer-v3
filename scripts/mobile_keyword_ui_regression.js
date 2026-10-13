const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { executeManualMobileKeyword } = require('../src/ui/automation/manualMobileKeywords');

async function main() {
    const calls = [];
    const router = {
        ensureSession: async () => calls.push('ready'),
        mobileTapOffset: async step => calls.push(step),
        mobileToastExist: async step => calls.push(step),
    };
    for (const keyword of ['mobileTapOffset', 'mobileToastExist']) {
        calls.length = 0;
        const result = await executeManualMobileKeyword(router, { keyword, locator: 'id=label', value: 'NI' });
        assert.equal(result.ok, true);
        assert.equal(calls[0], 'ready');
        assert.equal(calls[1].keyword.name, keyword);
        assert.equal(calls[1].xPath, 'id=label');
    }
    assert.equal(await executeManualMobileKeyword(router, { keyword: 'click' }), null);
    assert.equal(await executeManualMobileKeyword(router, { keyword: 'constructor' }), null);
    router.ensureSession = async () => { throw new Error('No device'); };
    assert.deepEqual(await executeManualMobileKeyword(router, { keyword: 'mobileTapOffset' }), { ok: false, output: 'No device' });
    router.ensureSession = async () => calls.push('ready');

    const home = fs.readFileSync(path.join(__dirname, '../src/ui/home.js'), 'utf8');
    const options = [];
    const reExecuteOptions = [];
    const start = home.indexOf('const keywordArr = [');
    const finish = home.indexOf('\n});', home.indexOf('keywordArr.forEach', start)) + 4;
    vm.runInNewContext(home.slice(start, finish), {
        document: { createElement: () => ({ cloneNode() { return { ...this }; } }) },
        testKeyword: { append: option => options.push(option) },
        reExecuteModalKeyword: { append: option => reExecuteOptions.push(option) },
    });
    for (const keyword of ['mobileTapOffset', 'mobileToastExist']) {
        assert.equal(options.filter(option => option.value === keyword).length, 1);
        assert.equal(reExecuteOptions.filter(option => option.value === keyword).length, 1);
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const handlerStart = source.indexOf('const testExecute = async');
    const handlerEnd = source.indexOf('\nconst ', handlerStart + 1);
    const output = [];
    const handler = vm.runInNewContext(source.slice(handlerStart, handlerEnd) + '\ntestExecute;', {
        executeManualMobileKeyword, playerMobileDriver: router,
        mainWindow: { webContents: { send: (...args) => output.push(args) } },
        process: { env: {} }, console: { log: () => {} },
    });
    for (const keyword of ['mobileTapOffset', 'mobileToastExist']) {
        const result = await handler(null, { locator: 'id=label', keyword, value: 'Saved' });
        assert.equal(result.ok, true);
        assert.equal(output.at(-1)[1].output, keyword + ' completed.');
    }
    console.log('PASS keyword dropdowns, re-execute options and manual mobile IPC without browser dependency');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
