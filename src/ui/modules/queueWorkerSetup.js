(function (global) {
  function createQueueWorkerSetupModule({
    elements,
    express,
    currentWebPortRef,
    documentRef,
  }) {
    let queueWorkerRefreshTimer = null;
    let lastConsumedSetupSessionToken = '';
    let currentQueueWorkerClientId = '';

    const formatQueueWorkerTime = value => {
      if (!value) return 'never';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'never';
      return date.toLocaleString();
    };

    const setQueueWorkerStateText = worker => {
      if (!elements.queueWorkerState || !elements.queueWorkerMessage) return;
      if (!worker) {
        elements.queueWorkerState.textContent = 'Worker status unavailable';
        elements.queueWorkerMessage.textContent = 'Start the local server to load runner settings.';
        return;
      }
      const stateParts = [];
      stateParts.push(worker.enabled ? 'Enabled' : 'Disabled');
      stateParts.push(worker.running ? (worker.busy ? 'Busy' : 'Idle') : 'Stopped');
      if (worker.deviceId) {
        stateParts.push(`Device ${worker.deviceId}`);
      }
      if (worker.runnerId) {
        stateParts.push(`Runner ${worker.runnerId}`);
      }
      elements.queueWorkerState.textContent = stateParts.join(' · ');

      if (worker.runnerUpdate?.requires_update) {
        const target = worker.runnerUpdate?.target_version ? ` (target ${worker.runnerUpdate.target_version})` : '';
        const baseMessage = worker.runnerUpdate?.required
          ? 'Runner update required before queue claims can continue.'
          : 'Runner update available.';
        const policyMessage = worker.runnerUpdate?.message || '';
        elements.queueWorkerMessage.textContent = `${baseMessage}${target}${policyMessage ? ` ${policyMessage}` : ''}`;
        return;
      }

      if (worker.lastError) {
        elements.queueWorkerMessage.textContent = `Last error: ${worker.lastError}`;
        return;
      }
      if (worker.deviceId && !worker.registeredDevice) {
        elements.queueWorkerMessage.textContent = 'Device binding saved. Runner will register this device on the next healthy poll.';
        return;
      }
      if (worker.lastHeartbeatAt) {
        elements.queueWorkerMessage.textContent = `Registered ${worker.registeredDevice ? 'yes' : 'no'} · Last heartbeat ${formatQueueWorkerTime(worker.lastHeartbeatAt)}`;
        return;
      }
      elements.queueWorkerMessage.textContent = 'Bind this runner VM to a device before enabling strict device claiming.';
    };

    const isDeviceSetupModalOpen = () => {
      const modal = documentRef.getElementById('deviceSetupModal');
      return !!modal && modal.classList.contains('show');
    };

    const applyQueueWorkerStatus = worker => {
      if (!elements.queueWorkerEnabled) return;
      currentQueueWorkerClientId = worker?.clientId ?? currentQueueWorkerClientId;
      elements.queueWorkerEnabled.value = worker?.enabled ? 'true' : 'false';
      elements.queueWorkerDeviceId.value = worker?.deviceId ?? '';
      elements.queueWorkerRunnerId.value = worker?.runnerId ?? '';
      elements.queueWorkerPollMs.value = worker?.pollMs ?? 3000;
      elements.queueWorkerApiBaseUrl.value = worker?.apiBaseUrl ?? elements.queueWorkerApiBaseUrl.value ?? '';
      setQueueWorkerStateText(worker);
    };

    const queueWorkerRequest = async (path, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${currentWebPortRef()}${path}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (!response.ok) {
        const message = payload?.message || `Runner request failed (${response.status})`;
        throw new Error(message);
      }
      return payload;
    };

    const normalizeApiBaseUrl = value => String(value || '').trim().replace(/\/$/, '');

    const loadQueueWorkerStatus = async ({ silent = false } = {}) => {
      if (!elements.queueWorkerEnabled) return;
      if (!silent) {
        setQueueWorkerStateText(null);
      }
      try {
        const payload = await queueWorkerRequest('/queue/status');
        applyQueueWorkerStatus(payload?.worker || null);
      } catch (error) {
        if (!silent) {
          setQueueWorkerStateText(null);
        }
        if (elements.queueWorkerMessage) {
          elements.queueWorkerMessage.textContent = error?.message || 'Unable to load runner settings.';
        }
      }
    };

    const saveQueueWorkerConfig = async (overrides = {}) => {
      if (!elements.saveQueueWorkerConfigBtn) return;
      const payload = {
        enabled: Object.prototype.hasOwnProperty.call(overrides, 'enabled')
          ? overrides.enabled
          : elements.queueWorkerEnabled?.value === 'true',
        deviceId: Object.prototype.hasOwnProperty.call(overrides, 'deviceId') ? overrides.deviceId : (elements.queueWorkerDeviceId?.value?.trim() || ''),
        clientId: Object.prototype.hasOwnProperty.call(overrides, 'clientId') ? overrides.clientId : currentQueueWorkerClientId,
        runnerId: Object.prototype.hasOwnProperty.call(overrides, 'runnerId') ? overrides.runnerId : (elements.queueWorkerRunnerId?.value?.trim() || ''),
        pollMs: elements.queueWorkerPollMs?.value ? Number(elements.queueWorkerPollMs.value) : undefined,
        apiBaseUrl: Object.prototype.hasOwnProperty.call(overrides, 'apiBaseUrl') ? overrides.apiBaseUrl : (elements.queueWorkerApiBaseUrl?.value?.trim() || ''),
        useRunnerSession: Object.prototype.hasOwnProperty.call(overrides, 'useRunnerSession') ? overrides.useRunnerSession : false,
      };
      const explicitDeviceKey = Object.prototype.hasOwnProperty.call(overrides, 'deviceKey') ? String(overrides.deviceKey || '').trim() : '';
      if (explicitDeviceKey) {
        payload.deviceKey = explicitDeviceKey;
      } else if (elements.queueWorkerDeviceKey?.value?.trim()) {
        payload.deviceKey = elements.queueWorkerDeviceKey.value.trim();
      }
      elements.saveQueueWorkerConfigBtn.disabled = true;
      if (elements.queueWorkerMessage) {
        elements.queueWorkerMessage.textContent = 'Saving runner settings...';
      }
      try {
        const result = await queueWorkerRequest('/queue/config', {
          method: 'POST',
          body: payload,
        });
        applyQueueWorkerStatus(result?.worker || null);
        if (elements.queueWorkerDeviceKey) {
          elements.queueWorkerDeviceKey.value = '';
        }
        if (elements.queueWorkerMessage) {
          elements.queueWorkerMessage.textContent = 'Runner settings saved.';
        }
      } catch (error) {
        if (elements.queueWorkerMessage) {
          elements.queueWorkerMessage.textContent = error?.message || 'Unable to save runner settings.';
        }
      } finally {
        elements.saveQueueWorkerConfigBtn.disabled = false;
      }
    };

    const pairDeviceWithCode = async () => {
      if (!elements.pairDeviceSetupBtn) return;
      const pairingCode = elements.queueWorkerPairingCode?.value?.trim() || '';
      const claimToken = elements.queueWorkerClaimToken?.value?.trim() || '';
      const apiBaseUrl = elements.queueWorkerApiBaseUrl?.value?.trim() || '';
      if (!pairingCode) {
        if (elements.queueWorkerPairingMessage) elements.queueWorkerPairingMessage.textContent = 'Pairing code is required.';
        return;
      }
      if (!apiBaseUrl) {
        if (elements.queueWorkerPairingMessage) elements.queueWorkerPairingMessage.textContent = 'Backend API Base URL is required before pairing.';
        return;
      }
      if (claimToken && !elements.queueWorkerRunnerId?.value?.trim()) {
        if (elements.queueWorkerPairingMessage) elements.queueWorkerPairingMessage.textContent = 'Runner ID is required when claim token is used.';
        return;
      }
      elements.pairDeviceSetupBtn.disabled = true;
      if (elements.queueWorkerPairingMessage) {
        elements.queueWorkerPairingMessage.textContent = 'Pairing device...';
      }
      try {
        const pairEndpoint = claimToken ? '/runner/agent/pair' : '/runner/pair';
        const payloadBody = claimToken
          ? {
              pairing_code: pairingCode,
              claim_token: claimToken,
              agent_id: elements.queueWorkerRunnerId?.value?.trim() || '',
              hostname: '',
            }
          : {
              pairing_code: pairingCode,
              runner_id: elements.queueWorkerRunnerId?.value?.trim() || '',
            };

        const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${pairEndpoint}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payloadBody),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || `Pairing failed (${response.status})`);
        }
        const data = payload?.data || payload || {};
        elements.queueWorkerDeviceId.value = data.device_id ? String(data.device_id) : '';
        if (data.runner_id) {
          elements.queueWorkerRunnerId.value = String(data.runner_id);
        }
        if (data.api_base_url) {
          elements.queueWorkerApiBaseUrl.value = String(data.api_base_url);
        }
        if (elements.queueWorkerDeviceKey) {
          elements.queueWorkerDeviceKey.value = String(data.device_key || '');
        }
        await saveQueueWorkerConfig({
          enabled: true,
          deviceId: data.device_id ? String(data.device_id) : '',
          clientId: data.client_id ? String(data.client_id) : '',
          runnerId: data.runner_id ? String(data.runner_id) : (elements.queueWorkerRunnerId?.value?.trim() || ''),
          apiBaseUrl: data.api_base_url ? String(data.api_base_url) : apiBaseUrl,
          deviceKey: String(data.device_key || ''),
          useRunnerSession: false,
        });
        if (elements.queueWorkerPairingCode) {
          elements.queueWorkerPairingCode.value = '';
        }
        if (elements.queueWorkerClaimToken) {
          elements.queueWorkerClaimToken.value = '';
        }
        if (elements.queueWorkerPairingMessage) {
          elements.queueWorkerPairingMessage.textContent = claimToken
            ? 'Device paired with agent token flow and saved locally.'
            : 'Device paired and saved locally.';
        }
      } catch (error) {
        if (elements.queueWorkerPairingMessage) {
          elements.queueWorkerPairingMessage.textContent = error?.message || 'Unable to pair device.';
        }
      } finally {
        elements.pairDeviceSetupBtn.disabled = false;
      }
    };

    const consumeSetupSession = async incoming => {
      const sessionToken = String(incoming?.sessionToken || incoming?.session_token || '').trim();
      if (!sessionToken || sessionToken === lastConsumedSetupSessionToken) {
        return;
      }

      const incomingApiBaseUrl = normalizeApiBaseUrl(incoming?.apiBaseUrl || incoming?.api_base_url || '');
      const currentApiBaseUrl = normalizeApiBaseUrl(elements.queueWorkerApiBaseUrl?.value || '');
      const apiBaseUrl = incomingApiBaseUrl || currentApiBaseUrl;

      if (!apiBaseUrl) {
        if (elements.queueWorkerPairingMessage) {
          elements.queueWorkerPairingMessage.textContent = 'Setup link received, but API base URL is missing.';
        }
        return;
      }

      if (elements.queueWorkerPairingMessage) {
        elements.queueWorkerPairingMessage.textContent = 'Applying one-click setup...';
      }

      try {
        const response = await fetch(`${apiBaseUrl}/runner/setup-session/consume`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ session_token: sessionToken }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || `Setup session consume failed (${response.status})`);
        }
        lastConsumedSetupSessionToken = sessionToken;
        const data = payload?.data || payload || {};

        if (elements.queueWorkerApiBaseUrl) {
          elements.queueWorkerApiBaseUrl.value = normalizeApiBaseUrl(data.api_base_url || apiBaseUrl);
        }
        if (elements.queueWorkerPairingCode) {
          elements.queueWorkerPairingCode.value = String(data.pairing_code || '');
        }
        if (elements.queueWorkerClaimToken) {
          elements.queueWorkerClaimToken.value = String(data.claim_token || '');
        }
        if (elements.queueWorkerDeviceId && data.device_id) {
          elements.queueWorkerDeviceId.value = String(data.device_id);
        }
        if (elements.queueWorkerRunnerId && data.runner_id) {
          elements.queueWorkerRunnerId.value = String(data.runner_id);
        }

        await pairDeviceWithCode();
      } catch (error) {
        if (elements.queueWorkerPairingMessage) {
          elements.queueWorkerPairingMessage.textContent = error?.message || 'Unable to apply one-click setup.';
        }
      }
    };

    const init = () => {
      elements.saveQueueWorkerConfigBtn?.addEventListener('click', saveQueueWorkerConfig);
      elements.pairDeviceSetupBtn?.addEventListener('click', pairDeviceWithCode);
      express?.runnerSetupSession?.((_event, payload) => {
        consumeSetupSession(payload);
      });
      express?.consumePendingRunnerSetupSession?.()
        .then(payload => {
          if (payload) {
            consumeSetupSession(payload);
          }
        })
        .catch(() => {});
      global.addEventListener('load', () => {
        loadQueueWorkerStatus();
        if (queueWorkerRefreshTimer) {
          clearInterval(queueWorkerRefreshTimer);
        }
        queueWorkerRefreshTimer = setInterval(() => {
          loadQueueWorkerStatus({ silent: true });
        }, 10000);
      });
      global.addEventListener('beforeunload', () => {
        if (queueWorkerRefreshTimer) {
          clearInterval(queueWorkerRefreshTimer);
          queueWorkerRefreshTimer = null;
        }
      });
    };

    return {
      init,
      loadQueueWorkerStatus,
      saveQueueWorkerConfig,
    };
  }

  global.createQueueWorkerSetupModule = createQueueWorkerSetupModule;
})(window);
