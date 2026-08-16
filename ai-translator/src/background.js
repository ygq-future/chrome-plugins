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
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' }).catch(() => {
        // 忽略（内容脚本未加载时的报错）
      });
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

  const tgtCode = targetLang || settings?.targetLang || 'zh-CN';
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

  // 排序：常用推荐模型排在前面，其余按字母排序
  modelIds.sort((a, b) => {
    const isSpecialA = /^(gpt-|deepseek|claude|gemini|llama|qwen)/i.test(a);
    const isSpecialB = /^(gpt-|deepseek|claude|gemini|llama|qwen)/i.test(b);
    if (isSpecialA && !isSpecialB) return -1;
    if (!isSpecialA && isSpecialB) return 1;
    return a.localeCompare(b);
  });

  return modelIds;
}

