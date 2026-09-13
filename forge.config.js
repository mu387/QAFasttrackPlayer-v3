// forge.config.js
const path = require('path');
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'staging';
const productName = 'QAFastTrack Local Player';
const executableName = 'QAFastTrack-Local-Player';

module.exports = {
  packagerConfig: {
    name: productName,
    executableName: executableName,
    appBundleId: `com.qafasttrack.${APP_ENV}`,
    ignore: [
      /(^|[\\/])20260401195000_Utitlity-With-staging-1\.0\.24-Setup\.exe$/,
    ],
    icon: path.join(__dirname, 'assets', 'icon'),
    extraResource: [
      path.join(__dirname, `.env.${APP_ENV}`),
    ],
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: {} },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
    { name: '@electron-forge/maker-dmg', config: {} },
  ],
};
