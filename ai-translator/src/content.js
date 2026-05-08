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
    wrap.style.display = '';
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
    panelVisible = false;
    const el = document.getElementById('ai-tr-panel');
    if (el) el.style.display = 'none';
  }

  function buildPanel() {
    const langList = [
      ['zh-CN','简体中文'], ['zh-TW','繁体中文'], ['en','英语'],
      ['ja','日语'], ['ko','韩语'], ['fr','法语'], ['de','德语'], ['es','西班牙语'],
    ];
    const opts = langList.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    const div = document.createElement('div');
    div.id = 'ai-tr-panel';
    div.style.display = ''; // visible
    div.innerHTML = `
      <div class="ai-panel-bg"></div>
      <div class="ai-panel-wrap">
        <div class="ai-panel-hd">
          <span class="ai-panel-title">AI 翻译面板</span>
          <span style="font-size:11px;color:#4a5568;">Alt+Shift+T</span>
          <button class="ai-panel-close" id="ai-panel-close-title">×</button>
        </div>
        <div class="ai-panel-bd">
          <div class="ai-panel-langs">
            <select id="ai-panel-src-lang">${opts}</select>
            <button id="ai-panel-swap" title="互换语言">⇄</button>
            <select id="ai-panel-tgt-lang">${opts}</select>
          </div>
          <div class="ai-panel-editors">
            <div class="ai-panel-col">
              <textarea id="ai-panel-src-text" placeholder="输入要翻译的文本..." spellcheck="false"></textarea>
              <div class="ai-panel-tbar">
                <button class="ai-tbar-btn" data-action="clear" data-side="src" title="清空">✕</button>
                <button class="ai-tbar-btn" data-action="copy" data-side="src" title="复制">📋</button>
              </div>
            </div>
            <div class="ai-panel-mid">
              <button id="ai-panel-translate">
                <span class="btn-text">翻译 ▶</span>
                <span class="btn-spinner"></span>
              </button>
            </div>
            <div class="ai-panel-col">
              <textarea id="ai-panel-tgt-text" placeholder="翻译结果..." spellcheck="false"></textarea>
              <div class="ai-panel-tbar">
                <button class="ai-tbar-btn" data-action="clear" data-side="tgt" title="清空">✕</button>
                <button class="ai-tbar-btn" data-action="copy" data-side="tgt" title="复制">📋</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    getMountTarget().appendChild(div);

    // 关闭
    const close = () => closePanel();
    div.querySelector('.ai-panel-bg').addEventListener('click', close);
    div.querySelector('#ai-panel-close-title').addEventListener('click', close);

    // 互换语言
    const srcText = div.querySelector('#ai-panel-src-text');
    const tgtText = div.querySelector('#ai-panel-tgt-text');
    div.querySelector('#ai-panel-swap').addEventListener('click', () => {
      const srcLang = div.querySelector('#ai-panel-src-lang');
      const tgtLang = div.querySelector('#ai-panel-tgt-lang');
      [srcLang.value, tgtLang.value] = [tgtLang.value, srcLang.value];
      [srcText.value, tgtText.value] = [tgtText.value, srcText.value];
    });

    // 翻译
    div.querySelector('#ai-panel-translate').addEventListener('click', () => {
      doPanelTranslate();
    });

    // Ctrl/Cmd+Enter 快捷键
    srcText.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doPanelTranslate();
    });
    tgtText.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doPanelTranslate();
    });

    // Escape 关闭
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
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

    // ── 双向翻译 ──────────────────────────────────
    function doPanelTranslate() {
      const srcVal = srcText.value.trim();
      const tgtVal = tgtText.value.trim();

      // 判断翻译方向
      let text, sourceLang, targetLang, resultBox;
      if (srcVal && !tgtVal) {
        // 左 → 右
        text = srcVal;
        sourceLang = div.querySelector('#ai-panel-src-lang').value;
        targetLang = div.querySelector('#ai-panel-tgt-lang').value;
        resultBox = tgtText;
      } else if (tgtVal && !srcVal) {
        // 右 → 左
        text = tgtVal;
        sourceLang = div.querySelector('#ai-panel-tgt-lang').value;
        targetLang = div.querySelector('#ai-panel-src-lang').value;
        resultBox = srcText;
      } else {
        // 两边都有 / 都没有 → 默认左→右
        if (!srcVal) return;
        text = srcVal;
        sourceLang = div.querySelector('#ai-panel-src-lang').value;
        targetLang = div.querySelector('#ai-panel-tgt-lang').value;
        resultBox = tgtText;
      }

      const btn = div.querySelector('#ai-panel-translate');
      const btnText = btn.querySelector('.btn-text');
      const spinner = btn.querySelector('.btn-spinner');
      btnText.style.display = 'none';
      spinner.style.display = 'inline-block';
      btn.disabled = true;

      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (!settings?.apiKey) {
          btnText.style.display = '';
          spinner.style.display = 'none';
          btn.disabled = false;
          resultBox.value = '请先点击插件图标配置 API Key';
          return;
        }

        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text, settings, sourceLang, targetLang } },
          (res) => {
            btnText.style.display = '';
            spinner.style.display = 'none';
            btn.disabled = false;
            if (res?.success) {
              resultBox.value = res.data;
            } else {
              resultBox.value = '翻译失败：' + (res?.error || '未知错误');
            }
          }
        );
      });
    }

    return div;
  }

})();
