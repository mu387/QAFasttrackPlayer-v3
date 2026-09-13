const assert = require('assert');
const { FastTrackAutomation } = require('../src/ui/automation');

const makeMainWindow = () => ({
    webContents: {
        send: () => {},
    },
});

const makeLoopHelper = value => ({ loop: value });

const makeStep = (description, loopValue = null, extras = {}) => ({
    id: Math.floor(Math.random() * 1000000),
    description,
    keyword: { name: 'noop' },
    value: '',
    xPath: '',
    ...(loopValue ? { Loop: loopValue } : {}),
    ...extras,
});

const createAutomation = (steps, visibleCount = 0) => {
    const automation = new FastTrackAutomation({
        testRunnerStepDataOriginal: [{ id: 1, steps }],
        testRunner: null,
        mainWindow: makeMainWindow(),
        token: null,
    });
    const executed = [];
    let countCalls = 0;

    automation.runStep = async step => {
        executed.push(step.description);
    };
    automation.webDriver.countVisibleElements = async locator => {
        countCalls += 1;
        assert.strictEqual(locator, 'css=.row');
        return visibleCount;
    };

    return { automation, executed, getCountCalls: () => countCalls };
};

async function runHarness() {
    {
        const { automation, executed } = createAutomation([
            makeStep('StartAction', 'Loop=:Start-3'),
            makeStep('MiddleAction'),
            makeStep('EndLoop', 'Loop=:End'),
        ]);

        await automation.runAutomation();
        assert.deepStrictEqual(executed, [
            'StartAction',
            'MiddleAction',
            'StartAction',
            'MiddleAction',
            'StartAction',
            'MiddleAction',
        ]);
    }

    {
        const { automation, executed, getCountCalls } = createAutomation([
            makeStep('DynamicStart', 'Loop=:Start-css=.row'),
            makeStep('DynamicBody'),
            makeStep('EndLoop', 'Loop=:End'),
        ], 2);

        await automation.runAutomation();
        assert.deepStrictEqual(executed, [
            'DynamicStart',
            'DynamicBody',
            'DynamicStart',
            'DynamicBody',
        ]);
        assert.strictEqual(getCountCalls(), 1);
    }

    {
        const { automation, executed } = createAutomation([
            makeStep('ZeroStart', 'Loop=:Start-0'),
            makeStep('ZeroBody'),
            makeStep('EndLoop', 'Loop=:End'),
        ]);

        await automation.runAutomation();
        assert.deepStrictEqual(executed, ['ZeroStart', 'ZeroBody']);
    }

    {
        const { automation, executed } = createAutomation([
            makeStep('HelperStartBody', null, { before_step: [makeLoopHelper('Loop=:Start-2')] }),
            makeStep('HelperEndBody', null, { after_step: [makeLoopHelper('Loop=:End')] }),
        ]);

        await automation.runAutomation();
        assert.deepStrictEqual(executed, [
            'HelperStartBody',
            'HelperEndBody',
            'HelperStartBody',
            'HelperEndBody',
        ]);
    }

    {
        const { automation } = createAutomation([
            makeStep('MissingEndStart', 'Loop=:Start-2'),
            makeStep('Body'),
        ]);

        await assert.rejects(
            () => automation.runAutomation(),
            /Loop end is missing/,
        );
    }

    {
        const { automation } = createAutomation([
            makeStep('OuterStart', 'Loop=:Start-2'),
            makeStep('InnerStart', 'Loop=:Start-2'),
            makeStep('EndLoop', 'Loop=:End'),
        ]);

        await assert.rejects(
            () => automation.runAutomation(),
            /Nested loops are not supported/,
        );
    }

    console.log('Loop runtime harness passed');
}

runHarness().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
