(function (global) {
  function createAdvancedSpyWorkspaceModule({
    elements,
    express,
    launchBrowser,
    getActiveWorkspace,
    useInRunner,
  }) {
    let isActive = false;
    let lastPayload = null;
    let fetchTimer = null;

    const STATUS_COPY = {
      active: 'Browser active. Advanced Spy is ready.',
      inactive: 'Browser inactive. Launch Browser to prepare the Advanced Spy workspace.',
      starting: 'Starting Advanced Spy...',
      started: 'Advanced Spy active. Hover to inspect, click once to capture.',
      fetched: 'Advanced Spy capture refreshed.',
      stopped: 'Advanced Spy stopped.',
      empty: 'No Advanced Spy capture yet. Hover an element and click once to capture.',
      error: 'Advanced Spy could not be initialized. Check the app log for details.',
    };

    const setStatus = text => {
      if (elements.advancedSpyStatusText) {
        elements.advancedSpyStatusText.textContent = text;
      }
    };

    const escapeHtml = value =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    const clearOutputs = () => {
      if (elements.advancedSpySelectorList) {
        elements.advancedSpySelectorList.innerHTML = '<div class="text-slate-400 text-sm">No Advanced Spy capture yet.</div>';
      }
      if (elements.advancedSpyIframeChain) {
        elements.advancedSpyIframeChain.innerHTML = '<div class="text-slate-400">No iframe traversal required.</div>';
      }
      if (elements.advancedSpyShadowPath) {
        elements.advancedSpyShadowPath.innerHTML = '<div class="text-slate-400">No shadow root traversal required.</div>';
      }
      if (elements.advancedSpyContextSummary) {
        elements.advancedSpyContextSummary.innerHTML = '<div class="text-slate-400">Context details appear after capture.</div>';
      }
      if (elements.advancedSpyElementDetails) elements.advancedSpyElementDetails.value = '';
    };

    const getPreferredLocator = payload => {
      const selectors = payload?.contract?.selectors;
      if (Array.isArray(selectors) && selectors.length > 0) {
        return (
          selectors.find(selector => String(selector?.kind || '').toLowerCase() === 'xpath')?.value ||
          selectors[0]?.value ||
          ''
        );
      }
      return (
        payload?.contract?.iframeChain?.[0]?.selector ||
        payload?.contract?.shadowChain?.[0]?.selector ||
        ''
      );
    };

    const renderChain = (container, items, emptyText) => {
      if (!container) return;
      if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = `<div class="text-slate-400">${escapeHtml(emptyText)}</div>`;
        return;
      }
      container.innerHTML = items.map((item, index) => {
        const label = item?.label || `Step ${index + 1}`;
        const selector = item?.selector || '';
        const kind = item?.kind || '';
        return `
          <div class="rounded-lg border border-slate-200 dark:!border-slate-700 bg-white/70 dark:!bg-slate-900/60 p-2 mb-2 last:mb-0">
            <div class="d-flex align-items-center justify-content-between gap-2">
              <div class="text-[11px] uppercase tracking-wide text-slate-500">${escapeHtml(label)}${kind ? ` · ${escapeHtml(kind)}` : ''}</div>
              <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2 advancedSpyChainCopyBtn" data-copy="${escapeHtml(selector)}">Copy</button>
            </div>
            <div class="mt-1 font-monospace text-[12px] break-all">${escapeHtml(selector)}</div>
          </div>
        `;
      }).join('');
    };

    const renderSelectors = selectors => {
      if (!elements.advancedSpySelectorList) return;
      if (!Array.isArray(selectors) || selectors.length === 0) {
        elements.advancedSpySelectorList.innerHTML = '<div class="text-slate-400 text-sm">No selectors available for this capture.</div>';
        return;
      }
      elements.advancedSpySelectorList.innerHTML = selectors.map((selector, index) => {
        const label = selector?.label || `Selector ${index + 1}`;
        const value = selector?.value || '';
        const kind = selector?.kind || '';
        return `
          <div class="rounded-lg border border-slate-200 dark:!border-slate-700 bg-white/70 dark:!bg-slate-900/60 p-2 mb-2 last:mb-0">
            <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
              <div class="d-flex align-items-center gap-2">
                <span class="inline-flex items-center justify-center rounded-full bg-cyan-500 text-white text-[10px] font-semibold min-w-[20px] h-5 px-1">${index + 1}</span>
                <div class="text-[11px] uppercase tracking-wide text-slate-500">${escapeHtml(label)}${kind ? ` · ${escapeHtml(kind)}` : ''}</div>
              </div>
              <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2 advancedSpySelectorCopyBtn" data-copy="${escapeHtml(value)}">Copy</button>
            </div>
            <div class="mt-1 font-monospace text-[12px] break-all">${escapeHtml(value)}</div>
          </div>
        `;
      }).join('');
    };

    const renderPayload = payload => {
      lastPayload = payload || null;
      const contract = payload?.contract || {};
      renderSelectors(contract.selectors);
      renderChain(elements.advancedSpyIframeChain, contract.iframeChain, 'No iframe traversal required.');
      if (elements.advancedSpyShadowPath) {
        if (contract.shadowPath) {
          elements.advancedSpyShadowPath.innerHTML = `
            <div class="rounded-lg border border-slate-200 dark:!border-slate-700 bg-white/70 dark:!bg-slate-900/60 p-2">
              <div class="d-flex align-items-center justify-content-between gap-2">
                <div class="text-[11px] uppercase tracking-wide text-slate-500">Shadow Traversal</div>
                <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2 advancedSpyShadowCopyBtn" data-copy="${escapeHtml(contract.shadowPath)}">Copy</button>
              </div>
              <div class="mt-1 font-monospace text-[12px] break-all">${escapeHtml(contract.shadowPath)}</div>
            </div>
          `;
        } else {
          elements.advancedSpyShadowPath.innerHTML = '<div class="text-slate-400">No shadow root traversal required.</div>';
        }
      }
      if (elements.advancedSpyContextSummary) {
        const notes = Array.isArray(contract.notes) && contract.notes.length > 0
          ? `<div class="mt-2 text-[11px] text-slate-500">${escapeHtml(contract.notes.join(' | '))}</div>`
          : '';
        elements.advancedSpyContextSummary.innerHTML = `
          <div class="text-sm text-slate-800 dark:text-slate-200">${escapeHtml(contract.context || 'regular-dom')}</div>
          ${notes}
        `;
      }
      if (elements.advancedSpyElementDetails) {
        const detailParts = [];
        if (contract.elementDetails) detailParts.push(contract.elementDetails);
        if (Array.isArray(contract.notes) && contract.notes.length > 0) {
          detailParts.push(`Notes: ${contract.notes.join(' | ')}`);
        }
        elements.advancedSpyElementDetails.value = detailParts.join('\n\n');
      }
    };

    const stopPolling = () => {
      if (fetchTimer) {
        global.clearTimeout(fetchTimer);
        fetchTimer = null;
      }
    };

    const handleFetchResult = async result => {
      if (!result) return;
      if (result?.source === 'click' && result?.contract) {
        renderPayload(result);
        setStatus(result?.message || STATUS_COPY.fetched);
        stopPolling();
        isActive = false;
        try {
          await express.advancedSpyStop?.();
        } catch (_) {}
      }
    };

    const pollForCapture = async () => {
      if (!isActive) return;
      try {
        const result = await express.advancedSpyFetch?.();
        await handleFetchResult(result);
      } catch (_) {
        // ignore polling failures until explicit stop
      }
      if (!isActive) return;
      fetchTimer = global.setTimeout(pollForCapture, 40);
    };

    const syncBrowserState = running => {
      if (elements.advancedSpyLaunchBrowserBtn) {
        elements.advancedSpyLaunchBrowserBtn.textContent = running ? 'Close Browser' : 'Launch Browser';
        elements.advancedSpyLaunchBrowserBtn.classList.toggle('btn-outline-danger', running);
        elements.advancedSpyLaunchBrowserBtn.classList.toggle('btn-outline-secondary', !running);
      }
      if (!running) {
        isActive = false;
        stopPolling();
      }
      if (getActiveWorkspace?.() === 'advanced-spy') {
        if (!running) {
          setStatus(STATUS_COPY.inactive);
        } else if (!lastPayload) {
          setStatus(isActive ? STATUS_COPY.started : STATUS_COPY.active);
        }
      }
    };

    const start = async () => {
      setStatus(STATUS_COPY.starting);
      try {
        const result = await express.advancedSpyStart?.();
        isActive = !!result?.active;
        clearOutputs();
        setStatus(result?.message || STATUS_COPY.started);
        stopPolling();
        if (isActive) {
          fetchTimer = global.setTimeout(pollForCapture, 40);
        }
      } catch (error) {
        setStatus(error?.message || STATUS_COPY.error);
      }
    };

    const fetchLatest = async () => {
      try {
        const result = await express.advancedSpyFetch?.();
        if (result?.contract && result?.source === 'click') {
          renderPayload(result);
          setStatus(result?.message || STATUS_COPY.fetched);
          return;
        }
        setStatus(STATUS_COPY.empty);
      } catch (error) {
        setStatus(error?.message || STATUS_COPY.error);
      }
    };

    const stop = async () => {
      stopPolling();
      try {
        await express.advancedSpyStop?.();
      } catch (_) {
        // ignore phase 1 stop failures in UI shell
      }
      isActive = false;
      clearOutputs();
      lastPayload = null;
      setStatus(STATUS_COPY.stopped);
    };

    const copyCurrentLocator = async () => {
      const locator = getPreferredLocator(lastPayload);
      if (!locator) {
        setStatus(STATUS_COPY.empty);
        return;
      }
      try {
        await navigator.clipboard.writeText(locator);
        setStatus('Advanced Spy locator copied to clipboard.');
      } catch (_) {
        setStatus('Clipboard copy failed. The locator is still available in the fields.');
      }
    };

    const useCurrentLocatorInRunner = () => {
      const payload = lastPayload?.contract || {};
      const locator = getPreferredLocator(lastPayload);
      if (!locator) {
        setStatus(STATUS_COPY.empty);
        return;
      }
      useInRunner?.({
        locator,
        preferredKeyword: payload.xpath ? 'Click' : 'Click',
      });
      setStatus('Advanced Spy locator copied into the Runner workspace.');
    };

    const init = () => {
      elements.advancedSpyLaunchBrowserBtn?.addEventListener('click', () => {
        launchBrowser?.();
      });
      elements.advancedSpyStartBtn?.addEventListener('click', () => {
        start();
      });
      elements.advancedSpyFetchBtn?.addEventListener('click', () => {
        fetchLatest();
      });
      elements.advancedSpyStopBtn?.addEventListener('click', () => {
        stop();
      });
      elements.advancedSpyCopyBtn?.addEventListener('click', () => {
        copyCurrentLocator();
      });
      elements.advancedSpyUseInRunnerBtn?.addEventListener('click', () => {
        useCurrentLocatorInRunner();
      });
      const bindChainCopy = container => {
        container?.addEventListener('click', async event => {
          const button = event.target.closest('.advancedSpyChainCopyBtn');
          if (!button) return;
          const value = button.getAttribute('data-copy') || '';
          if (!value) return;
          try {
            await navigator.clipboard.writeText(value);
            setStatus('Advanced Spy traversal row copied to clipboard.');
          } catch (_) {
            setStatus('Clipboard copy failed for traversal row.');
          }
        });
      };
      elements.advancedSpySelectorList?.addEventListener('click', async event => {
        const button = event.target.closest('.advancedSpySelectorCopyBtn');
        if (!button) return;
        const value = button.getAttribute('data-copy') || '';
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          setStatus('Advanced Spy selector copied to clipboard.');
        } catch (_) {
          setStatus('Clipboard copy failed for selector row.');
        }
      });
      bindChainCopy(elements.advancedSpyIframeChain);
      elements.advancedSpyShadowPath?.addEventListener('click', async event => {
        const button = event.target.closest('.advancedSpyShadowCopyBtn');
        if (!button) return;
        const value = button.getAttribute('data-copy') || '';
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          setStatus('Advanced Spy shadow path copied to clipboard.');
        } catch (_) {
          setStatus('Clipboard copy failed for shadow path.');
        }
      });
    };

    return {
      init,
      setStatus,
      syncBrowserState,
      stopSync: () => {
        stopPolling();
        isActive = false;
        clearOutputs();
        lastPayload = null;
        setStatus(STATUS_COPY.stopped);
      },
    };
  }

  global.createAdvancedSpyWorkspaceModule = createAdvancedSpyWorkspaceModule;
})(window);
