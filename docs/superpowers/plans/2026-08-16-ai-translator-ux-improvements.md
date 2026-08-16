# AI Translator UX & Feature Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 key UX optimizations and new features for `ai-translator`: exclude irrelevant files in `.gitignore`, centralize & expand supported target languages, modernize the translation panel into a vertical layout with AI auto-detected source language, eliminate post-cancellation card popups, make popup settings auto-save in real time, and add dynamic model fetching.

**Architecture:** Plain JavaScript Manifest V3 Chrome Extension without build tools. Centralized language dictionary in `src/languages.js` referenced by background worker, content script, and popup. Background service worker handles OpenAI-compatible `/v1/chat/completions` and `/v1/models`. Message-based synchronization with `chrome.storage.sync`.

**Tech Stack:** JavaScript (ES6+), Chrome Extension Manifest V3, HTML5, CSS3.

---

### Task 1: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Edit `.gitignore` to add `.claude/` and assistant artifacts**

Add the following to `.gitignore`:
```gitignore
# AI tooling & assistant caches
.claude/
.superpowers/
```

- [ ] **Step 2: Verify git status**

Run: `git status`
Expected: `.claude/` is no longer listed in untracked files.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore to exclude .claude and .superpowers"
```

---

### Task 2: Create Shared Languages Module (`src/languages.js`) & Update Manifest

**Files:**
- Create: `ai-translator/src/languages.js`
- Modify: `ai-translator/manifest.json`

- [ ] **Step 1: Create `src/languages.js` with comprehensive supported languages**

Write `ai-translator/src/languages.js`:
```javascript
// Shared Language Constants for AI Translator
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
  return item ? item.name : (code || '简体中文');
}

// Support CommonJS export if tested in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SUPPORTED_LANGUAGES, getLanguageName };
}
```

- [ ] **Step 2: Update `manifest.json` content_scripts list**

In `ai-translator/manifest.json`:
```json
    {
      "matches": ["<all_urls>"],
      "js": ["src/languages.js", "src/content.js"],
      "css": ["src/content.css"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 3: Commit**

```bash
git add ai-translator/src/languages.js ai-translator/manifest.json
git commit -m "feat(ai-translator): add centralized languages module and register in manifest"
```

---

### Task 3: Enhance Background Worker with Auto-detection Prompt & Model Fetching (`src/background.js`)

**Files:**
- Modify: `ai-translator/src/background.js`

- [ ] **Step 1: Update `background.js` to import `languages.js`, refine translation prompt, and handle `FETCH_MODELS`**

Update `ai-translator/src/background.js`:
```javascript
// Background Service Worker
// 在后台处理 API 请求，可绕过页面 CORS 限制
try {
  importScripts('languages.js');
} catch (e) {
  // Ignore in environments where importScripts is not available
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应，必须 return true
  }

  if (message.type === 'FETCH_MODELS') {
    handleFetchModels(message.payload)
      .then(models => sendResponse({ success: true, data: models }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(null, data => sendResponse(data));
    return true;
  }

  if (message.type === 'TOGGLE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' }).catch(() => {});
    });
  }
});

// ─── 快捷键：打开翻译面板 ─────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-translate-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' }).catch(() => {});
    });
  }
});

const REQUEST_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时，请重试');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleTranslation({ text, settings, targetLang }) {
  const { apiBase, apiKey, model } = settings || {};

  if (!apiKey) throw new Error('请先在插件设置中填写 API Key');

  const baseUrl = (apiBase || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const tgtCode = targetLang || settings.targetLang || 'zh-CN';
  const targetName = typeof getLanguageName === 'function' ? getLanguageName(tgtCode) : '简体中文';

  const prompt = `你是一个专业且高效的翻译引擎。请将以下文本翻译为${targetName}，自动识别源语言。
翻译要求：
1. 准确传达原文含义，表达自然流畅，符合目标语言的语言习惯。
2. 只输出最终翻译结果，不要输出任何解释、说明、备注、前缀或额外标点。

待翻译文本：
${text}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.3,
    }),
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    let hint = '';
    if (response.status === 401) hint = '（API Key 无效或过期）';
    else if (response.status === 429) hint = '（请求过于频繁，请稍后再试）';
    else if (response.status === 404) hint = '（模型名称或 API 地址错误）';
    throw new Error(`请求失败 ${response.status}${hint}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error('API 返回内容为空');
  return result;
}

async function handleFetchModels({ apiBase, apiKey }) {
  if (!apiKey) throw new Error('请先填写 API Key');

  const baseUrl = (apiBase || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/models`;

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  }, 15000);

  if (!response.ok) {
    let hint = '';
    if (response.status === 401) hint = '（API Key 无效）';
    else if (response.status === 404) hint = '（接口地址不支持获取模型）';
    throw new Error(`获取模型失败 ${response.status}${hint}`);
  }

  const resData = await response.json();
  const list = Array.isArray(resData.data) ? resData.data : (Array.isArray(resData) ? resData : []);
  const modelIds = list
    .map(item => typeof item === 'string' ? item : item?.id)
    .filter(Boolean);

  // 简单排序：常用的模型排在前面
  modelIds.sort((a, b) => {
    const isSpecialA = /^(gpt-|deepseek|claude|gemini|llama|qwen)/i.test(a);
    const isSpecialB = /^(gpt-|deepseek|claude|gemini|llama|qwen)/i.test(b);
    if (isSpecialA && !isSpecialB) return -1;
    if (!isSpecialA && isSpecialB) return 1;
    return a.localeCompare(b);
  });

  return modelIds;
}
```

- [ ] **Step 2: Commit**

```bash
git add ai-translator/src/background.js
git commit -m "feat(ai-translator): upgrade translation prompt with auto-detect and add FETCH_MODELS handler"
```

---

### Task 4: Fix Selection Translation Loading Dismissal & Race Conditions (`src/content.js`)

**Files:**
- Modify: `ai-translator/src/content.js`

- [ ] **Step 1: Add request ID tracking and cancellation validation to `doTranslate` and `closeAll`**

In `ai-translator/src/content.js`:
1. Add `let activeCardRequestId = 0;` at top scope.
2. In `doTranslate()`:
   - Increment `const currentReqId = ++activeCardRequestId;`
   - In `TRANSLATE` callback, verify `if (currentReqId !== activeCardRequestId) return;` and ensure `#ai-tr-card` is present.
3. In `closeAll()`:
   - Reset `activeCardRequestId = 0;`
   - Remove elements `#ai-tr-btn` and `#ai-tr-card`.

- [ ] **Step 2: Commit**

```bash
git add ai-translator/src/content.js
git commit -m "fix(ai-translator): prevent translation card from popping up after dismissal during loading"
```

---

### Task 5: Redesign Translation Panel UI (Vertical Stack Layout & Styles)

**Files:**
- Modify: `ai-translator/src/content.js`
- Modify: `ai-translator/src/content.css`

- [ ] **Step 1: Update Panel structure and logic in `content.js`**

Implement the new vertical stack layout in `content.js`:
- Top Box: Source Textarea with floating Clear/Copy on bottom-left, floating Translate Button (`#ai-panel-translate`) on bottom-right.
- Bottom Box: Target Textarea with floating Clear/Copy on bottom-left, floating Target Language Dropdown (`#ai-panel-tgt-lang`) on bottom-right.
- Use `SUPPORTED_LANGUAGES` from `languages.js` to populate the target language dropdown.
- Add real-time sync with `chrome.storage.sync.get('targetLang')`.
- Retain `Ctrl+Enter` shortcut to trigger translation.

- [ ] **Step 2: Update styles in `content.css` for the vertical layout and embedded toolbars**

Add CSS for:
- `.ai-panel-box`, `.ai-source-box`, `.ai-target-box`
- `.ai-panel-box-toolbar`, `.ai-box-actions-left`, `.ai-box-actions-right`
- `.ai-mini-btn` (compact, translucent, clear/copy buttons)
- `.ai-btn-translate-primary` (modern gradient with ⚡ icon and spinning state)
- Seamless focus rings and hover animations.

- [ ] **Step 3: Commit**

```bash
git add ai-translator/src/content.js ai-translator/src/content.css
git commit -m "feat(ai-translator): modernize translation panel into vertical stacked layout"
```

---

### Task 6: Modernize Settings Popup with Auto-Save and Model Fetching (`popup.html` & `popup.js`)

**Files:**
- Modify: `ai-translator/src/popup.html`
- Modify: `ai-translator/src/popup.js`

- [ ] **Step 1: Update `popup.html`**

In `ai-translator/src/popup.html`:
- Include `<script src="languages.js"></script>` before `popup.js`.
- Add auto-save badge indicator in header (`#save-status`).
- Update Model field: add a flex input group with input `#model` and button `#btn-fetch-models` ("⚡ 获取模型").
- Add model dropdown list container `#model-dropdown-container`.
- Remove `#btn-save` button (now instant auto-save).

- [ ] **Step 2: Update `popup.js`**

In `ai-translator/src/popup.js`:
- Populate target language dropdown using `SUPPORTED_LANGUAGES`.
- Implement debounced instant auto-save (`saveSettings()`) on `input` and `change` for all configuration controls.
- Display "已自动保存" feedback indicator on change.
- Implement `#btn-fetch-models` click event to send `FETCH_MODELS` to background, display dropdown/results, and allow single-click selection.

- [ ] **Step 3: Commit**

```bash
git add ai-translator/src/popup.html ai-translator/src/popup.js
git commit -m "feat(ai-translator): implement instant auto-save and dynamic model fetching in popup"
```

---

### Task 7: Comprehensive Verification & Functional Testing

**Files:**
- All modified extension files

- [ ] **Step 1: Inspect syntax and file structure**

Check that all files load correctly with valid JavaScript and manifest schema.

- [ ] **Step 2: Commit final improvements**

```bash
git status
```
