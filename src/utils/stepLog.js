const { api } = require('./api');
const { getStepLogUrl } = require('./endpoint');
const { getRuntimeConfig } = require('./runtimeConfig');
const stepStatusReporter = require('./stepStatusReporter');
const { redactApiCallValueForLogs } = require('./apiCallContract');

const resolveStepKeyword = step => {
  const candidates = [
    step?.keyword?.name,
    step?.keyword,
    step?.keyword_name,
    step?.keywordName,
  ];
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    const text = String(candidate).trim();
    if (text !== '') {
      return candidate;
    }
  }
  return null;
};

const stepLogCall = async ({
  runnerId,
  testSuiteId,
  stepId,
  testRunnerSteps,
  datasetId,
  runnerIndex,
  stepIndex,
  error = null,
  token,
  stepOverrides = null,
}) => {
  const runner = testRunnerSteps?.[runnerIndex];
  const runtimeFlag =
    getRuntimeConfig()?.enableMockUiFallback === true ||
    getRuntimeConfig()?.enableMockUiFallback === 'true';
  const envFlag = process.env.ENABLE_MOCK_UI_FALLBACK === 'true';
  const allowFallback = runtimeFlag || envFlag;
  const steps = runner?.steps || [];

  let step;
  if (
    stepId !== undefined &&
    stepId !== null &&
    datasetId !== undefined &&
    datasetId !== null
  ) {
    step =
      steps.filter(
        ({ id, dataset_id }) => id === stepId && datasetId === dataset_id,
      )[0] || undefined;
  }
  if (
    !step &&
    allowFallback &&
    stepIndex !== undefined &&
    stepIndex !== null &&
    steps[stepIndex]
  ) {
    step = steps[stepIndex];
  }
  if (!step && allowFallback && steps.length) {
    step =
      steps.find(s => s?.description || s?.keyword || s?.xPath || s?.xpath) ||
      steps[0];
  }

  if (!step) {
    return;
  }

  const keyword = resolveStepKeyword(step);
  const xPath = step?.xPath ?? step?.xpath;
  const keywordText = String(keyword || '').trim().toLowerCase();
  let sanitizedValue = step?.value;
  if (keywordText === 'apicall') {
    sanitizedValue = redactApiCallValueForLogs(step?.value);
  }
  const payloadStep = {
    ...step,
    keyword,
    xPath,
    value: sanitizedValue,
    is_passed: !error,
    ...(stepOverrides && typeof stepOverrides === 'object' ? stepOverrides : {}),
    ...(stepIndex !== undefined && stepIndex !== null
      ? { step_index: stepIndex }
      : {}),
  };

  try {
    const urgent =
      !!error ||
      payloadStep?.isLastTestCaseStep === true ||
      payloadStep?.isLastStepInRunner === true;
    stepStatusReporter.enqueue({
      runnerId,
      testSuiteId,
      step: payloadStep,
      token,
      urgent,
    });
    console.log('log call queued');
  } catch (enqueueError) {
    const config = {
      url: getStepLogUrl(),
      method: 'post',
      data: {
        test_runner_id: runnerId,
        test_suite_id: testSuiteId,
        steps: [payloadStep],
      },
      token,
    };
    try {
      await api.request(config);
      console.log('log call fallback successful');
    } catch (requestError) {
      const status = requestError?.response?.status ?? 'unknown';
      console.log('log call failed -- code-- ' + status);
    }
  }
};

module.exports = {
  stepLogCall,
};
