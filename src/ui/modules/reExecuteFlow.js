(function (global) {
  function createReExecuteFlowModule({
    elements,
    express,
    bootstrapRef,
    resolveStepKeyword,
  }) {
    let reExecModalInstance = null;
    let currentReExecData = null;
    let pendingReExecuteData = null;
    let suppressReExecuteModal = false;

    const getModalInstance = () => {
      const modalEl = elements.reExecuteDataModal;
      if (!modalEl) return null;
      reExecModalInstance = bootstrapRef.Modal.getOrCreateInstance
        ? bootstrapRef.Modal.getOrCreateInstance(modalEl)
        : new bootstrapRef.Modal(modalEl);
      return reExecModalInstance;
    };

    const setResumeFailedStepVisible = visible => {
      if (!elements.resumeFailedStepBtn) return;
      elements.resumeFailedStepBtn.classList.toggle('hidden', !visible);
      elements.resumeFailedStepBtn.classList.toggle('d-none', !visible);
    };

    const refreshResumeFailedStepState = () => {
      setResumeFailedStepVisible(!!pendingReExecuteData && suppressReExecuteModal === true);
    };

    const clearPendingState = ({ clearFields = false } = {}) => {
      currentReExecData = null;
      pendingReExecuteData = null;
      suppressReExecuteModal = false;
      if (clearFields) {
        if (elements.reExecuteModalXpath) elements.reExecuteModalXpath.value = '';
        if (elements.reExecuteModalKeyword) elements.reExecuteModalKeyword.value = '';
        if (elements.reExecuteModalValue) elements.reExecuteModalValue.value = '';
      }
      refreshResumeFailedStepState();
    };

    const dismissReExecuteModal = ({ clearFields = false, suppress = false } = {}) => {
      const instance = getModalInstance();
      if (!instance) return;
      if (clearFields) {
        clearPendingState({ clearFields: true });
      } else {
        suppressReExecuteModal = suppress === true;
        refreshResumeFailedStepState();
      }
      instance.hide();
    };

    const applyReExecuteChanges = () => {
      const keywordValue = elements.reExecuteModalKeyword?.value || currentReExecData?.keyword || '';
      const payload = {
        xPath: elements.reExecuteModalXpath?.value || currentReExecData?.xPath || '',
        value: elements.reExecuteModalValue?.value ?? currentReExecData?.value ?? '',
      };
      if (keywordValue) {
        payload.keyword = keywordValue;
      }
      express.dataToReExecuteStep(payload);
    };

    const showForStep = step => {
      const instance = getModalInstance();
      if (!instance || !step) return;

      currentReExecData = {
        description: step.description || step.step_description || step.name || 'N/A',
        xPath: step.xPath || step.xpath || step.locator || '',
        keyword: resolveStepKeyword(step) || '',
        value: step.value ?? '',
      };
      pendingReExecuteData = currentReExecData;
      suppressReExecuteModal = false;

      if (elements.reExecStepLabel) elements.reExecStepLabel.textContent = currentReExecData.description || 'N/A';
      if (elements.reExecLocatorLabel) elements.reExecLocatorLabel.textContent = currentReExecData.xPath || 'N/A';
      if (elements.reExecDataLabel) elements.reExecDataLabel.textContent = currentReExecData.value || 'N/A';
      if (elements.reExecuteModalXpath) elements.reExecuteModalXpath.value = currentReExecData.xPath;
      if (elements.reExecuteModalKeyword) elements.reExecuteModalKeyword.value = currentReExecData.keyword;
      if (elements.reExecuteModalValue) elements.reExecuteModalValue.value = currentReExecData.value;

      refreshResumeFailedStepState();

      if (suppressReExecuteModal) {
        return;
      }

      instance.show();
    };

    const reopenPendingReExecuteModal = () => {
      if (!pendingReExecuteData) {
        return;
      }
      const instance = getModalInstance();
      if (!instance) return;
      suppressReExecuteModal = false;
      currentReExecData = pendingReExecuteData;
      if (elements.reExecStepLabel) elements.reExecStepLabel.textContent = currentReExecData.description || 'N/A';
      if (elements.reExecLocatorLabel) elements.reExecLocatorLabel.textContent = currentReExecData.xPath || 'N/A';
      if (elements.reExecDataLabel) elements.reExecDataLabel.textContent = currentReExecData.value || 'N/A';
      if (elements.reExecuteModalXpath) elements.reExecuteModalXpath.value = currentReExecData.xPath || '';
      if (elements.reExecuteModalKeyword) elements.reExecuteModalKeyword.value = currentReExecData.keyword || '';
      if (elements.reExecuteModalValue) elements.reExecuteModalValue.value = currentReExecData.value || '';
      refreshResumeFailedStepState();
      instance.show();
    };

    const init = () => {
      elements.reExecuteModalExecuteBtn?.addEventListener('click', () => {
        applyReExecuteChanges();
        clearPendingState();
        dismissReExecuteModal();
        express.reExecuteStep();
      });

      elements.reExecuteModalResetBtn?.addEventListener('click', () => {
        if (!currentReExecData) return;
        if (elements.reExecuteModalXpath) elements.reExecuteModalXpath.value = currentReExecData.xPath || '';
        if (elements.reExecuteModalKeyword) elements.reExecuteModalKeyword.value = currentReExecData.keyword || '';
        if (elements.reExecuteModalValue) elements.reExecuteModalValue.value = currentReExecData.value || '';
        applyReExecuteChanges();
      });

      elements.reExecuteModalMarkPassBtn?.addEventListener('click', () => {
        clearPendingState();
        dismissReExecuteModal();
        express.markStepAsPass();
      });

      elements.reExecuteModalMarkFailBtn?.addEventListener('click', () => {
        clearPendingState();
        dismissReExecuteModal();
        express.markStepAsFail();
      });

      elements.reExecuteModalCancelBtn?.addEventListener('click', () => {
        dismissReExecuteModal({ suppress: true });
      });

      elements.resumeFailedStepBtn?.addEventListener('click', () => {
        reopenPendingReExecuteModal();
      });
    };

    return {
      clearPendingState,
      dismissReExecuteModal,
      init,
      refreshResumeFailedStepState,
      reopenPendingReExecuteModal,
      showForStep,
    };
  }

  global.createReExecuteFlowModule = createReExecuteFlowModule;
})(window);
