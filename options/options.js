/**
 * Options Script for Simple English Translator (Gemma 2B + ElevenLabs TTS)
 */

const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:11434",
  model: "gemma2:2b",
  provider: "ollama",
  temperature: 0.1,
  systemPrompt: "You are a plain text simplifier. Rewrite the given text using simple words and short sentences. Keep the same meaning. Output ONLY the simplified text with absolutely no introduction, greeting, explanation, note, label, or commentary before or after it. Do not write 'Sure', 'Here is', 'Simplified text:', 'Of course' or any similar phrase. Start your response with the first word of the simplified text directly.",
  replacementMode: "replace",
  showFloatingButton: true,
  autoSimplify: false,
  // ElevenLabs TTS
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",  // "Rachel" — premade, works on free tier
  elevenLabsModelId: "eleven_multilingual_v2",
  elevenLabsEnabled: true
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

  // ElevenLabs elements
  const elevenLabsEnabledCheckbox = document.getElementById("elevenLabsEnabled");
  const elevenLabsApiKeyInput = document.getElementById("elevenLabsApiKey");
  const elevenLabsVoiceSelect = document.getElementById("elevenLabsVoiceId");
  const elevenLabsModelSelect = document.getElementById("elevenLabsModelId");
  const fetchVoicesBtn = document.getElementById("fetchVoicesBtn");
  const testTtsBtn = document.getElementById("testTtsBtn");
  const ttsStatus = document.getElementById("ttsStatus");

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

      // ElevenLabs
      elevenLabsEnabledCheckbox.checked = settings.elevenLabsEnabled !== false;
      elevenLabsApiKeyInput.value = settings.elevenLabsApiKey || "";
      elevenLabsVoiceSelect.value = settings.elevenLabsVoiceId || DEFAULT_SETTINGS.elevenLabsVoiceId;
      elevenLabsModelSelect.value = settings.elevenLabsModelId || DEFAULT_SETTINGS.elevenLabsModelId;
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

  // --- ElevenLabs: Fetch Voices ---
  fetchVoicesBtn.addEventListener("click", () => {
    ttsStatus.textContent = "Fetching voices...";
    ttsStatus.className = "conn-status pending";

    // Temporarily save the API key so the background can use it
    chrome.storage.sync.set({ elevenLabsApiKey: elevenLabsApiKeyInput.value.trim() }, () => {
      chrome.runtime.sendMessage({ action: "LIST_VOICES" }, (res) => {
        if (res && res.success && res.voices && res.voices.length > 0) {
          ttsStatus.textContent = `Found ${res.voices.length} voices!`;
          ttsStatus.className = "conn-status success";

          // Remember current selection
          const currentVal = elevenLabsVoiceSelect.value;

          // Clear and repopulate
          elevenLabsVoiceSelect.innerHTML = "";
          res.voices.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.voice_id;
            opt.textContent = `${v.name} (${v.category})`;
            elevenLabsVoiceSelect.appendChild(opt);
          });

          // Restore selection if still available
          if ([...elevenLabsVoiceSelect.options].some(o => o.value === currentVal)) {
            elevenLabsVoiceSelect.value = currentVal;
          }
        } else {
          const err = (res && res.error) ? res.error : "Failed to fetch voices.";
          ttsStatus.textContent = err;
          ttsStatus.className = "conn-status error";
        }
      });
    });
  });

  // --- ElevenLabs: Test TTS ---
  testTtsBtn.addEventListener("click", () => {
    const apiKey = elevenLabsApiKeyInput.value.trim();
    if (!apiKey) {
      ttsStatus.textContent = "Please enter your ElevenLabs API key first.";
      ttsStatus.className = "conn-status error";
      return;
    }

    ttsStatus.textContent = "Generating speech...";
    ttsStatus.className = "conn-status pending";
    testTtsBtn.disabled = true;

    // Save settings temporarily so background can use them
    chrome.storage.sync.set({
      elevenLabsApiKey: apiKey,
      elevenLabsVoiceId: elevenLabsVoiceSelect.value,
      elevenLabsModelId: elevenLabsModelSelect.value
    }, () => {
      chrome.runtime.sendMessage(
        { action: "TTS_SPEAK", text: "Hello! This is a test of the Simple English Translator voice feature, powered by ElevenLabs." },
        (res) => {
          testTtsBtn.disabled = false;
          if (res && res.success && res.audio) {
            ttsStatus.textContent = "Playing test audio...";
            ttsStatus.className = "conn-status success";

            const audio = new Audio(res.audio);
            audio.play().catch(err => {
              ttsStatus.textContent = `Playback failed: ${err.message}`;
              ttsStatus.className = "conn-status error";
            });
            audio.addEventListener("ended", () => {
              ttsStatus.textContent = "TTS working!";
            });
          } else {
            const err = (res && res.error) ? res.error : "TTS test failed.";
            ttsStatus.textContent = err;
            ttsStatus.className = "conn-status error";
          }
        }
      );
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
      replacementMode: replacementModeSelect.value,
      // ElevenLabs
      elevenLabsEnabled: elevenLabsEnabledCheckbox.checked,
      elevenLabsApiKey: elevenLabsApiKeyInput.value.trim(),
      elevenLabsVoiceId: elevenLabsVoiceSelect.value,
      elevenLabsModelId: elevenLabsModelSelect.value
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
