/**
 * Background Service Worker for Simple English Translator (Gemma 2B)
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

// In-memory cache for fast lookup during session
const memoryCache = new Map();

// --- MV3 Service Worker Keepalive ---
// Chrome kills idle MV3 service workers after ~30s. We keep it alive
// by tracking open ports and sending a periodic noop ping while work is pending.
const activePorts = new Set();
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // Self-fetch to chrome-extension:// keeps the service worker awake
    fetch(chrome.runtime.getURL("manifest.json")).catch(() => {});
  }, 20000); // ping every 20s (well under Chrome's 30s kill threshold)
}

function stopKeepAlive() {
  if (activePorts.size > 0) return; // still have open ports, keep running
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Long-lived port connection from content script
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "simplify-port") return;

  activePorts.add(port);
  startKeepAlive();

  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
    stopKeepAlive();
  });

  port.onMessage.addListener(async (message) => {
    if (message.action === "SIMPLIFY_BATCH_PORT") {
      const settings = await getSettings();
      const texts = message.texts || [];
      const batchSize = 3;

      for (let i = 0; i < texts.length; i += batchSize) {
        const chunk = texts.slice(i, i + batchSize);
        const chunkResults = await Promise.all(
          chunk.map(item => handleSimplifyText(item.text, settings))
        );

        const results = chunkResults.map((res, idx) => ({
          id: chunk[idx].id,
          success: res.success,
          result: res.result,
          error: res.error,
          cached: res.cached
        }));

        // Send incremental chunk results back through the port
        try { port.postMessage({ type: "CHUNK", results }); } catch (e) {}
      }

      // Signal completion
      try { port.postMessage({ type: "DONE" }); } catch (e) {}
    }

    if (message.action === "SIMPLIFY_TEXT_PORT") {
      const result = await handleSimplifyText(message.text, message.settings);
      try { port.postMessage({ type: "RESULT", ...result }); } catch (e) {}
    }
  });
});

// Helper: Get settings from storage with defaults
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve(items);
    });
  });
}

// Helper: Normalize cache key
function getCacheKey(model, text) {
  return `${model}::${text.trim()}`;
}

// Helper: Clean up model output — strip ALL LLM preamble, suffixes and formatting noise
function cleanSimplifiedText(rawText) {
  if (!rawText) return "";
  let text = rawText.trim();

  // 1. Strip markdown code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }

  // 2. Comprehensive preamble patterns — order matters, most specific first
  const preamblePatterns = [
    // "Sure, here is the simplified text you requested: ..."  (with or without colon)
    /^sure[,!.]?\s+here\s+is\s+the\s+simplified\s+text\s+you\s+requested[.:!]?\s*/i,
    // "Sure, here is a simplified version:"
    /^sure[,!.]?\s+here\s+is\s+(a|the)\s+simplified\s+(text|version|english|translation)[^a-z][^:]*[:.]?\s*/i,
    // "Sure, here is:" / "Sure, here's:"
    /^sure[,!.]?\s+here['']?s?\s+[a-z\s]{0,20}[:.]?\s*/i,
    // "Sure!" / "Sure." alone
    /^sure[,!.]\s*/i,
    /^of\s+course[,!.]?\s*/i,
    /^certainly[,!.]?\s*/i,
    /^absolutely[,!.]?\s*/i,
    /^no\s+problem[,!.]?\s*/i,
    /^gladly[,!.]?\s*/i,
    // "Here is the simplified text:"
    /^here\s+is\s+the\s+simplified\s+(text|version|english|translation)[^a-z][^:]*[:.]?\s*/i,
    /^here\s+is\s+a\s+simplified\s+(text|version|english|translation)[^a-z][^:]*[:.]?\s*/i,
    /^here\s+is\s+my\s+simplified\s+(text|version)[^a-z][^:]*[:.]?\s*/i,
    // "Here's a simplified version:"
    /^here['']?s\s+(a|the|my)?\s*simplified\s+(text|version|english|translation)?[^a-z]*[:.]?\s*/i,
    /^here['']?s\s+(a|the|my)\s+(text|version|translation)\s+you\s+requested[^a-z]*[:.]?\s*/i,
    // "I've simplified the text:"
    /^i['']?ve\s+simplified\s+(the\s+)?(text|it)[^a-z]*[:.]?\s*/i,
    // "I have simplified:"
    /^i\s+have\s+simplified\s+(the\s+)?(text|it)?[^a-z]*[:.]?\s*/i,
    // "The simplified text is:"
    /^the\s+simplified\s+(text|version)\s+is[^a-z]*[:.]?\s*/i,
    // Labels
    /^simplified\s+(text|version|english)[:\s]+/i,
    /^in\s+simple\s+english[:\s]+/i,
    /^simple\s+english[:\s]+/i,
    /^simple\s+version[:\s]+/i,
    /^simplified[:\s]+/i,
    /^translation[:\s]+/i,
    /^output[:\s]+/i,
    /^answer[:\s]+/i,
    /^result[:\s]+/i,
  ];

  // Apply patterns in a loop until nothing changes
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of preamblePatterns) {
      const newText = text.replace(pattern, "");
      if (newText !== text) {
        text = newText.trim();
        changed = true;
        break;
      }
    }
  }

  // 3. Catch-all fallback: if text still starts with a known preamble word,
  //    split on the first newline or first ". " after typical preamble length
  //    and take everything after it.
  if (/^(sure|of course|certainly|absolutely|here is|here's|i've)/i.test(text)) {
    // Try split on newline first
    const newlineIdx = text.indexOf("\n");
    if (newlineIdx > 0 && newlineIdx < 120) {
      text = text.slice(newlineIdx).trim();
    } else {
      // Split on ". " or ": " or ":\n" after 20 chars (skip past the preamble sentence)
      const splitMatch = text.match(/^.{15,120}[.:]\s+/);
      if (splitMatch) {
        text = text.slice(splitMatch[0].length).trim();
      }
    }
  }

  // 4. Strip suffix meta-commentary
  const suffixPatterns = [
    /\s*\n+note[:\s].*/is,
    /\s*\(note[:\s][^)]*\)\s*$/i,
    /\s*\*\s*note[:\s].*/is,
    /\s*i\s+hope\s+this\s+helps.*$/i,
    /\s*let\s+me\s+know\s+if.*$/i,
    /\s*feel\s+free\s+to.*$/i,
    /\s*please\s+note\s+that.*$/i,
    /\s*this\s+(is\s+a\s+)?simplified\s+version.*$/i,
  ];
  for (const pattern of suffixPatterns) {
    text = text.replace(pattern, "").trim();
  }

  // 5. Strip surrounding quotes
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

// Call Ollama / Local API
async function callLocalLLM(text, settings) {
  const endpoint = settings.endpoint.replace(/\/+$/, "");
  const model = settings.model || "gemma:2b";
  const systemPrompt = settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
  const temperature = settings.temperature !== undefined ? parseFloat(settings.temperature) : 0.2;

  let url = "";
  let payload = {};

  if (settings.provider === "openai_compatible") {
    url = `${endpoint}/v1/chat/completions`;
    payload = {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: temperature
    };
  } else {
    // Default Ollama Native API: /api/generate
    url = `${endpoint}/api/generate`;
    payload = {
      model: model,
      prompt: `${systemPrompt}\n\nOriginal Text:\n${text}\n\nSimplified Text:`,
      stream: false,
      options: {
        temperature: temperature
      }
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for local model

    console.log(`[SimpleEN Background] Sending request to local LLM (${model}) at ${url}...`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[SimpleEN Background] HTTP Error ${response.status}:`, errText);
      if (response.status === 403) {
        throw new Error("HTTP 403 Forbidden: Ollama rejected request origin. Run Ollama with `OLLAMA_ORIGINS=\"*\" ollama serve`");
      }
      if (response.status === 404) {
        // Automatic fallback: query installed models and auto-switch if gemma2:2b or similar is found
        try {
          const health = await checkHealth(endpoint);
          if (health.online && health.models.length > 0) {
            const fallbackModel = health.models.find(m => m.includes("gemma")) || health.models[0];
            if (fallbackModel && fallbackModel !== model) {
              console.log(`[SimpleEN Background] Auto-switching from '${model}' to detected installed model '${fallbackModel}'`);
              chrome.storage.sync.set({ model: fallbackModel });
              return await callLocalLLM(text, { ...settings, model: fallbackModel });
            }
          }
        } catch (e) {
          console.warn("[SimpleEN Background] Fallback check failed:", e);
        }
        throw new Error(`HTTP 404: Model '${model}' not found in Ollama. Run 'ollama pull ${model}' or check 'ollama list' in terminal.`);
      }
      throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
    }

    const data = await response.json();
    let rawOutput = "";

    if (settings.provider === "openai_compatible") {
      rawOutput = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
    } else {
      rawOutput = data.response || "";
    }

    const cleaned = cleanSimplifiedText(rawOutput);
    console.log(`[SimpleEN Background] Simplified result received (${cleaned.length} chars).`);
    return cleaned;
  } catch (err) {
    console.error("[SimpleEN Background] LLM Call Failed:", err);
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Local model took too long to respond.");
    }
    if (err.message && err.message.includes("Failed to fetch")) {
      throw new Error("Cannot connect to Ollama (Failed to fetch). Ensure Ollama is running (`ollama serve`) and CORS is enabled (`OLLAMA_ORIGINS=\"*\"`).");
    }
    throw new Error(`Local model error: ${err.message}`);
  }
}

// Check backend health & get available models
async function checkHealth(endpoint) {
  const baseUrl = (endpoint || "http://localhost:11434").replace(/\/+$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (!res.ok) {
      return { online: false, error: `HTTP ${res.status}`, models: [] };
    }
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { online: true, models: models };
  } catch (err) {
    // Try checking /v1/models for OpenAI compatible servers (LM Studio, LocalAI)
    try {
      const res2 = await fetch(`${baseUrl}/v1/models`, { method: "GET" });
      if (res2.ok) {
        const data2 = await res2.json();
        const models2 = (data2.data || []).map(m => m.id);
        return { online: true, models: models2 };
      }
    } catch (e) {
      // Ignore fallback error
    }
    return { online: false, error: err.message, models: [] };
  }
}

// Handle Dictionary Definition (Bypasses Cache)
async function handleDefineText(text, settingsOverride) {
  const settings = settingsOverride || await getSettings();
  const dictionaryPrompt = `You are a dictionary. Define the word or phrase: '${text}'.
Provide the phonetic pronunciation, part of speech, and 1-2 clear definitions in simple English.
Format exactly like this example:
**word** (/wɜːrd/)
*noun*
1. a single distinct meaningful element of speech or writing.

Do NOT add any greetings, preamble, or conversational text. Output ONLY the formatted definition.`;

  // We override the system prompt for the dictionary feature
  const dictSettings = {
    ...settings,
    systemPrompt: dictionaryPrompt,
    temperature: 0.1 // very low temperature for factual definitions
  };

  try {
    const result = await callLocalLLM(text, dictSettings);
    return { success: true, result: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Process single simplification request with caching
async function handleSimplifyText(text, settingsOverride) {
  if (!text || text.trim().length === 0) {
    return { success: true, result: "" };
  }

  const settings = settingsOverride || await getSettings();
  const cacheKey = getCacheKey(settings.model, text);

  // Check memory cache
  if (memoryCache.has(cacheKey)) {
    return { success: true, result: memoryCache.get(cacheKey), cached: true };
  }

  // Check persistent chrome.storage.local
  const storageData = await chrome.storage.local.get([cacheKey]);
  if (storageData && storageData[cacheKey]) {
    memoryCache.set(cacheKey, storageData[cacheKey]);
    return { success: true, result: storageData[cacheKey], cached: true };
  }

  try {
    const simplified = await callLocalLLM(text, settings);
    if (simplified) {
      memoryCache.set(cacheKey, simplified);
      chrome.storage.local.set({ [cacheKey]: simplified });
    }
    return { success: true, result: simplified, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Message Listener for extension communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SIMPLIFY_TEXT") {
    handleSimplifyText(message.text, message.settings)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep async response channel open
  }

  if (message.action === "SIMPLIFY_BATCH") {
    (async () => {
      const settings = await getSettings();
      const results = [];
      const texts = message.texts || [];

      // Concurrency limit of 3 for local model stability
      const batchSize = 3;
      for (let i = 0; i < texts.length; i += batchSize) {
        const chunk = texts.slice(i, i + batchSize);
        const chunkPromises = chunk.map(item => handleSimplifyText(item.text, settings));
        const chunkResults = await Promise.all(chunkPromises);
        
        chunkResults.forEach((res, idx) => {
          const originalItem = chunk[idx];
          results.push({
            id: originalItem.id,
            success: res.success,
            result: res.result,
            error: res.error,
            cached: res.cached
          });
        });
      }
      sendResponse({ success: true, results });
    })();
    return true;
  }

  if (message.action === "CHECK_HEALTH") {
    checkHealth(message.endpoint)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ online: false, error: err.message, models: [] }));
    return true;
  }

  if (message.action === "CLEAR_CACHE") {
    memoryCache.clear();
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "GET_SETTINGS") {
    getSettings().then(s => sendResponse(s));
    return true;
  }

  // --- Dictionary Feature ---
  if (message.action === "DEFINE_TEXT") {
    (async () => {
      try {
        const settings = await getSettings();
        const definition = await handleDefineText(message.text, settings);
        sendResponse(definition);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // --- ElevenLabs TTS ---
  if (message.action === "TTS_SPEAK") {
    (async () => {
      try {
        const settings = await getSettings();
        const audioData = await elevenLabsTTS(message.text, settings);
        sendResponse({ success: true, audio: audioData });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "LIST_VOICES") {
    (async () => {
      try {
        const settings = await getSettings();
        const voices = await elevenLabsListVoices(settings);
        sendResponse({ success: true, voices });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// --- ElevenLabs TTS API ---

async function elevenLabsTTS(text, settings) {
  const apiKey = settings.elevenLabsApiKey;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not set. Go to Extension Options → ElevenLabs Settings to add your key.");
  }

  const voiceId = settings.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM";
  const modelId = settings.elevenLabsModelId || "eleven_multilingual_v2";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify({
      text: text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 401) {
      throw new Error("Invalid ElevenLabs API key. Check your key in Extension Options.");
    }
    if (response.status === 422) {
      throw new Error("Text too long or invalid for ElevenLabs TTS.");
    }
    throw new Error(`ElevenLabs API error (${response.status}): ${errBody}`);
  }

  // Convert audio response to base64 data URL for playback in content script
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:audio/mpeg;base64,${base64}`;
}

async function elevenLabsListVoices(settings) {
  const apiKey = settings.elevenLabsApiKey;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not set.");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: { "xi-api-key": apiKey }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices (${response.status})`);
  }

  const data = await response.json();
  return (data.voices || []).map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category || "unknown",
    preview_url: v.preview_url
  }));
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Also handle TTS via long-lived port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tts-port") return;
  activePorts.add(port);
  startKeepAlive();

  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
    stopKeepAlive();
  });

  port.onMessage.addListener(async (message) => {
    if (message.action === "TTS_SPEAK_PORT") {
      try {
        const settings = await getSettings();
        const audioData = await elevenLabsTTS(message.text, settings);
        try { port.postMessage({ type: "TTS_RESULT", success: true, audio: audioData, id: message.id }); } catch (e) {}
      } catch (err) {
        try { port.postMessage({ type: "TTS_RESULT", success: false, error: err.message, id: message.id }); } catch (e) {}
      }
    }
  });
});

// Extension installed / updated setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (items) => {
    if (Object.keys(items).length === 0) {
      chrome.storage.sync.set(DEFAULT_SETTINGS);
    }
  });
});
