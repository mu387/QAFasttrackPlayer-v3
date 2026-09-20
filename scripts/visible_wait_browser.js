const assert = require('node:assert/strict');
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { WebActions } = require('../src/ui/automation/webActions');
const legacy = require('../src/utils/keywordFunction');

async function main() {
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new')).build();
  try {
    const wa = new WebActions();
    wa.driver = driver;
    for (const [name, textWait, elementWait] of [
      ['automation', step => wa.waitForText(step), step => wa.waitForElement(step)],
      ['legacy', step => legacy.waitForText(driver, step), step => legacy.waitForElement(driver, step)],
    ]) {
      await driver.get('data:text/html,<div id="scope"><span style="display:none">Secret</span><span>Ready</span></div><div id="target" style="display:none">Later</div>');
      await textWait({ value: 'text=Secret >> scope=id=scope >> state=notexist >> timeout=1000' });
      await textWait({ value: 'text=Ready >> scope=id=scope >> match=exact >> timeout=1000' });
      await elementWait({ value: 'state=notexist >> target=id=target >> timeout=1000' });
      await driver.executeScript("setTimeout(() => document.getElementById('target').style.display='block', 350)");
      await elementWait({ value: 'state=exist >> target=id=target >> timeout=2000' });
      await driver.executeScript("setTimeout(() => { const el=document.createElement('div'); el.id='late'; el.textContent='Arrived'; document.body.append(el); },350)");
      await textWait({ value: 'text=Arrived >> scope=id=late >> timeout=2000' });
      await driver.executeScript("document.getElementById('scope').style.display='none'");
      await textWait({ value: 'text=Ready >> scope=id=scope >> state=notexist >> timeout=1000' });
      await assert.rejects(textWait({ value: 'text=Ready >> scope=css=[ >> state=notexist >> timeout=1000' }));
      await assert.rejects(textWait({ value: 'text=Absent >> timeout=250' }), /timed out/);
      console.log('PASS browser ' + name + ': hidden text, exact match, hidden ancestor, delayed element/scope, invalid selector, timeout');
    }
    await driver.get('data:text/html,<iframe srcdoc="<div id=inside>Frame Ready</div>"></iframe>');
    await driver.switchTo().frame(0);
    await wa.waitForText({ value: 'text=Frame Ready >> scope=id=inside >> timeout=1000' });
    await driver.switchTo().defaultContent();
    await driver.executeScript("const host=document.createElement('div'); document.body.append(host); window.__qaCurrentShadowRoot=host.attachShadow({mode:'open'}); window.__qaCurrentShadowRoot.innerHTML='<div id=shadow>Shadow Ready</div>';");
    await wa.waitForText({ value: 'text=Shadow Ready >> scope=id=shadow >> timeout=1000' });
    console.log('PASS browser active iframe and shadow scope');
  } finally { await driver.quit(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
