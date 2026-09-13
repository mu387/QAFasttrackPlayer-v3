let runtimeConfig = {};

function setRuntimeConfig(next = {}) {
  runtimeConfig = { ...runtimeConfig, ...next };
  return runtimeConfig;
}

function getRuntimeConfig() {
  return runtimeConfig;
}

module.exports = {
  setRuntimeConfig,
  getRuntimeConfig,
};
