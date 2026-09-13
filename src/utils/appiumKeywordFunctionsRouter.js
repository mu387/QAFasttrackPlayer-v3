const android = require('./appiumKeywordFunctions');
const ios = require('./appiumKeywordFunctionsIOS');

let currentPlatform = 'android';

const detectPlatform = caps => {
  const platformName =
    caps?.platformName ??
    caps?.['appium:platformName'] ??
    caps?.alwaysMatch?.platformName ??
    caps?.alwaysMatch?.['appium:platformName'];
  return /ios/i.test(String(platformName || '')) ? 'ios' : 'android';
};

const ensurePlatformFromDriver = driver => {
  if (!driver) return currentPlatform;
  const caps = driver.capabilities || {};
  currentPlatform = detectPlatform(caps);
  return currentPlatform;
};

const mobileOpenApp = async step => {
  let caps = null;
  try {
    caps = JSON.parse(step.value);
  } catch (err) {
    caps = null;
  }
  currentPlatform = detectPlatform(caps);
  return currentPlatform === 'ios'
    ? ios.mobileOpenAppIOS(step)
    : android.mobileOpenApp(step);
};

const mobileCloseApp = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  if (!driver) return;
  return platform === 'ios'
    ? ios.mobileCloseAppIOS(driver, step)
    : driver.terminateApp(step.value);
};

const mobileTap = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios' ? ios.mobileTapIOS(driver, step) : android.mobileTap(driver, step);
};

const mobileBack = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios' ? ios.mobileBackIOS(driver, step) : android.mobileBack(driver, step);
};

const mobileDoubleTap = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileDoubleTapIOS(driver, step)
    : android.mobileDoubleTap(driver, step);
};

const mobileLongPress = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileLongPressIOS(driver, step)
    : android.mobileLongPress(driver, step);
};

const mobileFill = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios' ? ios.mobileFillIOS(driver, step) : android.mobileFill(driver, step);
};

const mobileSwipe = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios' ? ios.mobileSwipeIOS(driver, step) : android.mobileSwipe(driver, step);
};

const mobileScrollToText = async (driver, step, forward = false, backward = false) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileScrollToTextIOS(driver, step)
    : android.mobileScrollToText(driver, step, forward, backward);
};

const mobileElementExist = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileElementExistIOS(driver, step)
    : android.mobileElementExist(driver, step);
};

const mobileElementNotExist = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileElementNotExistIOS(driver, step)
    : android.mobileElementNotExist(driver, step);
};

const mobileElementValidate = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileElementValidateIOS(driver, step)
    : android.mobileElementValidate(driver, step);
};

const mobileHideKeyboard = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileHideKeyboardIOS(driver, step)
    : android.mobileHideKeyboard(driver, step);
};

const mobileSwitchContext = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileSwitchContextIOS(driver, step)
    : android.mobileSwitchContext(driver, step);
};

const mobilePinch = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios' ? ios.mobilePinchIOS(driver, step) : android.mobilePinch(driver, step);
};

const mobileDigitalSignature = async (driver, step) => {
  const platform = ensurePlatformFromDriver(driver);
  return platform === 'ios'
    ? ios.mobileDigitalSignatureIOS(driver, step)
    : android.mobileDigitalSignature(driver, step);
};

module.exports = {
  mobileOpenApp,
  mobileCloseApp,
  mobileTap,
  mobileBack,
  mobileDoubleTap,
  mobileLongPress,
  mobileFill,
  mobileSwipe,
  mobileScrollToText,
  mobileElementExist,
  mobileElementNotExist,
  mobileElementValidate,
  mobileHideKeyboard,
  mobileSwitchContext,
  mobilePinch,
  mobileDigitalSignature,
};

