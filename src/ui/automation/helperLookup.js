function explicitTargetIndex(step, helperName = 'ifExist') {
    if (step.__explicitTargetIndex == null) return null;
    const index = Number(step.__explicitTargetIndex);
    if (!Number.isInteger(index) || index < 1) throw new Error(helperName + ' element index must be a positive integer.');
    return index;
}

function parseLocator(locator, strategies, helperName = 'ifExist') {
    const text = String(locator ?? '').trim();
    if (!text) throw new Error(helperName + ' requires a locator.');
    const match = text.match(/^([a-z][a-z0-9]*)=(.*)$/is);
    const strategy = match ? match[1].toLowerCase() : 'xpath';
    const value = match ? match[2].trim() : text;
    if (!Object.prototype.hasOwnProperty.call(strategies, strategy)) {
        throw new Error('Unsupported ' + helperName + ' locator strategy "' + strategy + '".');
    }
    if (!value) throw new Error(helperName + ' locator value is required for "' + strategy + '".');
    return strategies[strategy](value);
}

async function immediateLookup(getTimeouts, setTimeouts, lookup, helperName = 'ifExist') {
    const timeouts = await getTimeouts();
    if (!Number.isFinite(timeouts?.implicit) || timeouts.implicit < 0) {
        throw new Error('Cannot read the active driver implicit timeout for ' + helperName + '.');
    }
    if (timeouts.implicit === 0) return lookup();
    await setTimeouts({ implicit: 0 });
    try {
        return await lookup();
    } finally {
        await setTimeouts({ implicit: timeouts.implicit });
    }
}

module.exports = { explicitTargetIndex, parseLocator, immediateLookup };
