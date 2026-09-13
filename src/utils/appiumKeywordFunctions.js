const { remote, TouchAction } = require('webdriverio');
const mobileOpenApp = async step => {
  // const capabilities = {
  //   platformName: 'Android',
  //   'appium:automationName': 'UiAutomator2',
  //   'appium:deviceName': 'vivo 1907_19',
  //   'appium:appPackage': 'com.android.settings',
  //   'appium:appActivity': '.Settings',
  // };

  let wdOpts = null;
  try {
    wdOpts = {
      hostname: process.env.APPIUM_HOST || '127.0.0.1',
      port: parseInt(process.env.APPIUM_PORT, 10) || 4723,
      logLevel: 'info',
      // capabilities,
      capabilities: JSON.parse(step.value),
    };
    const driver = await remote(wdOpts);
    driver.setTimeout({ implicit: 10000 });
    return driver;
  } catch (error) {
    console.log('error', error);
  }

  //   const batteryItem = await driver.$('//*[@text="Wi-Fi"]');
  //   await batteryItem.click();
  //   await driver.pause(3000);
  //   await driver.back();

  //await mobileSetInputValue(driver,{xPath:'//android.widget.EditText[@text="Search settings"]',value:'hello'})
  //await driver.pause(3000);
  // await driver.touchAction([
  //     { action: 'press', x: 511, y: 1633 },
  //     { action: 'moveTo', x: 481, y: 1065 },
  //     'release'
  //   ]);
  // await driver.pause(3000);

  //const elem = await driver.$('//*[@text="System update"]');
  // scroll to specific element
  //await elem.scrollIntoView();
  // center element within the viewport
  //await elem.scrollIntoView({ block: 'center', inline: 'center' });

  //await mobileTap(driver,{xPath:'//*[@text="Jovi"]'})
  // await mobileTap(driver,{xPath:'//*[@text="Wi-Fi"]'})
  //await driver.pause(3000);
};

const getElement = async (driver, step) => {
  console.log('path', step.xPath);
  const el = await driver.$(step.xPath);
  if (el?.error) {
    throw new Error('Element not found');
  }
  return el;
};

const mobileTap = async (driver, step) => {
  const el = await getElement(driver, step);
  await el.click();
};

const mobileBack = async (driver, step) => {
  await driver.back();
};

const mobileDoubleTap = async (driver, step) => {
  const el = await getElement(driver, step);
  await el.doubleClick();
};

const mobileLongPress = async (driver, step) => {
  const el = await getElement(driver, step);
  // await el.touchAction([
  //     'press',
  //     'release'
  // ])
  const touchAction = new TouchAction(driver);
  await touchAction.longPress({ el }).perform();
};

const mobileFill = async (driver, step) => {
  const el = await getElement(driver, step);
  await el.setValue(step.value);
};

const mobileSwipe = async (driver, step) => {
  // const el=await getElement(driver,step)
  // const touchAction = new TouchAction(driver);
  // await touchAction.press({ el }).moveTo({ x: 100, y: 0 }).release().perform(); //element swipe

  // const touchAction = new TouchAction(driver);
  const startCoordinates = { x: 300, y: 1000 }; // Adjust these coordinates based on your specific case
  const endCoordinates = { x: 300, y: 500 };
  await touchAction
    .press(startCoordinates)
    .wait(1000) // Optional: You can add a wait time to control the speed of the swipe
    .moveTo(endCoordinates)
    .release()
    .perform();
};

const mobileScrollToText = async (
  driver,
  step,
  forward = false,
  backward = false,
) => {
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

  await driver.$(`android=${scrollCommand}`);
};

const mobileElementExist = async (driver, step) => {
  try {
    await getElement(driver, step);
    console.log('mobileElementExists - Element found');
  } catch (error) {
    console.log('mobileElementExists - Element not found');
    throw new Error('Element not found');
  }
};
const mobileElementNotExist = async (driver, step) => {
  try {
    await getElement(driver, step);
    console.log('mobileElementNotExists - Element not found');
    throw new Error('Element Exists');
  } catch (error) {
    console.log('mobileElementNotExists - Element found');
  }
};

//checks if input exits and validate input value
const mobileElementValidate = async (driver, step) => {
  try {
    const el = await getElement(driver, step);
    console.log('mobileElementExists - Element found');
    const value = await el.getText();
    console.log({ value, 'step.value': step.value });
    if (value !== step.value) {
      console.log('Input value not matched');

      throw new Error('Input value not matched');
    } else {
      console.log('Input value matched');
    }
  } catch (error) {
    console.log('mobileElementExists - Element not found');
    throw new Error('Element not found');
  }
};

//Added by Ayaz
const mobileHideKeyboard = async (driver, step) => {
  try {
    // Hide the keyboard
    await driver.hideKeyboard();
    // Wait for a second to ensure the keyboard is hidden
    await driver.sleep(1000);
    console.log('Keyboard hidden successfully');
  } catch (error) {
    console.log('Failed to hide keyboard');
    console.error(error);
  }
};
//Added by Ayaz
const mobileSwitchContext = async (driver, step) => {

  try {
    // Hide the keyboard
    await driver.switchContext(step.value);
    // Wait for a second to ensure the keyboard is hidden
    await driver.sleep(1000);
    console.log('Context Switched successfully');
  } catch (error) {
    console.log('Failed to Switch Context');
    console.error(error);
  }
};

const mobilePinch = async (driver, step) => {
  try {
    // Input Param: step.value should be a string with coordinates "startX1,startY1,endX1,endY1,startX2,startY2,endX2,endY2"
    const coords = step.value.split(',').map(Number);    
    if (coords.length !== 8) {
      throw new Error('Invalid coordinates. Expected format: "startX1,startY1,endX1,endY1,startX2,startY2,endX2,endY2"');
    }

    const [startX1, startY1, endX1, endY1, startX2, startY2, endX2, endY2] = coords;

    // Perform pinch gesture using touchAction
    await driver.touchAction([
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
const mobileDigitalSignature = async (driver, step) => {
  // Find the element
  const element = await getElement(driver, step);

  // Create a new Actions instance
  const actions = driver.actions({ bridge: true });

  // Perform the actions: move to element, click and hold, move by offset, release
  await actions.move({ origin: element })
    .press()
    .move({ origin: element, x: 10, y: 50 })
    .release()
    .perform();
};

module.exports = {
 // launchMobileDriver,
  //mobileTap,
  //mobileDoubleTap,
  //mobileLongPress,
  //mobileSetInputValue,
  //mobileBack,
  //mobileScrollToText,
  //mobileElementExists,
  //mobileElementNotExists,
  //mobileInputExistsAndValidate,
  //mobileHideKeyboard



  //updated by Ayaz
mobileOpenApp,
mobileTap,
mobileDoubleTap,
mobileLongPress,
mobileFill,
mobileBack,
mobileSwipe,
//mobileScrollForward,
//mobileScrollBackward,
mobileScrollToText,
//mobileScrollToElement,
mobileElementExist,
mobileElementNotExist,
mobileElementValidate,
mobileHideKeyboard,
//mobileCloseApp,
mobileSwitchContext,
mobilePinch,
mobileDigitalSignature
};
