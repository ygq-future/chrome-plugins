document.addEventListener('DOMContentLoaded', () => {

  // ── 构建目标语言自定义下拉 ──
  const rawLangs = typeof SUPPORTED_LANGUAGES !== 'undefined' ? SUPPORTED_LANGUAGES : [
    { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
    { code: 'zh-TW', name: '繁体中文', flag: '🇹🇼' },
    { code: 'en',    name: '英语',     flag: '🇺🇸' },
    { code: 'ja',    name: '日语',     flag: '🇯🇵' },
    { code: 'ko',    name: '韩语',     flag: '🇰🇷' },
    { code: 'fr',    name: '法语',     flag: '🇫🇷' },
    { code: 'de',    name: '德语',     flag: '🇩🇪' },
    { code: 'es',    name: '西班牙语', flag: '🇪🇸' },
    { code: 'ru',    name: '俄语',     flag: '🇷🇺' },
  ];
  const TGT_LANGS = rawLangs.map(l => [l.code, `${l.flag ? l.flag + ' ' : ''}${l.name}`]);

  const tgtMount = document.getElementById('targetLang-mount');
  const tgtSelect = createSelect(TGT_LANGS, 'zh-CN', 'targetLang', () => saveSettings());
  tgtMount.replaceWith(tgtSelect);

  // ── 构建模型选择单一下拉框（默认无假数据，仅在有保存值或获取后展示） ──
  const modelMount = document.getElementById('model-mount');
  const modelSelect = createSelect([], '', 'model', () => saveSettings(), '请点击「获取模型列表」选择模型');
  modelMount.replaceWith(modelSelect);

  // 点击其他处关闭打开的下拉
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ai-select')) {
      document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    }
  });

  // ── 加载已保存的设置 ──
  chrome.storage.sync.get(['apiBase','apiKey','model','targetLang','dismissOnScroll','panelMode','panelWidth','panelHeight'], (d) => {
    if (d.apiBase)     document.getElementById('apiBase').value    = d.apiBase;
    if (d.apiKey)      document.getElementById('apiKey').value     = d.apiKey;
    if (d.model)       modelSelect.value                           = d.model;
    if (d.targetLang)  tgtSelect.value                             = d.targetLang;
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

  // ── 自动保存（输入即生效） ──
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 150);
  }

  function saveSettings() {
    const selected = document.querySelector('input[name="dismissMode"]:checked');
    const dismissOnScroll = !selected || selected.value === 'scroll';

    const modeSelected = document.querySelector('input[name="panelMode"]:checked');
    const panelMode = modeSelected ? modeSelected.value : 'modal';

    const settings = {
      apiBase:        document.getElementById('apiBase').value.trim(),
      apiKey:         document.getElementById('apiKey').value.trim(),
      model:          modelSelect.value || '',
      targetLang:     tgtSelect.value || 'zh-CN',
      dismissOnScroll,
      panelMode,
      panelWidth:     parseInt(document.getElementById('panelWidth').value) || 680,
      panelHeight:    parseInt(document.getElementById('panelHeight').value) || 160,
    };

    chrome.storage.sync.set(settings, () => {
      showSaveStatus();
    });
  }

  let statusTimer = null;
  function showSaveStatus() {
    const status = document.getElementById('save-status');
    if (!status) return;
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.classList.remove('show');
    }, 1200);
  }

  // 监听所有输入框和单选框变化
  ['apiBase', 'apiKey', 'panelWidth', 'panelHeight'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', scheduleSave);
    el.addEventListener('blur', saveSettings);
  });

  document.querySelectorAll('input[name="dismissMode"]').forEach(r => {
    r.addEventListener('change', saveSettings);
  });

  document.querySelectorAll('input[name="panelMode"]').forEach(r => {
    r.addEventListener('change', saveSettings);
  });

  // ── 快捷预设按钮 ──
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('apiBase').value = btn.dataset.url;
      saveSettings();
    });
  });

  // ── 获取模型列表 ──
  const btnFetchModels = document.getElementById('btn-fetch-models');
  btnFetchModels?.addEventListener('click', () => {
    const apiBase = document.getElementById('apiBase').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();

    if (!apiKey) {
      toast('⚠ 请先填写 API Key');
      document.getElementById('apiKey').focus();
      return;
    }

    btnFetchModels.disabled = true;
    btnFetchModels.textContent = '获取中...';

    chrome.runtime.sendMessage(
      { type: 'FETCH_MODELS', payload: { apiBase, apiKey } },
      (res) => {
        btnFetchModels.disabled = false;
        btnFetchModels.textContent = '⚡ 获取模型列表';

        if (chrome.runtime.lastError) {
          toast('获取失败：后台通信错误');
          return;
        }

        if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
          const modelOpts = res.data.map(m => [m, m]);
          const current = modelSelect.value;
          const targetModel = modelOpts.some(([m]) => m === current) ? current : modelOpts[0][0];
          modelSelect.updateOptions(modelOpts, targetModel);
          saveSettings();
          toast(`✓ 成功获取 ${res.data.length} 个模型`);
        } else {
          toast('获取失败：' + (res?.error || '未返回有效模型列表'));
        }
      }
    );
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

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
  }
});

// 自定义下拉组件（支持动态刷新选项列表与占位提示）
function createSelect(initialList, defaultVal, id, onChange, placeholder = '请选择...') {
  const el = document.createElement('div');
  el.className = 'ai-select';
  el.id = id;
  let _list = [...initialList];
  let _value = defaultVal || '';

  function renderDropdown() {
    const drop = el.querySelector('.ai-select-drop');
    if (!drop) return;

    if (_list.length === 0) {
      drop.innerHTML = `<div class="ai-select-empty" style="padding: 12px 10px; color: #718096; font-size: 11px; text-align: center;">暂无选项，请点击上方按钮获取</div>`;
      return;
    }

    const optHtml = _list.map(([v, l]) =>
      `<div class="ai-select-opt${v === _value ? ' selected' : ''}" data-value="${v}">${l}</div>`
    ).join('');
    drop.innerHTML = optHtml;

    el.querySelectorAll('.ai-select-opt').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        el.value = opt.dataset.value;
        el.classList.remove('open');
      });
    });
  }

  function updateLabel() {
    const labelSpan = el.querySelector('.ai-select-label');
    if (!labelSpan) return;

    const item = _list.find(([v]) => v === _value);
    if (item) {
      labelSpan.textContent = item[1];
      labelSpan.style.color = '#e2e8f0';
    } else if (_value) {
      labelSpan.textContent = _value;
      labelSpan.style.color = '#e2e8f0';
    } else {
      labelSpan.textContent = placeholder;
      labelSpan.style.color = '#718096';
    }
  }

  el.innerHTML = `
    <button class="ai-select-btn" type="button">
      <span class="ai-select-label"></span>
      <span class="ai-select-arrow">▾</span>
    </button>
    <div class="ai-select-drop"></div>
  `;

  updateLabel();
  renderDropdown();

  Object.defineProperty(el, 'value', {
    get() { return _value; },
    set(v) {
      _value = v || '';
      if (v && !_list.some(([lv]) => lv === v)) {
        _list.unshift([v, v]);
      }
      updateLabel();
      renderDropdown();
      if (typeof onChange === 'function') onChange(_value);
    }
  });

  el.updateOptions = function(newList, selectedVal) {
    _list = [...newList];
    if (selectedVal && !_list.some(([v]) => v === selectedVal)) {
      _list.unshift([selectedVal, selectedVal]);
    }
    _value = selectedVal || _list[0]?.[0] || '';
    updateLabel();
    renderDropdown();
  };

  el.querySelector('.ai-select-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    if (!wasOpen) el.classList.add('open');
  });

  return el;
}
