(function (global) {
  function createNetworkCaptureModule({
    elements,
    express,
    alertFn = alert,
    getNetworkCaptureActive,
    setNetworkCaptureActive,
    getLatestNetworkCaptureEntries,
    buildApiStepFromCaptureEntry,
    refreshNetworkCaptureEntries,
    renderNetworkCaptureEntries,
    resetApiWorkspaceForm,
    populateApiWorkspaceFromApiCallValue,
    openCaptureEditorFromCaptureEntry,
    runApiCallFromCaptureEntry,
    setApiWorkspaceStatus,
    setNetworkCaptureStatus,
    setManualApiDraft,
    openApiWorkspace,
  }) {
    let liveRefreshTimer = null;
    let liveRefreshInFlight = false;

    const getStartButtons = () =>
      [elements.startNetworkCaptureBtn, elements.apiWorkspaceStartCaptureBtn].filter(Boolean);

    const getStopButtons = () =>
      [elements.stopNetworkCaptureBtn, elements.apiWorkspaceStopCaptureBtn].filter(Boolean);

    const syncCaptureButtons = () => {
      const active = !!getNetworkCaptureActive?.();
      getStartButtons().forEach(button => {
        button.textContent = active ? 'Stop Recording' : 'Start Recording';
        button.classList.remove('btn-outline-success', 'btn-outline-danger', 'btn-success', 'btn-danger', 'capture-active-blink');
        button.classList.add(active ? 'btn-danger' : 'btn-outline-success');
        if (active) {
          button.classList.add('capture-active-blink');
        }
      });
      getStopButtons().forEach(button => {
        button.classList.add('d-none');
      });
    };

    const stopLiveRefresh = () => {
      if (liveRefreshTimer) {
        clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
      }
      liveRefreshInFlight = false;
    };

    const refreshCapture = async () => {
      await refreshNetworkCaptureEntries();
    };

    const refreshCaptureLive = async () => {
      if (!getNetworkCaptureActive?.() || liveRefreshInFlight) return;
      liveRefreshInFlight = true;
      try {
        await refreshCapture();
      } finally {
        liveRefreshInFlight = false;
      }
    };

    const startLiveRefresh = () => {
      stopLiveRefresh();
      liveRefreshTimer = setInterval(refreshCaptureLive, 2000);
      refreshCaptureLive();
    };

    const setApiCaptureStatusText = text => {
      if (elements.apiWorkspaceCaptureStatus) {
        elements.apiWorkspaceCaptureStatus.textContent = text;
      }
    };

    const resetCaptureUi = entries => {
      setNetworkCaptureActive(false);
      renderNetworkCaptureEntries(entries);
      setNetworkCaptureStatus('Capture inactive', false);
      setApiCaptureStatusText('Capture inactive');
      syncCaptureButtons();
      stopLiveRefresh();
    };

    const startCapture = async () => {
      try {
        const result = await express.startNetworkCapture();
        if (result && result.ok === false) {
          const message = String(result.message || 'Unable to start network capture.');
          alertFn(message);
          setNetworkCaptureStatus(message, false);
          setApiCaptureStatusText('Capture inactive');
          syncCaptureButtons();
          stopLiveRefresh();
          return;
        }
        setNetworkCaptureActive(true);
        setNetworkCaptureStatus('Capture active - 0 requests', true);
        setApiCaptureStatusText('Capture active - 0 requests');
        renderNetworkCaptureEntries([]);
        syncCaptureButtons();
        startLiveRefresh();
      } catch (error) {
        alertFn(error?.message || 'Unable to start network capture.');
        setNetworkCaptureStatus('Capture start failed', false);
        syncCaptureButtons();
        stopLiveRefresh();
      }
    };

    const stopCapture = async () => {
      try {
        stopLiveRefresh();
        const result = await express.stopNetworkCapture();
        const entries = result?.entries || [];
        setNetworkCaptureActive(false);
        renderNetworkCaptureEntries(entries);
        syncCaptureButtons();
        setNetworkCaptureStatus(`Capture stopped - ${entries.length} requests`, false);
        setApiCaptureStatusText(`Capture stopped - ${entries.length} requests`);
      } catch (error) {
        setNetworkCaptureStatus('Capture stop failed', false);
        syncCaptureButtons();
        stopLiveRefresh();
      }
    };

    const resetCapture = async () => {
      stopLiveRefresh();
      try {
        const result = await express.clearNetworkCapture?.();
        resetCaptureUi(result?.entries || []);
      } catch (_) {
        resetCaptureUi([]);
      }
      resetApiWorkspaceForm();
    };

    const applyCapturedEntryToRunner = entry => {
      const apiStepValue = buildApiStepFromCaptureEntry(entry);
      setManualApiDraft(apiStepValue);
      populateApiWorkspaceFromApiCallValue(apiStepValue);
      openApiWorkspace();
    };

    const applyCapturedEntryToApiWorkspace = entry => {
      const apiStepValue = buildApiStepFromCaptureEntry(entry);
      populateApiWorkspaceFromApiCallValue(apiStepValue);
      setManualApiDraft(apiStepValue, { message: '', skipOutput: true });
      setApiWorkspaceStatus('Captured request loaded into API workspace.');
    };

    const removeCapturedEntryAt = async index => {
      const entries = Array.isArray(getLatestNetworkCaptureEntries?.())
        ? getLatestNetworkCaptureEntries()
        : [];
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) return false;
      const targetEntry = entries[index];
      let nextEntries = entries.filter((_, entryIndex) => entryIndex !== index);
      let removedCount = entries.length - nextEntries.length;
      if (targetEntry && typeof express.removeNetworkCaptureEntriesMatching === 'function') {
        try {
          const result = await express.removeNetworkCaptureEntriesMatching(targetEntry);
          if (Array.isArray(result?.entries)) {
            nextEntries = result.entries;
          }
          if (Number.isFinite(Number(result?.removed))) {
            removedCount = Number(result.removed);
          }
        } catch (_) {}
      } else if (targetEntry) {
        const method = String(targetEntry?.method || 'GET').trim().toUpperCase();
        const url = String(targetEntry?.url || '').trim();
        nextEntries = entries.filter(entry =>
          String(entry?.method || 'GET').trim().toUpperCase() !== method ||
          String(entry?.url || '').trim() !== url
        );
        removedCount = entries.length - nextEntries.length;
      }
      renderNetworkCaptureEntries(nextEntries);
      const active = !!getNetworkCaptureActive?.();
      const statusText = active
        ? `Capture active - ${nextEntries.length} requests`
        : `Capture stopped - ${nextEntries.length} requests`;
      const apiStatusText = active
        ? `Capture active - ${nextEntries.length} requests`
        : `Capture stopped - ${nextEntries.length} requests`;
      setNetworkCaptureStatus(statusText, active);
      setApiCaptureStatusText(apiStatusText);
      setApiWorkspaceStatus(
        removedCount > 1
          ? `${removedCount} matching captured requests removed.`
          : 'Captured request removed.'
      );
      return true;
    };

    const handleRunnerCaptureClick = async event => {
      const useBtn = event.target?.closest?.('.useNetworkCaptureBtn');
      const replayBtn = event.target?.closest?.('.replayNetworkCaptureBtn');
      const editBtn = event.target?.closest?.('.editNetworkCaptureBtn');
      const deleteBtn = event.target?.closest?.('.deleteNetworkCaptureBtn');
      const sourceBtn = useBtn || replayBtn || editBtn || deleteBtn;
      if (!sourceBtn) return;
      const index = Number(sourceBtn.getAttribute('data-entry-index'));
      const entry = getLatestNetworkCaptureEntries()[index];
      if (deleteBtn) {
        await removeCapturedEntryAt(index);
        return;
      }
      if (!entry) return;
      try {
        if (editBtn) {
          openCaptureEditorFromCaptureEntry?.(entry);
        } else if (replayBtn) {
          await runApiCallFromCaptureEntry?.(entry);
        } else {
          applyCapturedEntryToRunner(entry);
        }
      } catch (error) {
        elements.testOutput.value = error?.message || 'Failed to convert captured request.';
      }
    };

    const handleApiWorkspaceCaptureClick = async event => {
      const useBtn = event.target?.closest?.('.useNetworkCaptureBtn');
      const replayBtn = event.target?.closest?.('.replayNetworkCaptureBtn');
      const editBtn = event.target?.closest?.('.editNetworkCaptureBtn');
      const deleteBtn = event.target?.closest?.('.deleteNetworkCaptureBtn');
      const sourceBtn = useBtn || replayBtn || editBtn || deleteBtn;
      if (!sourceBtn) return;
      const index = Number(sourceBtn.getAttribute('data-entry-index'));
      const entry = getLatestNetworkCaptureEntries()[index];
      if (deleteBtn) {
        await removeCapturedEntryAt(index);
        return;
      }
      if (!entry) return;
      try {
        if (editBtn) {
          openCaptureEditorFromCaptureEntry?.(entry);
        } else if (replayBtn) {
          await runApiCallFromCaptureEntry?.(entry);
        } else {
          applyCapturedEntryToApiWorkspace(entry);
        }
      } catch (error) {
        setApiWorkspaceStatus(error?.message || 'Failed to convert captured request.');
      }
    };

    const handleBrowserClosed = () => {
      stopLiveRefresh();
      resetCaptureUi([]);
    };

    const toggleCapture = async () => {
      if (getNetworkCaptureActive()) {
        await stopCapture();
      } else {
        await startCapture();
      }
    };

    const init = () => {
      elements.startNetworkCaptureBtn?.addEventListener('click', toggleCapture);
      elements.apiWorkspaceStartCaptureBtn?.addEventListener('click', toggleCapture);

      elements.refreshNetworkCaptureBtn?.addEventListener('click', refreshCapture);
      elements.apiWorkspaceRefreshCaptureBtn?.addEventListener('click', () => {
        elements.refreshNetworkCaptureBtn?.click();
      });

      elements.stopNetworkCaptureBtn?.addEventListener('click', stopCapture);
      elements.apiWorkspaceStopCaptureBtn?.addEventListener('click', stopCapture);

      elements.networkCaptureList?.addEventListener('click', handleRunnerCaptureClick);
      elements.apiWorkspaceCaptureList?.addEventListener('click', handleApiWorkspaceCaptureClick);
      syncCaptureButtons();
    };

    return {
      init,
      getNetworkCaptureActive,
      handleBrowserClosed,
      refreshCapture,
      resetCapture,
      stopCapture,
    };
  }

  global.createNetworkCaptureModule = createNetworkCaptureModule;
})(window);
