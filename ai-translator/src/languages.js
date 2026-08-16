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
