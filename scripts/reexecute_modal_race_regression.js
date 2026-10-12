const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ui/modules/reExecuteFlow.js'), 'utf8'), { window });
  const element = () => {
    const listeners = {};
    return {
      value: '', textContent: '', classList: { toggle() {} },
      addEventListener: (name, callback) => { listeners[name] = callback; },
      fire: name => listeners[name]?.(),
    };
  };
  const elements = Object.fromEntries([
    'reExecuteDataModal', 'reExecuteModalExecuteBtn', 'reExecuteModalMarkPassBtn',
    'reExecuteModalMarkFailBtn', 'reExecuteModalCancelBtn', 'resumeFailedStepBtn',
    'reExecuteModalXpath', 'reExecuteModalKeyword', 'reExecuteModalValue', 'reExecStepLabel',
  ].map(name => [name, element()]));
  const modal = {
    shown: false, closing: false,
    show() { if (!this.closing) this.shown = true; },
    hide() { if (this.shown && !this.closing) { this.shown = false; this.closing = true; } },
    finishHide() { this.closing = false; elements.reExecuteDataModal.fire('hidden.bs.modal'); },
  };
  const calls = [];
  const flow = window.createReExecuteFlowModule({
    elements,
    bootstrapRef: { Modal: { getOrCreateInstance: () => modal } },
    resolveStepKeyword: step => step.keyword.name,
    express: Object.fromEntries(['dataToReExecuteStep', 'reExecuteStep', 'markStepAsPass', 'markStepAsFail']
      .map(name => [name, () => calls.push(name)])),
  });
  flow.init();
  return { flow, elements, modal, calls };
}
const first = { description: 'Exist', keyword: { name: 'exist' }, value: 'Monday' };
const next = { description: 'Launch Browser', keyword: { name: 'launchBrowser' }, value: 'NI' };
for (const button of ['reExecuteModalExecuteBtn', 'reExecuteModalMarkPassBtn', 'reExecuteModalMarkFailBtn']) {
  const { flow, elements, modal } = fixture();
  flow.showForStep(first);
  assert.equal(modal.shown, true);
  elements[button].fire('click');
  assert.equal(modal.closing, true);
  flow.showForStep(next);
  modal.finishHide();
  assert.equal(modal.shown, true, button + ': immediate next failure must reopen after closing');
  assert.equal(elements.reExecStepLabel.textContent, 'Launch Browser');
  assert.equal(elements.reExecuteModalValue.value, 'NI');
}
for (const clear of [false, true]) {
  const { flow, elements, modal } = fixture();
  flow.showForStep(first);
  elements.reExecuteModalCancelBtn.fire('click');
  if (clear) flow.clearPendingState({ clearFields: true });
  modal.finishHide();
  assert.equal(modal.shown, false, 'Close or cleared state must not reopen');
  if (!clear) {
    elements.resumeFailedStepBtn.fire('click');
    assert.equal(modal.shown, true);
  }
}
{
  const { flow, elements, modal } = fixture();
  flow.showForStep(first);
  elements.reExecuteModalMarkFailBtn.fire('click');
  flow.showForStep(next);
  flow.dismissReExecuteModal({ clearFields: true });
  modal.finishHide();
  assert.equal(modal.shown, false, 'Stop must discard a pending reopen');
}
console.log('PASS rerun modal consecutive failures, retry, pass/fail, Close, reopen and cleared-state timing');
