const assert = require('node:assert/strict');
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { WebActions } = require('../src/ui/automation/webActions');

async function main() {
    const driver = await new Builder().forBrowser('chrome')
        .setChromeOptions(new chrome.Options().addArguments('--headless=new')).build();
    try {
        const provider = new WebActions();
        provider.driver = driver;
        await driver.manage().setTimeouts({ implicit: 10000 });
        await driver.get('data:text/html,' + encodeURIComponent('<button id="close">Close</button><button hidden id="hidden">Hidden</button><iframe srcdoc="<button id=inside>Inside</button>"></iframe>'));
        assert.equal(await provider.ifExist({ xPath: 'id=close' }), true);
        assert.equal(await provider.ifExist({ xPath: 'id=hidden' }), true);
        const started = Date.now();
        assert.equal(await provider.ifExist({ xPath: 'id=missing' }), false);
        assert.ok(Date.now() - started < 3000, 'Absent lookup must not wait for the 10-second implicit timeout');
        assert.equal((await driver.manage().getTimeouts()).implicit, 10000);
        assert.equal(await provider.ifExist({ xPath: '//button[2]' }), true);
        assert.equal(await provider.ifExist({ xPath: '//button[3]' }), false);
        await assert.rejects(provider.ifExist({ xPath: 'xpath=//*[' }));
        assert.equal((await driver.manage().getTimeouts()).implicit, 10000);
        await driver.switchTo().frame(0);
        assert.equal(await provider.ifExist({ xPath: 'id=inside' }), true);
        assert.equal(await provider.ifExist({ xPath: 'id=close' }), false);
        await driver.switchTo().defaultContent();
        assert.equal(await provider.ifExist({ xPath: 'id=close' }), true);
        await driver.quit();
        await assert.rejects(provider.ifExist({ xPath: 'id=close' }));
        console.log('PASS real browser ifExist presence, absence, invalid locator/session, iframe scope and timeout restoration');
    } finally {
        try { await driver.quit(); } catch {}
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
