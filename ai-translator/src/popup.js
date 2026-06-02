document.addEventListener('DOMContentLoaded', () => {

  // ── 构建目标语言自定义下拉（与翻译面板一致的样式与动画）──
  const TGT_LANGS = [
    ['zh-CN','🇨🇳 简体中文'], ['zh-TW','🇹🇼 繁体中文'], ['en','🇺🇸 英语'],
    ['ja','🇯🇵 日语'], ['ko','🇰🇷 韩语'], ['fr','🇫🇷 法语'],
    ['de','🇩🇪 德语'], ['es','🇪🇸 西班牙语'],
  ];
  const tgtMount = document.getElementById('targetLang-mount');
  tgtMount.replaceWith(createSelect(TGT_LANGS, 'zh-CN', 'targetLang'));

  // 点击其他处关闭打开的下拉
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ai-select')) {
      document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    }
  });

  // ── 加载已保存的设置 ──
  chrome.storage.sync.get(['apiBase','apiKey','model','targetLang','dismissOnScroll','panelMode','panelWidth','panelHeight'], (d) => {
    if (d.apiBase)    document.getElementById('apiBase').value    = d.apiBase;
    if (d.apiKey)     document.getElementById('apiKey').value     = d.apiKey;
    if (d.model)      document.getElementById('model').value      = d.model;
    if (d.targetLang) document.getElementById('targetLang').value = d.targetLang;
    if (d.panelWidth)  document.getElementById('panelWidth').value  = d.panelWidth;
    if (d.panelHeight) document.getElementById('panelHeight').value = d.panelHeight;

    // dismissOnScroll 默认 true（滚动关闭）
    const scrollMode = d.dismissOnScroll !== false ? 'scroll' : 'click';
    const dismissRadios = document.querySelectorAll('input[name="dismissMode"]');
    dismissRadios.forEach(r => { r.checked = r.value === scrollMode; });

    // panelMode 默认 modal
    const panelMode = d.panelMode || 'modal';
    const modeRadios = document.querySelectorAll('input[name="panelMode"]');
    modeRadios.forEach(r => { r.checked = r.value === panelMode; });
  });

  // ── 快捷预设按钮 ──
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('apiBase').value = btn.dataset.url;
      if (!document.getElementById('model').value) {
        document.getElementById('model').value = btn.dataset.model || '';
      }
    });
  });

  // ── 打开翻译面板 ──
  document.getElementById('btn-open-panel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PANEL' });
    window.close();
  });

  // ── 快捷键设置入口 ──
  document.getElementById('link-shortcuts')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ── 保存设置 ──
  document.getElementById('btn-save').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) { toast('⚠ 请填写 API Key'); return; }

    const selected = document.querySelector('input[name="dismissMode"]:checked');
    const dismissOnScroll = !selected || selected.value === 'scroll';

    const modeSelected = document.querySelector('input[name="panelMode"]:checked');
    const panelMode = modeSelected ? modeSelected.value : 'modal';

    const settings = {
      apiBase:        document.getElementById('apiBase').value.trim(),
      apiKey,
      model:          document.getElementById('model').value.trim() || 'gpt-4o-mini',
      targetLang:     document.getElementById('targetLang').value,
      dismissOnScroll,
      panelMode,
      panelWidth:     parseInt(document.getElementById('panelWidth').value) || 700,
      panelHeight:    parseInt(document.getElementById('panelHeight').value) || 230,
    };

    chrome.storage.sync.set(settings, () => toast('✓ 设置已保存'));
  });

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
  }
});

// 自定义下拉组件：返回带 value get/set 的元素，外部仍可用 .value 读写
function createSelect(langList, defaultVal, id) {
  const el = document.createElement('div');
  el.className = 'ai-select';
  el.id = id;
  let _value = defaultVal;

  const optHtml = langList.map(([v, l]) =>
    `<div class="ai-select-opt${v === defaultVal ? ' selected' : ''}" data-value="${v}">${l}</div>`
  ).join('');
  const initLabel = langList.find(([v]) => v === defaultVal)?.[1] || langList[0][1];

  el.innerHTML = `
    <button class="ai-select-btn" type="button">
      <span class="ai-select-label">${initLabel}</span>
      <span class="ai-select-arrow">▾</span>
    </button>
    <div class="ai-select-drop">${optHtml}</div>
  `;

  Object.defineProperty(el, 'value', {
    get() { return _value; },
    set(v) {
      _value = v;
      const label = langList.find(([lv]) => lv === v)?.[1] || v;
      el.querySelector('.ai-select-label').textContent = label;
      el.querySelectorAll('.ai-select-opt').forEach(o => {
        o.classList.toggle('selected', o.dataset.value === v);
      });
    }
  });

  el.querySelector('.ai-select-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    if (!wasOpen) el.classList.add('open');
  });

  el.querySelectorAll('.ai-select-opt').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.value = opt.dataset.value;
      el.classList.remove('open');
    });
  });

  return el;
}
