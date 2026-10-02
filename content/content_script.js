/**
 * Content Script for Simple English Translator (Gemma 2B)
 */

(function () {
  // Prevent duplicate script injection
  if (window.__simpleEnglishExtLoaded) return;
  window.__simpleEnglishExtLoaded = true;

  // --- Safety guard: checks if the extension context is still valid ---
  function isExtensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Safe sendMessage — used only for quick fire-and-forget calls (GET_SETTINGS, health)
  function safeMessage(payload, callback) {
    if (!isExtensionAlive()) {
      if (callback) callback(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) { if (callback) callback(null); return; }
        if (callback) callback(response);
      });
    } catch (e) {
      if (callback) callback(null);
    }
  }

  // --- Long-lived port for LLM calls (survives MV3 service worker restarts) ---
  let port = null;
  let portCallbacks = {}; // keyed by request id

  function getPort() {
    if (!isExtensionAlive()) return null;
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: "simplify-port" });
      port.onDisconnect.addListener(() => {
        port = null;
        // Reject all pending callbacks with a friendly message
        Object.values(portCallbacks).forEach(cb => cb({ success: false, error: "Service worker restarted. Please try again." }));
        portCallbacks = {};
      });
      port.onMessage.addListener((msg) => {
        if (msg.type === "RESULT" && portCallbacks["single"]) {
          const cb = portCallbacks["single"];
          delete portCallbacks["single"];
          cb(msg);
        }
        if (msg.type === "CHUNK" && portCallbacks["batch_chunk"]) {
          portCallbacks["batch_chunk"](msg.results);
        }
        if (msg.type === "DONE" && portCallbacks["batch_done"]) {
          const cb = portCallbacks["batch_done"];
          delete portCallbacks["batch_chunk"];
          delete portCallbacks["batch_done"];
          cb();
        }
      });
    } catch (e) {
      port = null;
    }
    return port;
  }

  // Send a single text simplification via port
  function portSimplifyText(text, callback) {
    const p = getPort();
    if (!p) { callback({ success: false, error: "Extension context lost. Refresh the page." }); return; }
    portCallbacks["single"] = callback;
    try { p.postMessage({ action: "SIMPLIFY_TEXT_PORT", text }); }
    catch (e) { callback({ success: false, error: e.message }); }
  }

  // Send a batch simplification via port with incremental chunk callbacks
  function portSimplifyBatch(texts, onChunk, onDone) {
    const p = getPort();
    if (!p) { onDone([]); return; }
    portCallbacks["batch_chunk"] = onChunk;
    portCallbacks["batch_done"] = onDone;
    try { p.postMessage({ action: "SIMPLIFY_BATCH_PORT", texts }); }
    catch (e) { onDone([]); }
  }

  let extensionSettings = {
    replacementMode: "replace",
    showFloatingButton: true,
    autoSimplify: false
  };

  // Fetch settings on initialization via quick sendMessage (no LLM involved)
  safeMessage({ action: "GET_SETTINGS" }, (settings) => {
    if (settings) {
      extensionSettings = { ...extensionSettings, ...settings };
      initContentScript();
    }
  });

  // Dynamic UI elements
  let floatingBtn = null;
  let tooltipEl = null;
  let toastEl = null;
  let currentSelectionRange = null;

  // Track elements currently being translated or translated
  const translatedElements = new Map();

  function initContentScript() {
    createUIElements();
    attachEventListeners();

    if (extensionSettings.autoSimplify) {
      simplifyVisiblePage();
    }
  }

  // Create overlay DOM elements
  function createUIElements() {
    // Floating Selection Button
    floatingBtn = document.createElement("div");
    floatingBtn.id = "simple-eng-floating-btn";
    floatingBtn.className = "simple-eng-ui simple-eng-floating-btn simple-eng-hidden";
    floatingBtn.innerHTML = `
      <span class="simple-eng-btn-icon">⚡</span>
      <span class="simple-eng-btn-text">Simplify</span>
    `;
    document.body.appendChild(floatingBtn);

    // Tooltip Popup
    tooltipEl = document.createElement("div");
    tooltipEl.id = "simple-eng-tooltip";
    tooltipEl.className = "simple-eng-ui simple-eng-tooltip simple-eng-hidden";
    tooltipEl.innerHTML = `
      <div class="simple-eng-tooltip-header">
        <span class="simple-eng-tooltip-title">⚡ Simple English (Gemma 2B)</span>
        <button class="simple-eng-tooltip-close" title="Close">&times;</button>
      </div>
      <div class="simple-eng-tooltip-body">
        <div class="simple-eng-spinner-container">
          <div class="simple-eng-spinner"></div>
          <span>Translating with local Gemma 2B...</span>
        </div>
        <div class="simple-eng-tooltip-content"></div>
      </div>
      <div class="simple-eng-tooltip-footer">
        <button class="simple-eng-btn simple-eng-btn-copy">📋 Copy</button>
        <button class="simple-eng-btn simple-eng-btn-replace">✏️ Replace in Page</button>
      </div>
    `;
    document.body.appendChild(tooltipEl);

    // Toast Container
    toastEl = document.createElement("div");
    toastEl.id = "simple-eng-toast";
    toastEl.className = "simple-eng-ui simple-eng-toast simple-eng-hidden";
    document.body.appendChild(toastEl);
  }

  // Show Toast Notification
  function showToast(message, type = "info", duration = 3500) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = `simple-eng-ui simple-eng-toast simple-eng-toast-${type} simple-eng-show`;

    setTimeout(() => {
      toastEl.className = "simple-eng-ui simple-eng-toast simple-eng-hidden";
    }, duration);
  }

  // Event Listeners for user interaction
  function attachEventListeners() {
    // Handle Text Selection for Floating Button
    document.addEventListener("mouseup", (e) => {
      if (!extensionSettings.showFloatingButton) return;

      // Ignore mouseup inside our own UI elements
      if (e.target.closest(".simple-eng-ui")) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";

        if (selectedText.length >= 5) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();

          if (rect && rect.width > 0 && rect.height > 0) {
            currentSelectionRange = range.cloneRange();
            positionFloatingBtn(rect);
            return;
          }
        }
        hideFloatingBtn();
      }, 50);
    });

    // Handle Floating Button Click
    floatingBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideFloatingBtn();

      if (currentSelectionRange) {
        const textToSimplify = currentSelectionRange.toString().trim();
        const rect = currentSelectionRange.getBoundingClientRect();
        showTooltipForSelection(textToSimplify, rect);
      }
    });

    // Handle Tooltip Close
    tooltipEl.querySelector(".simple-eng-tooltip-close").addEventListener("click", () => {
      hideTooltip();
    });

    // Copy Button inside Tooltip
    tooltipEl.querySelector(".simple-eng-btn-copy").addEventListener("click", () => {
      const content = tooltipEl.querySelector(".simple-eng-tooltip-content").textContent;
      if (content) {
        navigator.clipboard.writeText(content).then(() => {
          showToast("Copied Simple English translation!", "success");
        });
      }
    });

    // Replace Selection in Page
    tooltipEl.querySelector(".simple-eng-btn-replace").addEventListener("click", () => {
      const content = tooltipEl.querySelector(".simple-eng-tooltip-content").textContent;
      if (content && currentSelectionRange) {
        replaceTextInRange(currentSelectionRange, content);
        hideTooltip();
        showToast("Replaced selection with Simple English!", "success");
      }
    });

    // Close floating button on scroll or window resize
    window.addEventListener("scroll", () => hideFloatingBtn(), { passive: true });
  }

  function positionFloatingBtn(rect) {
    const top = window.scrollY + rect.top - 40;
    const left = window.scrollX + rect.left + (rect.width / 2) - 45;

    floatingBtn.style.top = `${Math.max(10, top)}px`;
    floatingBtn.style.left = `${Math.max(10, left)}px`;
    floatingBtn.classList.remove("simple-eng-hidden");
  }

  function hideFloatingBtn() {
    if (floatingBtn) {
      floatingBtn.classList.add("simple-eng-hidden");
    }
  }

  // Show Tooltip Popup and trigger translation
  function showTooltipForSelection(text, rect) {
    const top = window.scrollY + rect.bottom + 10;
    const left = Math.min(window.scrollX + rect.left, window.innerWidth - 380);

    tooltipEl.style.top = `${Math.max(10, top)}px`;
    tooltipEl.style.left = `${Math.max(10, left)}px`;

    const spinner = tooltipEl.querySelector(".simple-eng-spinner-container");
    const contentEl = tooltipEl.querySelector(".simple-eng-tooltip-content");
    const footer = tooltipEl.querySelector(".simple-eng-tooltip-footer");

    spinner.style.display = "flex";
    contentEl.style.display = "none";
    footer.style.display = "none";
    contentEl.textContent = "";

    tooltipEl.classList.remove("simple-eng-hidden");

    // Call background via long-lived port (survives MV3 service worker sleep)
    portSimplifyText(text, (response) => {
      spinner.style.display = "none";

      if (response && response.success) {
        contentEl.textContent = response.result;
        contentEl.style.display = "block";
        footer.style.display = "flex";
      } else {
        const errMsg = (response && response.error) ? response.error : "Extension reloaded — please refresh this page (F5).";
        contentEl.innerHTML = `<span class="simple-eng-error">Error: ${escapeHtml(errMsg)}</span>`;
        contentEl.style.display = "block";
      }
    });
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.classList.add("simple-eng-hidden");
    }
  }

  function replaceTextInRange(range, newText) {
    range.deleteContents();
    const span = document.createElement("span");
    span.className = "simple-eng-replaced-text";
    span.textContent = newText;
    range.insertNode(span);
  }

  // DOM Text Extraction & Full/Section Page Simplification
  const IGNORED_TAGS = new Set([
    "SCRIPT", "STYLE", "CODE", "PRE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION",
    "SVG", "MATH", "CANVAS", "IFRAME", "KBD", "BUTTON"
  ]);

  // Heading tags — only translate if they're long descriptive sentences, not short labels
  const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

  function isTranslatableElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (IGNORED_TAGS.has(el.tagName)) return false;
    if (el.closest(".simple-eng-ui")) return false;
    if (el.isContentEditable) return false;
    // Skip elements already translated or being loaded
    if (el.dataset.simpleEngOriginal) return false;

    const text = el.innerText ? el.innerText.trim() : "";
    if (text.length < 10) return false;
    // Skip purely numeric/symbol elements and reference brackets like [1]
    if (/^[\d\s.,;:!?()\[\]–\-]+$/.test(text)) return false;

    // Headings: only translate if they are longer than 40 chars (i.e. full sentences,
    // not short section labels like "History" or "Early life" which always cause preamble)
    if (HEADING_TAGS.has(el.tagName) && text.length < 40) return false;

    return true;
  }

  // Collect the deepest meaningful text-bearing elements on the full page.
  // Strategy: prefer leaf-level block elements so we don't send the same text
  // twice through a parent/child pair.
  function getCandidateElements() {
    const selector = [
      "p",
      "li", "dt", "dd",
      "blockquote", "figcaption", "caption", "td", "th",
      // Long headings only (short ones are filtered by isTranslatableElement)
      "h1", "h2", "h3", "h4", "h5", "h6",
      "div.mw-parser-output > div:not([class])"  // Wikipedia bare text divs
    ].join(", ");

    const nodes = Array.from(document.querySelectorAll(selector));
    const seen = new Set();

    return nodes.filter(node => {
      if (!isTranslatableElement(node)) return false;

      // De-duplicate: skip if any ancestor is already in our candidate set
      let ancestor = node.parentElement;
      while (ancestor) {
        if (seen.has(ancestor)) return false;
        ancestor = ancestor.parentElement;
      }

      // Skip if this node has block-level children — prefer translating children individually
      const hasBlockChildren = node.querySelector("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption");
      if (hasBlockChildren) return false;

      seen.add(node);
      return true;
    });
  }

  // Simplify Page Content
  async function simplifyVisiblePage() {
    console.log("[SimpleEN ContentScript] Scanning page for translatable elements...");
    const candidates = getCandidateElements();
    console.log(`[SimpleEN ContentScript] Found ${candidates.length} translatable candidates.`);

    if (candidates.length === 0) {
      showToast("No translatable text found on this page.", "warning");
      return;
    }

    showToast(`Simplifying ${candidates.length} sections using Gemma 2B...`, "info");

    const batchData = candidates.map((el, index) => {
      // Store original text on dataset if not already saved
      if (!el.dataset.simpleEngOriginal) {
        el.dataset.simpleEngOriginal = el.innerHTML;
      }

      el.classList.add("simple-eng-loading-element");

      return {
        id: index,
        text: el.innerText.trim()
      };
    });

    // Send batch via long-lived port — results rendered incrementally as each chunk arrives
    let totalSuccessCount = 0;

    portSimplifyBatch(batchData, (chunkResults) => {
      // Called per batch chunk (3 elements at a time) as Gemma finishes them
      chunkResults.forEach((item) => {
        const el = candidates[item.id];
        if (!el) return;
        el.classList.remove("simple-eng-loading-element");

        if (item.success && item.result) {
          totalSuccessCount++;
          translatedElements.set(el, el.dataset.simpleEngOriginal);

          if (extensionSettings.replacementMode === "side_by_side") {
            el.innerHTML = `
              <div class="simple-eng-original-block">${el.dataset.simpleEngOriginal}</div>
              <div class="simple-eng-side-block"><span class="simple-eng-badge">Simple EN</span> ${escapeHtml(item.result)}</div>
            `;
          } else {
            el.innerHTML = `<span class="simple-eng-badge" title="Original text saved. Click 'Restore' to undo.">Simple EN</span> ${escapeHtml(item.result)}`;
          }
          el.classList.add("simple-eng-translated-element");
        }
      });
    }, () => {
      // Called once when all chunks are done
      showToast(`Successfully simplified ${totalSuccessCount} sections into Simple English!`, "success");
    });
  }

  // Restore Original Webpage Content
  function restoreOriginalPage() {
    const elements = document.querySelectorAll("[data-simple-eng-original]");
    let restoredCount = 0;

    elements.forEach(el => {
      if (el.dataset.simpleEngOriginal) {
        el.innerHTML = el.dataset.simpleEngOriginal;
        delete el.dataset.simpleEngOriginal;
        el.classList.remove("simple-eng-translated-element", "simple-eng-loading-element");
        restoredCount++;
      }
    });

    // Clear tracked replacements
    translatedElements.clear();

    if (restoredCount > 0) {
      showToast(`Restored original text for ${restoredCount} sections.`, "info");
    } else {
      showToast("Page is already showing original text.", "info");
    }
  }

  // Helper to escape HTML characters
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Listen for popup action commands — guarded against invalidated context
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isExtensionAlive()) return;
      if (message.action === "SIMPLIFY_PAGE") {
        simplifyVisiblePage();
        sendResponse({ success: true });
      } else if (message.action === "RESTORE_PAGE") {
        restoreOriginalPage();
        sendResponse({ success: true });
      } else if (message.action === "UPDATE_SETTINGS") {
        extensionSettings = { ...extensionSettings, ...message.settings };
        sendResponse({ success: true });
      }
    });
  } catch (e) {
    console.warn("[SimpleEN] Could not register onMessage listener:", e.message);
  }

})();
