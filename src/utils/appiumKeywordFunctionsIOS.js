const { remote } = require('webdriverio');

const mobileOpenAppIOS = async step => {
  let wdOpts = null;
  try {
    wdOpts = {
      hostname: process.env.APPIUM_HOST || '127.0.0.1',
      port: parseInt(process.env.APPIUM_PORT, 10) || 4723,
      logLevel: 'info',
      capabilities: JSON.parse(step.value),
    };
    const driver = await remote(wdOpts);
    driver.setTimeout({ implicit: 10000 });
    return driver;
  } catch (error) {
    console.log('error', error);
  }
};

const mobileTapIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  await el.click();
};

const mobileBackIOS = async (driver, step) => {
  await driver.back();
};

const mobileDoubleTapIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  await el.doubleClick();
};

const mobileLongPressIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  const rect = await el.getRect();
  const x = Math.floor(rect.x + rect.width / 2);
  const y = Math.floor(rect.y + rect.height / 2);
  await driver.execute('mobile: touchAndHold', { x, y, duration: 1.0 });
};

const mobileFillIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  await el.setValue(step.value);
};

const mobileSwipeIOS = async (driver, step) => {
  const direction = (step.value || 'up').toLowerCase();
  const allowed = new Set(['up', 'down', 'left', 'right']);
  await driver.execute('mobile: swipe', {
    direction: allowed.has(direction) ? direction : 'up',
  });
};

const mobileScrollToTextIOS = async (driver, step) => {
  let text = step?.value || '';
  const valArr = text.split('_');
  if (valArr.length > 1) text = valArr.slice(2).join('_') || text;

  const escaped = String(text).replace(/'/g, "\\'");
  const selector = `-ios predicate string:(label CONTAINS '${escaped}' OR name CONTAINS '${escaped}' OR value CONTAINS '${escaped}')`;
  for (let i = 0; i < 10; i++) {
    const el = await driver.$(selector);
    if (await el.isExisting()) return;
    await driver.execute('mobile: scroll', { direction: 'down' });
  }
  throw new Error(`Text not found: ${text}`);
};

const mobileElementExistIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  if (!(await el.isExisting())) throw new Error('Element not found');
};

const mobileElementNotExistIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  if (await el.isExisting()) throw new Error('Element Exists');
};

const mobileElementValidateIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  const value = await el.getText();
  if (value !== step.value) throw new Error('Input value not matched');
};

const mobileHideKeyboardIOS = async (driver, step) => {
  await driver.hideKeyboard();
};

const mobileSwitchContextIOS = async (driver, step) => {
  await driver.switchContext(step.value);
};

const mobilePinchIOS = async (driver, step) => {
  const parts = String(step.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const scale = Number(parts[0] ?? 0.5);
  const velocity = Number(parts[1] ?? -1);
  await driver.execute('mobile: pinch', { scale, velocity });
};

const mobileDigitalSignatureIOS = async (driver, step) => {
  const el = await driver.$(step.xPath);
  const rect = await el.getRect();
  const startX = Math.floor(rect.x + rect.width * 0.2);
  const startY = Math.floor(rect.y + rect.height * 0.5);
  const endX = Math.floor(rect.x + rect.width * 0.8);
  const endY = Math.floor(rect.y + rect.height * 0.6);
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 400, x: endX, y: endY },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await driver.releaseActions();
};

const mobileCloseAppIOS = async (driver, step) => {
  const bundleId = step.value;
  await driver.terminateApp(bundleId);
};

module.exports = {
  mobileOpenAppIOS,
  mobileTapIOS,
  mobileBackIOS,
  mobileDoubleTapIOS,
  mobileLongPressIOS,
  mobileFillIOS,
  mobileSwipeIOS,
  mobileScrollToTextIOS,
  mobileElementExistIOS,
  mobileElementNotExistIOS,
  mobileElementValidateIOS,
  mobileHideKeyboardIOS,
  mobileSwitchContextIOS,
  mobilePinchIOS,
  mobileDigitalSignatureIOS,
  mobileCloseAppIOS,
};

