const { getRuntimeConfig } = require('./runtimeConfig');

const ENV_BASE_URL =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.API_BASE_URL ||
  'https://api.qafasttrack.com/api';

const joinBase = (base, path) => {
  if (!base) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
};

const resolveUrl = (overrideOrEnvValue, fallbackPath) => {
  const rc = getRuntimeConfig() || {};
  const base = rc.apiBaseUrl || ENV_BASE_URL;
  const value = overrideOrEnvValue;
  if (!value) return joinBase(base, fallbackPath);
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return joinBase(base, value);
};

const getBaseUrl = () => getRuntimeConfig()?.apiBaseUrl || ENV_BASE_URL;
const useRunnerDeviceAuth = () => getRuntimeConfig()?.runnerAuthMode === 'device-key';

const getUploadVideoUrl = () =>
  resolveUrl(
    getRuntimeConfig()?.uploadVideoUrl || process.env.UPLOAD_TEST_VIDEO_URL,
    useRunnerDeviceAuth() ? '/runner/upload/testsuites/video' : '/upload/testsuites/video',
  );

const getSaveCloseUrl = () =>
  resolveUrl(
    getRuntimeConfig()?.saveCloseUrl || process.env.SAVE_CLOSE_URL,
    useRunnerDeviceAuth() ? '/runner/save/close/testsuites' : '/save/close/testsuites',
  );
const getStepLogUrl = () =>
  resolveUrl(
    getRuntimeConfig()?.stepLogUrl || process.env.STEP_LOG_URL,
    useRunnerDeviceAuth() ? '/runner/save/testsuites/steps/status' : '/save/testsuites/steps/status',
  );
const getStepLogBulkUrl = () =>
  resolveUrl(
    getRuntimeConfig()?.stepLogBulkUrl || process.env.STEP_LOG_BULK_URL,
    useRunnerDeviceAuth() ? '/runner/bulk/testsuites/steps/status' : '/bulk/testsuites/steps/status',
  );

module.exports = {
  BASE_URL: ENV_BASE_URL,
  getBaseUrl,
  getUploadVideoUrl,
  getStepLogUrl,
  getStepLogBulkUrl,
  getSaveCloseUrl,
};

