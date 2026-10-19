(function (global) {
  const BANNER_ID = 'appUpdateBanner';

  // Statuses that should never interrupt the operator.
  const SILENT = new Set(['idle', 'checking', 'up-to-date', 'unsupported']);

  function formatText(state) {
    switch (state.status) {
      case 'downloading':
        return 'Downloading a runner update in the background. Work continues normally.';
      case 'ready':
        return 'Update downloaded. Restart to finish installing.';
      case 'manual':
        return 'A newer runner build is available. Download it from your IT channel.';
      case 'error':
        return 'Update check failed. The runner will retry automatically.';
      default:
        return '';
    }
  }

  function actionLabel(state) {
    if (state.status === 'ready') return 'Restart to update';
    if (state.status === 'manual') return 'Download';
    if (state.status === 'error') return 'Check again';
    return 'Check now';
  }

  function createAppUpdaterBanner({ documentRef = document, updater = window.appUpdater } = {}) {
    const banner = documentRef.getElementById(BANNER_ID);
    if (!banner) return { init: () => {}, render: () => {} };

    const textEl = documentRef.getElementById('appUpdateText');
    const actionEl = documentRef.getElementById('appUpdateAction');
    const dismissEl = documentRef.getElementById('appUpdateDismiss');

    let dismissedKey = '';

    const hide = () => {
      banner.classList.add('d-none');
    };

    const show = () => {
      banner.classList.remove('d-none');
    };

    const render = state => {
      if (!state || SILENT.has(state.status)) {
        hide();
        return;
      }

      // Once the operator dismisses "downloading", stay quiet until something changes.
      const key = `${state.status}:${state.releaseName || ''}`;
      if (state.status === 'downloading' && dismissedKey === key) {
        hide();
        return;
      }

      const message = formatText(state);
      if (textEl) textEl.textContent = message;

      const label = actionLabel(state);
      if (actionEl) {
        actionEl.textContent = label;
        actionEl.dataset.action = state.status;
      }

      // Nothing actionable during a background download.
      if (actionEl) {
        actionEl.classList.toggle('d-none', state.status === 'downloading');
      }
      if (dismissEl) {
        dismissEl.classList.toggle('d-none', state.status === 'ready' || state.status === 'manual');
      }

      banner.dataset.state = state.status;
      show();
    };

    const handleAction = async () => {
      if (!updater) return;
      const status = actionEl ? actionEl.dataset.action : '';

      if (status === 'ready') {
        await updater.restart();
        return;
      }
      if (status === 'manual') {
        await updater.openDownload();
        return;
      }
      if (status === 'error') {
        const next = await updater.check();
        render(next);
      }
    };

    const init = async () => {
      if (actionEl) actionEl.addEventListener('click', handleAction);
      if (dismissEl) {
        dismissEl.addEventListener('click', () => {
          dismissedKey = `${banner.dataset.state}:`;
          hide();
        });
      }
      if (!updater) return;

      try {
        const state = await updater.getStatus();
        render(state);
      } catch {
        hide();
      }

      updater.onStatus(render);
    };

    return { init, render };
  }

  global.createAppUpdaterBanner = createAppUpdaterBanner;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => createAppUpdaterBanner().init());
  } else {
    createAppUpdaterBanner().init();
  }
})(window);
