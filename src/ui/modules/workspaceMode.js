(function (global) {
  function createWorkspaceModeModule({ elements, onEnterApiWorkspace }) {
    let activeWorkspace = 'runner';

    const normalizeWorkspaceMode = mode =>
      mode === 'api' || mode === 'advanced-spy' ? mode : 'runner';

    const applyWorkspaceClasses = () => {
      elements.runnerWorkspace?.classList.toggle('hidden', activeWorkspace !== 'runner');
      elements.apiWorkspace?.classList.toggle('hidden', activeWorkspace !== 'api');
      elements.advancedSpyWorkspace?.classList.toggle('hidden', activeWorkspace !== 'advanced-spy');
      elements.openApiCallsWorkspace?.classList.toggle('!text-white', activeWorkspace === 'api');
      elements.openApiCallsWorkspace?.classList.toggle('bg-blue-900', activeWorkspace === 'api');
      elements.openAdvancedSpyWorkspace?.classList.toggle('!text-white', activeWorkspace === 'advanced-spy');
      elements.openAdvancedSpyWorkspace?.classList.toggle('bg-blue-900', activeWorkspace === 'advanced-spy');
    };

    const setWorkspaceMode = mode => {
      activeWorkspace = normalizeWorkspaceMode(mode);
      applyWorkspaceClasses();
      if (activeWorkspace === 'api') {
        onEnterApiWorkspace?.();
      }
    };

    const init = () => {
      elements.openApiCallsWorkspace?.addEventListener('click', () => {
        setWorkspaceMode('api');
      });

      elements.openAdvancedSpyWorkspace?.addEventListener('click', () => {
        setWorkspaceMode('advanced-spy');
      });

      elements.closeApiWorkspaceBtn?.addEventListener('click', () => {
        setWorkspaceMode('runner');
      });

      elements.closeAdvancedSpyWorkspaceBtn?.addEventListener('click', () => {
        setWorkspaceMode('runner');
      });
    };

    return {
      init,
      getActiveWorkspace: () => activeWorkspace,
      setWorkspaceMode,
    };
  }

  global.createWorkspaceModeModule = createWorkspaceModeModule;
})(window);
