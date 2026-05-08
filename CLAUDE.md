# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Chrome extension (Manifest V3) for AI-powered text-selection translation. Supports any OpenAI-compatible API (OpenAI, DeepSeek, Groq, Gemini, etc.). Licensed under Apache 2.0.

## Key files and architecture

```
ai-translator/
├── manifest.json          # Extension config: permissions, content_scripts, commands, service_worker
├── src/
│   ├── background.js      # Service worker — handles all API calls and message routing
│   ├── content.js          # Content script — text selection UI, floating translation card, translation panel
│   ├── content.css         # All injected UI styles (~500 lines)
│   ├── popup.html          # Settings popup (API config, dismiss mode, target language)
│   └── popup.js            # Settings popup logic — reads/writes chrome.storage.sync
└── icons/                  # Extension icons (16/48/128)
```

## Message flow

1. **Text selection translation**: user selects text → `content.js` shows floating "AI 翻译" button → click triggers `GET_SETTINGS` message to background → then `TRANSLATE` message with text + settings → background makes OpenAI-compatible API call → result rendered in floating card.

2. **Translation panel** (keyboard shortcut): `Alt+Shift+T` / `Cmd+Shift+T` triggers `chrome.commands` in `background.js` → relays `TOGGLE_PANEL` to content script → content script builds/shows a full panel with source/target language selects, dual textareas, and bidirectional translation.

3. **Settings** are persisted in `chrome.storage.sync`. Both content script and popup read/write them, and content script listens for `storage.onChanged` to react in real time.

## API translation layer (`background.js`)

- Endpoint: `{apiBase}/v1/chat/completions` (OpenAI chat-completion format)
- Uses a language name map (`zh-CN` → `简体中文`, etc.) to construct the translation prompt
- Maps HTTP status codes to Chinese-language hints (401/429/404)
- By default routes through the service worker to bypass page CORS restrictions

## Development notes

- This is a plain JS project with no build step, no package manager, no dependencies. Edit files directly, then load the `ai-translator/` directory as an unpacked extension in `chrome://extensions`.
- The content script runs at `document_idle` on all URLs. UI elements use high z-index values (2147483646/2147483647) and prefix all IDs/classes with `ai-` to avoid collisions.
- The `isOurUI()` helper in content.js gates all click-outside-to-close and scroll-to-close behavior — always add new UI IDs to that check.
- `chrome.runtime.sendMessage` callbacks may fail silently if the other side isn't listening; the code uses `chrome.runtime.lastError` checks and `.catch(() => {})` on the sender side.
