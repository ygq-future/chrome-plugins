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
  });

  // 点击非 UI 区域 → 关闭
  document.addEventListener('mousedown', (e) => {
    if (!isOurUI(e.target)) closeAll();
  });

  function isOurUI(el) {
    return !!el.closest?.('#ai-tr-btn, #ai-tr-card');
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
    document.body.appendChild(btn);

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
    document.body.appendChild(card);

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
    const sx = window.scrollX, sy = window.scrollY;
    const vw = window.innerWidth, vh = window.innerHeight;
    const GAP = 8;

    // 先附加到 DOM 获取实际尺寸
    el.style.visibility = 'hidden';
    el.style.position = 'absolute';
    document.body.appendChild(el);
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;
    el.remove();
    el.style.visibility = '';

    // 默认：选区左下方
    let left = rect.left + sx;
    let top  = rect.bottom + sy + GAP;

    // 右侧溢出 → 左移
    if (left + elW > sx + vw - 8) left = sx + vw - elW - 8;
    if (left < sx + 4) left = sx + 4;

    // 下方溢出 → 显示在选区上方
    if (rect.bottom + elH + GAP > vh) {
      top = rect.top + sy - elH - GAP;
      if (top < sy + 4) top = rect.bottom + sy + GAP; // 上方也不够就还是放下面
    }

    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  // ─── 工具 ────────────────────────────────────────────────────
  function removeEl(id) { document.getElementById(id)?.remove(); }
  function closeAll() { removeEl('ai-tr-btn'); removeEl('ai-tr-card'); }
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }

})();
