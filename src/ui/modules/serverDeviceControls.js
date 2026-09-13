(function (global) {
  function createServerDeviceControlsModule({
    elements,
    express,
    jqueryRef,
    documentRef,
    deviceServerControlDisabled = false,
    getCurrentAppiumPort,
  }) {
    const $ = jqueryRef;

    const setAppiumButtons = running => {
      if (!elements.appiumServerToggle || !elements.appiumServerIcon || !elements.appiumServerLabel) {
        return;
      }
      if (running) {
        elements.appiumServerToggle.classList.remove('bg-green-900');
        elements.appiumServerToggle.classList.add('bg-red-900');
        elements.appiumServerIcon.classList.remove('bi-play-fill');
        elements.appiumServerIcon.classList.add('bi-stop-circle');
        elements.appiumServerLabel.textContent = 'Stop Appium Server';
        return;
      }
      elements.appiumServerToggle.classList.add('bg-green-900');
      elements.appiumServerToggle.classList.remove('bg-red-900');
      elements.appiumServerIcon.classList.add('bi-play-fill');
      elements.appiumServerIcon.classList.remove('bi-stop-circle');
      elements.appiumServerLabel.textContent = 'Start Appium Server';
    };

    const applyServerStatus = status => {
      const isRunning = status === true;
      if (elements.startServerBtn && elements.stopServerBtn) {
        elements.startServerBtn.style.display = isRunning ? 'none' : '';
        elements.stopServerBtn.style.display = isRunning ? '' : 'none';
      }
      const notRunningEl = documentRef.querySelector('#serverNotRunning');
      const runningEl = documentRef.querySelector('#serverIsRunning');
      if (!notRunningEl || !runningEl) {
        return;
      }
      notRunningEl.classList.toggle('hidden', isRunning);
      runningEl.classList.toggle('hidden', !isRunning);
      notRunningEl.classList.toggle('flex', !isRunning);
      runningEl.classList.toggle('flex', isRunning);
    };

    const initExecutionDelay = () => {
      if (!elements.executionDelayInput) {
        return;
      }

      const applyExecutionDelay = () => {
        const parsed = Number(elements.executionDelayInput.value);
        const delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
        elements.executionDelayInput.value = String(delayMs);
        express.setExecutionSpeed?.(delayMs);
      };

      express.getExecutionSettings?.().then(settings => {
        const parsed = Number(settings?.delayMs);
        const delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
        elements.executionDelayInput.value = String(delayMs);
        express.setExecutionSpeed?.(delayMs);
      }).catch(() => {
        applyExecutionDelay();
      });

      elements.executionDelayInput.addEventListener('change', applyExecutionDelay);
    };

    const initScreenOptions = () => {
      if (!elements.screenDropdown) {
        return;
      }
      express.setScreenOptions((event, { screens = [] }) => {
        screens.forEach(screen => {
          const optEl = documentRef.createElement('option');
          optEl.text = screen.name;
          optEl.value = screen.id;
          elements.screenDropdown.add(optEl);
        });
        elements.screenDropdown.addEventListener('change', e => {
          express.selectScreen(e.target.value || null);
        });
      });
    };

    const initDeviceServerControls = () => {
      if (deviceServerControlDisabled) {
        [elements.appiumServerToggle, elements.startWinAppServerBtn, elements.stopWinAppServerBtn].forEach(el => {
          if (!el) return;
          el.classList.add('hidden', 'd-none');
          el.style.display = 'none';
        });
      }

      $('#startWinAppServer, #stopWinAppServer').on('click', async function () {
        if (deviceServerControlDisabled) {
          alert('WinAppDriver control is disabled in the app. Please start/stop it externally.');
          return;
        }
        const method = this.id === 'startWinAppServer' ? 'startWinAppServer' : 'stopWinAppServer';
        const ok = await express[method]();
        if (!ok) {
          alert(method === 'startWinAppServer' ? 'Failed to start WinApp server (port in use?).' : 'WinApp server is not running.');
          return;
        }
        $('#startWinAppServer, #stopWinAppServer').toggle();
      });

      $(elements.appiumServerToggle).on('click', async function () {
        if (deviceServerControlDisabled) {
          alert('Appium server control is disabled in the app. Please start/stop it externally.');
          return;
        }
        const isRunning = elements.appiumServerLabel?.textContent?.toLowerCase().includes('stop');
        if (isRunning) {
          const ok = await express.stopAppiumServer();
          if (!ok) {
            alert('Appium server is not running.');
            setAppiumButtons(false);
            return;
          }
          setAppiumButtons(false);
          return;
        }
        const ok = await express.startAppiumServer(getCurrentAppiumPort?.() ?? 4723);
        if (!ok) {
          alert('Failed to start Appium server (port in use?).');
          setAppiumButtons(false);
          return;
        }
        setAppiumButtons(true);
      });
    };

    const init = () => {
      express.getRecoverySettings?.().then(settings => {
        if (!elements.allowRecoveryToggle) return;
        elements.allowRecoveryToggle.checked = !!settings?.allowRecovery;
      });

      elements.allowRecoveryToggle?.addEventListener('change', () => {
        express.setRecoverySettings?.({ allowRecovery: !!elements.allowRecoveryToggle.checked });
      });

      if (elements.highlightToggle) {
        express.setHighlightEnabled?.(elements.highlightToggle.checked);
        elements.highlightToggle.addEventListener('change', () => {
          express.setHighlightEnabled?.(elements.highlightToggle.checked);
        });
      }

      initExecutionDelay();
      initDeviceServerControls();
      initScreenOptions();

      elements.forceReloadBtn?.addEventListener('click', () => {
        express.forceReload();
      });

      elements.toggleDevToolsBtn?.addEventListener('click', () => {
        express.toggleDevTools().then(opened => {
          if (opened === true) {
            elements.toggleDevToolsBtn.textContent = 'Close DevTools';
          } else if (opened === false) {
            elements.toggleDevToolsBtn.textContent = 'Open DevTools';
          }
        });
      });

      express.getServerStatus?.((event, { status }) => {
        applyServerStatus(status);
        console.log(status, 'status');
      });
    };

    return {
      applyServerStatus,
      init,
      setAppiumButtons,
    };
  }

  global.createServerDeviceControlsModule = createServerDeviceControlsModule;
})(window);
