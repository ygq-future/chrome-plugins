document.addEventListener('DOMContentLoaded', () => {

  // ── 加载已保存的设置 ──
  chrome.storage.sync.get(['apiBase','apiKey','model','targetLang','dismissOnScroll','panelMinHeight','panelMaxHeight'], (d) => {
    if (d.apiBase)    document.getElementById('apiBase').value    = d.apiBase;
    if (d.apiKey)     document.getElementById('apiKey').value     = d.apiKey;
    if (d.model)      document.getElementById('model').value      = d.model;
    if (d.targetLang) document.getElementById('targetLang').value = d.targetLang;
    if (d.panelMinHeight) document.getElementById('panelMinHeight').value = d.panelMinHeight;
    if (d.panelMaxHeight) document.getElementById('panelMaxHeight').value = d.panelMaxHeight;

    // dismissOnScroll 默认 true（滚动关闭）
    const scrollMode = d.dismissOnScroll !== false ? 'scroll' : 'click';
    const radios = document.querySelectorAll('input[name="dismissMode"]');
    radios.forEach(r => { r.checked = r.value === scrollMode; });
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

    const settings = {
      apiBase:        document.getElementById('apiBase').value.trim(),
      apiKey,
      model:          document.getElementById('model').value.trim() || 'gpt-4o-mini',
      targetLang:     document.getElementById('targetLang').value,
      dismissOnScroll,
      panelMinHeight: parseInt(document.getElementById('panelMinHeight').value) || 100,
      panelMaxHeight: parseInt(document.getElementById('panelMaxHeight').value) || 500,
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
