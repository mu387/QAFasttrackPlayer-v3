function parseScroll(value) {
    const match = String(value ?? '').trim().match(/^(UP|DOWN|LEFT|RIGHT)_(\d+)$/i);
    if (!match) throw new Error('mobileScroll requires DIRECTION_PIXELS, for example DOWN_300.');
    const pixels = Number(match[2]);
    if (!Number.isSafeInteger(pixels) || pixels <= 0) {
        throw new Error('mobileScroll pixels must be a positive integer.');
    }
    return { direction: match[1].toLowerCase(), pixels };
}

async function mobileScroll(driver, step, platform) {
    const { direction, pixels } = parseScroll(step?.value);
    if (!['android', 'ios'].includes(platform)) throw new Error('Unsupported mobileScroll platform: ' + platform);
    if (!driver?.sessionId) throw new Error('mobileScroll requires an active ' + platform + ' Appium session.');
    const { width, height } = await driver.getWindowSize();
    if (![width, height].every(size => Number.isSafeInteger(size) && size > 1)) {
        throw new Error('mobileScroll requires valid window dimensions.');
    }
    const vertical = direction === 'up' || direction === 'down';
    const extent = vertical ? height : width;
    if (pixels >= extent) throw new Error('mobileScroll distance must be less than the current ' + (vertical ? 'height' : 'width') + ' (' + extent + ').');
    if (platform === 'ios') {
        await driver.execute('mobile: scroll', { direction, distance: pixels / extent });
        return;
    }
    const lower = Math.floor((extent - pixels) / 2);
    const upper = lower + pixels;
    const forward = direction === 'down' || direction === 'right';
    const start = forward ? upper : lower;
    const end = forward ? lower : upper;
    const startX = vertical ? Math.floor(width / 2) : start;
    const startY = vertical ? start : Math.floor(height / 2);
    const endX = vertical ? startX : end;
    const endY = vertical ? end : startY;
    let actionError;
    try {
        await driver.performActions([{
            type: 'pointer',
            id: 'mobileScrollFinger',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, origin: 'viewport', x: startX, y: startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration: 300, origin: 'viewport', x: endX, y: endY },
                { type: 'pointerUp', button: 0 },
            ],
        }]);
    } catch (error) {
        actionError = error;
        throw error;
    } finally {
        try {
            await driver.releaseActions();
        } catch (error) {
            if (!actionError) throw error;
            console.log('mobileScroll input release failed', error.message || error);
        }
    }
}

module.exports = { parseScroll, mobileScroll };
