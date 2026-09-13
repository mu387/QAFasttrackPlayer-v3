const injectXPathRecorderHooksScript = function (currentDepth, currentIframeChain, currentRunId) {
                const KEY = '__qaSelectorSpy';
                const state = window[KEY] || {};
                const overlayId = 'qa-selectorhub-overlay';
                const tipId = 'qa-selectorhub-tip';

                const cleanup = () => {
                    state.active = false;
                    const listenerRoots = Array.isArray(state.listenerRoots) && state.listenerRoots.length
                        ? state.listenerRoots
                        : [document];
                    listenerRoots.forEach(root => {
                        try {
                            if (state.onMove) root.removeEventListener('pointermove', state.onMove, true);
                            if (state.onLeave) root.removeEventListener('pointerleave', state.onLeave, true);
                            if (state.onPointerDown) root.removeEventListener('pointerdown', state.onPointerDown, true);
                        } catch (_) {}
                    });
                    state.listenerRoots = [];
                    if (state.onMessage) window.removeEventListener('message', state.onMessage, true);
                    document.getElementById(overlayId)?.remove();
                    document.getElementById(tipId)?.remove();
                };

                cleanup();

                state.active = true;
                state.depth = currentDepth;
                state.iframeChain = Array.isArray(currentIframeChain) ? currentIframeChain : [];
                state.runId = Number(currentRunId || 0);
                state.canCaptureClick = false;
                state.canCaptureClickAt = 0;
                state.queue = [];
                state.hover = null;
                state.selected = null;
                state.lastTarget = null;
                const quoteXpath = value => {
                    const text = String(value ?? '');
                    if (!text.includes("'")) return `'${text}'`;
                    if (!text.includes('"')) return `"${text}"`;
                    return `concat('${text.split("'").join(`', "'", '`)}')`;
                };

                const cssEscape = value =>
                    String(value ?? '').replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');

                const ensureUi = () => {
                    let overlay = document.getElementById(overlayId);
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = overlayId;
                        overlay.setAttribute('data-qa-spy-ui', '1');
                        Object.assign(overlay.style, {
                            position: 'fixed',
                            left: '0',
                            top: '0',
                            width: '0',
                            height: '0',
                            border: '2px solid #f59e0b',
                            background: 'rgba(245, 158, 11, 0.18)',
                            boxShadow: '0 0 0 1px rgba(15,23,42,0.18)',
                            borderRadius: '3px',
                            pointerEvents: 'none',
                            zIndex: '2147483646',
                            opacity: '0',
                        });
                        document.documentElement.appendChild(overlay);
                    }
                    let tip = document.getElementById(tipId);
                    if (!tip) {
                        tip = document.createElement('div');
                        tip.id = tipId;
                        tip.setAttribute('data-qa-spy-ui', '1');
                        Object.assign(tip.style, {
                            position: 'fixed',
                            left: '0',
                            top: '0',
                            maxWidth: '420px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: 'rgba(15, 23, 42, 0.96)',
                            color: '#f8fafc',
                            fontFamily: 'Consolas, Monaco, monospace',
                            fontSize: '11px',
                            lineHeight: '1.4',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pointerEvents: 'none',
                            zIndex: '2147483647',
                            boxShadow: '0 8px 22px rgba(15,23,42,0.28)',
                            opacity: '0',
                        });
                        document.documentElement.appendChild(tip);
                    }
                    return { overlay, tip };
                };

                const hideUi = () => {
                    const { overlay, tip } = ensureUi();
                    overlay.style.opacity = '0';
                    overlay.style.width = '0px';
                    overlay.style.height = '0px';
                    tip.style.opacity = '0';
                    tip.textContent = '';
                };

                const deactivateLocal = () => {
                    state.active = false;
                    state.hover = null;
                    state.lastTarget = null;
                    const listenerRoots = Array.isArray(state.listenerRoots) && state.listenerRoots.length
                        ? state.listenerRoots
                        : [document];
                    listenerRoots.forEach(root => {
                        try {
                            if (state.onMove) root.removeEventListener('pointermove', state.onMove, true);
                            if (state.onLeave) root.removeEventListener('pointerleave', state.onLeave, true);
                            if (state.onPointerDown) root.removeEventListener('pointerdown', state.onPointerDown, true);
                        } catch (_) {}
                    });
                    state.listenerRoots = [];
                    if (state.onMessage) window.removeEventListener('message', state.onMessage, true);
                    hideUi();
                };

                const clearInspectorUiInWindow = targetWindow => {
                    try {
                        const targetState = targetWindow.__qaSelectorSpy;
                        if (targetState) {
                            targetState.hover = null;
                            targetState.lastTarget = null;
                        }
                        const targetOverlay = targetWindow.document.getElementById(overlayId);
                        const targetTip = targetWindow.document.getElementById(tipId);
                        if (targetOverlay) {
                            targetOverlay.style.opacity = '0';
                            targetOverlay.style.width = '0px';
                            targetOverlay.style.height = '0px';
                        }
                        if (targetTip) {
                            targetTip.style.opacity = '0';
                            targetTip.textContent = '';
                        }
                    } catch (_) {}
                };

                const deactivateInspectorInWindow = targetWindow => {
                    try {
                        const targetState = targetWindow.__qaSelectorSpy;
                        if (targetState) {
                            targetState.active = false;
                            targetState.hover = null;
                            targetState.lastTarget = null;
                            const listenerRoots = Array.isArray(targetState.listenerRoots) && targetState.listenerRoots.length
                                ? targetState.listenerRoots
                                : [targetWindow.document];
                            listenerRoots.forEach(root => {
                                try {
                                    if (targetState.onMove) root.removeEventListener('pointermove', targetState.onMove, true);
                                    if (targetState.onLeave) root.removeEventListener('pointerleave', targetState.onLeave, true);
                                    if (targetState.onPointerDown) root.removeEventListener('pointerdown', targetState.onPointerDown, true);
                                } catch (_) {}
                            });
                            targetState.listenerRoots = [];
                            if (targetState.onMessage) targetWindow.removeEventListener('message', targetState.onMessage, true);
                        }
                        clearInspectorUiInWindow(targetWindow);
                    } catch (_) {}
                };

                const visitAccessibleWindows = (startWindow, visitor, visited = new Set()) => {
                    if (!startWindow || visited.has(startWindow)) return;
                    visited.add(startWindow);
                    visitor(startWindow);
                    try {
                        const frameNodes = Array.from(startWindow.document?.querySelectorAll?.('iframe, frame') || []);
                        frameNodes.forEach(frame => {
                            try {
                                if (frame.contentWindow) {
                                    visitAccessibleWindows(frame.contentWindow, visitor, visited);
                                }
                            } catch (_) {}
                        });
                    } catch (_) {}
                };

                const clearOtherAccessibleInspectorUi = () => {
                    let rootWindow = window;
                    while (true) {
                        let parentWindow = null;
                        try {
                            parentWindow = rootWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === rootWindow) {
                            break;
                        }
                        rootWindow = parentWindow;
                    }
                    visitAccessibleWindows(rootWindow, targetWindow => {
                        if (targetWindow === window) return;
                        clearInspectorUiInWindow(targetWindow);
                    });
                };

                const deactivateAccessibleInspectors = () => {
                    let rootWindow = window;
                    while (true) {
                        let parentWindow = null;
                        try {
                            parentWindow = rootWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === rootWindow) {
                            break;
                        }
                        rootWindow = parentWindow;
                    }
                    visitAccessibleWindows(rootWindow, deactivateInspectorInWindow);
                };

                const deactivateAncestorInspectors = () => {
                    let currentWindow = window;
                    while (currentWindow) {
                        deactivateInspectorInWindow(currentWindow);
                        let parentWindow = null;
                        try {
                            parentWindow = currentWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === currentWindow) {
                            break;
                        }
                        currentWindow = parentWindow;
                    }
                };

                const relayToParent = message => {
                    try {
                        if (window.parent && window.parent !== window) {
                            window.parent.postMessage(message, '*');
                        }
                    } catch (_) {}
                };

                state.onMessage = event => {
                    const data = event?.data;
                    if (!data || data.__qaSelectorSpyBridge !== true) return;
                    if (data.kind === 'live') {
                        window.__qaSelectorSpyLive = data.payload?.locator ? data.payload : null;
                    }
                    if (data.kind === 'pending') {
                        window.__qaSelectorSpyPending = data.payload?.locator ? data.payload : null;
                    }
                    relayToParent(data);
                };
                window.addEventListener('message', state.onMessage, true);

                const publishPendingSelection = payload => {
                    if (!payload?.locator) return;
                    window.__qaSelectorSpyPending = payload;
                    relayToParent({
                        __qaSelectorSpyBridge: true,
                        kind: 'pending',
                        payload,
                    });
                };

                const isIgnored = element => {
                    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
                    if (element.closest?.('[data-qa-spy-ui="1"]')) return true;
                    const tag = String(element.tagName || '').toLowerCase();
                    return ['html', 'body'].includes(tag);
                };

                const isOversizedContainer = element => {
                    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
                    const tag = String(element.tagName || '').toLowerCase();
                    if (!['div', 'section', 'main', 'article', 'form'].includes(tag)) return false;
                    const id = String(element.id || '').toLowerCase();
                    const name = String(element.getAttribute?.('name') || '').toLowerCase();
                    const dataTestId = String(element.getAttribute?.('data-testid') || '').toLowerCase();
                    const ariaLabel = String(element.getAttribute?.('aria-label') || '').toLowerCase();
                    const keepBecauseNamed =
                        (id && !['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(id)) ||
                        (name && !['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(name)) ||
                        !!dataTestId ||
                        !!ariaLabel;
                    if (keepBecauseNamed) {
                        return false;
                    }
                    const rect = element.getBoundingClientRect?.();
                    if (!rect) return false;
                    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
                    if (!viewportWidth || !viewportHeight) return false;
                    const widthRatio = rect.width / viewportWidth;
                    const heightRatio = rect.height / viewportHeight;
                    const isGenericShell = ['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(id)
                        || ['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(name);
                    if (isGenericShell && (widthRatio > 0.45 || heightRatio > 0.45)) {
                        return true;
                    }
                    return widthRatio > 0.75 && heightRatio > 0.55;
                };

                const isValidSpyTarget = element => !isIgnored(element) && !isOversizedContainer(element);

                const collectListenerRoots = () => {
                    const roots = [];
                    const visited = new Set();
                    const visitRoot = root => {
                        if (!root || visited.has(root)) return;
                        visited.add(root);
                        roots.push(root);
                        let elements = [];
                        try {
                            elements = Array.from(root.querySelectorAll?.('*') || []);
                        } catch (_) {
                            elements = [];
                        }
                        elements.forEach(element => {
                            try {
                                if (element.shadowRoot) {
                                    visitRoot(element.shadowRoot);
                                }
                            } catch (_) {}
                        });
                    };
                    visitRoot(document);
                    return roots;
                };

                const publishLiveHover = payload => {
                    window.__qaSelectorSpyLive = payload && payload.locator ? payload : null;
                    relayToParent({
                        __qaSelectorSpyBridge: true,
                        kind: 'live',
                        payload: payload && payload.locator ? payload : null,
                    });
                };

                const resolveHoveredElement = event => {
                    const candidates = [];
                    const pushCandidate = element => {
                        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
                        if (candidates.includes(element)) return;
                        candidates.push(element);
                    };

                    const eventPathTarget = event?.composedPath?.()?.[0];
                    if (eventPathTarget?.nodeType === Node.ELEMENT_NODE) {
                        pushCandidate(eventPathTarget);
                    }

                    try {
                        const path = Array.isArray(event?.composedPath?.()) ? event.composedPath() : [];
                        path.forEach(node => {
                            if (node?.nodeType === Node.ELEMENT_NODE) {
                                pushCandidate(node);
                            }
                        });
                    } catch (_) {}

                    try {
                        const root = event?.currentTarget && typeof event.currentTarget.elementsFromPoint === 'function'
                            ? event.currentTarget
                            : document;
                        const pointTargets = Array.from(root.elementsFromPoint?.(event.clientX, event.clientY) || []);
                        pointTargets.forEach(pushCandidate);
                    } catch (_) {
                        pushCandidate(document.elementFromPoint(event.clientX, event.clientY));
                    }

                    const eventTarget = event?.target && event.target.nodeType === Node.ELEMENT_NODE ? event.target : null;
                    pushCandidate(eventTarget);

                    return candidates.find(isValidSpyTarget) || null;
                };

                const buildCss = element => {
                    if (element.id) return `#${cssEscape(element.id)}`;
                    const parts = [];
                    let node = element;
                    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
                        let part = node.tagName.toLowerCase();
                        if (node.getAttribute('name')) {
                            part += `[name="${cssEscape(node.getAttribute('name'))}"]`;
                            parts.unshift(part);
                            break;
                        }
                        const classes = Array.from(node.classList || []).filter(Boolean).slice(0, 2);
                        if (classes.length) {
                            part += `.${classes.map(cssEscape).join('.')}`;
                        }
                        parts.unshift(part);
                        node = node.parentElement;
                    }
                    return parts.join(' > ');
                };

                const buildSelectorDescriptor = element => {
                    const xpathTag = '*';
                    const id = String(element.id || '').trim();
                    if (id) {
                        return {
                            kind: 'xpath',
                            selector: `//${xpathTag}[@id=${quoteXpath(id)}]`,
                        };
                    }
                    const name = String(element.getAttribute?.('name') || '').trim();
                    if (name) {
                        return {
                            kind: 'xpath',
                            selector: `//${xpathTag}[@name=${quoteXpath(name)}]`,
                        };
                    }
                    const dataTestId = String(element.getAttribute?.('data-testid') || '').trim();
                    if (dataTestId) {
                        return {
                            kind: 'xpath',
                            selector: `//${xpathTag}[@data-testid=${quoteXpath(dataTestId)}]`,
                        };
                    }
                    return {
                        kind: 'css',
                        selector: buildCss(element),
                    };
                };

                const buildIframeChain = () => {
                    const source = Array.isArray(state.iframeChain) ? state.iframeChain : [];
                    const chain = [];
                    let previousKey = '';
                    source.forEach(item => {
                        if (!item?.selector) {
                            return;
                        }
                        const key = `${item?.kind || ''}:${item.selector}`;
                        // Keep repeated selectors across levels; collapse only immediate duplicates.
                        if (key === previousKey) {
                            return;
                        }
                        chain.push(item);
                        previousKey = key;
                    });
                    return chain;
                };

                const getShadowHosts = element => {
                    const hosts = [];
                    let current = element;
                    while (current) {
                        let rootNode = null;
                        try {
                            rootNode = current.getRootNode?.();
                        } catch (_) {
                            rootNode = null;
                        }
                        const host = rootNode?.host;
                        if (!host || host === current) {
                            break;
                        }
                        hosts.unshift(host);
                        current = host;
                    }
                    return hosts;
                };

                const buildShadowChain = element =>
                    getShadowHosts(element)
                        .map(host => ({
                            kind: 'css',
                            selector: buildCss(host),
                        }))
                        .filter(item => item?.selector);

                const buildTraversalValue = (iframeChain, shadowChain) => {
                    if (shadowChain.length === 0) {
                        if (iframeChain.length === 1) {
                            return iframeChain[0].selector;
                        }
                        if (iframeChain.length > 1) {
                            return iframeChain
                                .map(item => item.selector)
                                .join(' >> ');
                        }
                        return '';
                    }
                    const shadowPath = shadowChain.map(item => item.selector).join(' >> ');
                    if (iframeChain.length === 0) {
                        return shadowPath;
                    }
                    const iframePath = iframeChain
                        .map(item => item.selector)
                        .join(' >> ');
                    const iframeStep = `switchToIframe=${iframePath}`;
                    const shadowStep = `switchToDom=${shadowPath}`;
                    return `Step 1=${iframeStep} || Step 2=${shadowStep}`;
                };

                const buildAbsoluteXpath = element => {
                    const parts = [];
                    let node = element;
                    while (node && node.nodeType === Node.ELEMENT_NODE) {
                        let index = 1;
                        let sibling = node.previousElementSibling;
                        while (sibling) {
                            if (sibling.tagName === node.tagName) index += 1;
                            sibling = sibling.previousElementSibling;
                        }
                        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
                        node = node.parentElement;
                    }
                    return `/${parts.join('/')}`;
                };

                const evaluateXpathCount = xpath => {
                    try {
                        const result = document.evaluate(
                            `count(${xpath})`,
                            document,
                            null,
                            XPathResult.NUMBER_TYPE,
                            null,
                        );
                        return Number(result?.numberValue || 0);
                    } catch (_) {
                        return 0;
                    }
                };

                const isUniqueXpath = xpath => evaluateXpathCount(xpath) === 1;

                const getElementIndexForXpath = element => {
                    if (!element?.parentElement) return 1;
                    const siblings = Array.from(element.parentElement.children || []);
                    let index = 0;
                    for (const sibling of siblings) {
                        if (String(sibling.tagName || '').toLowerCase() === String(element.tagName || '').toLowerCase()) {
                            index += 1;
                        }
                        if (sibling === element) return index || 1;
                    }
                    return 1;
                };

                const buildRelativeFromAnchor = element => {
                    let current = element?.parentElement;
                    let depth = 0;
                    while (current && depth < 5) {
                        const id = String(current.id || '').trim();
                        const dataTestId = String(current.getAttribute?.('data-testid') || '').trim();
                        const name = String(current.getAttribute?.('name') || '').trim();
                        const ariaLabel = String(current.getAttribute?.('aria-label') || '').trim();
                        let anchor = '';
                        if (id) anchor = `//*[@id=${quoteXpath(id)}]`;
                        else if (dataTestId) anchor = `//*[@data-testid=${quoteXpath(dataTestId)}]`;
                        else if (name) anchor = `//*[@name=${quoteXpath(name)}]`;
                        else if (ariaLabel) anchor = `//*[@aria-label=${quoteXpath(ariaLabel)}]`;
                        if (anchor && isUniqueXpath(anchor)) {
                            const elTag = String(element.tagName || '').toLowerCase();
                            const index = getElementIndexForXpath(element);
                            return `${anchor}//${elTag}[${index}]`;
                        }
                        current = current.parentElement;
                        depth += 1;
                    }
                    return '';
                };

                const buildLocators = element => {
                    const rootNode = element?.getRootNode?.();
                    if (rootNode && rootNode.toString?.() === '[object ShadowRoot]') {
                        const css = buildCss(element);
                        return css ? [css] : [];
                    }
                    const tag = String(element?.tagName || '').toLowerCase();
                    const preferredTag = tag || '*';
                    const wildcardTag = '*';
                    const uniqueLocators = [];
                    const fallbackLocators = [];
                    const seen = new Set();
                    const push = value => {
                        const candidate = String(value || '').trim();
                        if (!candidate || seen.has(candidate)) return;
                        seen.add(candidate);
                        if (isUniqueXpath(candidate)) uniqueLocators.push(candidate);
                        else fallbackLocators.push(candidate);
                    };
                    ['id', 'data-testid', 'name', 'aria-label', 'placeholder', 'title', 'role', 'value'].forEach(attr => {
                        const value = String(element.getAttribute?.(attr) || '').trim();
                        if (!value) return;
                        push(`//${wildcardTag}[@${attr}=${quoteXpath(value)}]`);
                        if (preferredTag !== wildcardTag) push(`//${preferredTag}[@${attr}=${quoteXpath(value)}]`);
                    });
                    const typeValue = String(element.getAttribute?.('type') || '').trim();
                    const nameValue = String(element.getAttribute?.('name') || '').trim();
                    if (typeValue && nameValue) {
                        push(`//*[@type=${quoteXpath(typeValue)} and @name=${quoteXpath(nameValue)}]`);
                        if (preferredTag !== wildcardTag) {
                            push(`//${preferredTag}[@type=${quoteXpath(typeValue)} and @name=${quoteXpath(nameValue)}]`);
                        }
                    }
                    const classToken = String(element.getAttribute?.('class') || '')
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .find(token => token.length > 2) || '';
                    if (classToken) {
                        const classContains = `contains(concat(' ', normalize-space(@class), ' '), ${quoteXpath(` ${classToken} `)})`;
                        push(`//*[${classContains}]`);
                        if (preferredTag !== wildcardTag) push(`//${preferredTag}[${classContains}]`);
                    }
                    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
                    const hasMojibakeGlyphs = /ÃŽâ€œÃƒÂ»|Ã¯Â¿Â½/.test(text);
                    const hasSymbolNoise = /[Ã¢â€“Â¸Ã¢â€“Â¾Ã¢â‚¬Â¢Ã¢â€”Â¦Ã¢â€”â€ Ã¢â€”â€¡Ã¢â€“Â Ã¢â€“Â¡Ã¢â€“Â²Ã¢â€“Â¼Ã¢â€”â‚¬Ã¢â€“Â¶]/.test(text);
                    const hasControlChars = /[\u0000-\u001F\u007F]/.test(text);
                    if (text && text.length <= 60 && !hasMojibakeGlyphs && !hasSymbolNoise && !hasControlChars) {
                        push(`//*[normalize-space(.)=${quoteXpath(text)}]`);
                        push(`//${preferredTag}[normalize-space(.)=${quoteXpath(text)}]`);
                    }
                    if (text && text.length <= 80 && !hasMojibakeGlyphs && !hasSymbolNoise && !hasControlChars) {
                        push(`//*[contains(normalize-space(.),${quoteXpath(text)})]`);
                        push(`//${preferredTag}[contains(normalize-space(.),${quoteXpath(text)})]`);
                    }
                    const relative = buildRelativeFromAnchor(element);
                    if (relative) push(relative);
                    push(buildCss(element));
                    push(buildAbsoluteXpath(element));
                    return [...uniqueLocators, ...fallbackLocators].slice(0, 10);
                };

                const formatTip = element => {
                    if (!element) return '';
                    if (currentDepth > 0) {
                        return 'Element is inside an iframe';
                    }
                    try {
                        const rootNode = element.getRootNode?.();
                        if (rootNode && rootNode.toString?.() === '[object ShadowRoot]') {
                            return 'Element is inside shadow DOM';
                        }
                    } catch (_) {}
                    return '';
                };

                const draw = (element, mode) => {
                    const rect = element.getBoundingClientRect();
                    const { overlay, tip } = ensureUi();
                    overlay.style.left = `${rect.left}px`;
                    overlay.style.top = `${rect.top}px`;
                    overlay.style.width = `${rect.width}px`;
                    overlay.style.height = `${rect.height}px`;
                    overlay.style.borderColor = mode === 'selected' ? '#ea580c' : '#f59e0b';
                    overlay.style.background = mode === 'selected' ? 'rgba(234, 88, 12, 0.24)' : 'rgba(245, 158, 11, 0.18)';
                    overlay.style.opacity = '1';
                    tip.textContent = `${mode === 'selected' ? 'Locked' : 'Hover'} Ã¢â‚¬Â¢ ${formatTip(element)}`;
                    tip.style.left = `${Math.max(8, rect.left)}px`;
                    tip.style.top = `${Math.max(8, rect.top - 34)}px`;
                    tip.style.opacity = '1';
                    const tipText = formatTip(element);
                    if (tipText) {
                        tip.textContent = tipText;
                    } else {
                        tip.textContent = '';
                        tip.style.opacity = '0';
                    }
                };

                const updatePayload = (element, mode) => {
                    const paths = buildLocators(element);
                    const iframeChain = buildIframeChain();
                    const shadowChain = buildShadowChain(element);
                    const tag = String(element?.tagName || '').toLowerCase();
                    const isFrameTag = tag === 'iframe' || tag === 'frame';
                    let value = buildTraversalValue(iframeChain, shadowChain);
                    if (!value && isFrameTag) {
                        const frameSelf = buildSelectorDescriptor(element)?.selector || '';
                        value = frameSelf;
                    }
                    const locatorKind = shadowChain.length > 0 ? 'css' : 'xpath';
                    const payload = {
                        locator: paths[0] || '',
                        paths,
                        value,
                        locatorKind,
                        iframeChain,
                        shadowChain,
                        tip: formatTip(element),
                        depth: currentDepth,
                        mode,
                        runId: Number(currentRunId || 0),
                        capturedAt: Date.now(),
                    };
                    if (mode === 'selected') {
                        state.selected = payload;
                        state.queue.push(payload);
                    } else {
                        state.hover = payload;
                    }
                };

                state.onMove = event => {
                    if (!state.active) return;
                    const element = resolveHoveredElement(event);
                    if (!element) {
                        state.hover = null;
                        state.lastTarget = null;
                        state.canCaptureClick = false;
                        state.canCaptureClickAt = 0;
                        publishLiveHover(null);
                        hideUi();
                        return;
                    }
                    if (state.lastTarget === element) return;
                    state.lastTarget = element;
                    state.canCaptureClick = true;
                    state.canCaptureClickAt = Date.now();
                    clearOtherAccessibleInspectorUi();
                    draw(element, 'hover');
                    updatePayload(element, 'hover');
                    publishLiveHover(state.hover);
                };

                state.onLeave = () => {
                    if (!state.active) return;
                    state.hover = null;
                    state.lastTarget = null;
                    state.canCaptureClick = false;
                    state.canCaptureClickAt = 0;
                    publishLiveHover(null);
                    hideUi();
                };

                state.onPointerDown = event => {
                    if (!state.active) return;
                    const element = resolveHoveredElement(event);
                    if (!element) return;
                    if (!state.canCaptureClick) return;
                    const liveHover = state.hover;
                    if (!liveHover?.locator) return;
                    if (Number(liveHover.runId || 0) !== Number(currentRunId || 0)) return;
                    if (!state.lastTarget || element !== state.lastTarget) return;
                    if ((Date.now() - Number(state.canCaptureClickAt || 0)) < 60) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    state.lastTarget = element;
                    state.canCaptureClick = false;
                    state.canCaptureClickAt = 0;
                    updatePayload(element, 'selected');
                    if (state.selected?.locator) {
                        publishPendingSelection(state.selected);
                    }
                    publishLiveHover(null);
                    state.clickedAt = Date.now();
                    hideUi();
                    deactivateAncestorInspectors();
                    deactivateAccessibleInspectors();
                    deactivateLocal();
                };

                state.listenerRoots = collectListenerRoots();
                state.listenerRoots.forEach(root => {
                    try {
                        root.addEventListener('pointermove', state.onMove, true);
                        root.addEventListener('pointerleave', state.onLeave, true);
                        root.addEventListener('pointerdown', state.onPointerDown, true);
                    } catch (_) {}
                });

                window[KEY] = state;
        };

const injectAdvancedSpyHooksScript = function (currentDepth, currentIframeChain) {
                const KEY = '__qaAdvancedSpy';
                const getRootWindow = () => {
                    let rootWindow = window;
                    while (true) {
                        let parentWindow = null;
                        try {
                            parentWindow = rootWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === rootWindow) break;
                        rootWindow = parentWindow;
                    }
                    return rootWindow;
                };
                const state = window[KEY] || {};
                const overlayId = 'qa-advanced-spy-overlay';
                const tipId = 'qa-advanced-spy-tip';

                const cleanup = () => {
                    state.active = false;
                    if (state.onMove) document.removeEventListener('pointermove', state.onMove, true);
                    if (state.onLeave) document.removeEventListener('pointerleave', state.onLeave, true);
                    if (state.onPointerDown) document.removeEventListener('pointerdown', state.onPointerDown, true);
                    if (state.onMessage) window.removeEventListener('message', state.onMessage, true);
                    document.getElementById(overlayId)?.remove();
                    document.getElementById(tipId)?.remove();
                };

                cleanup();

                state.active = true;
                state.depth = currentDepth;
                state.iframeChain = Array.isArray(currentIframeChain) ? currentIframeChain : [];
                state.selected = null;
                state.lastTarget = null;

                const quoteXpath = value => {
                    const text = String(value ?? '');
                    if (!text.includes("'")) return `'${text}'`;
                    if (!text.includes('"')) return `"${text}"`;
                    return `concat('${text.split("'").join(`', "'", '`)}')`;
                };

                const cssEscape = value =>
                    String(value ?? '').replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');

                const ensureUi = () => {
                    let overlay = document.getElementById(overlayId);
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = overlayId;
                        overlay.setAttribute('data-qa-spy-ui', '1');
                        Object.assign(overlay.style, {
                            position: 'fixed',
                            left: '0',
                            top: '0',
                            width: '0',
                            height: '0',
                            border: '2px solid #f59e0b',
                            background: 'rgba(245, 158, 11, 0.18)',
                            boxShadow: '0 0 0 1px rgba(15,23,42,0.18)',
                            borderRadius: '3px',
                            pointerEvents: 'none',
                            zIndex: '2147483646',
                            opacity: '0',
                        });
                        document.documentElement.appendChild(overlay);
                    }
                    let tip = document.getElementById(tipId);
                    if (!tip) {
                        tip = document.createElement('div');
                        tip.id = tipId;
                        tip.setAttribute('data-qa-spy-ui', '1');
                        Object.assign(tip.style, {
                            position: 'fixed',
                            left: '0',
                            top: '0',
                            maxWidth: '420px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: 'rgba(15, 23, 42, 0.96)',
                            color: '#f8fafc',
                            fontFamily: 'Consolas, Monaco, monospace',
                            fontSize: '11px',
                            lineHeight: '1.4',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pointerEvents: 'none',
                            zIndex: '2147483647',
                            boxShadow: '0 8px 22px rgba(15,23,42,0.28)',
                            opacity: '0',
                        });
                        document.documentElement.appendChild(tip);
                    }
                    return { overlay, tip };
                };

                const hideUi = () => {
                    const { overlay, tip } = ensureUi();
                    overlay.style.opacity = '0';
                    overlay.style.width = '0px';
                    overlay.style.height = '0px';
                    tip.style.opacity = '0';
                    tip.textContent = '';
                };

                const deactivateLocal = () => {
                    state.active = false;
                    state.lastTarget = null;
                    if (state.onMove) document.removeEventListener('pointermove', state.onMove, true);
                    if (state.onLeave) document.removeEventListener('pointerleave', state.onLeave, true);
                    if (state.onPointerDown) document.removeEventListener('pointerdown', state.onPointerDown, true);
                    if (state.onClick) document.removeEventListener('click', state.onClick, true);
                    if (state.onMessage) window.removeEventListener('message', state.onMessage, true);
                    hideUi();
                };

                const clearInspectorUiInWindow = targetWindow => {
                    try {
                        const targetState = targetWindow.__qaAdvancedSpy;
                        if (targetState) {
                            targetState.lastTarget = null;
                        }
                        const targetOverlay = targetWindow.document.getElementById(overlayId);
                        const targetTip = targetWindow.document.getElementById(tipId);
                        if (targetOverlay) {
                            targetOverlay.style.opacity = '0';
                            targetOverlay.style.width = '0px';
                            targetOverlay.style.height = '0px';
                        }
                        if (targetTip) {
                            targetTip.style.opacity = '0';
                            targetTip.textContent = '';
                        }
                    } catch (_) {}
                };

                const deactivateInspectorInWindow = targetWindow => {
                    try {
                        const targetState = targetWindow.__qaAdvancedSpy;
                        if (targetState) {
                            targetState.active = false;
                            targetState.lastTarget = null;
                            if (targetState.onMove) targetWindow.document.removeEventListener('pointermove', targetState.onMove, true);
                            if (targetState.onLeave) targetWindow.document.removeEventListener('pointerleave', targetState.onLeave, true);
                            if (targetState.onPointerDown) targetWindow.document.removeEventListener('pointerdown', targetState.onPointerDown, true);
                            if (targetState.onClick) targetWindow.document.removeEventListener('click', targetState.onClick, true);
                            if (targetState.onMessage) targetWindow.removeEventListener('message', targetState.onMessage, true);
                        }
                        clearInspectorUiInWindow(targetWindow);
                    } catch (_) {}
                };

                const visitAccessibleWindows = (startWindow, visitor, visited = new Set()) => {
                    if (!startWindow || visited.has(startWindow)) return;
                    visited.add(startWindow);
                    visitor(startWindow);
                    try {
                        const frameNodes = Array.from(startWindow.document?.querySelectorAll?.('iframe, frame') || []);
                        frameNodes.forEach(frame => {
                            try {
                                if (frame.contentWindow) {
                                    visitAccessibleWindows(frame.contentWindow, visitor, visited);
                                }
                            } catch (_) {}
                        });
                    } catch (_) {}
                };

                const getStopToken = () => {
                    try {
                        return Number(getRootWindow().__qaAdvancedSpyStopToken || 0);
                    } catch (_) {
                        return 0;
                    }
                };

                state.stopToken = getStopToken();

                const hasStopSignal = () => getStopToken() !== Number(state.stopToken || 0);

                const clearOtherAccessibleInspectorUi = () => {
                    const rootWindow = getRootWindow();
                    visitAccessibleWindows(rootWindow, targetWindow => {
                        if (targetWindow === window) return;
                        clearInspectorUiInWindow(targetWindow);
                    });
                };

                const deactivateAccessibleInspectors = () => {
                    const rootWindow = getRootWindow();
                    visitAccessibleWindows(rootWindow, deactivateInspectorInWindow);
                };

                const deactivateAncestorInspectors = () => {
                    let currentWindow = window;
                    while (currentWindow) {
                        deactivateInspectorInWindow(currentWindow);
                        let parentWindow = null;
                        try {
                            parentWindow = currentWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === currentWindow) {
                            break;
                        }
                        currentWindow = parentWindow;
                    }
                };

                const publishStopSignal = () => {
                    const nextToken = getStopToken() + 1;
                    const rootWindow = getRootWindow();
                    try {
                        rootWindow.__qaAdvancedSpyStopToken = nextToken;
                    } catch (_) {}
                    visitAccessibleWindows(rootWindow, targetWindow => {
                        try {
                            targetWindow.__qaAdvancedSpyStopToken = nextToken;
                        } catch (_) {}
                    });
                    let currentWindow = window;
                    while (currentWindow) {
                        try {
                            currentWindow.__qaAdvancedSpyStopToken = nextToken;
                        } catch (_) {}
                        let parentWindow = null;
                        try {
                            parentWindow = currentWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === currentWindow) {
                            break;
                        }
                        currentWindow = parentWindow;
                    }
                    state.stopToken = nextToken;
                };

                const relayToParent = message => {
                    try {
                        if (window.parent && window.parent !== window) {
                            window.parent.postMessage(message, '*');
                        }
                    } catch (_) {}
                };

                state.onMessage = event => {
                    const data = event?.data;
                    if (!data || data.__qaAdvancedSpyBridge !== true) return;
                    if (data.kind === 'pending') {
                        window.__qaAdvancedSpyPending = data.payload?.contract ? data.payload : null;
                    }
                    relayToParent(data);
                };
                window.addEventListener('message', state.onMessage, true);

                const publishPendingSelection = payload => {
                    if (!payload?.contract) return;
                    window.__qaAdvancedSpyPending = payload;
                    let currentWindow = window;
                    while (currentWindow) {
                        try {
                            currentWindow.__qaAdvancedSpyPending = payload;
                        } catch (_) {}
                        let parentWindow = null;
                        try {
                            parentWindow = currentWindow.parent;
                        } catch (_) {
                            break;
                        }
                        if (!parentWindow || parentWindow === currentWindow) {
                            break;
                        }
                        currentWindow = parentWindow;
                    }
                    relayToParent({
                        __qaAdvancedSpyBridge: true,
                        kind: 'pending',
                        payload,
                    });
                };

                const isIgnored = element => {
                    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
                    if (element.closest?.('[data-qa-spy-ui="1"]')) return true;
                    const tag = String(element.tagName || '').toLowerCase();
                    return ['html', 'body', 'iframe', 'frame'].includes(tag);
                };

                const isOversizedContainer = element => {
                    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
                    const tag = String(element.tagName || '').toLowerCase();
                    if (!['div', 'section', 'main', 'article', 'form'].includes(tag)) return false;
                    const id = String(element.id || '').toLowerCase();
                    const name = String(element.getAttribute?.('name') || '').toLowerCase();
                    const dataTestId = String(element.getAttribute?.('data-testid') || '').toLowerCase();
                    const ariaLabel = String(element.getAttribute?.('aria-label') || '').toLowerCase();
                    const keepBecauseNamed =
                        (id && !['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(id)) ||
                        (name && !['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(name)) ||
                        !!dataTestId ||
                        !!ariaLabel;
                    if (keepBecauseNamed) return false;
                    const rect = element.getBoundingClientRect?.();
                    if (!rect) return false;
                    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
                    if (!viewportWidth || !viewportHeight) return false;
                    const widthRatio = rect.width / viewportWidth;
                    const heightRatio = rect.height / viewportHeight;
                    const isGenericShell = ['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(id)
                        || ['content', 'container', 'wrapper', 'main', 'root', 'app', 'page'].includes(name);
                    if (isGenericShell && (widthRatio > 0.45 || heightRatio > 0.45)) {
                        return true;
                    }
                    return widthRatio > 0.75 && heightRatio > 0.55;
                };

                const isValidSpyTarget = element => !isIgnored(element) && !isOversizedContainer(element);

                const resolveHoveredElement = event => {
                    const candidates = [];
                    const pushCandidate = element => {
                        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
                        if (candidates.includes(element)) return;
                        candidates.push(element);
                    };

                    const eventTarget = event?.target && event.target.nodeType === Node.ELEMENT_NODE ? event.target : null;
                    pushCandidate(eventTarget);

                    try {
                        const path = Array.isArray(event?.composedPath?.()) ? event.composedPath() : [];
                        path.forEach(node => {
                            if (node?.nodeType === Node.ELEMENT_NODE) pushCandidate(node);
                        });
                    } catch (_) {}

                    try {
                        const pointTargets = Array.from(document.elementsFromPoint(event.clientX, event.clientY) || []);
                        pointTargets.forEach(pushCandidate);
                    } catch (_) {
                        pushCandidate(document.elementFromPoint(event.clientX, event.clientY));
                    }

                    return candidates.find(isValidSpyTarget) || null;
                };

                const getShadowHosts = element => {
                    const hosts = [];
                    try {
                        let root = element.getRootNode?.();
                        while (root && root.host) {
                            hosts.unshift(root.host);
                            root = root.host.getRootNode?.();
                        }
                    } catch (_) {}
                    return hosts;
                };

                const buildCss = element => {
                    if (element.id) return `#${cssEscape(element.id)}`;
                    const parts = [];
                    let node = element;
                    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
                        let part = node.tagName.toLowerCase();
                        const dataTestId = node.getAttribute?.('data-testid');
                        const ariaLabel = node.getAttribute?.('aria-label');
                        if (dataTestId) {
                            part += `[data-testid="${cssEscape(dataTestId)}"]`;
                            parts.unshift(part);
                            break;
                        }
                        if (ariaLabel) {
                            part += `[aria-label="${cssEscape(ariaLabel)}"]`;
                            parts.unshift(part);
                            break;
                        }
                        if (node.getAttribute('name')) {
                            part += `[name="${cssEscape(node.getAttribute('name'))}"]`;
                            parts.unshift(part);
                            break;
                        }
                        const classes = Array.from(node.classList || []).filter(Boolean).slice(0, 2);
                        if (classes.length) {
                            part += `.${classes.map(cssEscape).join('.')}`;
                        }
                        parts.unshift(part);
                        node = node.parentElement;
                    }
                    return parts.join(' > ');
                };

                const evaluateXpathCount = xpath => {
                    try {
                        const result = document.evaluate(
                            `count(${xpath})`,
                            document,
                            null,
                            XPathResult.NUMBER_TYPE,
                            null,
                        );
                        return Number(result?.numberValue || 0);
                    } catch (_) {
                        return 0;
                    }
                };

                const isUniqueXpath = xpath => evaluateXpathCount(xpath) === 1;

                const buildXpath = element => {
                    const rootNode = element.getRootNode?.();
                    if (rootNode && rootNode.toString?.() === '[object ShadowRoot]') {
                        return '';
                    }
                    const tag = String(element?.tagName || '').toLowerCase() || '*';
                    const candidates = [];
                    const seen = new Set();
                    const push = value => {
                        const candidate = String(value || '').trim();
                        if (!candidate || seen.has(candidate)) return;
                        seen.add(candidate);
                        candidates.push(candidate);
                    };
                    const attributes = ['id', 'data-testid', 'name', 'aria-label', 'placeholder', 'title', 'role', 'value'];
                    for (const attr of attributes) {
                        const value = String(element.getAttribute?.(attr) || '').trim();
                        if (value) {
                            push(`//*[@${attr}=${quoteXpath(value)}]`);
                            push(`//${tag}[@${attr}=${quoteXpath(value)}]`);
                        }
                    }
                    const typeValue = String(element.getAttribute?.('type') || '').trim();
                    const nameValue = String(element.getAttribute?.('name') || '').trim();
                    if (typeValue && nameValue) {
                        push(`//*[@type=${quoteXpath(typeValue)} and @name=${quoteXpath(nameValue)}]`);
                        push(`//${tag}[@type=${quoteXpath(typeValue)} and @name=${quoteXpath(nameValue)}]`);
                    }
                    const classToken = String(element.getAttribute?.('class') || '')
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .find(token => token.length > 2) || '';
                    if (classToken) {
                        const classContains = `contains(concat(' ', normalize-space(@class), ' '), ${quoteXpath(` ${classToken} `)})`;
                        push(`//*[${classContains}]`);
                        push(`//${tag}[${classContains}]`);
                    }
                    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
                    const hasMojibakeGlyphs = /ÃŽâ€œÃƒÂ»|Ã¯Â¿Â½/.test(text);
                    const hasSymbolNoise = /[Ã¢â€“Â¸Ã¢â€“Â¾Ã¢â‚¬Â¢Ã¢â€”Â¦Ã¢â€”â€ Ã¢â€”â€¡Ã¢â€“Â Ã¢â€“Â¡Ã¢â€“Â²Ã¢â€“Â¼Ã¢â€”â‚¬Ã¢â€“Â¶]/.test(text);
                    const hasControlChars = /[\u0000-\u001F\u007F]/.test(text);
                    if (text && text.length <= 60 && !hasMojibakeGlyphs && !hasSymbolNoise && !hasControlChars) {
                        push(`//*[normalize-space(.)=${quoteXpath(text)}]`);
                        push(`//${tag}[normalize-space(.)=${quoteXpath(text)}]`);
                    }
                    if (text && text.length <= 80 && !hasMojibakeGlyphs && !hasSymbolNoise && !hasControlChars) {
                        push(`//*[contains(normalize-space(.),${quoteXpath(text)})]`);
                        push(`//${tag}[contains(normalize-space(.),${quoteXpath(text)})]`);
                    }
                    const parts = [];
                    let node = element;
                    while (node && node.nodeType === Node.ELEMENT_NODE) {
                        let index = 1;
                        let sibling = node.previousElementSibling;
                        while (sibling) {
                            if (sibling.tagName === node.tagName) index += 1;
                            sibling = sibling.previousElementSibling;
                        }
                        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
                        node = node.parentElement;
                    }
                    push(`/${parts.join('/')}`);
                    const unique = candidates.find(isUniqueXpath);
                    return unique || candidates[0] || '';
                };

                const buildIndexedXpath = element => {
                    const rootNode = element.getRootNode?.();
                    if (rootNode && rootNode.toString?.() === '[object ShadowRoot]') {
                        return '';
                    }
                    const parts = [];
                    let node = element;
                    while (node && node.nodeType === Node.ELEMENT_NODE) {
                        const tagName = node.tagName.toLowerCase();
                        if (tagName === 'html' || tagName === 'body') {
                            node = node.parentElement;
                            continue;
                        }
                        let index = 1;
                        let sibling = node.previousElementSibling;
                        while (sibling) {
                            if (sibling.tagName === node.tagName) index += 1;
                            sibling = sibling.previousElementSibling;
                        }
                        parts.unshift(`${tagName}[${index}]`);
                        node = node.parentElement;
                    }
                    return parts.length ? `//${parts.join('/')}` : '';
                };

                const formatContext = element => {
                    const parts = [];
                    if (currentDepth > 0) {
                        parts.push(currentDepth > 1 ? `nested-iframe-depth:${currentDepth}` : 'iframe');
                    }
                    const shadowHosts = getShadowHosts(element);
                    if (shadowHosts.length) {
                        parts.push(`shadow-dom:${shadowHosts.length}`);
                    }
                    return parts.join(' | ') || 'regular-dom';
                };

                const buildTraversal = element => {
                    const parts = [];
                    if (currentDepth > 0) {
                        parts.push(currentDepth > 1 ? `iframe-depth:${currentDepth}` : 'iframe');
                    }
                    const shadowHosts = getShadowHosts(element);
                    shadowHosts.forEach(host => {
                        const hostCss = host.id ? `#${host.id}` : host.tagName.toLowerCase();
                        parts.push(`shadow(host=${hostCss})`);
                    });
                    return parts.join(' -> ');
                };

                const buildIframeChain = () => {
                    if (!Array.isArray(state.iframeChain)) return [];
                    const seen = new Set();
                    return state.iframeChain.filter(item => {
                        const key = `${item?.kind || ''}::${item?.selector || ''}`;
                        if (!item?.selector || seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                };

                const buildShadowChain = element => {
                    const chain = [];
                    const hosts = getShadowHosts(element);
                    hosts.forEach((host, index) => {
                        const descriptor = buildSelectorDescriptor(host);
                        chain.push({
                            label: `Shadow Host ${index + 1}`,
                            kind: descriptor.kind,
                            selector: descriptor.selector,
                        });
                    });
                    return chain;
                };

                const buildShadowPath = element => {
                    const chain = buildShadowChain(element);
                    if (chain.length === 0) return '';
                    return chain.map(item => item.selector).join(' >> ');
                };

                const buildSelectors = (element, css, xpath) => {
                    const selectors = [];
                    const push = (label, value, kind) => {
                        if (!value || selectors.some(entry => entry.value === value)) return;
                        selectors.push({ label, value, kind });
                    };
                    push('Rel cssSelector', css, 'css');
                    push('Rel XPath', xpath, 'xpath');
                    push('index XPath', buildIndexedXpath(element), 'xpath');
                    const tag = String(element?.tagName || '').toLowerCase() || '*';
                    ['id', 'data-testid', 'name', 'aria-label', 'placeholder', 'title'].forEach(attr => {
                        const value = String(element.getAttribute?.(attr) || '').trim();
                        if (!value) return;
                        push(`Attr XPath (${attr})`, `//${tag}[@${attr}=${quoteXpath(value)}]`, 'xpath');
                    });
                    return selectors;
                };

                const buildElementDetails = element => {
                    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140);
                    const attrs = ['id', 'name', 'data-testid', 'aria-label', 'role']
                        .map(attr => {
                            const value = element.getAttribute?.(attr);
                            return value ? `${attr}=${value}` : null;
                        })
                        .filter(Boolean);
                    return [
                        `tag=${String(element.tagName || '').toLowerCase()}`,
                        text ? `text=${text}` : '',
                        attrs.length ? `attrs=${attrs.join(', ')}` : '',
                    ].filter(Boolean).join(' | ');
                };

                const formatTip = element => {
                    const shadowHosts = getShadowHosts(element);
                    if (currentDepth > 0) return 'Element is inside an iframe';
                    if (shadowHosts.length) return 'Element is inside shadow DOM';
                    return '';
                };

                const draw = element => {
                    const rect = element.getBoundingClientRect();
                    const { overlay, tip } = ensureUi();
                    overlay.style.left = `${rect.left}px`;
                    overlay.style.top = `${rect.top}px`;
                    overlay.style.width = `${rect.width}px`;
                    overlay.style.height = `${rect.height}px`;
                    overlay.style.borderColor = '#f59e0b';
                    overlay.style.background = 'rgba(245, 158, 11, 0.18)';
                    overlay.style.opacity = '1';
                    const tipText = formatTip(element);
                    if (tipText) {
                        tip.textContent = tipText;
                        tip.style.left = `${Math.max(8, rect.left)}px`;
                        tip.style.top = `${Math.max(8, rect.top - 34)}px`;
                        tip.style.opacity = '1';
                    } else {
                        tip.textContent = '';
                        tip.style.opacity = '0';
                    }
                };

                const buildPayload = element => {
                    const css = buildCss(element);
                    const xpath = buildXpath(element);
                    const traversal = buildTraversal(element);
                    const iframeChain = buildIframeChain();
                    const shadowChain = buildShadowChain(element);
                    const shadowPath = buildShadowPath(element);
                    const selectors = buildSelectors(element, css, xpath);
                    const notes = [];
                    if (currentDepth > 0) notes.push('iframe traversal required');
                    if (!xpath) notes.push('xpath omitted for shadow DOM content');
                    return {
                        source: 'click',
                        contract: {
                            traversal,
                            selectors,
                            iframeChain,
                            shadowChain,
                            shadowPath,
                            css,
                            xpath,
                            context: formatContext(element),
                            elementDetails: buildElementDetails(element),
                            notes,
                        },
                    };
                };

                state.onMove = event => {
                    if (!state.active) return;
                    if (hasStopSignal()) {
                        deactivateLocal();
                        return;
                    }
                    const element = resolveHoveredElement(event);
                    if (!element) {
                        state.lastTarget = null;
                        clearOtherAccessibleInspectorUi();
                        hideUi();
                        return;
                    }
                    if (state.lastTarget === element) return;
                    state.lastTarget = element;
                    clearOtherAccessibleInspectorUi();
                    draw(element);
                };

                state.onLeave = () => {
                    if (!state.active) return;
                    if (hasStopSignal()) {
                        deactivateLocal();
                        return;
                    }
                    state.lastTarget = null;
                    hideUi();
                };

                state.onPointerDown = event => {
                    if (!state.active) return;
                    if (hasStopSignal()) {
                        deactivateLocal();
                        return;
                    }
                    const element = resolveHoveredElement(event);
                    if (!element) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    const payload = buildPayload(element);
                    state.selected = payload;
                    publishStopSignal();
                    publishPendingSelection(payload);
                    hideUi();
                    deactivateAncestorInspectors();
                    deactivateAccessibleInspectors();
                    deactivateLocal();
                };

                state.onClick = event => {
                    if (!state.active && !hasStopSignal()) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                };

                document.addEventListener('pointermove', state.onMove, true);
                document.addEventListener('pointerleave', state.onLeave, true);
                document.addEventListener('pointerdown', state.onPointerDown, true);
                document.addEventListener('click', state.onClick, true);
            };

module.exports = {
    injectXPathRecorderHooksScript,
    injectAdvancedSpyHooksScript,
};


