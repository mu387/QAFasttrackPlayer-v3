async function executeMobileKeyword(context, keywordNameRaw, keywordMethod, step) {
    const keywordPerf = context.perfStart('keyword', {
        keyword: keywordNameRaw,
        channel: 'mobile',
    });
    await context.mobileDriver[keywordMethod](step);
    context.perfEnd(keywordPerf, 'ok');
}

async function executeCaptureKeyword(context, keywordNameRaw, keywordMethod, step) {
    const keywordPerf = context.perfStart('keyword', {
        keyword: keywordNameRaw,
        channel: 'web',
    });
    context.capturedData = await context.webDriver[keywordMethod](step);
    context.setRuntimeVariable('web_capture', context.capturedData);
    context.perfEnd(keywordPerf, 'ok');
}

async function executeApiCallKeyword(context, keywordNameRaw, keywordMethod, step) {
    const keywordPerf = context.perfStart('keyword', {
        keyword: keywordNameRaw,
        channel: 'web',
    });
    const apiResultRaw = await context.webDriver[keywordMethod](step);
    const apiResult = context.parseApiResult(apiResultRaw);
    await context.assertApiResult(apiResult, step.expected_output);
    context.registerApiRuntimeVariables(apiResult);
    context.capturedData = context.getPrimaryApiCaptureValue(apiResult);
    context.lastApiResult = apiResult;
    context.perfEnd(keywordPerf, 'ok', {
        status: apiResult?.status,
        mode: apiResult?.mode,
        protocol: apiResult?.protocol,
    });
}

async function executeWebKeyword(context, keywordNameRaw, keywordMethod, step) {
    const keywordPerf = context.perfStart('keyword', {
        keyword: keywordNameRaw,
        channel: 'web',
    });
    await context.webDriver[keywordMethod](step);
    context.perfEnd(keywordPerf, 'ok');
}

async function executeKeywordStep(context, keywordNameRaw, keywordName, keywordMethod, step) {
    if (context.isEmailSandboxIssueAliasKeyword?.(keywordName)) {
        await context.executeEmailSandboxIssueAliasStep(step);
    } else if (context.isEmailSandboxWaitExtractKeyword?.(keywordName)) {
        await context.executeEmailSandboxWaitExtractStep(step);
    } else if (keywordName.startsWith('mobile')) {
        await executeMobileKeyword(context, keywordNameRaw, keywordMethod, step);
    } else if (keywordName === 'getelementvalue') {
        await executeCaptureKeyword(context, keywordNameRaw, keywordMethod, step);
    } else if (keywordName === 'apicall') {
        await executeApiCallKeyword(context, keywordNameRaw, keywordMethod, step);
    } else {
        await executeWebKeyword(context, keywordNameRaw, keywordMethod, step);
    }
}

module.exports = {
    executeKeywordStep,
    executeMobileKeyword,
    executeCaptureKeyword,
    executeApiCallKeyword,
    executeWebKeyword,
};
