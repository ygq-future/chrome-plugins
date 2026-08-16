# AI Translator UX & Feature Improvements Design Spec

- **Date:** 2026-08-16
- **Status:** Approved
- **Scope:** `ai-translator` extension & repository configuration

---

## 1. Objectives & Overview

This specification details 6 key improvements to the `ai-translator` Chrome extension and project configuration:
1. **Git Ignore Configuration**: Ignore irrelevant development/AI tool artifacts (`.claude/`, `.superpowers/`, etc.).
2. **Unified & Expanded Languages Definition (`src/languages.js`)**:
   - Extract a centralized `SUPPORTED_LANGUAGES` dataset shared across `background.js` (via `importScripts`), `content.js` (via `manifest.json content_scripts`), and `popup.html`.
   - Expand supported target languages to include Chinese (Simplified/Traditional), English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, Arabic, Vietnamese, Thai, Indonesian, Hindi, Dutch, Polish, Turkish, etc.
3. **AI Translation Panel Modern Vertical Layout & Auto-Detect Source Language**:
   - Redesign translation prompt to always auto-detect source language and output pure translation in the requested target language.
   - Restructure the translation panel (`Alt+Shift+T`) into a modern stacked (vertical) layout:
     - Top box: Source input textarea, with floating mini "Clear/Copy" buttons at bottom-left and a floating "⚡ 翻译" button at bottom-right.
     - Bottom box: Target translation textarea, with floating mini "Clear/Copy" buttons at bottom-left and a floating "Target Language" select at bottom-right.
4. **Card Dismissal & Race Condition Handling**:
   - Prevent the floating selection translation card from popping up if the user dismissed or closed it while it was in the loading state.
5. **Popup Configuration Instant Auto-Save**:
   - Make all settings in `popup.html` save immediately on input/change to `chrome.storage.sync`.
   - Remove the manual "保存设置" button and provide a subtle auto-save status indicator.
6. **Dynamic Model Fetching**:
   - Add a "获取模型列表" button next to the model input in popup settings.
   - Fetch models from `{apiBase}/v1/models` using the configured API Key via the background service worker.
   - Display a selectable dropdown list while keeping the option for manual input.

---

## 2. Detailed Technical Design

### 2.1 Git Ignore Updates (`.gitignore`)
Add:
```gitignore
# AI tooling & local assistant caches
.claude/
.superpowers/
```

### 2.2 Shared Languages Definition (`src/languages.js`)
Create a single source of truth for languages used by background worker, content script, and popup:
```javascript
// src/languages.js
const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁体中文', flag: '🇹🇼' },
  { code: 'en',    name: '英语',     flag: '🇺🇸' },
  { code: 'ja',    name: '日语',     flag: '🇯🇵' },
  { code: 'ko',    name: '韩语',     flag: '🇰🇷' },
  { code: 'fr',    name: '法语',     flag: '🇫🇷' },
  { code: 'de',    name: '德语',     flag: '🇩🇪' },
  { code: 'es',    name: '西班牙语', flag: '🇪🇸' },
  { code: 'ru',    name: '俄语',     flag: '🇷🇺' },
  { code: 'pt',    name: '葡萄牙语', flag: '🇵🇹' },
  { code: 'it',    name: '意大利语', flag: '🇮🇹' },
  { code: 'ar',    name: '阿拉伯语', flag: '🇸🇦' },
  { code: 'vi',    name: '越南语',   flag: '🇻🇳' },
  { code: 'th',    name: '泰语',     flag: '🇹🇭' },
  { code: 'id',    name: '印尼语',   flag: '🇮🇩' },
  { code: 'hi',    name: '印地语',   flag: '🇮🇳' },
  { code: 'nl',    name: '荷兰语',   flag: '🇳🇱' },
  { code: 'pl',    name: '波兰语',   flag: '🇵🇱' },
  { code: 'tr',    name: '土耳其语', flag: '🇹🇷' },
];

function getLanguageName(code) {
  const item = SUPPORTED_LANGUAGES.find(l => l.code === code);
  return item ? item.name : code;
}
```
- In `manifest.json`: Add `"src/languages.js"` before `"src/content.js"`.
- In `background.js`: Add `importScripts('languages.js');`.
- In `popup.html`: Add `<script src="languages.js"></script>` before `popup.js`.

### 2.2 AI Prompt & Background API Routing (`src/background.js`)

#### Prompt Redesign
Translate prompt no longer needs `sourceLang` specification. AI automatically detects source language and targets `targetLang`:
```javascript
const langMap = {
  'zh-CN': '简体中文', 'zh-TW': '繁体中文', 'en': '英语',
  'ja': '日语', 'ko': '韩语', 'fr': '法语', 'de': '德语', 'es': '西班牙语',
};
const target = langMap[targetLang] || targetLang || '简体中文';

const prompt = `你是一个专业且高效的翻译引擎。请将以下文本翻译为${target}，自动识别源语言。
翻译要求：
1. 准确传达原文含义，表达自然流畅，符合目标语言的语言习惯。
2. 只输出最终翻译结果，不要输出任何解释、说明、备注、前缀或额外标点。

待翻译文本：
${text}`;
```

#### New Message Handler: `FETCH_MODELS`
- **Payload**: `{ apiBase, apiKey }`
- **Endpoint**: `${baseUrl}/v1/models` (GET request with `Authorization: Bearer ${apiKey}`)
- **Timeout**: 15,000 ms
- **Response Handling**:
  - Extract array of models: `data.map(m => m.id)`
  - Sort alphabetically or place common chat models (e.g. `gpt-4o`, `deepseek-chat`, `claude-3-5-sonnet`) first.
  - Return `{ success: true, models: [...] }` or `{ success: false, error: '...' }`.

---

### 2.3 Translation Card Dismissal Cancellation (`src/content.js`)

#### Problem
When the user clicks "AI 翻译", an asynchronous translation request is sent to `background.js`. If the user cancels the card before the response arrives (e.g., clicks close `×`, clicks outside, or scrolls), the background message callback still calls `showCard('result', ...)` which mounts a brand new card.

#### Solution
1. Maintain a module-level request counter:
   ```javascript
   let activeCardRequestId = 0;
   ```
2. When starting translation in `doTranslate()`:
   ```javascript
   const reqId = ++activeCardRequestId;
   ```
3. When closing cards in `closeAll()`:
   ```javascript
   activeCardRequestId = 0;
   ```
4. In the `TRANSLATE` message callback:
   ```javascript
   if (reqId !== activeCardRequestId) {
     // User cancelled / closed the card while waiting; do not display result
     return;
   }
   ```

---

### 2.4 Translation Panel Redesign (`src/content.js` & `src/content.css`)

#### UI Layout (Vertical Stack)
```html
<div class="ai-panel-wrap">
  <!-- Header -->
  <div class="ai-panel-hd">
    <div class="ai-panel-hd-left">
      <div class="ai-panel-logo">AI</div>
      <span class="ai-panel-title">AI 翻译面板</span>
      <span class="ai-panel-badge">自动识别源语言</span>
    </div>
    <div class="ai-panel-hd-right">
      <span class="ai-panel-shortcut"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 翻译</span>
      <button class="ai-panel-close" id="ai-panel-close-title">×</button>
    </div>
  </div>

  <!-- Body -->
  <div class="ai-panel-bd">
    <!-- Top: Source editor box -->
    <div class="ai-panel-box ai-source-box">
      <textarea id="ai-panel-src-text" placeholder="输入要翻译的文本..." spellcheck="false"></textarea>
      <div class="ai-panel-box-toolbar">
        <div class="ai-box-actions-left">
          <button class="ai-mini-btn" data-action="clear" data-side="src" title="清空">清空</button>
          <button class="ai-mini-btn" data-action="copy" data-side="src" title="复制">复制</button>
        </div>
        <div class="ai-box-actions-right">
          <button id="ai-panel-translate" class="ai-btn-translate-primary" title="快捷键 Ctrl+Enter">
            <span class="btn-icon">⚡</span>
            <span class="btn-text">翻译</span>
            <span class="btn-spinner"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom: Target editor box -->
    <div class="ai-panel-box ai-target-box">
      <textarea id="ai-panel-tgt-text" placeholder="翻译结果..." spellcheck="false"></textarea>
      <div class="ai-panel-box-toolbar">
        <div class="ai-box-actions-left">
          <button class="ai-mini-btn" data-action="clear" data-side="tgt" title="清空">清空</button>
          <button class="ai-mini-btn" data-action="copy" data-side="tgt" title="复制">复制</button>
        </div>
        <div class="ai-box-actions-right">
          <div id="ai-panel-tgt-lang"></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

#### CSS & Styling
- `.ai-panel-box`: `position: relative; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: #161b27; transition: border-color 0.15s;`
- Focus state on textarea highlights parent `.ai-panel-box`.
- Textarea styling: `width: 100%; border: none; background: transparent; padding: 12px 14px 44px 14px; color: #e2e8f0; resize: none;`
- `.ai-panel-box-toolbar`: `position: absolute; left: 10px; right: 10px; bottom: 8px; display: flex; justify-content: space-between; align-items: center; pointer-events: none;`
- Buttons inside toolbar: `pointer-events: auto;`
- Mini buttons (`.ai-mini-btn`): compact, modern, translucent dark buttons with hover highlight.
- Translate button (`.ai-btn-translate-primary`): vibrant blue gradient with hover shine and spinning indicator when translating.
- Target language dropdown in bottom box: compact custom dropdown matching design system.

---

### 2.5 Popup Settings & Model Fetching (`src/popup.html` & `src/popup.js`)

#### Instant Auto-Save
- Remove `#btn-save`.
- Add auto-save handler on:
  - Text inputs: `input` event (debounced 150ms) and `blur` event (immediate).
  - Radios & Selects: `change` event.
  - Preset buttons: click triggers immediate save after updating inputs.
- Header status badge: Display a subtle "✓ 已自动保存" indicator that fades out smoothly after each change.

#### Fetch Models Feature
- In `popup.html`, next to the Model input field:
  - Add a button `#btn-fetch-models` ("⚡ 获取模型").
  - Add a container `#model-select-container` for displaying fetched models.
- In `popup.js`:
  - When `#btn-fetch-models` is clicked:
    - Check if `apiKey` is provided; if not, show toast "请先填写 API Key".
    - Change button state to "获取中...".
    - Send `chrome.runtime.sendMessage({ type: 'FETCH_MODELS', payload: { apiBase, apiKey } })`.
    - On success: Populate the model select dropdown, show toast "已获取 N 个模型", set current model.
    - On failure: Show error toast (e.g. "获取模型失败: 401 (Key 无效)").

---

## 3. Verification & Testing Strategy

1. **`.gitignore`**: Verify `git status` no longer reports `.claude/` or other untracked cache files.
2. **AI Translation & Auto-detection**:
   - Open translation panel (`Alt+Shift+T`), enter English/Japanese/French text, select Target Language "简体中文", press `Ctrl+Enter` or click "⚡ 翻译", verify translation output.
   - Verify mini clear and copy buttons on both top and bottom boxes.
3. **Card Loading Cancellation**:
   - Select text on a page, click "AI 翻译", immediately click `×` or click outside while "翻译中…" is spinning.
   - Verify that after the API request finishes, no card is re-opened.
4. **Popup Auto-Save**:
   - Open popup, type in API Base or API Key, switch tabs / blur, reopen popup, verify all inputs are preserved.
   - Switch target language, dismiss mode, panel mode, and panel size; verify all settings persist.
5. **Model Fetching**:
   - Input valid API Key & Base URL, click "⚡ 获取模型", verify models are populated and selectable.
