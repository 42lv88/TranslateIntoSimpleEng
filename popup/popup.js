/**
 * Popup Script for Simple English Translator (Gemma 2B)
 */

document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const modelInfoText = document.getElementById("modelInfoText");
  const refreshHealthBtn = document.getElementById("refreshHealthBtn");
  const simplifyPageBtn = document.getElementById("simplifyPageBtn");
  const restorePageBtn = document.getElementById("restorePageBtn");
  const openOptionsBtn = document.getElementById("openOptionsBtn");
  const floatingBtnToggle = document.getElementById("floatingBtnToggle");
  const replacementModeSelect = document.getElementById("replacementModeSelect");
  const clearCacheLink = document.getElementById("clearCacheLink");

  let currentSettings = {};

  // Load current settings and check health
  initPopup();

  async function initPopup() {
    chrome.runtime.sendMessage({ action: "GET_SETTINGS" }, (settings) => {
      if (settings) {
        currentSettings = settings;
        floatingBtnToggle.checked = !!settings.showFloatingButton;
        replacementModeSelect.value = settings.replacementMode || "replace";
        modelInfoText.textContent = `Model: ${settings.model || "gemma:2b"}`;

        checkModelHealth(settings.endpoint);
      }
    });
  }

  // Check Local LLM Backend Status
  function checkModelHealth(endpoint) {
    statusDot.className = "status-dot status-checking";
    statusText.textContent = "Connecting to local Gemma model...";

    chrome.runtime.sendMessage({ action: "CHECK_HEALTH", endpoint }, (res) => {
      if (res && res.online) {
        const models = res.models || [];
        const currentModel = currentSettings.model || "gemma:2b";
        const hasGemma = models.some(m => m.includes("gemma"));

        statusDot.className = "status-dot status-online";
        if (hasGemma || models.includes(currentModel)) {
          statusText.textContent = `Online: ${currentModel}`;
        } else if (models.length > 0) {
          statusText.textContent = `Online (${models.length} models found)`;
        } else {
          statusText.textContent = "Online: Ollama Server connected";
        }
      } else {
        statusDot.className = "status-dot status-offline";
        const err = res ? res.error : "Offline";
        statusText.textContent = `Disconnected: Check Ollama (${endpoint || "http://localhost:11434"})`;
      }
    });
  }

  // Refresh Health Button
  refreshHealthBtn.addEventListener("click", () => {
    checkModelHealth(currentSettings.endpoint);
  });

  // Simplify Current Page
  simplifyPageBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "SIMPLIFY_PAGE" }, (res) => {
        if (chrome.runtime.lastError) {
          alert("Could not communicate with page. Please refresh the web page and try again.");
        } else {
          window.close();
        }
      });
    }
  });

  // Restore Original Text
  restorePageBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "RESTORE_PAGE" }, (res) => {
        if (chrome.runtime.lastError) {
          alert("Could not communicate with page. Please refresh the web page and try again.");
        } else {
          window.close();
        }
      });
    }
  });

  // Toggle Floating Selection Button
  floatingBtnToggle.addEventListener("change", () => {
    const newValue = floatingBtnToggle.checked;
    currentSettings.showFloatingButton = newValue;

    chrome.storage.sync.set({ showFloatingButton: newValue }, () => {
      notifyContentScript({ showFloatingButton: newValue });
    });
  });

  // Replacement Mode Select
  replacementModeSelect.addEventListener("change", () => {
    const newValue = replacementModeSelect.value;
    currentSettings.replacementMode = newValue;

    chrome.storage.sync.set({ replacementMode: newValue }, () => {
      notifyContentScript({ replacementMode: newValue });
    });
  });

  // Notify Active Tab Content Script of Settings Change
  async function notifyContentScript(updatedSettings) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "UPDATE_SETTINGS", settings: updatedSettings }, () => {
        // Ignore errors if content script is not injected on active tab (e.g. chrome://)
        if (chrome.runtime.lastError) {}
      });
    }
  }

  // Open Options Page
  openOptionsBtn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options/options.html"));
    }
  });

  // Clear Cache
  clearCacheLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "CLEAR_CACHE" }, (res) => {
      alert("Translation cache cleared!");
    });
  });
});
