# Simple English Translator (Gemma 2B Chrome Extension) ⚡

A modern Google Chrome extension (Manifest V3) that translates webpage HTML text from standard English into **Simple English** (CEFR A2/B1 level) using your locally hosted **Gemma 2B** model via Ollama or an OpenAI-compatible local server.

All webpage elements (images, SVG graphics, icons, CSS layout, formatting, interactive buttons, forms, and code blocks) remain intact while converting complex, dense paragraphs and text nodes into clear, simple English.

---

## Features 🚀

- **Local & Private LLM**: Communicates directly with your locally running `gemma:2b` model via Ollama (`http://localhost:11434`). Zero external API costs and 100% data privacy.
- **Selective Text Simplification**:
  - **Floating Action Button**: Highlight any text on a webpage to reveal a floating `⚡ Simplify` button.
  - **Whole Page Simplification**: One click in the toolbar popup translates all main article text and headings.
  - **Undo / Restore**: Toggle back to original text anytime with one click.
- **Smart DOM Text Preservation**:
  - Automatically skips code blocks (`<code>`, `<pre>`), math formulas, SVG icons, input fields, script/style tags, and images.
  - Preserves HTML styling and structural layout.
- **Customizable System Prompt & Temperature**: Tune simplification level, prompt rules, or target reading level via the Options page.
- **In-Memory & Storage Caching**: Instant response for previously translated text sections.

---

## Quick Setup Guide 🛠️

### Step 1: Install & Run Ollama with Gemma 2B

1. Download and install [Ollama](https://ollama.com).
2. Open your terminal and pull the Gemma 2B model:
   ```bash
   ollama pull gemma:2b
   ```
3. Start Ollama with `OLLAMA_ORIGINS="*"` so Chrome Extension requests are allowed:
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```
   *Note: Without `OLLAMA_ORIGINS="*"`, Ollama returns `HTTP 403 Forbidden` to Chrome Extension origins (`chrome-extension://...`).*

---

### Step 2: Load Extension in Google Chrome

1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the project directory: `/home/"user"/TranslateIntoSimpleEng` (or your local clone directory).
5. The **Simple English Translator (Gemma 2B)** extension icon will appear in your Chrome toolbar! ⚡

---

## How to Use 💡

1. **Toolbar Popup**:
   - Click the extension icon in your Chrome toolbar.
   - Check the connection status badge (it should show 🟢 *Online: gemma:2b*).
   - Click **Simplify Current Page** to translate the current page into Simple English.
   - Click **Restore Original Text** to bring back the original webpage text.

2. **Selected Text (Floating Button)**:
   - Highlight any complex paragraph or text selection on any website.
   - Click the floating `⚡ Simplify` button near your selection.
   - View the simplified text in a tooltip popup with options to **Copy** or **Replace in Page**.

3. **Extension Options**:
   - Click the ⚙️ gear icon in the extension popup or right-click the extension icon -> **Options**.
   - Customize API Endpoint (`http://localhost:11434`), Model Name (`gemma:2b`), System Prompt, Temperature, or Translation Style (*Replace in-place* vs *Side-by-side*).

---

## Project Structure 📁

```
TranslateIntoSimpleEng/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background/
│   └── background.js          # Service worker for Ollama API calls & caching
├── content/
│   ├── content_script.js      # DOM parser, text extractor, floating UI & inline replacer
│   └── content_style.css      # Content script UI styles (tooltips, floating buttons, toasts)
├── popup/
│   ├── popup.html             # Extension toolbar popup interface
│   ├── popup.js               # Popup script & health check handler
│   └── popup.css              # Popup styling
├── options/
│   ├── options.html           # Settings configuration page
│   ├── options.js             # Options form handler & model picker
│   └── options.css            # Options page styling
├── icons/
│   └── icon.svg               # Extension icon
├── tests/
│   └── test_extension.py      # Automated Python verification suite
└── README.md                  # Documentation
```


https://github.com/user-attachments/assets/2ba77b66-21f0-4403-8512-34a0af3d7836



https://github.com/user-attachments/assets/1dbf0485-2fc3-402f-9909-43039a9c1119


---

## License 📄

MIT License. Built for local AI translation workflows.
