const { api } = require('./utils/api');
const { contextBridge } = require('electron');
const fs = require('fs');
const axios = require('axios');
const {
  Builder,
  Browser,
  By,
  Key,
  until,
  Select,
} = require('selenium-webdriver');
// const {ActionSequence, Mouse} = require('selenium-webdriver/lib/actions');
const url = require('url');

const cors = require('cors');
const express = require('express');
const { ipcRenderer } = require('electron/renderer');
const { getUploadVideoUrl } = require('./utils/endpoint');
const { setRuntimeConfig } = require('./utils/runtimeConfig');
const expressApp = express();
expressApp.use(express.json());
expressApp.use(cors());
let expressListen = null;
let driver = null;
let currentStep = 0;
let currentRunner = 0;
let isPaused = false;
let testRunnerStepData = null;

contextBridge.exposeInMainWorld('express', {
  startServer: port => ipcRenderer.invoke('startServer', port),
  stopServer: () => ipcRenderer.invoke('stopServer'),
  testLaunchBrowser: () => ipcRenderer.invoke('testLaunchBrowser'),
  closeTestBrowser: () => ipcRenderer.invoke('closeTestBrowser'),
  testExecute: (locator, keyword, value, expectedOutput = '') => ipcRenderer.invoke('testExecute', { locator, keyword, value, expectedOutput }),
  testExecuteOutput: callback => ipcRenderer.on('testExecuteOutput', callback),
  startNetworkCapture: () => ipcRenderer.invoke('startNetworkCapture'),
  stopNetworkCapture: () => ipcRenderer.invoke('stopNetworkCapture'),
  getNetworkCaptureEntries: () => ipcRenderer.invoke('getNetworkCaptureEntries'),
  clearNetworkCapture: () => ipcRenderer.invoke('clearNetworkCapture'),
  removeNetworkCaptureEntriesMatching: entry => ipcRenderer.invoke('removeNetworkCaptureEntriesMatching', entry),
  apiWorkspaceChooseWsdlFile: () => ipcRenderer.invoke('apiWorkspaceChooseWsdlFile'),
  apiWorkspaceImportWsdl: payload => ipcRenderer.invoke('apiWorkspaceImportWsdl', payload),
  apiWorkspaceChooseOpenApiFile: () => ipcRenderer.invoke('apiWorkspaceChooseOpenApiFile'),
  apiWorkspaceImportOpenApi: payload => ipcRenderer.invoke('apiWorkspaceImportOpenApi', payload),

  getServerStatus: callback => ipcRenderer.on('getServerStatus', callback),

  pauseExecution: () => ipcRenderer.invoke('pauseExecution'),
  resumeExecution: () => ipcRenderer.invoke('resumeExecution'),
  stopExecution: () => ipcRenderer.invoke('stopExecution'),

  reExecuteStep: () => ipcRenderer.invoke('reExecuteStep'),
  isReExecute: checked => ipcRenderer.send('isReExecute', checked),

  testRunnerStepData: callback =>
    ipcRenderer.on('testRunnerStepData', callback),
  openReExecuteDataModal: callback =>
    ipcRenderer.on('openReExecuteDataModal', callback),
  emailSandboxRuntimeStatus: callback =>
    ipcRenderer.on('emailSandboxRuntimeStatus', callback),
  dataToReExecuteStep: payload =>
    ipcRenderer.invoke('dataToReExecuteStep', payload),
  markStepAsPass: () => ipcRenderer.invoke('markStepAsPass'),
  markStepAsFail: () => ipcRenderer.invoke('markStepAsFail'),
  recordXpathStart: () => ipcRenderer.invoke('recordXpathStart'),
  recordXpathStop: () => ipcRenderer.invoke('recordXpathStop'),
  recordXpathFetch: () => ipcRenderer.invoke('recordXpathFetch'),
  advancedSpyStart: () => ipcRenderer.invoke('advancedSpyStart'),
  advancedSpyStop: () => ipcRenderer.invoke('advancedSpyStop'),
  advancedSpyFetch: () => ipcRenderer.invoke('advancedSpyFetch'),
  noActiveTest: callback => ipcRenderer.on('noActiveTest', callback),
  forceReload: () => ipcRenderer.invoke('forceReload'),
  toggleDevTools: () => ipcRenderer.invoke('toggleDevTools'),
  setHighlightEnabled: enabled => ipcRenderer.invoke('setHighlightEnabled', enabled),
  getExecutionSettings: () => ipcRenderer.invoke('getExecutionSettings'),
  setExecutionSpeed: mode => ipcRenderer.invoke('setExecutionSpeed', mode),
  getRecoverySettings: () => ipcRenderer.invoke('getRecoverySettings'),
  setRecoverySettings: settings => ipcRenderer.invoke('setRecoverySettings', settings),
  getReExecuteSettings: () => ipcRenderer.invoke('getRecoverySettings'),
  decideRecovery: decision => ipcRenderer.invoke('decideRecovery', decision),
  recoveryPrompt: callback => ipcRenderer.on('recoveryPrompt', callback),
  recoveryCleared: callback => ipcRenderer.on('recoveryCleared', callback),
  freePort: port => ipcRenderer.invoke('freePort', port),
  checkPort: port => ipcRenderer.invoke('checkPort', port),
  setScreenOptions: callback => ipcRenderer.on('setScreenOptions', callback),
  runnerSetupSession: callback => ipcRenderer.on('runnerSetupSession', callback),
  consumePendingRunnerSetupSession: () => ipcRenderer.invoke('consumePendingRunnerSetupSession'),
  selectScreen: screenId => ipcRenderer.invoke('selectScreen', screenId),
  exportLastRun: language => ipcRenderer.invoke('exportLastRun', language),
  // SET_SOURCE:(data)=>{
  //     console.log(data)
  //     return ipcRenderer.invoke('SET_SOURCE',data)
  //  }
});

ipcRenderer.on(
  'startScreenRecording',
  async (event, { selectedScreen, testRunnerId, suiteId, token, runtimeConfig }) => {
    console.log({ selectedScreen });
    if (runtimeConfig && typeof runtimeConfig === 'object') {
      setRuntimeConfig(runtimeConfig);
    }
    if (!selectedScreen) {
      console.log('startScreenRecording skipped: no screen selected');
      return;
    }
    try {
  const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedScreen,
            minWidth: 960,
            maxWidth: 960,
            minHeight: 540,
            maxHeight: 540,
          },
        },
      });
      handleStream({ stream, testRunnerId, suiteId, token });
    } catch (e) {
      handleError(e);
    }
  },
);
let mediaRecorder;
let recordedChunks = [];
let currentStream = null;
ipcRenderer.on('stopScreenRecording', async event => {
  console.log(mediaRecorder)
  if (!mediaRecorder) return;
  try {
    mediaRecorder.stop();
    mediaRecorder = null;
  } catch (err) {
    console.error('stopScreenRecording failed', err);
  }
});



function handleStream({ stream, testRunnerId, suiteId, token }) {
  console.log(stream);
  currentStream = stream;
  const video = document.querySelector('video');
  video.srcObject = stream;
  video.onloadedmetadata = async e => await video.play();
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm; codecs=vp9',
    videoBitsPerSecond: 800000,
  });
  mediaRecorder.ondataavailable = onDataAvailable;
  mediaRecorder.onstop = () => stopRecording({ testRunnerId, suiteId, token });
  mediaRecorder.start();
}
function onDataAvailable(e) {
  recordedChunks.push(e.data);
}
async function stopRecording({ testRunnerId, suiteId, token }) {
  const blob = new Blob(recordedChunks, {
    type: 'video/webm; codecs=vp9',
  });

  // free stream tracks to avoid leaks
  try {
    currentStream?.getTracks?.().forEach(track => {
      try {
        track.stop();
      } catch (err) {
        console.log('failed to stop track (ignored)', err?.message || err);
      }
    });
  } catch (_) {
    // ignore
  }
  currentStream = null;

  const videoUrl = URL.createObjectURL(blob);
  const video = document.querySelector('video');
  video.srcObject = null;
  video.src = videoUrl;
  recordedChunks = [];

  const formData = new FormData();
  formData.append('test_runner_id', testRunnerId);
  formData.append('test_suite_id', suiteId);
  const videoFile = new File([blob], 'video.webm');
  formData.append('videos', videoFile);
  formData.append('videos[0]', videoFile);
  console.log('Uploading screen recording', { sizeBytes: blob.size });
  console.time('screenRecording:upload');

  try {
    const authHeader =
      token && token.toLowerCase().startsWith('bearer ')
        ? token
        : token
        ? `Bearer ${token}`
        : '';
    const uploadStartedAt = Date.now();
    const response = await fetch(getUploadVideoUrl(), {
      method: 'POST',
      body: formData,
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      try {
        data = await response.text();
      } catch (_) {
        data = null;
      }
    }
    console.log('Upload response status:', response.status, 'body:', data, 'durationMs:', Date.now() - uploadStartedAt);
    try {
      ipcRenderer.send('uploadVideoLog', {
        status: response.status,
        body: data,
        durationMs: Date.now() - uploadStartedAt,
      });
    } catch (err) {
      console.log('uploadVideoLog send failed (ignored)', err?.message || err);
    }
    if (!response.ok) {
      console.error('Upload failed', response.status, data);
    }
  } catch (error) {
    console.error('Error uploading video:', error);
  } finally {
    console.timeEnd('screenRecording:upload');
  }
  //     const xhr = new XMLHttpRequest();

  // // Add an event listener to track the upload progress
  // xhr.upload.addEventListener('progress', (event) => {
  //   if (event.lengthComputable) {
  //     const percentage = (event.loaded / event.total) * 100;
  //     console.log(`Upload progress: ${percentage.toFixed(2)}%`);
  //   }
  // });

  // // Add an event listener for the load event (upload complete)
  // xhr.addEventListener('load', () => {
  //   if (xhr.status === 200) {
  //     console.log('Upload complete');
  //     // Handle the server response here
  //   } else {
  //     console.error('Upload failed');
  //   }
  // });

  // // Open a POST request to the desired upload URL
  // xhr.open('POST', url, true);

  // // Send the FormData with the file to the server
  // xhr.send(formData);
  // }
  // });
}
function handleError(e) {
  const video = document.querySelector('video');
  video.srcObject = null;
  console.log(e);
}

setTimeout(() => {
  //mediaRecorder.stop()
}, 10000);



