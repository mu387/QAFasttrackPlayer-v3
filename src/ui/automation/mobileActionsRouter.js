const { MobileActions } = require('./mobileActions');
const { MobileActionsIOS } = require('./mobileActionsIOS');

const detectPlatform = caps => {
  const platformName =
    caps?.platformName ??
    caps?.['appium:platformName'] ??
    caps?.alwaysMatch?.platformName ??
    caps?.alwaysMatch?.['appium:platformName'];
  return /ios/i.test(String(platformName || '')) ? 'ios' : 'android';
};

class MobileActionsRouter {
  android = new MobileActions();
  ios = new MobileActionsIOS();
  platform = 'android';
  driver = null;

  _syncDriver() {
    this.driver = this.platform === 'ios' ? this.ios.driver : this.android.driver;
  }

  async mobileOpenApp(step) {
    // ensure any previous session is torn down before opening a new one
    if (this.driver) {
      try {
        await this.driver.deleteSession();
      } catch (err) {
        console.log('previous mobile session cleanup failed (ignored)', err?.message || err);
      } finally {
        this.driver = null;
      }
    }
    let caps = null;
    try {
      caps = JSON.parse(step.value);
    } catch (err) {
      caps = null;
    }
    this.platform = detectPlatform(caps);

    if (this.platform === 'ios') {
      await this.ios.mobileOpenAppIOS(step);
    } else {
      await this.android.mobileOpenApp(step);
    }
    this._syncDriver();
  }

  async mobileCloseApp(step) {
    try {
      if (this.platform === 'ios') {
        await this.ios.mobileCloseAppIOS(step);
      } else {
        await this.android.mobileCloseApp(step);
      }
    } finally {
      try {
        if (this.driver) {
          await this.driver.deleteSession();
        }
      } catch (err) {
        console.log('mobile deleteSession failed (ignored)', err?.message || err);
      }
      this.driver = null;
      this._syncDriver();
    }
  }

  async mobileTap(step) {
    return this.platform === 'ios'
      ? this.ios.mobileTapIOS(step)
      : this.android.mobileTap(step);
  }

  async mobileBack(step) {
    return this.platform === 'ios'
      ? this.ios.mobileBackIOS(step)
      : this.android.mobileBack(step);
  }

  async mobileDoubleTap(step) {
    return this.platform === 'ios'
      ? this.ios.mobileDoubleTapIOS(step)
      : this.android.mobileDoubleTap(step);
  }

  async mobileLongPress(step) {
    return this.platform === 'ios'
      ? this.ios.mobileLongPressIOS(step)
      : this.android.mobileLongPress(step);
  }

  async mobileFill(step) {
    return this.platform === 'ios'
      ? this.ios.mobileFillIOS(step)
      : this.android.mobileFill(step);
  }

  async mobileSwipe(step) {
    return this.platform === 'ios'
      ? this.ios.mobileSwipeIOS(step)
      : this.android.mobileSwipe(step);
  }

  async mobileScrollToText(step) {
    return this.platform === 'ios'
      ? this.ios.mobileScrollToTextIOS(step)
      : this.android.mobileScrollToText(step);
  }

  async mobileElementExist(step) {
    return this.platform === 'ios'
      ? this.ios.mobileElementExistIOS(step)
      : this.android.mobileElementExist(step);
  }

  async mobileElementNotExist(step) {
    return this.platform === 'ios'
      ? this.ios.mobileElementNotExistIOS(step)
      : this.android.mobileElementNotExist(step);
  }

  async mobileElementValidate(step) {
    return this.platform === 'ios'
      ? this.ios.mobileElementValidateIOS(step)
      : this.android.mobileElementValidate(step);
  }

  async mobileHideKeyboard(step) {
    return this.platform === 'ios'
      ? this.ios.mobileHideKeyboardIOS(step)
      : this.android.mobileHideKeyboard(step);
  }

  async mobileSwitchContext(step) {
    return this.platform === 'ios'
      ? this.ios.mobileSwitchContextIOS(step)
      : this.android.mobileSwitchContext(step);
  }

  async mobilePinch(step) {
    return this.platform === 'ios'
      ? this.ios.mobilePinchIOS(step)
      : this.android.mobilePinch(step);
  }

  async mobileDigitalSignature(step) {
    return this.platform === 'ios'
      ? this.ios.mobileDigitalSignatureIOS(step)
      : this.android.mobileDigitalSignature(step);
  }
}

module.exports = { MobileActionsRouter };
