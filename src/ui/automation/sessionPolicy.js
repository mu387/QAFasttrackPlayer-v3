const { parseApiCallValue } = require('../../utils/apiCallContract');

function resolveKeywordSessionPolicy(keywordName, resolvedStepValue) {
    const normalizedKeyword = String(keywordName || '').toLowerCase();
    const isApiCallKeyword = normalizedKeyword === 'apicall';
    let apiCallResolvedMode = 'browser_session';

    if (isApiCallKeyword) {
        try {
            apiCallResolvedMode = parseApiCallValue(resolvedStepValue, {
                defaultMode: 'browser_session',
            })?.mode || 'browser_session';
        } catch (_) {
            apiCallResolvedMode = 'browser_session';
        }
    }

    const isMobileKeyword = normalizedKeyword.startsWith('mobile');
    const requiresWebSession =
        !isMobileKeyword &&
        !['launchbrowser', 'launchdebugbrowser', 'debugbrowser', 'connectbrowser', 'closebrowser', 'loop'].includes(normalizedKeyword) &&
        !(isApiCallKeyword && apiCallResolvedMode !== 'browser_session');

    return {
        apiCallResolvedMode,
        isApiCallKeyword,
        isMobileKeyword,
        requiresWebSession,
    };
}

async function enforceKeywordSessionPolicy(context, keywordNameRaw, keywordName, policy) {
    if (policy.requiresWebSession) {
        const sessionPerf = context.perfStart('session_check', {
            keyword: keywordNameRaw,
            mode: 'required',
        });
        const ok = await context.webDriver.hasValidSession();
        context.perfEnd(sessionPerf, ok ? 'ok' : 'error');
        if (!ok) {
            console.log('[automation] invalid WebDriver session before step');
            throw new Error('WebDriver session is not active. Please launch the browser again.');
        }
        return { skip: false };
    }

    const sessionPerf = context.perfStart('session_check', {
        keyword: keywordNameRaw,
        mode: policy.isApiCallKeyword ? `optional:${policy.apiCallResolvedMode}` : 'optional',
    });
    const ok = await context.webDriver.hasValidSession();
    context.perfEnd(sessionPerf, ok ? 'ok' : 'skip');
    if (!ok && keywordName === 'closebrowser') {
        console.log('[automation] closeBrowser skipped: no valid session');
        return { skip: true, reason: 'closebrowser_no_session' };
    }

    return { skip: false };
}

module.exports = {
    resolveKeywordSessionPolicy,
    enforceKeywordSessionPolicy,
};
