// AI 划词翻译 · Content Script
(function () {
  'use strict';

  let selectionText = '';
  let selectionRect = null;

  // ─── 读取「关闭方式」设置，决定是否绑定滚动关闭 ─────────────
  // dismissOnScroll: true = 滚动即关闭（默认）; false = 仅点击其他地方关闭
  let dismissOnScroll = true;

  function applyScrollSetting(val) {
    dismissOnScroll = val;
    if (dismissOnScroll) {
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    } else {
      window.removeEventListener('scroll', onScroll, { capture: true });
    }
  }

  function onScroll() { closeAll(); }

  // 初始化时读取设置
  chrome.storage.sync.get('dismissOnScroll', (d) => {
    // 未设置过则默认 true（滚动关闭）
    applyScrollSetting(d.dismissOnScroll !== false);
  });

  // 设置变更时实时生效（用户在 popup 改完不用刷新页面）
  chrome.storage.onChanged.addListener((changes) => {
    if ('dismissOnScroll' in changes) {
      applyScrollSetting(changes.dismissOnScroll.newValue !== false);
    }
  });

  // 点击页面任意位置关闭所有自定义下拉
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ai-select')) {
      document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    }
  });

  // ─── 监听划词结束 ────────────────────────────────────────────
  // 使用捕获阶段，确保在模态框阻止冒泡前捕获事件
  document.addEventListener('mouseup', (e) => {
    if (isOurUI(e.target)) return;

    // 稍微延迟，确保 selection 已更新
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (text && text.length >= 2) {
        selectionText = text;
        try {
          selectionRect = sel.getRangeAt(0).getBoundingClientRect();
        } catch {
          return;
        }
        showBtn();
      } else {
        closeAll();
      }
    }, 20);
  }, true);

  // 点击非 UI 区域 → 关闭（捕获阶段，确保在模态框中也能触发）
  document.addEventListener('mousedown', (e) => {
    if (!isOurUI(e.target)) closeAll();
  }, true);

  function isOurUI(el) {
    return !!el.closest?.('#ai-tr-btn, #ai-tr-card, #ai-tr-panel');
  }

  // ─── 显示翻译小按钮 ──────────────────────────────────────────
  function showBtn() {
    removeEl('ai-tr-btn');
    removeEl('ai-tr-card');

    const btn = document.createElement('div');
    btn.id = 'ai-tr-btn';
    btn.innerHTML = `
      <span class="ai-btn-icon">AI</span>
      <span class="ai-btn-label">翻译</span>
    `;
    placeNear(btn, selectionRect, 'btn');
    getMountTarget().appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      doTranslate();
    });
  }

  // ─── 触发翻译 ────────────────────────────────────────────────
  function doTranslate() {
    removeEl('ai-tr-btn');
    showCard('loading');

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
      if (!settings?.apiKey) {
        showCard('error', '请先点击插件图标，填写 API Key 并保存。', true);
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', payload: { text: selectionText, settings } },
        (res) => {
          if (chrome.runtime.lastError) {
            showCard('error', '插件通信异常，请刷新页面后重试。');
            return;
          }
          if (res?.success) {
            showCard('result', res.data, false, settings);
          } else {
            showCard('error', res?.error || '翻译失败，请检查设置。');
          }
        }
      );
    });
  }

  // ─── 翻译卡片 ────────────────────────────────────────────────
  function showCard(state, content = '', needSettings = false, settings = {}) {
    removeEl('ai-tr-card');

    const card = document.createElement('div');
    card.id = 'ai-tr-card';

    const preview = selectionText.length > 70
      ? selectionText.slice(0, 70) + '…'
      : selectionText;

    const modelLabel = settings.model || (settings.apiBase ? 'custom' : '');

    let bodyHtml = '';
    let footHtml = '';

    if (state === 'loading') {
      bodyHtml = `<div class="ai-loading"><div class="ai-spinner"></div><span>翻译中…</span></div>`;
    } else if (state === 'result') {
      bodyHtml = `<div class="ai-result">${esc(content)}</div>`;
      footHtml = `
        <div class="ai-card-foot">
          <span class="ai-model-tag">${esc(modelLabel)}</span>
          <button class="ai-copy-btn" id="ai-copy-btn">复制</button>
        </div>`;
    } else if (state === 'error') {
      const link = needSettings
        ? `<br><span class="ai-error-link" id="ai-open-settings">→ 打开设置</span>`
        : '';
      bodyHtml = `<div class="ai-error">${esc(content)}${link}</div>`;
    }

    card.innerHTML = `
      <div class="ai-card-head">
        <div class="ai-card-head-left">
          <div class="ai-card-logo">AI</div>
          <span class="ai-card-title-text">划词翻译</span>
        </div>
        <button class="ai-card-close" id="ai-card-close">×</button>
      </div>
      <div class="ai-card-source">${esc(preview)}</div>
      <div class="ai-card-body">${bodyHtml}</div>
      ${footHtml}
    `;

    placeNear(card, selectionRect, 'card');
    getMountTarget().appendChild(card);

    // 关闭
    card.querySelector('#ai-card-close')?.addEventListener('click', closeAll);

    // 拖拽
    const head = card.querySelector('.ai-card-head');
    let dragInfo = null;
    head?.addEventListener('mousedown', function(e) {
      if (e.target === card.querySelector('#ai-card-close')) return;
      const rect = card.getBoundingClientRect();
      dragInfo = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
      head.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragInfo) return;
      const dx = e.clientX - dragInfo.startX;
      const dy = e.clientY - dragInfo.startY;
      card.style.left = Math.max(0, Math.min(window.innerWidth - card.offsetWidth, dragInfo.left + dx)) + 'px';
      card.style.top = Math.max(0, Math.min(window.innerHeight - card.offsetHeight, dragInfo.top + dy)) + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (!dragInfo) return;
      dragInfo = null;
      head?.classList.remove('dragging');
    });

    // 复制
    card.querySelector('#ai-copy-btn')?.addEventListener('click', function () {
      navigator.clipboard.writeText(content).then(() => {
        this.textContent = '已复制 ✓';
        this.classList.add('copied');
        setTimeout(() => {
          this.textContent = '复制';
          this.classList.remove('copied');
        }, 2000);
      });
    });

    // 打开设置提示
    card.querySelector('#ai-open-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });
  }

  // ─── 元素定位（靠近选区） ────────────────────────────────────
  function placeNear(el, rect, type) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const GAP = 8;

    // 先附加到 DOM 获取实际尺寸
    el.style.visibility = 'hidden';
    el.style.position = 'fixed';
    document.body.appendChild(el);
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;
    el.remove();
    el.style.visibility = '';
    el.style.position = '';

    // 使用 viewport 坐标（position: fixed），避免模态框内滚动偏移问题
    let left = rect.left;
    let top  = rect.bottom + GAP;

    // 右侧溢出 → 左移
    if (left + elW > vw - 8) left = vw - elW - 8;
    if (left < 4) left = 4;

    // 下方溢出 → 显示在选区上方
    if (rect.bottom + elH + GAP > vh) {
      top = rect.top - elH - GAP;
      if (top < 4) top = rect.bottom + GAP; // 上方也不够就还是放下面
    }

    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  // ─── 挂载点 ────────────────────────────────────────────────────
  // 如果页面有打开的 <dialog>（showModal），元素必须挂到 dialog 内部，
  // 否则会被 dialog 的 top-layer ::backdrop 遮挡（top layer 无视 z-index）
  function getMountTarget() {
    const dialog = document.querySelector('dialog[open]');
    return dialog || document.body;
  }

  // ─── 工具 ────────────────────────────────────────────────────
  function removeEl(id) { document.getElementById(id)?.remove(); }
  function closeAll() { removeEl('ai-tr-btn'); removeEl('ai-tr-card'); }
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }

  // ─── 翻译面板（快捷键 Alt+Shift+T 触发）─────────────────────
  let panelVisible = false;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_PANEL') {
      panelVisible ? closePanel() : openPanel();
    }
  });

  function openPanel() {
    let wrap = document.getElementById('ai-tr-panel');
    if (!wrap) wrap = buildPanel();
    panelVisible = true;
    wrap.classList.remove('closing');
    wrap.style.display = '';
    // 应用面板模式
    chrome.storage.sync.get('panelMode', (d) => {
      const mode = d.panelMode || 'modal';
      if (mode === 'floating') {
        wrap.classList.add('ai-panel-floating');
        const inner = wrap.querySelector('.ai-panel-wrap');
        const w = inner.offsetWidth || 680;
        const h = inner.offsetHeight || 400;
        wrap.style.left = Math.max(0, (window.innerWidth - w) / 2) + 'px';
        wrap.style.top = Math.max(0, (window.innerHeight - h) / 2) + 'px';
      } else {
        wrap.classList.remove('ai-panel-floating');
        wrap.style.left = '';
        wrap.style.top = '';
      }
    });
    // 加载默认语言设置
    chrome.storage.sync.get('targetLang', (d) => {
      const src = wrap.querySelector('#ai-panel-src-lang');
      const tgt = wrap.querySelector('#ai-panel-tgt-lang');
      if (src.value !== 'en' || !src.dataset._inited) {
        src.value = 'en';
        src.dataset._inited = '1';
      }
      if (!tgt.dataset._inited) {
        tgt.value = d.targetLang || 'zh-CN';
        tgt.dataset._inited = '1';
      }
    });
    // 聚焦源语言输入框
    setTimeout(() => wrap.querySelector('#ai-panel-src-text')?.focus(), 100);
  }

  function closePanel() {
    if (!panelVisible) return;
    panelVisible = false;
    document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    const el = document.getElementById('ai-tr-panel');
    if (!el) return;
    el.classList.add('closing');
    setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('closing');
    }, 150);
  }

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
        e.preventDefault(); // prevent blur on textarea
        el.value = opt.dataset.value;
        el.classList.remove('open');
      });
    });

    return el;
  }

  function buildPanel() {
    const langList = [
      ['zh-CN','简体中文'], ['zh-TW','繁体中文'], ['en','英语'],
      ['ja','日语'], ['ko','韩语'], ['fr','法语'], ['de','德语'], ['es','西班牙语'],
    ];

    const div = document.createElement('div');
    div.id = 'ai-tr-panel';
    div.style.display = ''; // visible
    div.innerHTML = `
      <div class="ai-panel-bg"></div>
      <div class="ai-panel-wrap">
        <div class="ai-panel-hd">
          <span class="ai-panel-title">AI 翻译面板</span>
          <span class="ai-panel-shortcut">Alt+Shift+T</span>
          <button class="ai-panel-close" id="ai-panel-close-title">×</button>
        </div>
        <div class="ai-panel-bd">
          <div class="ai-panel-langs">
            <div id="ai-panel-src-lang"></div>
            <button id="ai-panel-swap" title="互换语言">⇄</button>
            <div id="ai-panel-tgt-lang"></div>
          </div>
          <div class="ai-panel-editors">
            <div class="ai-panel-col">
              <textarea id="ai-panel-src-text" placeholder="输入要翻译的文本..." spellcheck="false"></textarea>
            </div>
            <div class="ai-panel-mid">
              <div class="ai-translate-btn-group">
                <button class="ai-translate-dir ai-translate-to-left" title="翻译到左侧 (←)">◀</button>
                <button id="ai-panel-translate">
                  <span class="btn-text">翻译</span>
                  <span class="btn-spinner"></span>
                </button>
                <button class="ai-translate-dir ai-translate-to-right" title="翻译到右侧 (→)">▶</button>
              </div>
            </div>
            <div class="ai-panel-col">
              <textarea id="ai-panel-tgt-text" placeholder="翻译结果..." spellcheck="false"></textarea>
            </div>
          </div>
          <div class="ai-panel-footers">
            <div class="ai-panel-tbar">
              <button class="ai-tbar-btn" data-action="clear" data-side="src" title="清空">清空</button>
              <button class="ai-tbar-btn" data-action="copy" data-side="src" title="复制">复制</button>
            </div>
            <div class="ai-panel-mid-spacer"></div>
            <div class="ai-panel-tbar">
              <button class="ai-tbar-btn" data-action="clear" data-side="tgt" title="清空">清空</button>
              <button class="ai-tbar-btn" data-action="copy" data-side="tgt" title="复制">复制</button>
            </div>
          </div>
        </div>
      </div>
    `;

    getMountTarget().appendChild(div);

    // 替换为自定义下拉
    const srcPlaceholder = div.querySelector('#ai-panel-src-lang');
    const tgtPlaceholder = div.querySelector('#ai-panel-tgt-lang');
    const srcSelect = createSelect(langList, 'en', 'ai-panel-src-lang');
    const tgtSelect = createSelect(langList, 'zh-CN', 'ai-panel-tgt-lang');
    srcPlaceholder.replaceWith(srcSelect);
    tgtPlaceholder.replaceWith(tgtSelect);

    // 关闭
    const close = () => closePanel();
    div.querySelector('.ai-panel-bg').addEventListener('click', close);
    div.querySelector('#ai-panel-close-title').addEventListener('click', close);

    // 互换语言
    const srcText = div.querySelector('#ai-panel-src-text');
    const tgtText = div.querySelector('#ai-panel-tgt-text');
    const swapBtn = div.querySelector('#ai-panel-swap');
    swapBtn.addEventListener('click', () => {
      const srcLang = div.querySelector('#ai-panel-src-lang');
      const tgtLang = div.querySelector('#ai-panel-tgt-lang');
      [srcLang.value, tgtLang.value] = [tgtLang.value, srcLang.value];
      [srcText.value, tgtText.value] = [tgtText.value, srcText.value];
      swapBtn.classList.add('spinning');
      setTimeout(() => swapBtn.classList.remove('spinning'), 250);
    });

    // 方向按钮：强制指定翻译方向
    div.querySelector('.ai-translate-to-right').addEventListener('click', (e) => {
      e.stopPropagation();
      doPanelTranslate('right');
    });
    div.querySelector('.ai-translate-to-left').addEventListener('click', (e) => {
      e.stopPropagation();
      doPanelTranslate('left');
    });

    // 翻译按钮：默认向右翻译
    div.querySelector('#ai-panel-translate').addEventListener('click', () => {
      doPanelTranslate('right');
    });

    // Ctrl/Cmd+Enter 快捷键（默认向右翻译）
    srcText.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doPanelTranslate('right');
    });
    tgtText.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doPanelTranslate('right');
    });

    // Escape 关闭
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    // 应用用户配置的面板尺寸
    chrome.storage.sync.get(['panelWidth', 'panelHeight'], (d) => {
      const w = d.panelWidth || 700;
      const h = d.panelHeight || 230;
      div.querySelector('.ai-panel-wrap').style.width = w + 'px';
      srcText.style.height = h + 'px';
      tgtText.style.height = h + 'px';
    });

    // 清空 / 复制按钮
    div.querySelectorAll('.ai-tbar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const side = btn.dataset.side;
        const action = btn.dataset.action;
        const tb = side === 'src' ? srcText : tgtText;
        if (action === 'clear') {
          tb.value = '';
          tb.focus();
        } else if (action === 'copy') {
          if (!tb.value) return;
          navigator.clipboard.writeText(tb.value).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = orig; }, 1500);
          });
        }
      });
    });

    // ── 翻译（direction: 'right' = 左→右, 'left' = 右→左）──
    function doPanelTranslate(direction) {
      const btn = div.querySelector('#ai-panel-translate');
      if (btn.disabled) return; // 防抖：翻译中禁止重复触发

      let text, sourceLang, targetLang, resultBox;

      if (direction === 'left') {
        // 右 → 左
        text = tgtText.value.trim();
        if (!text) return;
        sourceLang = div.querySelector('#ai-panel-tgt-lang').value;
        targetLang = div.querySelector('#ai-panel-src-lang').value;
        resultBox = srcText;
      } else {
        // 左 → 右（默认）
        text = srcText.value.trim();
        if (!text) return;
        sourceLang = div.querySelector('#ai-panel-src-lang').value;
        targetLang = div.querySelector('#ai-panel-tgt-lang').value;
        resultBox = tgtText;
      }

      const btnText = btn.querySelector('.btn-text');
      const spinner = btn.querySelector('.btn-spinner');
      const btnGroup = div.querySelector('.ai-translate-btn-group');
      btnGroup.classList.add('is-translating');
      btnText.style.display = 'none';
      spinner.style.display = 'inline-block';
      btn.disabled = true;

      function finish() {
        btnGroup.classList.remove('is-translating');
        btnText.style.display = '';
        spinner.style.display = 'none';
        btn.disabled = false;
      }

      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (!settings?.apiKey) {
          finish();
          resultBox.value = '请先点击插件图标配置 API Key';
          return;
        }

        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text, settings, sourceLang, targetLang } },
          (res) => {
            finish();
            if (res?.success) {
              resultBox.value = res.data;
            } else {
              resultBox.value = '翻译失败：' + (res?.error || '未知错误');
            }
          }
        );
      });
    }

    // ── 浮动模式拖拽 ────────────────────────────────────────
    let panelDragInfo = null;
    const panelHd = div.querySelector('.ai-panel-hd');
    panelHd.addEventListener('mousedown', function(e) {
      if (e.target === div.querySelector('#ai-panel-close-title')) return;
      if (!div.classList.contains('ai-panel-floating')) return;
      const rect = div.getBoundingClientRect();
      panelDragInfo = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
      panelHd.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!panelDragInfo) return;
      const dx = e.clientX - panelDragInfo.startX;
      const dy = e.clientY - panelDragInfo.startY;
      div.style.left = Math.max(0, Math.min(window.innerWidth - div.offsetWidth, panelDragInfo.left + dx)) + 'px';
      div.style.top = Math.max(0, Math.min(window.innerHeight - div.offsetHeight, panelDragInfo.top + dy)) + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (!panelDragInfo) return;
      panelDragInfo = null;
      panelHd.classList.remove('dragging');
    });

    return div;
  }

})();
