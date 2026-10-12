const { performance } = require('node:perf_hooks');
const lookup = require('./helperLookup');

const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function splitOptions(rawValue) {
    const parts = [];
    let current = '';
    let quote = '';
    let depth = 0;
    const value = String(rawValue ?? '');
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            current += character;
            if (character === quote && value[index - 1] !== '\\') quote = '';
            continue;
        }
        if (character === '"' || character === "'") quote = character;
        if ('([{'.includes(character)) depth += 1;
        if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
        if (!quote && depth === 0 && value.slice(index, index + 2) === '>>') {
            if (current.trim()) parts.push(current.trim());
            current = '';
            index += 1;
        } else {
            current += character;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function parseConfig(step, helperName) {
    const isText = helperName === 'waitForText';
    const config = {
        target: String(step.xPath ?? '').trim(),
        state: isText ? 'exist' : '',
        text: '',
        match: 'contains',
        timeout: 10000,
        index: step.__explicitTargetIndex,
    };
    for (const part of splitOptions(step.value)) {
        const separator = part.indexOf('=');
        if (separator < 1) {
            config[isText ? 'text' : 'state'] = isText ? part : part.toLowerCase();
            continue;
        }
        const key = part.slice(0, separator).trim().toLowerCase();
        const value = part.slice(separator + 1).trim();
        if (['target', 'scope', 'xpath'].includes(key)) {
            config.target = value;
            config.index = undefined;
        } else if (key === 'state') {
            config.state = value.toLowerCase();
        } else if (key === 'timeout') {
            config.timeout = Number(value);
        } else if (isText && key === 'text') {
            config.text = value;
        } else if (isText && key === 'match') {
            config.match = value.toLowerCase();
        } else {
            throw new Error('Unknown ' + helperName + ' option: ' + key);
        }
    }
    if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
        throw new Error(helperName + ' timeout must be a positive number of milliseconds.');
    }
    const states = isText ? ['exist', 'notexist'] : ['exist', 'notexist', 'visible', 'hidden', 'enabled', 'disabled', 'selected', 'notselected'];
    if (!states.includes(config.state)) throw new Error('Unsupported ' + helperName + ' state: ' + config.state);
    if (isText) {
        config.text = normalizeText(config.text);
        if (!config.text) throw new Error('waitForText requires a text value.');
        if (!['contains', 'exact'].includes(config.match)) throw new Error('Unsupported waitForText match: ' + config.match);
    }
    config.index = lookup.explicitTargetIndex({ __explicitTargetIndex: config.index }, helperName);
    return config;
}

function selectorFor(target, platform, helperName) {
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
        throw new Error(helperName + ' is not supported for platform ' + platform);
    }
    return lookup.parseLocator(target, strategies, helperName);
}

async function elementMatches(elements, state) {
    if (state === 'exist') return elements.length > 0;
    if (state === 'notexist') return elements.length === 0;
    if (elements.length === 0) return state === 'hidden';
    const method = ['visible', 'hidden'].includes(state) ? 'isDisplayed'
        : ['enabled', 'disabled'].includes(state) ? 'isEnabled' : 'isSelected';
    const statuses = await Promise.all(elements.map(element => element[method]()));
    return ['hidden', 'disabled', 'notselected'].includes(state)
        ? statuses.every(status => !status) : statuses.some(Boolean);
}

async function textMatches(elements, config, platform) {
    for (const element of elements) {
        if (!await element.isDisplayed()) continue;
        let text = normalizeText(await element.getText());
        const attributes = platform === 'ios' ? ['label', 'value'] : ['text', 'value'];
        for (const attribute of attributes) {
            if (text) break;
            text = normalizeText(await element.getAttribute(attribute));
        }
        if (config.match === 'exact' ? text === config.text : text.includes(config.text)) return true;
    }
    return false;
}

async function wait(driver, step, platform, helperName) {
    const config = parseConfig(step, helperName);
    const selector = selectorFor(config.target, platform, helperName);
    if (!driver?.sessionId) throw new Error(helperName + ' requires an active ' + platform + ' Appium session.');
    return lookup.immediateLookup(
        () => driver.getTimeouts(),
        timeouts => driver.setTimeout(timeouts),
        async () => {
            const deadline = performance.now() + config.timeout;
            while (true) {
                step.__checkWaitCancellation?.();
                let elements = await driver.$$(selector);
                if (config.index != null) elements = elements.slice(config.index - 1, config.index);
                let satisfied;
                if (helperName === 'waitForText') {
                    const found = await textMatches(elements, config, platform);
                    satisfied = config.state === 'notexist' ? !found : found;
                } else {
                    satisfied = await elementMatches(elements, config.state);
                }
                step.__checkWaitCancellation?.();
                if (satisfied) return;
                const remaining = deadline - performance.now();
                if (remaining <= 0) throw new Error(helperName + ' timed out waiting for ' + config.state + ' on ' + config.target);
                await new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)));
            }
        },
        helperName,
    );
}

module.exports = { parseConfig, wait };
