// AI 划词翻译 · Content Script
(function () {
  'use strict';

  let selectionText = '';
  let selectionRect = null;
  let activeCardRequestId = 0; // 用于追踪划词翻译请求生命周期，避免取消后仍弹出卡片

  // ─── 读取「关闭方式」设置，决定是否绑定滚动关闭 ─────────────
  // dismissOnScroll: true = 滚动即关闭; false = 仅点击其他地方关闭（默认）
  let dismissOnScroll = false;

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
    // 未设置过则默认 false（点击其他地方关闭）
    applyScrollSetting(d.dismissOnScroll === true);
  });

  // 设置变更时实时生效（用户在 popup 改完不用刷新页面）
  chrome.storage.onChanged.addListener((changes) => {
    if ('dismissOnScroll' in changes) {
      applyScrollSetting(changes.dismissOnScroll.newValue === true);
    }
  });

  // 点击页面任意位置关闭所有自定义下拉
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ai-select')) {
      document.querySelectorAll('.ai-select.open').forEach(s => s.classList.remove('open'));
    }
  });

  // ─── 监听划词结束 ────────────────────────────────────────────
  let lastMouseUpPos = { x: 0, y: 0 };

  function isValidRect(r) {
    if (!r) return false;
    if ((!r.width || r.width === 0) && (!r.height || r.height === 0)) return false;
    if (r.left === 0 && r.top === 0 && r.right === 0 && r.bottom === 0) return false;
    return true;
  }

  function makeFallbackRect(pos) {
    const x = (pos && typeof pos.x === 'number' && pos.x > 0) ? pos.x : window.innerWidth / 2;
    const y = (pos && typeof pos.y === 'number' && pos.y > 0) ? pos.y : window.innerHeight / 2;
    return {
      left: Math.max(0, x - 15),
      right: x + 15,
      top: Math.max(0, y - 10),
      bottom: y + 10,
      width: 30,
      height: 20
    };
  }

  function getSelectionRect(sel, fallbackPos) {
    if (!sel || sel.rangeCount === 0) {
      return makeFallbackRect(fallbackPos);
    }

    try {
      const range = sel.getRangeAt(0);

      // 1. 优先尝试 getBoundingClientRect()
      const bRect = range.getBoundingClientRect();
      if (isValidRect(bRect)) return bRect;

      // 2. 尝试 getClientRects()（多行/行内元素/Web Component）
      const cRects = range.getClientRects();
      if (cRects && cRects.length > 0) {
        for (let i = cRects.length - 1; i >= 0; i--) {
          if (isValidRect(cRects[i])) return cRects[i];
        }
      }

      // 3. 尝试包含选区的父级节点（如 Web Component / 自定义标签）
      let container = range.commonAncestorContainer;
      if (container && container.nodeType === Node.TEXT_NODE) {
        container = container.parentElement;
      }
      if (container && typeof container.getBoundingClientRect === 'function') {
        const pRect = container.getBoundingClientRect();
        if (isValidRect(pRect)) return pRect;
      }
    } catch (e) {
      // 忽略 Range 异常，直接使用鼠标坐标回退
    }

    return makeFallbackRect(fallbackPos);
  }

  // 使用捕获阶段，确保在模态框阻止冒泡前捕获事件
  document.addEventListener('mouseup', (e) => {
    if (isOurUI(e.target)) return;
    lastMouseUpPos = { x: e.clientX, y: e.clientY };

    // 稍微延迟，确保 selection 已更新
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (text && text.length >= 2) {
        selectionText = text;
        selectionRect = getSelectionRect(sel, lastMouseUpPos);
        if (selectionRect) {
          showBtn();
        }
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
  // ─── SVG 图标 ─────────────────────────────────────────────────
  const ICONS = {
    speak: `<svg class="ai-speak-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
    stop: `<svg class="ai-speak-svg ai-playing-dot-svg" viewBox="0 0 16 16" width="12" height="12"><circle cx="8" cy="8" r="5" fill="currentColor"></circle></svg>`,
  };

  // ─── 智能语言识别与 TTS 模块 ──────────────────────────────────
  function detectLanguageFast(text) {
    if (!text) return null;
    const str = text.trim();
    // 日文假名（平假名/片假名）
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(str)) return 'ja-JP';
    // 韩文字母
    if (/[\uac00-\ud7af\u1100-\u11ff]/.test(str)) return 'ko-KR';
    // 俄文西里尔字母
    if (/[\u0400-\u04ff]/.test(str)) return 'ru-RU';
    // 阿拉伯文
    if (/[\u0600-\u06ff]/.test(str)) return 'ar-SA';
    // 泰文
    if (/[\u0e00-\u0e7f]/.test(str)) return 'th-TH';
    // 包含中文汉字（且无日文假名）
    if (/[\u4e00-\u9fa5]/.test(str)) return 'zh-CN';
    // 纯英文/标准 ASCII
    if (/^[A-Za-z0-9\s.,!?'"()\-:;/@#$%^&*+=<>_~`]+$/.test(str)) return 'en-US';
    return null;
  }

  async function resolveLanguage(text, knownLang) {
    if (knownLang) {
      return typeof normalizeBcp47 === 'function' ? normalizeBcp47(knownLang) : knownLang;
    }
    const fast = detectLanguageFast(text);
    if (fast) return fast;

    // 截取前 60 字交给配置的大模型进行判断
    const sample = (text || '').trim().slice(0, 60);
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (!settings?.apiKey || !settings?.model) {
          resolve('en-US');
          return;
        }
        chrome.runtime.sendMessage(
          { type: 'DETECT_LANGUAGE', payload: { text: sample, settings } },
          (res) => {
            if (res?.success && res.data) {
              resolve(res.data);
            } else {
              resolve('en-US');
            }
          }
        );
      });
    });
  }

  function splitTextForSpeech(text, maxChunkLen = 140) {
    if (!text || text.length <= maxChunkLen) return [text];
    const sentences = text.match(/[^。！？.!?\n]+[。！？.!?\n]*|\n+/g) || [text];
    const chunks = [];
    let current = '';

    for (const s of sentences) {
      if ((current + s).length <= maxChunkLen) {
        current += s;
      } else {
        if (current) chunks.push(current.trim());
        if (s.length > maxChunkLen) {
          const subParts = s.match(new RegExp(`.{1,${maxChunkLen}}`, 'g')) || [s];
          chunks.push(...subParts.map(p => p.trim()));
          current = '';
        } else {
          current = s;
        }
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  const speechController = {
    currentId: null,
    sessionId: 0,
    heartbeatTimer: null,
    onStateChange: null,

    stop() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.sessionId++;
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
      const prevId = this.currentId;
      const prevCb = this.onStateChange;
      this.currentId = null;
      this.onStateChange = null;
      if (prevId && prevCb) {
        prevCb(prevId, 'idle');
      }
    },

    async speak({ id, text, lang, onStateChange }) {
      if (!text || !text.trim()) return;
      if (!('speechSynthesis' in window)) {
        alert('当前浏览器环境不支持语音合成');
        return;
      }

      // 如果点击的是当前正在播放或正在识别的按钮，则切换为停止
      if (this.currentId === id) {
        this.stop();
        return;
      }

      this.stop();

      this.currentId = id;
      this.onStateChange = onStateChange;
      const session = ++this.sessionId;

      if (this.onStateChange) {
        this.onStateChange(id, 'detecting');
      }

      let targetLang = lang;
      if (!targetLang) {
        targetLang = await resolveLanguage(text);
      }

      if (this.sessionId !== session) return; // 期间已被取消

      const chunks = splitTextForSpeech(text);
      if (!chunks.length) {
        this.stop();
        return;
      }

      if (this.onStateChange) {
        this.onStateChange(id, 'playing');
      }

      // Chromium 15 秒保活心跳
      this.heartbeatTimer = setInterval(() => {
        if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 10000);

      const voices = window.speechSynthesis.getVoices?.() || [];
      const normLang = typeof normalizeBcp47 === 'function' ? normalizeBcp47(targetLang) : targetLang;
      const langPrefix = normLang.split('-')[0].toLowerCase();
      const matchedVoice = voices.find(v => v.lang.toLowerCase() === normLang.toLowerCase())
        || voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));

      let chunkIdx = 0;
      const playNext = () => {
        if (this.sessionId !== session) return;
        if (chunkIdx >= chunks.length) {
          this.stop();
          return;
        }

        const chunkText = chunks[chunkIdx++];
        const utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.lang = normLang;
        if (matchedVoice) utterance.voice = matchedVoice;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onend = () => {
          if (this.sessionId === session) playNext();
        };
        utterance.onerror = (e) => {
          if (e.error !== 'interrupted') {
            console.warn('[AI Translator] TTS error:', e);
          }
          if (this.sessionId === session) this.stop();
        };

        window.speechSynthesis.speak(utterance);
      };

      playNext();
    }
  };


  // ─── 显示翻译小按钮 ──────────────────────────────────────────
  // ─── 显示翻译/朗读悬浮工具栏 ─────────────────────────────────
  function showBtn() {
    removeEl('ai-tr-btn');
    removeEl('ai-tr-card');

    const bar = document.createElement('div');
    bar.id = 'ai-tr-btn';
    bar.innerHTML = `
      <button class="ai-btn-action ai-btn-tr-action" id="ai-quick-tr" title="翻译选中文本">
        <span class="ai-btn-icon">AI</span>
        <span class="ai-btn-label">翻译</span>
      </button>
      <span class="ai-btn-sep"></span>
      <button class="ai-btn-action ai-btn-speak-action" id="ai-quick-speak" title="朗读选中文本（智能识别语言）">
        <span class="ai-speak-icon-slot">${ICONS.speak}</span>
        <span class="ai-btn-label">朗读</span>
      </button>
    `;
    placeNear(bar, selectionRect, 'btn');
    getMountTarget().appendChild(bar);

    bar.querySelector('#ai-quick-tr').addEventListener('click', (e) => {
      e.stopPropagation();
      speechController.stop();
      doTranslate();
    });

    const speakBtn = bar.querySelector('#ai-quick-speak');
    speakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const textToSpeak = selectionText;
      speechController.speak({
        id: 'quick-btn',
        text: textToSpeak,
        onStateChange: (id, state) => {
          if (id !== 'quick-btn') return;
          const slot = speakBtn.querySelector('.ai-speak-icon-slot');
          const label = speakBtn.querySelector('.ai-btn-label');
          if (!slot || !label) return;
          if (state === 'detecting') {
            slot.innerHTML = '<span class="ai-speak-spinner"></span>';
            label.textContent = '识别中';
            speakBtn.classList.add('loading');
            speakBtn.classList.remove('playing');
          } else if (state === 'playing') {
            slot.innerHTML = ICONS.stop;
            label.textContent = '停止';
            speakBtn.classList.remove('loading');
            speakBtn.classList.add('playing');
          } else {
            slot.innerHTML = ICONS.speak;
            label.textContent = '朗读';
            speakBtn.classList.remove('loading', 'playing');
          }
        }
      });
    });
  }

  // ─── 触发划词翻译 ────────────────────────────────────────────
  function doTranslate() {
    removeEl('ai-tr-btn');
    const reqId = ++activeCardRequestId;
    showCard('loading');

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
      if (reqId !== activeCardRequestId) return; // 已被用户取消

      if (!settings?.apiKey) {
        showCard('error', '请先点击插件图标，填写 API Key 并保存。', true);
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', payload: { text: selectionText, settings } },
        (res) => {
          if (reqId !== activeCardRequestId) return; // 已被用户取消，不再弹出

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
          <div class="ai-card-foot-btns">
            <button class="ai-copy-btn ai-card-speak-foot-btn" id="ai-card-speak-tgt" title="朗读译文">
              <span class="ai-speak-icon-slot">${ICONS.speak}</span>
              <span class="ai-speak-btn-text">朗读</span>
            </button>
            <button class="ai-copy-btn" id="ai-copy-btn">复制</button>
          </div>
        </div>`;
      const link = needSettings
        ? `<br><span class="ai-error-link" id="ai-open-settings">→ 打开设置</span>`
        : '';
      bodyHtml = `<div class="ai-error">${esc(content)}${link}</div>`;
      if (!needSettings) {
        footHtml = `
          <div class="ai-card-foot">
            <span></span>
            <button class="ai-copy-btn" id="ai-retry-btn">重试</button>
          </div>`;
      }
    }

    card.innerHTML = `
      <div class="ai-card-head">
        <div class="ai-card-head-left">
          <div class="ai-card-logo">AI</div>
          <span class="ai-card-title-text">划词翻译</span>
        </div>
        <button class="ai-card-close" id="ai-card-close">×</button>
      </div>
      <div class="ai-card-source-wrap">
        <div class="ai-card-source">${esc(preview)}</div>
        <button class="ai-card-speak-icon-btn" id="ai-card-speak-src" title="朗读原文（智能识别语言）">
          <span class="ai-speak-icon-slot">${ICONS.speak}</span>
        </button>
      </div>
      <div class="ai-card-body">${bodyHtml}</div>
      ${footHtml}
    `;

    // 先隐藏挂载，自动调整尺寸后再定位，避免闪动
    card.style.visibility = 'hidden';
    getMountTarget().appendChild(card);
    if (state === 'result') autoSizeCard(card);
    positionCard(card, selectionRect);
    card.style.visibility = '';

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

    // 重试
    card.querySelector('#ai-retry-btn')?.addEventListener('click', () => {
      doTranslate();
    });
    const srcSpeakBtn = card.querySelector('#ai-card-speak-src');
    srcSpeakBtn?.addEventListener('click', () => {
      const textToSpeak = selectionText;
      speechController.speak({
        id: 'card-src',
        text: textToSpeak,
        onStateChange: (id, st) => {
          if (id !== 'card-src') return;
          const slot = srcSpeakBtn.querySelector('.ai-speak-icon-slot');
          if (!slot) return;
          if (st === 'detecting') {
            slot.innerHTML = '<span class="ai-speak-spinner"></span>';
            srcSpeakBtn.classList.add('loading');
            srcSpeakBtn.classList.remove('playing');
          } else if (st === 'playing') {
            slot.innerHTML = ICONS.stop;
            srcSpeakBtn.classList.remove('loading');
            srcSpeakBtn.classList.add('playing');
          } else {
            slot.innerHTML = ICONS.speak;
            srcSpeakBtn.classList.remove('loading', 'playing');
          }
        }
      });
    });

    // 朗读译文（目标语言已知，0延迟）
    const tgtSpeakBtn = card.querySelector('#ai-card-speak-tgt');
    tgtSpeakBtn?.addEventListener('click', () => {
      const targetLang = settings.targetLang || 'zh-CN';
      speechController.speak({
        id: 'card-tgt',
        text: content,
        lang: targetLang,
        onStateChange: (id, st) => {
          if (id !== 'card-tgt') return;
          const slot = tgtSpeakBtn.querySelector('.ai-speak-icon-slot');
          const txt = tgtSpeakBtn.querySelector('.ai-speak-btn-text');
          if (st === 'playing') {
            if (slot) slot.innerHTML = ICONS.stop;
            if (txt) txt.textContent = '停止';
            tgtSpeakBtn.classList.add('playing');
          } else {
            if (slot) slot.innerHTML = ICONS.speak;
            if (txt) txt.textContent = '朗读';
            tgtSpeakBtn.classList.remove('playing');
          }
        }
      });
    });
  }

  // ─── 结果卡片自动调整尺寸 ────────────────────────────────────
  function autoSizeCard(card) {
    const M = 16;
    const maxH = window.innerHeight - M * 2;
    const absMaxW = Math.max(260, window.innerWidth - M * 2);
    const comfyW = Math.min(460, absMaxW);
    const body = card.querySelector('.ai-card-body');

    card.style.maxHeight = maxH + 'px';
    card.style.width = 'auto'; // position:fixed + 仅设 left/top → 收缩到内容宽度
    if (body) body.style.overflowY = '';

    // 先按舒适宽度测量
    card.style.maxWidth = comfyW + 'px';
    if (card.offsetHeight <= maxH) return; // 未超高，fit-content 即可

    // 超高 → 二分加宽
    let lo = comfyW, hi = absMaxW, best = absMaxW;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      card.style.maxWidth = mid + 'px';
      if (card.offsetHeight <= maxH) { best = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    card.style.maxWidth = best + 'px';

    // 即便最宽仍超高 → 结果区滚动兜底
    if (card.offsetHeight > maxH && body) body.style.overflowY = 'auto';
  }

  // ─── 卡片定位（靠近选区，元素已挂载） ──────────────────────
  function positionCard(el, rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const GAP = 8;
    const elW = el.offsetWidth, elH = el.offsetHeight;

    let left = rect.left;
    if (rect.width > 0 && rect.width < elW) {
      left = rect.left + (rect.width - elW) / 2;
    }
    if (left + elW > vw - 12) left = vw - elW - 12;
    if (left < 12) left = 12;

    let top = rect.bottom + GAP;
    if (top + elH + GAP > vh) {
      top = rect.top - elH - GAP;
    }
    top = Math.max(12, Math.min(top, vh - elH - 12));

    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  // ─── 元素定位（靠近选区） ────────────────────────────────────
  function placeNear(el, rect, type) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const GAP = 8;

    el.style.visibility = 'hidden';
    el.style.position = 'fixed';
    document.body.appendChild(el);
    const elW = el.offsetWidth || 130;
    const elH = el.offsetHeight || 32;
    el.remove();
    el.style.visibility = '';
    el.style.position = 'fixed';

    // 水平方向：选区较窄或正常情况下居中显示，体验更聚焦自然
    let left = rect.left + (rect.width - elW) / 2;
    if (left + elW > vw - 8) left = vw - elW - 8;
    if (left < 8) left = 8;

    // 垂直方向：优先放置于选区下方
    let top = rect.bottom + GAP;

    // 下方超出视口 → 翻转至选区上方
    if (top + elH + GAP > vh) {
      top = rect.top - elH - GAP;
      if (top < 8) {
        top = Math.min(rect.bottom + GAP, vh - elH - 8);
      }
    }
    top = Math.max(8, Math.min(top, vh - elH - 8));

    el.style.left = Math.round(left) + 'px';
    el.style.top  = Math.round(top)  + 'px';
  }

  // ─── 挂载点 ────────────────────────────────────────────────────
  function getMountTarget() {
    const dialog = document.querySelector('dialog[open]');
    return dialog || document.body;
  }

  // ─── 工具 ────────────────────────────────────────────────────
  function removeEl(id) { document.getElementById(id)?.remove(); }
  function closeAll() {
    activeCardRequestId = 0; // 重置请求 ID，放弃等待中的响应
    speechController.stop();
    removeEl('ai-tr-btn');
    removeEl('ai-tr-card');
  }

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
        const h = inner.offsetHeight || 440;
        wrap.style.left = Math.max(0, (window.innerWidth - w) / 2) + 'px';
        wrap.style.top = Math.max(0, (window.innerHeight - h) / 2) + 'px';
      } else {
        wrap.classList.remove('ai-panel-floating');
        wrap.style.left = '';
        wrap.style.top = '';
      }
    });

    // 加载翻译面板专属目标语言设置（独立于划词翻译，互不影响）
    chrome.storage.sync.get('panelTargetLang', (d) => {
      const tgt = wrap.querySelector('#ai-panel-tgt-lang');
      if (tgt && d.panelTargetLang) {
        tgt.value = d.panelTargetLang;
      }
    });

    // 聚焦输入源文本框
    setTimeout(() => wrap.querySelector('#ai-panel-src-text')?.focus(), 100);
  }

  function closePanel() {
    if (!panelVisible) return;
    speechController.stop();
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
    const initLabel = langList.find(([v]) => v === defaultVal)?.[1] || langList[0]?.[1] || defaultVal;

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
        const item = langList.find(([lv]) => lv === v);
        const label = item ? item[1] : v;
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
        // 保存当前面板选择的目标语言（独立 key: panelTargetLang，不影响设置面板中的 targetLang）
        chrome.storage.sync.set({ panelTargetLang: el.value });
      });
    });

    return el;
  }

  function buildPanel() {
    // 语言列表数据源
    const langList = (typeof SUPPORTED_LANGUAGES !== 'undefined' ? SUPPORTED_LANGUAGES : [
      { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
      { code: 'zh-TW', name: '繁体中文', flag: '🇹🇼' },
      { code: 'en',    name: '英语',     flag: '🇺🇸' },
      { code: 'ja',    name: '日语',     flag: '🇯🇵' },
      { code: 'ko',    name: '韩语',     flag: '🇰🇷' },
      { code: 'fr',    name: '法语',     flag: '🇫🇷' },
      { code: 'de',    name: '德语',     flag: '🇩🇪' },
      { code: 'es',    name: '西班牙语', flag: '🇪🇸' },
      { code: 'ru',    name: '俄语',     flag: '🇷🇺' },
    ]).map(l => [l.code, `${l.flag ? l.flag + ' ' : ''}${l.name}`]);

    const div = document.createElement('div');
    div.id = 'ai-tr-panel';
    div.style.display = ''; // visible
    div.innerHTML = `
      <div class="ai-panel-bg"></div>
      <div class="ai-panel-wrap">
        <div class="ai-panel-hd">
          <div class="ai-panel-hd-left">
            <div class="ai-panel-logo">AI</div>
            <span class="ai-panel-title">AI 翻译面板</span>
            <span class="ai-panel-badge">自动识别源语言</span>
          </div>
          <div class="ai-panel-hd-right">
            <span class="ai-panel-shortcut"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 翻译</span>
            <button class="ai-panel-close" id="ai-panel-close-title">×</button>
          </div>
        </div>
        <div class="ai-panel-bd">
          <!-- 上方：输入源文本区 -->
          <div class="ai-panel-box ai-source-box">
            <textarea id="ai-panel-src-text" placeholder="输入要翻译的文本..." spellcheck="false"></textarea>
            <div class="ai-panel-box-toolbar">
              <div class="ai-box-actions-left">
                <button class="ai-mini-btn" data-action="clear" data-side="src" title="清空">清空</button>
                <button class="ai-mini-btn" data-action="copy" data-side="src" title="复制">复制</button>
                <button class="ai-mini-btn" data-action="speak" data-side="src" title="朗读原文">朗读</button>
              </div>
              <div class="ai-box-actions-right">
                <button id="ai-panel-translate" class="ai-btn-translate-primary" title="快捷键 Ctrl+Enter">
                  <span class="btn-icon">⚡</span>
                  <span class="btn-text">翻译</span>
                  <span class="btn-spinner"></span>
                </button>
              </div>
            </div>
          </div>

          <!-- 下方：目标语言翻译结果区 -->
          <div class="ai-panel-box ai-target-box">
            <textarea id="ai-panel-tgt-text" placeholder="翻译结果..." spellcheck="false"></textarea>
            <div class="ai-panel-box-toolbar">
              <div class="ai-box-actions-left">
                <button class="ai-mini-btn" data-action="clear" data-side="tgt" title="清空">清空</button>
                <button class="ai-mini-btn" data-action="copy" data-side="tgt" title="复制">复制</button>
                <button class="ai-mini-btn" data-action="speak" data-side="tgt" title="朗读译文">朗读</button>
              </div>
              <div class="ai-box-actions-right">
                <div id="ai-panel-tgt-lang-mount"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    getMountTarget().appendChild(div);

    // 挂载目标语言自定义下拉
    const tgtMount = div.querySelector('#ai-panel-tgt-lang-mount');
    const tgtSelect = createSelect(langList, 'zh-CN', 'ai-panel-tgt-lang');
    tgtMount.replaceWith(tgtSelect);

    const srcText = div.querySelector('#ai-panel-src-text');
    const tgtText = div.querySelector('#ai-panel-tgt-text');

    // 关闭
    const close = () => closePanel();
    div.querySelector('.ai-panel-bg').addEventListener('click', close);
    div.querySelector('#ai-panel-close-title').addEventListener('click', close);

    // 翻译按钮
    div.querySelector('#ai-panel-translate').addEventListener('click', doPanelTranslate);

    // Ctrl/Cmd+Enter 快捷键触发翻译
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

    // 应用用户配置的面板尺寸
    chrome.storage.sync.get(['panelWidth', 'panelHeight'], (d) => {
      const w = d.panelWidth || 680;
      const h = d.panelHeight || 160; // 单个输入框高度
      div.querySelector('.ai-panel-wrap').style.width = w + 'px';
      srcText.style.height = h + 'px';
      tgtText.style.height = h + 'px';
    });

    // 清空 / 复制按钮
    div.querySelectorAll('.ai-mini-btn').forEach(btn => {
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
            btn.textContent = '已复制 ✓';
            setTimeout(() => { btn.textContent = orig; }, 1500);
          });
        } else if (action === 'speak') {
          const val = tb.value.trim();
          if (!val) return;
          const id = `panel-${side}`;
          const lang = side === 'tgt' ? (div.querySelector('#ai-panel-tgt-lang')?.value || 'zh-CN') : null;
          speechController.speak({
            id,
            text: val,
            lang,
            onStateChange: (activeId, st) => {
              if (activeId !== id) return;
              if (st === 'playing') {
                btn.textContent = '停止';
                btn.classList.add('playing');
              } else if (st === 'detecting') {
                btn.textContent = '识别中';
              } else {
                btn.textContent = '朗读';
                btn.classList.remove('playing');
              }
            }
          });
        }
      });
    });

    // ── 翻译逻辑 ──
    function doPanelTranslate() {
      const btn = div.querySelector('#ai-panel-translate');
      if (btn.disabled) return;

      const text = srcText.value.trim();
      if (!text) {
        srcText.focus();
        return;
      }

      const targetLang = div.querySelector('#ai-panel-tgt-lang')?.value || 'zh-CN';

      const btnIcon = btn.querySelector('.btn-icon');
      const btnText = btn.querySelector('.btn-text');
      const spinner = btn.querySelector('.btn-spinner');

      btn.classList.add('is-translating');
      if (btnIcon) btnIcon.style.display = 'none';
      if (btnText) btnText.textContent = '翻译中';
      if (spinner) spinner.style.display = 'inline-block';
      btn.disabled = true;

      function finish() {
        btn.classList.remove('is-translating');
        if (btnIcon) btnIcon.style.display = '';
        if (btnText) btnText.textContent = '翻译';
        if (spinner) spinner.style.display = 'none';
        btn.disabled = false;
      }

      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (!settings?.apiKey) {
          finish();
          tgtText.value = '请先点击插件图标配置 API Key';
          return;
        }

        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text, settings, targetLang } },
          (res) => {
            finish();
            if (res?.success) {
              tgtText.value = res.data;
            } else {
              tgtText.value = '翻译失败：' + (res?.error || '未知错误');
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

