(function (global) {
  function createAdvancedSpyShellModule({ elements, launchBrowser, getActiveWorkspace }) {
    const STATUS_COPY = {
      start: 'Advanced Spy shell only in Phase 0. Start/Fetch/Stop wiring will come in the next engine phase.',
      fetch: 'Advanced Spy shell only in Phase 0. Fetch wiring will come in the next engine phase.',
      stop: 'Advanced Spy shell only in Phase 0. Stop wiring will come in the next engine phase.',
      active: 'Browser active. Advanced Spy shell is ready for engine wiring in the next phase.',
      inactive: 'Browser inactive. Launch Browser to prepare the Advanced Spy workspace.',
    };

    const setStatus = text => {
      if (elements.advancedSpyStatusText) {
        elements.advancedSpyStatusText.textContent = text;
      }
    };

    const syncBrowserState = running => {
      if (elements.advancedSpyLaunchBrowserBtn) {
        elements.advancedSpyLaunchBrowserBtn.textContent = running ? 'Close Browser' : 'Launch Browser';
        elements.advancedSpyLaunchBrowserBtn.classList.toggle('btn-outline-danger', running);
        elements.advancedSpyLaunchBrowserBtn.classList.toggle('btn-outline-secondary', !running);
      }
      if (getActiveWorkspace?.() === 'advanced-spy') {
        setStatus(running ? STATUS_COPY.active : STATUS_COPY.inactive);
      }
    };

    const init = () => {
      elements.advancedSpyLaunchBrowserBtn?.addEventListener('click', () => {
        launchBrowser?.();
      });

      elements.advancedSpyStartBtn?.addEventListener('click', () => {
        setStatus(STATUS_COPY.start);
      });

      elements.advancedSpyFetchBtn?.addEventListener('click', () => {
        setStatus(STATUS_COPY.fetch);
      });

      elements.advancedSpyStopBtn?.addEventListener('click', () => {
        setStatus(STATUS_COPY.stop);
      });
    };

    return {
      init,
      setStatus,
      syncBrowserState,
    };
  }

  global.createAdvancedSpyShellModule = createAdvancedSpyShellModule;
})(window);
