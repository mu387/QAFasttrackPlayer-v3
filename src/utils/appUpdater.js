const { app, autoUpdater, BrowserWindow, ipcMain, shell } = require('electron');

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Wraps Electron's built-in Squirrel autoUpdater.
 *
 * The feed is a directory that contains RELEASES + the *.nupkg package. Signing is not
 * required for updates to work: Squirrel verifies each package against the SHA-1 listed
 * in RELEASES, so a tampered download is rejected either way.
 *
 * mode:
 *   'auto'   - check, download in the background, offer "restart to update"
 *   'manual' - never download; expose the download link (locked-down client machines)
 */
function createAppUpdater(options = {}) {
  const feedUrl = String(options.feedUrl || '').trim();
  const downloadUrl = String(options.downloadUrl || feedUrl).trim();
  const mode = options.mode === 'manual' ? 'manual' : 'auto';
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS;
  const logger = options.logger || console;

  const state = {
    mode,
    status: 'idle',
    supported: false,
    currentVersion: app.getVersion(),
    feedUrl,
    downloadUrl,
    releaseName: '',
    error: null,
    checkedAt: null,
  };

  let timer = null;
  let started = false;

  const isSupported = () => app.isPackaged && process.platform === 'win32' && feedUrl !== '';

  const broadcast = () => {
    const payload = { ...state };
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('updater:status', payload);
      }
    });
  };

  const setStatus = (status, extra = {}) => {
    Object.assign(state, extra, { status });
    broadcast();
  };

  const checkNow = () => {
    if (!state.supported) return { ...state };
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      setStatus('error', { error: String(error && error.message ? error.message : error) });
    }
    return { ...state };
  };

  const start = () => {
    if (started) return { ...state };
    started = true;

    if (mode === 'manual') {
      setStatus('manual');
      return { ...state };
    }

    state.supported = isSupported();
    if (!state.supported) {
      // Dev builds, non-Windows, or no feed configured: nothing to check.
      setStatus('unsupported');
      return { ...state };
    }

    try {
      autoUpdater.setFeedURL({ url: feedUrl });

      autoUpdater.on('checking-for-update', () => setStatus('checking'));
      autoUpdater.on('update-available', () => setStatus('downloading'));
      autoUpdater.on('update-not-available', () =>
        setStatus('up-to-date', { checkedAt: new Date().toISOString() })
      );
      autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) =>
        setStatus('ready', {
          releaseName: String(releaseName || ''),
          checkedAt: new Date().toISOString(),
        })
      );
      autoUpdater.on('error', (error) => {
        const message = String(error && error.message ? error.message : error);
        logger.warn('[updater] check failed:', message);
        setStatus('error', { error: message });
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      logger.warn('[updater] could not initialise:', message);
      setStatus('error', { error: message });
      return { ...state };
    }

    checkNow();
    timer = setInterval(checkNow, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();

    return { ...state };
  };

  const restartAndInstall = () => {
    if (state.status !== 'ready') return { ...state };
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (error) {
        logger.warn('[updater] install failed:', error && error.message ? error.message : error);
      }
    });
    return { ...state };
  };

  const openDownloadPage = async () => {
    const target = downloadUrl || feedUrl;
    if (target) await shell.openExternal(target);
    return { ...state };
  };

  return {
    start,
    checkNow,
    restartAndInstall,
    openDownloadPage,
    getStatus: () => ({ ...state }),
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** IPC surface consumed by the renderer banner (see preload.js). */
function registerAppUpdaterIpc(updater) {
  ipcMain.handle('updater:getStatus', () => updater.getStatus());
  ipcMain.handle('updater:check', () => updater.checkNow());
  ipcMain.handle('updater:restart', () => updater.restartAndInstall());
  ipcMain.handle('updater:openDownload', () => updater.openDownloadPage());
}

module.exports = { createAppUpdater, registerAppUpdaterIpc };
