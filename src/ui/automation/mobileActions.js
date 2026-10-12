const { remote, TouchAction } = require('webdriverio');
const helperLookup = require('./helperLookup');
const mobileWait = require('./mobileWait');
const { mobileScroll } = require('./mobileScroll');
const mobileCapture = require('./mobileCapture');
const mobileElementActions = require('./mobileElementActions');

class MobileActions{
  async mobileTapOffset(step) {
    return mobileElementActions.mobileTapOffset(this.driver, step, 'android');
  }

  async mobileToastExist(step) {
    return mobileElementActions.mobileToastExist(this.driver, step, 'android');
  }

  async getElementValue(step) {
    return mobileCapture.getElementValue(this.driver, step, 'android');
  }

  async mobileScroll(step) {
    return mobileScroll(this.driver, step, 'android');
  }

  async waitForElement(step) {
    return mobileWait.wait(this.driver, step, 'android', 'waitForElement');
  }

  async waitForText(step) {
    return mobileWait.wait(this.driver, step, 'android', 'waitForText');
  }

  async mobileClear(step) {
    const index = helperLookup.explicitTargetIndex(step, 'mobileClear') ?? 1;
    const selector = helperLookup.parseLocator(step.xPath, {
      xpath: value => value,
      id: value => 'id=' + value,
      accessibilityid: value => '~' + value,
      android: value => 'android=' + value,
    }, 'mobileClear');
    if (!this.driver?.sessionId) {
      throw new Error('mobileClear requires an active Android Appium session.');
    }
    const elements = await this.driver.$$(selector);
    const element = elements[index - 1];
    if (!element) throw new Error('mobileClear element not found.');
    await element.clearValue();
  }

  async ifExist(step) {
    const index = helperLookup.explicitTargetIndex(step);
    const selector = helperLookup.parseLocator(step.xPath, {
      xpath: value => value,
      id: value => 'id=' + value,
      accessibilityid: value => '~' + value,
      android: value => 'android=' + value,
    });
    if (!this.driver?.sessionId) {
      throw new Error('ifExist requires an active Android Appium session.');
    }
    const elements = await helperLookup.immediateLookup(
      () => this.driver.getTimeouts(),
      timeouts => this.driver.setTimeout(timeouts),
      () => this.driver.$$(selector),
    );
    return index == null ? elements.length > 0 : Boolean(elements[index - 1]);
  }
    driver=null;
  async mobileOpenApp ( step ) {
        let wdOpts = null;
        try {
          wdOpts = {
            hostname: process.env.APPIUM_HOST || '127.0.0.1',
            port: parseInt(process.env.APPIUM_PORT, 10) || 4723,
            logLevel: 'info',
            // capabilities,
             capabilities: JSON.parse(step.value),
          };
          this.sessionOptions = structuredClone(wdOpts);
          this.driver = await remote(wdOpts);
          this.driver.setTimeout({ implicit: 10000 });
          if (!this.driver?.sessionId) {
            throw new Error('Mobile app launch failed: no session established');
          }
        } catch (error) {
          this.driver = null;
          const msg = error?.message || String(error);
          const isConnRefused = msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED');
          const reason = isConnRefused
            ? 'Appium server is not running or not reachable'
            : 'Failed to launch app with provided capabilities';
          throw new Error(`${reason}: ${msg}`);
        }
     
      };




 async getElement(step){
    console.log('path', step.xPath);
    const el = await this.driver.$(step.xPath);
    if (el?.error) {
      throw new Error('Element not found');
    }
    return el;
  };
  
  async  mobileTap(step){
    const el = await this.getElement(step);
    await el.click();
  };
  
  async  mobileBack(step){
    await this.driver.back();
  };
  
  async  mobileDoubleTap(step){
    const el = await this.getElement(step);
    await el.doubleClick();
  };
  
  async  mobileLongPress(step){
    const el = await this.getElement(step);
    // await el.touchAction([
    //     'press',
    //     'release'
    // ])
    const touchAction = new TouchAction(this.driver);
    await touchAction.longPress({ el }).perform();
  };
  
  async  mobileFill(step){
    const el = await this.getElement(step);
    await el.setValue(step.value);
  };
  
  async  mobileSwipe(step){
    // const el=await getElement(driver,step)
    // const touchAction = new TouchAction(driver);
    // await touchAction.press({ el }).moveTo({ x: 100, y: 0 }).release().perform(); //element swipe
  
    // const touchAction = new TouchAction(driver);
    const startCoordinates = { x: 300, y: 1000 }; // Adjust these coordinates based on your specific case
    const endCoordinates = { x: 300, y: 500 };
    const touchAction = new TouchAction(this.driver);
    await touchAction
      .press(startCoordinates)
      .wait(1000) // Optional: You can add a wait time to control the speed of the swipe
      .moveTo(endCoordinates)
      .release()
      .perform();
  };
  
  async mobileScrollToTextDirection(step, direction) {
    if (!['up', 'down'].includes(direction)) throw new Error('Unsupported scroll direction: ' + direction);
    if (!this.driver?.sessionId) throw new Error('Directional scroll requires an active Android Appium session.');
    const value = String(step?.value ?? '');
    const indexed = value.match(/^(\d+)_(\d+)_(.*)$/s);
    const containerIndex = indexed ? Number(indexed[1]) : 0;
    const targetIndex = indexed ? Number(indexed[2]) : 0;
    const text = indexed ? indexed[3] : value;
    if (!text.trim()) throw new Error('Directional scroll requires text.');
    if (!Number.isSafeInteger(containerIndex) || !Number.isSafeInteger(targetIndex)) {
      throw new Error('Directional scroll indexes must be non-negative integers.');
    }
    const containerSelector = 'android=new UiSelector().scrollable(true).instance(' + containerIndex + ')';
    const targetSelector = 'android=new UiSelector().text(' + JSON.stringify(text) + ').instance(' + targetIndex + ')';
    let canScrollMore = true;
    for (let attempt = 0; attempt <= 10; attempt++) {
      const containers = await this.driver.$$(containerSelector);
      const container = containers[0];
      if (!container?.elementId) throw new Error('Scrollable container not found: ' + containerIndex);
      const elements = await container.$$(targetSelector);
      for (const element of elements) {
        if (await element.isDisplayed()) return;
      }
      if (!canScrollMore || attempt === 10) break;
      canScrollMore = await this.driver.execute('mobile: scrollGesture', {
        elementId: container.elementId,
        direction,
        percent: 0.8,
      });
    }
    throw new Error('Text not found: ' + text);
  }

  async  mobileScrollToText  (
    step,
    forward = false,
    backward = false,
  ) {
    let scrollableViewIndex = 0;
    let targetIndex = 0;
    let text = step?.value;
    const valArr = step?.value?.split('_');
    if (valArr.length > 1) {
      scrollableViewIndex = valArr[0];
      targetIndex = valArr[1];
      text = valArr.reduce((acc, curr, index) => {
        if (index > 1) {
          acc = acc + (acc === '' ? '' : '_') + curr;
        }
        return acc;
      }, '');
    }
  
    let scrollCommand = `new UiScrollable(new UiSelector().scrollable(true).instance(${scrollableViewIndex})).scrollIntoView(new UiSelector().text("${text}").instance(${targetIndex}))`;
    if (forward) {
      scrollCommand = `new UiScrollable(new UiSelector().scrollable(true).instance(${scrollableViewIndex})).scrollIntoView(new UiSelector().text("${text}")).scrollForward()`;
    }
    if (backward) {
      scrollCommand = `new UiScrollable(new UiSelector().scrollable(true).instance(${scrollableViewIndex})).scrollIntoView(new UiSelector().text("${text}")).scrollBackward()`;
    }
  
    await this.driver.$(`android=${scrollCommand}`);
  };
  
  async  mobileElementExist(step){
    try {
      await this.getElement(step);
      console.log('mobileElementExists - Element found');
    } catch (error) {
      console.log('mobileElementExists - Element not found');
      throw new Error('Element not found');
    }
  };
  async  mobileElementNotExist(step){
    if (!this.driver?.sessionId) {
      throw new Error('mobileElementNotExist requires an active Android Appium session.');
    }
    if (!String(step.xPath ?? '').trim()) {
      throw new Error('mobileElementNotExist requires a locator.');
    }
    const elements = await this.driver.$$(step.xPath);
    if (elements.length > 0) throw new Error('Element Exists');
  };
  
  //checks if input exits and validate input value
  async  mobileElementValidate(step){
    try {
      const el = await this.getElement(step);
      console.log('mobileElementExists - Element found');
      let value = await el.getText();
      if (!value) {
        value = await el.getAttribute('text');
      }
      if (!value) {
        value = await el.getAttribute('value');
      }
      const actual = (value || '').trim();
      const expected = (step.value || '').trim();
      console.log({ actual, expected });
      if (actual !== expected) {
        console.log('Input value not matched');
        throw new Error(`Input value not matched. Expected: '${expected}', Found: '${actual}'`);
      }
      console.log('Input value matched');
    } catch (error) {
      console.log('mobileElementValidate failed', error);
      if (error?.message?.includes('not matched')) {
        throw error;
      }
      throw new Error('Element not found');
    }
  };
  
  //Added by Ayaz
  async  mobileHideKeyboard(step){
    try {
      // Hide the keyboard
      await this.driver.hideKeyboard();
      // Wait for a second to ensure the keyboard is hidden
      await this.driver.sleep(1000);
      console.log('Keyboard hidden successfully');
    } catch (error) {
      console.log('Failed to hide keyboard');
      console.error(error);
    }
  };
  //Added by Ayaz
  async  mobileSwitchContext(step){
  
    try {
      // Hide the keyboard
      await this.driver.switchContext(step.value);
      // Wait for a second to ensure the keyboard is hidden
      await this.driver.sleep(1000);
      console.log('Context Switched successfully');
    } catch (error) {
      console.log('Failed to Switch Context');
      console.error(error);
    }
  };
  
  async  mobilePinch(step){
    try {
      // Input Param: step.value should be a string with coordinates "startX1,startY1,endX1,endY1,startX2,startY2,endX2,endY2"
      const coords = step.value.split(',').map(Number);    
      if (coords.length !== 8) {
        throw new Error('Invalid coordinates. Expected format: "startX1,startY1,endX1,endY1,startX2,startY2,endX2,endY2"');
      }
  
      const [startX1, startY1, endX1, endY1, startX2, startY2, endX2, endY2] = coords;
  
      // Perform pinch gesture using touchAction
      await this.driver.touchAction([
        { action: 'press', x: startX1, y: startY1 },
        { action: 'moveTo', x: endX1, y: endY1 },
        'release',
        { action: 'press', x: startX2, y: startY2 },
        { action: 'moveTo', x: endX2, y: endY2 },
        'release'
      ]);
  
      console.log('Pinch gesture performed successfully');
    } catch (error) {
      console.log('Failed to perform pinch gesture');
      console.error(error);
    }
  };
  
  
  //Added by Ayaz
  async  mobileDigitalSignature(step){
    // Find the element
    const element = await this.getElement(step);
  
    // Create a new Actions instance
    const actions = this.driver.actions({ bridge: true });
  
    // Perform the actions: move to element, click and hold, move by offset, release
    await actions.move({ origin: element })
      .press()
      .move({ origin: element, x: 10, y: 50 })
      .release()
      .perform();
  };
  
  async mobileCloseApp(step) {
    try {
        // Directly use step.value as the appPackage string
        const appPackage = step.value;
        if (!this.driver) {
          console.log('Driver is not initialized.');
          return;
        }
        try {
          await this.driver.terminateApp(appPackage);
          console.log(`${appPackage} has been closed.`);
        } catch (err) {
          console.log('terminateApp failed (ignored)', err?.message || err);
        }
        try {
          await this.driver.deleteSession();
        } catch (err) {
          console.log('deleteSession failed (ignored)', err?.message || err);
        } finally {
          this.driver = null;
        }
    } catch (error) {
        console.log('Error closing the app:', error);
    }
};

}

module.exports={
    MobileActions
}
