(function (global) {
  function createSpyWorkspaceModule({ elements, express, setLaunchButtonState, alertFn = alert }) {
    let isXpathRecording = false;
    let xpathFetchInterval = null;
    let xpathRecorderSession = 0;
    let xpathFetchInFlight = false;
    let spyStartClickedAt = 0;
    let firstHoverLoggedForSession = false;
    let spyTransitionInFlight = false;

    const setSpyUiState = active => {
      const span = elements.xpathRecorderBtn?.querySelector?.('span');
      if (span) {
        span.innerText = active ? 'Stop Spying' : 'Spy Objects';
      } else if (elements.xpathRecorderBtn) {
        elements.xpathRecorderBtn.innerText = active ? 'Stop Spying' : 'Spy Objects';
      }
      elements.spyIndicator?.classList.toggle('animate-pulse', !!active);
      elements.spyIndicator?.classList.toggle('bg-red-500', !!active);
      elements.spyIndicator?.classList.toggle('bg-gray-400', !active);
    };

    const clearPolling = () => {
      xpathFetchInFlight = false;
      if (xpathFetchInterval) {
        clearTimeout(xpathFetchInterval);
        xpathFetchInterval = null;
      }
    };

    const stopSpyUiOnly = () => {
      isXpathRecording = false;
      xpathRecorderSession += 1;
      clearPolling();
      setSpyUiState(false);
      firstHoverLoggedForSession = false;
    };

    const stopSpyInspection = async ({ awaitRemote = true } = {}) => {
      spyTransitionInFlight = true;
      console.log('[spy-ui] stop requested', { awaitRemote, session: xpathRecorderSession });
      stopSpyUiOnly();
      try {
        const stopPromise = express.recordXpathStop();
        if (awaitRemote) {
          await stopPromise;
        }
        console.log('[spy-ui] stop completed', { session: xpathRecorderSession });
      } catch (_) {}
      finally {
        spyTransitionInFlight = false;
      }
    };

    const stopSpyInspectionSync = ({ notifyRemote = true } = {}) => {
      stopSpyUiOnly();
      if (!notifyRemote) {
        return;
      }
      try {
        express.recordXpathStop();
      } catch (_) {}
    };

    const startPolling = recorderSession => {
      console.log('[spy-ui] polling start', { session: recorderSession });
      const scheduleNextFetch = () => {
        if (!isXpathRecording || recorderSession !== xpathRecorderSession) return;
        xpathFetchInterval = setTimeout(fetchOnce, 40);
      };

      const fetchOnce = async () => {
        if (!isXpathRecording || recorderSession !== xpathRecorderSession) return;
        if (xpathFetchInFlight) {
          scheduleNextFetch();
          return;
        }
        xpathFetchInFlight = true;
        try {
          const result = await express.recordXpathFetch();
          if (!isXpathRecording || recorderSession !== xpathRecorderSession) return;
          if (!result) {
            scheduleNextFetch();
            return;
          }
          const paths = Array.isArray(result) ? result : result.paths;
          const locator = Array.isArray(result) ? (result[0] || '') : (result.locator || result.paths?.[0] || '');
          const value = Array.isArray(result) ? '' : (result.value || '');
          const source = Array.isArray(result) ? 'selected' : (result.source || 'none');
          if (source === 'inactive') {
            console.log('[spy-ui] fetch inactive -> stopping', { session: recorderSession });
            await stopSpyInspection();
            setLaunchButtonState(false);
            return;
          }
          if (locator || (paths && paths.length > 0)) {
            if (source === 'hover' && !firstHoverLoggedForSession) {
              firstHoverLoggedForSession = true;
              const elapsedMs = spyStartClickedAt ? Math.max(0, Date.now() - spyStartClickedAt) : null;
              console.log('[spy-ui] first hover capture', { session: recorderSession, elapsedMs });
            }
            const liveLocator = locator || paths[0];
            if (elements.testLocator) {
              elements.testLocator.value = liveLocator;
              elements.testLocator.setAttribute('value', liveLocator);
            }
            if (elements.testValue) {
              elements.testValue.value = value;
              elements.testValue.setAttribute('value', value);
            }
            if (elements.testOutput) {
              elements.testOutput.value = '';
            }
          }
          if (source === 'click' || source === 'selected') {
            const elapsedMs = spyStartClickedAt ? Math.max(0, Date.now() - spyStartClickedAt) : null;
            console.log('[spy-ui] click capture', { session: recorderSession, elapsedMs });
            console.log('[spy-ui] fetch click -> stopping', { session: recorderSession });
            await stopSpyInspection({ awaitRemote: false });
            return;
          }
          scheduleNextFetch();
        } finally {
          xpathFetchInFlight = false;
        }
      };

      fetchOnce();
    };

    const toggleSpy = async () => {
      if (spyTransitionInFlight) {
        return;
      }
      isXpathRecording = !isXpathRecording;
      console.log('[spy-ui] toggle', { active: isXpathRecording, session: xpathRecorderSession + 1 });
      setSpyUiState(isXpathRecording);
      if (!isXpathRecording) {
        await stopSpyInspection();
        return;
      }

      spyTransitionInFlight = true;
      xpathRecorderSession += 1;
      const recorderSession = xpathRecorderSession;
      spyStartClickedAt = Date.now();
      firstHoverLoggedForSession = false;
      clearPolling();
      try {
        const success = await express.recordXpathStart();
        console.log('[spy-ui] start response', { success, session: recorderSession });
        if (recorderSession !== xpathRecorderSession || !isXpathRecording) {
          spyTransitionInFlight = false;
          return;
        }
        if (!success) {
          alertFn('Test browser is not launched.');
          await stopSpyInspection();
          return;
        }
        startPolling(recorderSession);
      } finally {
        spyTransitionInFlight = false;
      }
    };

    const init = () => {
      elements.captureXpath?.addEventListener('click', toggleSpy);
    };

    return {
      init,
      isRecording: () => isXpathRecording,
      setSpyUiState,
      stopSpyUiOnly,
      stopSpyInspection,
      stopSpyInspectionSync,
    };
  }

  global.createSpyWorkspaceModule = createSpyWorkspaceModule;
})(window);
