/**
 * Options Script for Simple English Translator (Gemma 2B)
 */

const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:11434",
  model: "gemma2:2b",
  provider: "ollama",
  temperature: 0.1,
  systemPrompt: "You are a plain text simplifier. Rewrite the given text using simple words and short sentences. Keep the same meaning. Output ONLY the simplified text with absolutely no introduction, greeting, explanation, note, label, or commentary before or after it. Do not write 'Sure', 'Here is', 'Simplified text:', 'Of course' or any similar phrase. Start your response with the first word of the simplified text directly.",
  replacementMode: "replace",
  showFloatingButton: true,
  autoSimplify: false
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("settingsForm");
  const endpointInput = document.getElementById("endpoint");
  const providerSelect = document.getElementById("provider");
  const modelInput = document.getElementById("modelSelect");
  const fetchModelsBtn = document.getElementById("fetchModelsBtn");
  const testConnBtn = document.getElementById("testConnBtn");
  const connStatus = document.getElementById("connStatus");
  const systemPromptInput = document.getElementById("systemPrompt");
  const temperatureInput = document.getElementById("temperature");
  const tempValueDisplay = document.getElementById("tempValue");
  const showFloatingBtnCheckbox = document.getElementById("showFloatingButton");
  const autoSimplifyCheckbox = document.getElementById("autoSimplify");
  const replacementModeSelect = document.getElementById("replacementMode");
  const saveStatus = document.getElementById("saveStatus");
  const resetBtn = document.getElementById("resetBtn");

  // Load existing settings
  loadSettings();

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      endpointInput.value = settings.endpoint || DEFAULT_SETTINGS.endpoint;
      providerSelect.value = settings.provider || DEFAULT_SETTINGS.provider;
      modelInput.value = settings.model || DEFAULT_SETTINGS.model;
      systemPromptInput.value = settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
      temperatureInput.value = settings.temperature !== undefined ? settings.temperature : DEFAULT_SETTINGS.temperature;
      tempValueDisplay.textContent = temperatureInput.value;
      showFloatingBtnCheckbox.checked = !!settings.showFloatingButton;
      autoSimplifyCheckbox.checked = !!settings.autoSimplify;
      replacementModeSelect.value = settings.replacementMode || DEFAULT_SETTINGS.replacementMode;
    });
  }

  // Update Temperature display value
  temperatureInput.addEventListener("input", () => {
    tempValueDisplay.textContent = temperatureInput.value;
  });

  // Test Connection
  testConnBtn.addEventListener("click", () => {
    const endpoint = endpointInput.value.trim();
    connStatus.textContent = "Testing connection...";
    connStatus.className = "conn-status pending";

    chrome.runtime.sendMessage({ action: "CHECK_HEALTH", endpoint }, (res) => {
      if (res && res.online) {
        const models = res.models || [];
        connStatus.textContent = `Connected! (${models.length} local models detected)`;
        connStatus.className = "conn-status success";
      } else {
        const err = res ? res.error : "Failed";
        connStatus.textContent = `Connection Failed: ${err}`;
        connStatus.className = "conn-status error";
      }
    });
  });

  // Fetch Available Models
  fetchModelsBtn.addEventListener("click", () => {
    const endpoint = endpointInput.value.trim();
    connStatus.textContent = "Fetching models...";
    connStatus.className = "conn-status pending";

    chrome.runtime.sendMessage({ action: "CHECK_HEALTH", endpoint }, (res) => {
      if (res && res.online && res.models && res.models.length > 0) {
        connStatus.textContent = `Found models: ${res.models.join(", ")}`;
        connStatus.className = "conn-status success";

        // Auto select gemma model if found
        const gemmaModel = res.models.find(m => m.includes("gemma"));
        if (gemmaModel) {
          modelInput.value = gemmaModel;
        } else {
          modelInput.value = res.models[0];
        }
      } else {
        connStatus.textContent = "No models found or connection failed.";
        connStatus.className = "conn-status error";
      }
    });
  });

  // Save Settings Form
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const newSettings = {
      endpoint: endpointInput.value.trim(),
      provider: providerSelect.value,
      model: modelInput.value.trim(),
      systemPrompt: systemPromptInput.value.trim(),
      temperature: parseFloat(temperatureInput.value),
      showFloatingButton: showFloatingBtnCheckbox.checked,
      autoSimplify: autoSimplifyCheckbox.checked,
      replacementMode: replacementModeSelect.value
    };

    chrome.storage.sync.set(newSettings, () => {
      saveStatus.textContent = "Settings saved successfully!";
      saveStatus.className = "save-status success";

      setTimeout(() => {
        saveStatus.textContent = "";
      }, 3000);
    });
  });

  // Reset Defaults
  resetBtn.addEventListener("click", () => {
    if (confirm("Reset all settings to default configuration?")) {
      chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
        loadSettings();
        saveStatus.textContent = "Settings reset to default.";
        saveStatus.className = "save-status info";
        setTimeout(() => { saveStatus.textContent = ""; }, 3000);
      });
    }
  });
});
