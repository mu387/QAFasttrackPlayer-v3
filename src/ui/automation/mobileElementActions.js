const lookup = require('./helperLookup');

async function findElement(driver, step, platform, keyword) {
    const strategies = {
        xpath: value => value,
        id: value => 'id=' + value,
        accessibilityid: value => '~' + value,
    };
    if (platform === 'android') strategies.android = value => 'android=' + value;
    else if (platform === 'ios') {
        strategies.iospredicate = value => '-ios predicate string:' + value;
        strategies.iosclasschain = value => '-ios class chain:' + value;
    } else {
        throw new Error('Unsupported ' + keyword + ' platform: ' + platform);
    }
    const selector = lookup.parseLocator(step.xPath, strategies, keyword);
    const index = lookup.explicitTargetIndex(step, keyword) ?? 1;
    if (!driver?.sessionId) throw new Error(keyword + ' requires an active ' + platform + ' Appium session.');
    const elements = await driver.$$(selector);
    const element = elements[index - 1];
    if (!element) throw new Error(keyword + ' element not found.');
    return element;
}

async function elementRect(element) {
    if (typeof element.getRect === 'function') {
        try {
            return await element.getRect();
        } catch (error) {
            if (!/unsupported|not implemented|not a function|unknown command/i.test(error?.message || '')) throw error;
        }
    }
    const location = await element.getLocation();
    const size = await element.getSize();
    return { x: location.x, y: location.y, width: size.width, height: size.height };
}

async function mobileTapOffset(driver, step, platform) {
    const element = await findElement(driver, step, platform, 'mobileTapOffset');
    const rect = await elementRect(element);
    if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite)) {
        throw new Error('mobileTapOffset could not determine the element rectangle.');
    }
    const match = String(step.value ?? '').trim().match(/^(LEFT|RIGHT|UP|DOWN)_(\d+)$/i);
    const valid = match && Number.isSafeInteger(Number(match[2]));
    const direction = valid ? match[1].toUpperCase() : 'LEFT';
    const offset = valid ? Number(match[2]) : 20;
    let tapX = rect.x + rect.width / 2;
    let tapY = rect.y + rect.height / 2;
    if (direction === 'LEFT') tapX = rect.x - offset;
    else if (direction === 'RIGHT') tapX = rect.x + rect.width + offset;
    else if (direction === 'UP') tapY = rect.y - offset;
    else tapY = rect.y + rect.height + offset;
    await driver.execute(platform === 'android' ? 'mobile: clickGesture' : 'mobile: tap', {
        x: Math.round(tapX),
        y: Math.round(tapY),
    });
}

async function mobileToastExist(driver, step, platform) {
    const element = await findElement(driver, step, platform, 'mobileToastExist');
    const actual = await element.getText();
    if (typeof actual !== 'string' || actual.length === 0 || step.value == null || !actual.includes(String(step.value))) {
        throw new Error('mobileToastExist toast text does not contain the expected step value.');
    }
}

module.exports = { mobileTapOffset, mobileToastExist };
