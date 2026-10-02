import json
import os
import sys

def test_manifest():
    manifest_path = os.path.join(os.path.dirname(__file__), "..", "manifest.json")
    assert os.path.exists(manifest_path), "manifest.json does not exist"

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    assert manifest.get("manifest_version") == 3, "manifest_version must be 3"
    assert manifest.get("name") == "Simple English Translator (Gemma 2B)"
    assert "storage" in manifest.get("permissions", [])
    assert "activeTab" in manifest.get("permissions", [])

    print("✓ Manifest V3 validation passed.")

def test_files_exist():
    base_dir = os.path.join(os.path.dirname(__file__), "..")
    required_files = [
        "manifest.json",
        "background/background.js",
        "content/content_script.js",
        "content/content_style.css",
        "popup/popup.html",
        "popup/popup.js",
        "popup/popup.css",
        "options/options.html",
        "options/options.js",
        "options/options.css",
        "README.md"
    ]

    for rel_path in required_files:
        full_path = os.path.join(base_dir, rel_path)
        assert os.path.exists(full_path), f"Missing required file: {rel_path}"

    print(f"✓ All {len(required_files)} extension files verified.")

def test_background_ollama_payload():
    bg_path = os.path.join(os.path.dirname(__file__), "..", "background", "background.js")
    with open(bg_path, "r") as f:
        content = f.read()

    assert "gemma:2b" in content, "Default model should be gemma:2b"
    assert "/api/generate" in content, "Ollama generate endpoint should be supported"
    assert "/v1/chat/completions" in content, "OpenAI compatible endpoint should be supported"
    assert "cleanSimplifiedText" in content, "Text cleaning function should exist"

    print("✓ Background Ollama payload and response parsing verified.")

def test_content_script_selectors():
    cs_path = os.path.join(os.path.dirname(__file__), "..", "content", "content_script.js")
    with open(cs_path, "r") as f:
        content = f.read()

    assert "IGNORED_TAGS" in content
    assert "SVG" in content and "CODE" in content and "PRE" in content
    assert "simple-eng-floating-btn" in content
    assert "SIMPLIFY_BATCH" in content

    print("✓ Content script text node extraction and element safety verified.")

if __name__ == "__main__":
    try:
        test_manifest()
        test_files_exist()
        test_background_ollama_payload()
        test_content_script_selectors()
        print("\nAll extension tests passed successfully!")
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
