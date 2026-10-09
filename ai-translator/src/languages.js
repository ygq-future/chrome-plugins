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

const BCP47_MAP = {
  'zh': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'en': 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-GB',
  'ja': 'ja-JP',
  'ja-jp': 'ja-JP',
  'ko': 'ko-KR',
  'ko-kr': 'ko-KR',
  'fr': 'fr-FR',
  'fr-fr': 'fr-FR',
  'de': 'de-DE',
  'de-de': 'de-DE',
  'es': 'es-ES',
  'es-es': 'es-ES',
  'ru': 'ru-RU',
  'ru-ru': 'ru-RU',
  'pt': 'pt-PT',
  'pt-pt': 'pt-PT',
  'pt-br': 'pt-BR',
  'it': 'it-IT',
  'it-it': 'it-IT',
  'ar': 'ar-SA',
  'ar-sa': 'ar-SA',
  'vi': 'vi-VN',
  'vi-vn': 'vi-VN',
  'th': 'th-TH',
  'th-th': 'th-TH',
  'id': 'id-ID',
  'id-id': 'id-ID',
  'hi': 'hi-IN',
  'hi-in': 'hi-IN',
  'nl': 'nl-NL',
  'nl-nl': 'nl-NL',
  'pl': 'pl-PL',
  'pl-pl': 'pl-PL',
  'tr': 'tr-TR',
  'tr-tr': 'tr-TR',
};

function normalizeBcp47(raw) {
  if (!raw || typeof raw !== 'string') return 'en-US';
  // 清理可能带有的标点、反引号或说明文本
  const clean = raw.trim().replace(/^[`'"]+|[`'"]+$/g, '').split(/[\s,，]+/)[0].trim();
  const lower = clean.toLowerCase();
  if (BCP47_MAP[lower]) return BCP47_MAP[lower];
  const prefix = lower.split('-')[0];
  if (BCP47_MAP[prefix]) return BCP47_MAP[prefix];
  return clean || 'en-US';
}

// Support CommonJS export if tested in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SUPPORTED_LANGUAGES, getLanguageName, normalizeBcp47, BCP47_MAP };
}
