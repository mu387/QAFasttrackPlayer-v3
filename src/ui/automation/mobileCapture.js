const lookup = require('./helperLookup');

async function getElementValue(driver, step, platform) {
    const attribute = String(step.value ?? '').trim();
    if (!attribute) throw new Error('getElementValue requires a text/property/attribute name.');
    if (attribute.toLowerCase() === 'selection') {
        throw new Error('getElementValue selection is supported for web dropdowns only.');
    }
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
        throw new Error('Unsupported getElementValue platform: ' + platform);
    }
    const selector = lookup.parseLocator(step.xPath, strategies, 'getElementValue');
    const index = lookup.explicitTargetIndex(step, 'getElementValue') ?? 1;
    if (!driver?.sessionId) throw new Error('getElementValue requires an active ' + platform + ' Appium session.');
    const elements = await driver.$$(selector);
    const element = elements[index - 1];
    if (!element) throw new Error('getElementValue element not found.');
    switch (attribute.toLowerCase()) {
        case 'gettext':
            return element.getText();
        case 'isselected':
            return element.isSelected();
        case 'isenabled':
            return element.isEnabled();
        case 'isdisplayed':
            return element.isDisplayed();
        default: {
            const value = await element.getAttribute(attribute);
            return typeof value === 'string' && value.includes('\n') ? value.replace(/[\n\r]/g, '') : value;
        }
    }
}

module.exports = { getElementValue };
