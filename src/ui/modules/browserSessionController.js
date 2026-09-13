(function (global) {
  function createBrowserSessionController({
    elements,
    express,
    beforeClose,
    onStateChange,
    onBrowserClosed,
  }) {
    let isBrowserLaunched = false;
    let browserLaunchInProgress = false;
    let browserCloseInProgress = false;

    const setLaunchButtonState = running => {
      isBrowserLaunched = !!running;

      if (elements.testLaunchBrowser) {
        elements.testLaunchBrowser.textContent = running ? 'Close Browser' : 'Launch Browser';
        elements.testLaunchBrowser.classList.toggle('btn-primary', !running);
        elements.testLaunchBrowser.classList.toggle('btn-outline-danger', !!running);
      }

      if (elements.apiWorkspaceLaunchBrowserBtn) {
        elements.apiWorkspaceLaunchBrowserBtn.textContent = running ? 'Close Browser' : 'Launch Browser';
        elements.apiWorkspaceLaunchBrowserBtn.classList.toggle('btn-outline-danger', !!running);
        elements.apiWorkspaceLaunchBrowserBtn.classList.toggle('btn-outline-secondary', !running);
      }

      onStateChange?.(!!running);
    };

    const handleLaunchBrowserClick = async () => {
      if (browserLaunchInProgress || browserCloseInProgress) return;

      if (!isBrowserLaunched) {
        browserLaunchInProgress = true;
        try {
          await express.testLaunchBrowser();
          setLaunchButtonState(true);
        } finally {
          browserLaunchInProgress = false;
        }
        return;
      }

      browserCloseInProgress = true;
      try {
        const shouldClose = await beforeClose?.();
        if (shouldClose === false) {
          return;
        }
        await express.closeTestBrowser();
        setLaunchButtonState(false);
        onBrowserClosed?.();
      } finally {
        browserCloseInProgress = false;
      }
    };

    const init = () => {
      elements.testLaunchBrowser?.addEventListener('click', handleLaunchBrowserClick);
      elements.apiWorkspaceLaunchBrowserBtn?.addEventListener('click', () => {
        elements.testLaunchBrowser?.click();
      });
    };

    return {
      getIsBrowserLaunched: () => isBrowserLaunched,
      init,
      setLaunchButtonState,
    };
  }

  global.createBrowserSessionController = createBrowserSessionController;
})(window);
