const { MobileActions } = require('./mobileActions');
const { MobileActionsIOS } = require('./mobileActionsIOS');
const { ensureMobileSession } = require('./mobileSession');

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

  async ensureSession(checkCancellation) {
    return ensureMobileSession(this, checkCancellation);
  }

  async mobileOpenApp(step) {
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

  async mobileCloseApp(step, checkCancellation) {
    const provider = this.platform === 'ios' ? this.ios : this.android;
    if (provider.driver || provider.sessionOptions) await this.ensureSession(checkCancellation);
    checkCancellation?.();
    try {
      if (this.platform === 'ios') {
        await this.ios.mobileCloseAppIOS(step);
      } else {
        await this.android.mobileCloseApp(step);
      }
    } finally {
      try {
        if (provider.driver) await provider.driver.deleteSession();
      } catch (err) {
        console.log('mobile deleteSession failed (ignored)', err?.message || err);
      }
      provider.driver = null;
      provider.sessionOptions = null;
      this._syncDriver();
    }
  }

  async mobileTapOffset(step) {
    return this.platform === 'ios'
      ? this.ios.mobileTapOffset(step)
      : this.android.mobileTapOffset(step);
  }

  async mobileToastExist(step) {
    return this.platform === 'ios'
      ? this.ios.mobileToastExist(step)
      : this.android.mobileToastExist(step);
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

  async mobileClear(step) {
    if (!['android', 'ios'].includes(this.platform)) {
      throw new Error('mobileClear requires an Android or iOS execution target.');
    }
    return this.platform === 'ios'
      ? this.ios.mobileClear(step)
      : this.android.mobileClear(step);
  }

  async mobileFill(step) {
    return this.platform === 'ios'
      ? this.ios.mobileFillIOS(step)
      : this.android.mobileFill(step);
  }

  async mobileScroll(step) {
    if (!['android', 'ios'].includes(this.platform)) throw new Error('Unsupported mobileScroll platform: ' + this.platform);
    return this.platform === 'ios'
      ? this.ios.mobileScroll(step)
      : this.android.mobileScroll(step);
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

  async mobileScrollToTextUp(step) {
    return this.platform === 'ios'
      ? this.ios.mobileScrollToTextIOS(step, 'up')
      : this.android.mobileScrollToTextDirection(step, 'up');
  }

  async mobileScrollToTextDown(step) {
    return this.platform === 'ios'
      ? this.ios.mobileScrollToTextIOS(step, 'down')
      : this.android.mobileScrollToTextDirection(step, 'down');
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
