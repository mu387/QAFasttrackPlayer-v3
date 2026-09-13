const { remote } = require('webdriverio');

class MobileActionsIOS {
  driver = null;

  async mobileOpenAppIOS(step) {
    let wdOpts = null;
    try {
      wdOpts = {
        hostname: process.env.APPIUM_HOST || '127.0.0.1',
        port: parseInt(process.env.APPIUM_PORT, 10) || 4723,
        logLevel: 'info',
        capabilities: JSON.parse(step.value),
      };
      this.driver = await remote(wdOpts);
      this.driver.setTimeout({ implicit: 10000 });
    } catch (error) {
      console.log('error', error);
    }
  }

  async getElementIOS(step) {
    const el = await this.driver.$(step.xPath);
    if (el?.error) throw new Error('Element not found');
    return el;
  }

  async mobileTapIOS(step) {
    const el = await this.getElementIOS(step);
    await el.click();
  }

  async mobileBackIOS(step) {
    await this.driver.back();
  }

  async mobileDoubleTapIOS(step) {
    const el = await this.getElementIOS(step);
    await el.doubleClick();
  }

  async mobileLongPressIOS(step) {
    const el = await this.getElementIOS(step);
    const rect = await el.getRect();
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    await this.driver.execute('mobile: touchAndHold', { x, y, duration: 1.0 });
  }

  async mobileFillIOS(step) {
    const el = await this.getElementIOS(step);
    await el.setValue(step.value);
  }

  async mobileSwipeIOS(step) {
    const direction = (step.value || 'up').toLowerCase();
    const allowed = new Set(['up', 'down', 'left', 'right']);
    await this.driver.execute('mobile: swipe', {
      direction: allowed.has(direction) ? direction : 'up',
    });
  }

  async mobileScrollToTextIOS(step) {
    let text = step?.value || '';
    const valArr = text.split('_');
    if (valArr.length > 1) {
      text = valArr.slice(2).join('_') || text;
    }

    const escaped = String(text).replace(/'/g, "\\'");
    const selector = `-ios predicate string:(label CONTAINS '${escaped}' OR name CONTAINS '${escaped}' OR value CONTAINS '${escaped}')`;

    for (let i = 0; i < 10; i++) {
      const el = await this.driver.$(selector);
      if (await el.isExisting()) return;
      await this.driver.execute('mobile: scroll', { direction: 'down' });
    }
    throw new Error(`Text not found: ${text}`);
  }

  async mobileElementExistIOS(step) {
    const el = await this.getElementIOS(step);
    if (!(await el.isExisting())) throw new Error('Element not found');
  }

  async mobileElementNotExistIOS(step) {
    const el = await this.driver.$(step.xPath);
    if (await el.isExisting()) throw new Error('Element Exists');
  }

  async mobileElementValidateIOS(step) {
    const el = await this.getElementIOS(step);
    const value = await el.getText();
    if (value !== step.value) throw new Error('Input value not matched');
  }

  async mobileHideKeyboardIOS(step) {
    try {
      await this.driver.hideKeyboard();
      await this.driver.pause(300);
    } catch (error) {
      console.log('Failed to hide keyboard');
      console.error(error);
    }
  }

  async mobileSwitchContextIOS(step) {
    await this.driver.switchContext(step.value);
    await this.driver.pause(300);
  }

  async mobilePinchIOS(step) {
    const parts = String(step.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const scale = Number(parts[0] ?? 0.5);
    const velocity = Number(parts[1] ?? -1);
    await this.driver.execute('mobile: pinch', { scale, velocity });
  }

  async mobileDigitalSignatureIOS(step) {
    const el = await this.getElementIOS(step);
    const rect = await el.getRect();
    const startX = Math.floor(rect.x + rect.width * 0.2);
    const startY = Math.floor(rect.y + rect.height * 0.5);
    const endX = Math.floor(rect.x + rect.width * 0.8);
    const endY = Math.floor(rect.y + rect.height * 0.6);

    await this.driver.performActions([
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
    await this.driver.releaseActions();
  }

  async mobileCloseAppIOS(step) {
    try {
      const bundleId = step.value;
      if (!this.driver) return;
      await this.driver.terminateApp(bundleId);
    } catch (error) {
      console.log('Error closing the app:', error);
    }
  }
}

module.exports = { MobileActionsIOS };