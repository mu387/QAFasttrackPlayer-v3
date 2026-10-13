const { createMobileCancellationCheck } = require('./mobileSession');
const IF_EXIST_COMMENT = 'Passed automatically: IfExist condition not met (element not found), step skipped.';

const keywordOf = step => String(step?.keyword?.name ?? step?.keyword ?? step?.keyword_name ?? step?.keywordName ?? '').trim();
const isIfExist = step => keywordOf(step).toLowerCase() === 'ifexist';
const isMobileClear = step => keywordOf(step).toLowerCase() === 'mobileclear';
const isCaptureHelper = step => keywordOf(step).toLowerCase() === 'getelementvalue';
const isWaitHelper = step => ['waitforelement', 'waitfortext'].includes(keywordOf(step).toLowerCase());

function actionNames(provider) {
    const names = new Set();
    for (let current = provider; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (name !== 'constructor' && !name.startsWith('_') && typeof Object.getOwnPropertyDescriptor(current, name)?.value === 'function') {
                names.add(name.toLowerCase());
            }
        }
    }
    return names;
}

function resolveExecutionTarget(context, mainStep) {
    const declared = String(mainStep.executionTarget ?? mainStep.execution_target ?? mainStep.target ?? '').trim().toLowerCase();
    if (declared) return declared;
    const keyword = keywordOf(mainStep).toLowerCase();
    if (keyword === 'apicall') return 'api';
    if (actionNames(context.mobileDriver).has(keyword)) return context.mobileDriver.platform;
    if (actionNames(context.webDriver).has(keyword)) return 'web';
    throw new Error('Cannot resolve execution target for action "' + keywordOf(mainStep) + '". Set executionTarget explicitly.');
}

function resolveHelperProvider(context, mainStep, helperName) {
    const target = resolveExecutionTarget(context, mainStep);
    const providers = {
        web: context.webDriver,
        android: context.mobileDriver?.android,
        ios: context.mobileDriver?.ios,
    };
    const provider = providers[target];
    if (!provider || typeof provider[helperName] !== 'function') {
        throw new Error(helperName + ' is not supported for execution target "' + target + '".');
    }
    if (target !== 'web' && context.mobileDriver?.platform !== target) {
        throw new Error('The active mobile session does not match execution target "' + target + '".');
    }
    return provider;
}

function prepareIfExist(mainStep, helperStep, resolveValue = value => value, helperName = 'ifExist') {
    const value = String(resolveValue(helperStep.value) ?? '').trim();
    const helperLocator = String(resolveValue(helperStep.xPath ?? helperStep.xpath) ?? '').trim();
    const mainLocator = String(resolveValue(mainStep.xPath ?? mainStep.xpath) ?? '').trim();
    let locator = value || helperLocator || mainLocator;
    const option = locator.match(/^(target|scope)\s*=(.*)$/is);
    if (option) locator = option[2].trim();
    if (!locator) throw new Error(helperName + ' requires a helper target or main-step locator.');
    const ownsLocator = Boolean(value || (helperLocator && helperLocator !== mainLocator));
    return {
        ...helperStep,
        xPath: locator,
        __explicitTargetIndex: ownsLocator ? undefined : mainStep.__explicitTargetIndex,
    };
}

async function ensureHelperSession(context, provider) {
    if (provider === context.webDriver) return;
    await context.mobileDriver.ensureSession(createMobileCancellationCheck(context));
}

async function runCaptureHelper(context, mainStep, helperStep) {
    if (!isCaptureHelper(helperStep)) throw new Error('Unsupported capture helper: ' + keywordOf(helperStep));
    if (resolveExecutionTarget(context, mainStep) === 'web') return context.runStep(helperStep);
    const resolveValue = value => typeof context.resolveRuntimeValue === 'function' ? context.resolveRuntimeValue(value) : value;
    const mainLocator = resolveValue(mainStep.xPath ?? mainStep.xpath);
    const locator = resolveValue(helperStep.xPath ?? helperStep.xpath ?? mainLocator);
    const prepared = {
        ...helperStep,
        value: resolveValue(helperStep.value),
        xPath: locator,
        __explicitTargetIndex: helperStep.__explicitTargetIndex ?? (locator === mainLocator ? mainStep.__explicitTargetIndex : undefined),
    };
    context.capturedData = null;
    const provider = resolveHelperProvider(context, mainStep, 'getElementValue');
    await ensureHelperSession(context, provider);
    context.capturedData = await provider.getElementValue(prepared);
}

async function runWaitHelper(context, mainStep, helperStep) {
    const name = keywordOf(helperStep).toLowerCase();
    if (!isWaitHelper(helperStep)) throw new Error('Unsupported wait helper: ' + keywordOf(helperStep));
    const helperName = name === 'waitforelement' ? 'waitForElement' : 'waitForText';
    const provider = resolveHelperProvider(context, mainStep, helperName);
    if (provider === context.webDriver) return context.runStep(helperStep);
    await ensureHelperSession(context, provider);
    const resolveValue = value => typeof context.resolveRuntimeValue === 'function' ? context.resolveRuntimeValue(value) : value;
    const locator = resolveValue(helperStep.xPath ?? helperStep.xpath ?? mainStep.xPath ?? mainStep.xpath);
    await provider[helperName]({
        ...helperStep,
        value: resolveValue(helperStep.value),
        xPath: locator,
        __explicitTargetIndex: helperStep.__explicitTargetIndex ?? mainStep.__explicitTargetIndex,
        __checkWaitCancellation: () => {
            context.throwIfCancellationRequested?.();
            context.ensureNotCanceled?.();
        },
    });
}

async function runBeforeHelper(context, mainStep, helperStep) {
    if (isMobileClear(helperStep)) {
        const target = resolveExecutionTarget(context, mainStep);
        if (!['android', 'ios'].includes(target)) {
            throw new Error('mobileClear is not supported for execution target "' + target + '".');
        }
        const provider = resolveHelperProvider(context, mainStep, 'mobileClear');
        const prepared = prepareIfExist(mainStep, helperStep, value =>
            typeof context.resolveRuntimeValue === 'function' ? context.resolveRuntimeValue(value) : value, 'mobileClear');
        await ensureHelperSession(context, provider);
        await provider.mobileClear(prepared);
        return true;
    }
    if (!isIfExist(helperStep)) throw new Error('Unsupported shared before-step helper: ' + keywordOf(helperStep));
    const provider = resolveHelperProvider(context, mainStep, 'ifExist');
    const prepared = prepareIfExist(mainStep, helperStep, value =>
        typeof context.resolveRuntimeValue === 'function' ? context.resolveRuntimeValue(value) : value);
    await ensureHelperSession(context, provider);
    const exists = await provider.ifExist(prepared);
    if (typeof exists !== 'boolean') throw new Error('ifExist provider must return a boolean.');
    return exists;
}

module.exports = { IF_EXIST_COMMENT, isIfExist, isMobileClear, isWaitHelper, isCaptureHelper, resolveExecutionTarget, resolveHelperProvider, prepareIfExist, runBeforeHelper, runWaitHelper, runCaptureHelper };
