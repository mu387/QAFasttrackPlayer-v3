const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Browser } = require('selenium-webdriver');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const web = read('src/ui/automation/webActions.js');
const start = web.indexOf('    async launchBrowser(');
const end = web.indexOf('        console.log(`[launchBrowser]', start);
assert.ok(start >= 0 && end > start);
const validate = vm.runInNewContext(`({${web.slice(start, end)} return browserName; }}).launchBrowser`, { Browser });

async function run() {
    for (const value of [undefined, null, '', ' ', 'NI', 'ni', 'unknown', 'TOSTRING']) {
        await assert.rejects(validate({ value }), /Invalid browser value/);
    }
    for (const [key, value] of Object.entries(Browser)) {
        assert.equal(await validate({ value: key }), value);
        assert.equal(await validate({ value: ` ${value.toUpperCase()} ` }), value);
    }
    const main = read('src/index.js');
    const serverStart = main.slice(main.indexOf("server.once('listening'"));
    assert.ok(!serverStart.includes('isReExecuteFlag = false;'));
    assert.ok(main.includes("isReExecuteFlag = persisted.reExecuteOnFail === true || persisted.reExecuteOnFail === 'true'"));
    const html = read('src/ui/home.html');
    assert.equal((html.match(/id="textActions"/g) || []).length, 1);
    const home = read('src/ui/home.js');
    const scrollStart = home.indexOf("const logViewport = td.closest('.log-table-scroll');");
    const scrollEnd = home.indexOf('}, 100)', scrollStart);
    assert.ok(scrollStart >= 0 && scrollEnd > scrollStart);
    let result;
    const viewport = {
        scrollTop: 100, clientHeight: 200,
        getBoundingClientRect: () => ({ top: 300 }),
        scrollTo: options => { result = options; },
    };
    vm.runInNewContext(home.slice(scrollStart, scrollEnd), {
        td: { closest: () => viewport, getBoundingClientRect: () => ({ top: 600, height: 20 }) },
    });
    assert.equal(result.top, 310);
    assert.equal(result.behavior, 'smooth');
    assert.match(read('src/ui/style.css'), /#runnerWorkspace #collapseOne\s*\{[^}]*max-height: 40vh;[^}]*overflow-y: auto;/);
    console.log('Browser failure and scoped log scrolling checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
