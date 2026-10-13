const methods = {
    mobiletapoffset: 'mobileTapOffset',
    mobiletoastexist: 'mobileToastExist',
};

async function executeManualMobileKeyword(router, { locator, keyword, value = '' }) {
    const normalized = String(keyword || '').trim().toLowerCase();
    const method = Object.hasOwn(methods, normalized) ? methods[normalized] : null;
    if (!method) return null;
    try {
        await router.ensureSession();
        await router[method]({ keyword: { name: method }, xPath: locator, value });
        return { ok: true, output: method + ' completed.' };
    } catch (error) {
        return { ok: false, output: error?.message || String(error) };
    }
}

module.exports = { executeManualMobileKeyword };
