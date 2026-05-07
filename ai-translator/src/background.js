// Background Service Worker
// 在后台处理 API 请求，可绕过页面 CORS 限制

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应，必须 return true
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(null, data => sendResponse(data));
    return true;
  }
});

async function handleTranslation({ text, settings }) {
  const { apiBase, apiKey, model, targetLang } = settings;

  if (!apiKey) throw new Error('请先在插件设置中填写 API Key');

  const baseUrl = (apiBase || 'https://api.openai.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const langMap = {
    'zh-CN': '简体中文', 'zh-TW': '繁体中文', 'en': '英语',
    'ja': '日语', 'ko': '韩语', 'fr': '法语', 'de': '德语', 'es': '西班牙语',
  };
  const langName = langMap[targetLang] || targetLang || '简体中文';
  const prompt = `将以下文本翻译成${langName}，只返回翻译结果，不解释，不加前缀：\n\n${text}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
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
