(function (global) {
  function createManualRunnerModule({
    elements,
    express,
    getActiveApiCallResultTab,
    setActiveApiCallResultTab,
    onToggleApiCallResult,
    resetApiCallResult,
    runAssertions,
    renderApiCallResult,
    syncApiCallPanelVisibility,
    stopSpyBeforeExecute,
    setLaunchButtonState,
    getLatestApiCallOutput,
  }) {
    let lastApiExecutionSource = 'manual';

    const getSelectedManualKeyword = () =>
      String(elements.testKeyword?.value || '').trim().toLowerCase();

    const setExecutionSource = source => {
      lastApiExecutionSource = source === 'api' ? 'api' : 'manual';
    };

    const getExecutionSource = () => lastApiExecutionSource;

    const handleKeywordChange = event => {
      console.log(event.target.value);
      resetApiCallResult();
    };

    const handleValueInput = () => {
      if (getSelectedManualKeyword() !== 'apicall') return;
      if (String(elements.testValue?.value || '').trim() === '') {
        resetApiCallResult();
      } else {
        syncApiCallPanelVisibility();
      }
    };

    const handleExecute = () => {
      const keyword = String(elements.testKeyword?.value || '').toLowerCase();
      const locator = String(elements.testLocator?.value || '');
      const value = String(elements.testValue?.value || '');
      const allowEmptyLocator = [
        'closebrowser',
        'apicall',
        'switchtoiframe',
        'switchtodom',
        'wait',
        'issuealias',
        'waitaliasemail',
        'emailsandboxissuealias',
        'emailissuealias',
        'emailsandboxwaitextract',
        'emailwaitextract',
        'launchbrowser',
        'launchdebugbrowser',
        'debugbrowser',
        'connectbrowser',
      ];
      console.log('[manual-runner-ui] execute request', {
        keyword,
        locator,
        value,
      });
      if (!locator.trim() && !allowEmptyLocator.includes(keyword)) {
        console.log('[manual-runner-ui] blocked execute: locator required for keyword', keyword);
        return;
      }
      stopSpyBeforeExecute?.();
      resetApiCallResult();
      setExecutionSource('manual');
      express.testExecute(locator, elements.testKeyword?.value, value, '');
      if (['launchbrowser', 'launchdebugbrowser', 'debugbrowser', 'connectbrowser'].includes(keyword)) {
        setLaunchButtonState(true);
      } else if (keyword === 'closebrowser') {
        setLaunchButtonState(false);
      }
    };

    const handleApiCallTabClick = button => {
      const selectedTab = button.getAttribute('data-tab') || 'json';
      setActiveApiCallResultTab(selectedTab);
      elements.apiCallTabButtons.forEach(tabButton =>
        tabButton.classList.toggle('active', tabButton === button),
      );
      renderApiCallResult(
        getLatestApiCallOutput() || elements.testOutput?.value || '',
        elements.testExpectedOutput?.value || '',
        {
          evaluateAssertions: !!elements.apiCallAssertionList?.children?.length,
        },
      );
    };

    const handleRunAssertions = () => {
      if (!getLatestApiCallOutput() && !elements.testOutput?.value) {
        return;
      }
      runAssertions(elements.testExpectedOutput?.value || '');
    };

    const init = () => {
      elements.toggleApiCallResultBtn?.addEventListener('click', () => {
        onToggleApiCallResult?.();
      });

      elements.resetApiCallResultBtn?.addEventListener('click', () => {
        resetApiCallResult();
      });

      elements.testKeyword?.addEventListener('change', handleKeywordChange);
      elements.testValue?.addEventListener('input', handleValueInput);
      elements.testExecute?.addEventListener('click', handleExecute);

      elements.apiCallTabButtons?.forEach(button => {
        button.addEventListener('click', () => handleApiCallTabClick(button));
      });

      elements.runApiAssertionsBtn?.addEventListener('click', handleRunAssertions);
    };

    return {
      getExecutionSource,
      getSelectedManualKeyword,
      init,
      setExecutionSource,
    };
  }

  global.createManualRunnerModule = createManualRunnerModule;
})(window);
