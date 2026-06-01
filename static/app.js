const dropzone = document.getElementById('dropzone');
const input = document.getElementById('epub-input');
const statusEl = document.getElementById('status');
const reader = document.getElementById('reader');
const measureNode = document.getElementById('reader-measure');
const themeToggle = document.getElementById('theme-toggle');
const fontFamilySelect = document.getElementById('font-family');
const fontSizeInput = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');
const readerWidthInput = document.getElementById('reader-width');
const readerWidthValue = document.getElementById('reader-width-value');
const settingsDialog = document.getElementById('settings-dialog');
const settingsOpenBtn = document.getElementById('settings-open');

const BASE_TITLE = 'EPUB Reader';
const THEME_KEY = 'epub_reader_theme';
const FONT_KEY = 'epub_reader_font';
const SIZE_KEY = 'epub_reader_size';
const WIDTH_KEY = 'epub_reader_width';
const FONT_OPTIONS = new Set(['serif', 'sans', 'mono']);
const SIZE_MIN = 10;
const SIZE_MAX = 26;
const SIZE_DEFAULT = 17;
const WIDTH_MIN = 520;
const WIDTH_MAX = 1100;
const WIDTH_DEFAULT = 760;
const MEDIA_SELECTOR = 'img, table, figure, picture, svg, canvas, video, audio, iframe, math';
const MOUNT_ROOT_MARGIN = '1200px 0px';

let baseHue = 28;
let rafLocked = false;
let virtualReader = null;
let pretextLib = null;
let recomputeRaf = 0;

(async () => {
  try {
    pretextLib = await import('https://esm.sh/@chenglou/pretext');
  } catch (err) {
    console.warn('Pretext failed to load; falling back to DOM remeasurement.', err);
  }
})();

function hashToHue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return ((Math.abs(hash) % 360) + 360) % 360;
}

function setHue(hue) {
  document.documentElement.style.setProperty('--hue', String(hue));
}

function updateAdaptiveHue() {
  if (rafLocked) return;
  rafLocked = true;
  window.requestAnimationFrame(() => {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = window.scrollY / maxScroll;
    const adaptiveHue = (baseHue + Math.floor(progress * 120)) % 360;
    setHue(adaptiveHue);
    rafLocked = false;
  });
}

function setTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(THEME_KEY, resolved);
  themeToggle.textContent = resolved === 'dark' ? 'Light Theme' : 'Dark Theme';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function setFontFamily(font) {
  const resolved = FONT_OPTIONS.has(font) ? font : 'serif';
  document.documentElement.setAttribute('data-font', resolved);
  localStorage.setItem(FONT_KEY, resolved);
  fontFamilySelect.value = resolved;
}

function setFontSize(size) {
  const parsed = Number.parseInt(size, 10);
  const resolved = Number.isFinite(parsed)
    ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, parsed))
    : SIZE_DEFAULT;
  document.documentElement.style.setProperty('--reader-font-size', `${resolved}px`);
  localStorage.setItem(SIZE_KEY, String(resolved));
  fontSizeInput.value = String(resolved);
  fontSizeValue.textContent = `${resolved}px`;
}

function setReaderWidth(width) {
  const parsed = Number.parseInt(width, 10);
  const resolved = Number.isFinite(parsed)
    ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, parsed))
    : WIDTH_DEFAULT;
  document.documentElement.style.setProperty('--reader-max-width', `${resolved}px`);
  localStorage.setItem(WIDTH_KEY, String(resolved));
  readerWidthInput.value = String(resolved);
  readerWidthValue.textContent = `${resolved}px`;
}

function initReaderPrefs() {
  setFontFamily(localStorage.getItem(FONT_KEY) || 'serif');
  setFontSize(localStorage.getItem(SIZE_KEY) || SIZE_DEFAULT);
  setReaderWidth(localStorage.getItem(WIDTH_KEY) || WIDTH_DEFAULT);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function syncMeasureWidth() {
  const outer = reader.offsetWidth;
  if (outer > 0) {
    measureNode.style.setProperty('--reader-measure-width', `${outer}px`);
  }
}

function canvasFontShorthand(style) {
  const parts = [];
  if (style.fontStyle && style.fontStyle !== 'normal') parts.push(style.fontStyle);
  const weight = style.fontWeight;
  if (weight && weight !== '400' && weight !== 'normal') parts.push(weight);
  parts.push(style.fontSize);
  parts.push(style.fontFamily);
  return parts.join(' ');
}

function parsePxList(...values) {
  let total = 0;
  for (const v of values) {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

class VirtualReader {
  constructor(container, measureContainer) {
    this.container = container;
    this.measureContainer = measureContainer;
    this.chapters = [];
    this.observer = null;
    this._aborted = false;
  }

  destroy() {
    this._aborted = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    for (const ch of this.chapters) {
      ch.element.remove();
    }
    this.chapters = [];
  }

  async load(chapterPayloads, onProgress) {
    this._aborted = false;
    this.observer = new IntersectionObserver(this._onIntersect.bind(this), {
      root: null,
      rootMargin: MOUNT_ROOT_MARGIN,
    });

    const fragment = document.createDocumentFragment();
    this.chapters = chapterPayloads.map((payload, i) => {
      const el = document.createElement('section');
      el.className = 'chapter chapter-placeholder';
      el.dataset.chapterIndex = String(i);
      el.style.minHeight = '120px';
      fragment.appendChild(el);
      return {
        index: i,
        html: payload.html,
        element: el,
        mounted: false,
        blocks: null,
        originalChapterHeight: 0,
        originalContentWidth: 0,
        originalBaseFontSize: SIZE_DEFAULT,
      };
    });
    this.container.appendChild(fragment);

    syncMeasureWidth();
    for (let i = 0; i < this.chapters.length; i += 1) {
      if (this._aborted) return;
      const ch = this.chapters[i];
      this._measureChapter(ch);
      if (this.observer) this.observer.observe(ch.element);
      if (typeof onProgress === 'function') onProgress(i + 1, this.chapters.length);
      if ((i & 7) === 7) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  _measureChapter(ch) {
    this.measureContainer.innerHTML = '';
    const wrapper = document.createElement('section');
    wrapper.className = 'chapter';
    wrapper.innerHTML = ch.html;
    this.measureContainer.appendChild(wrapper);

    const measureStyle = window.getComputedStyle(this.measureContainer);
    const baseFontSize = Number.parseFloat(measureStyle.fontSize) || SIZE_DEFAULT;
    const innerWidth = wrapper.clientWidth || this.measureContainer.clientWidth || WIDTH_DEFAULT;

    const blocks = [];
    for (const child of Array.from(wrapper.children)) {
      const rect = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      const marginY = parsePxList(style.marginTop, style.marginBottom);
      const containsMedia = child.matches(MEDIA_SELECTOR) || child.querySelector(MEDIA_SELECTOR);
      const text = (child.textContent || '').trim();

      if (containsMedia || !text) {
        blocks.push({
          kind: 'media',
          height: rect.height,
          margin: marginY,
        });
        continue;
      }

      const fontSize = Number.parseFloat(style.fontSize) || baseFontSize;
      const lineHeightRaw = style.lineHeight;
      let lineHeight = Number.parseFloat(lineHeightRaw);
      if (!Number.isFinite(lineHeight)) {
        lineHeight = fontSize * 1.5;
      }
      const paddingX = parsePxList(style.paddingLeft, style.paddingRight);
      const paddingY = parsePxList(style.paddingTop, style.paddingBottom);
      const borderY = parsePxList(style.borderTopWidth, style.borderBottomWidth);
      const contentWidth = Math.max(1, (child.clientWidth || innerWidth) - paddingX);

      blocks.push({
        kind: 'text',
        text: child.textContent || '',
        font: canvasFontShorthand(style),
        fontFamily: style.fontFamily,
        fontSizePx: fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeightPx: lineHeight,
        lineHeightRatio: lineHeight / fontSize,
        fontSizeRatio: fontSize / baseFontSize,
        letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
        contentWidth,
        contentWidthRatio: contentWidth / Math.max(1, innerWidth),
        paddingY,
        borderY,
        margin: marginY,
        originalHeight: rect.height,
        height: rect.height,
      });
    }

    const totalHeight = wrapper.getBoundingClientRect().height;
    ch.blocks = blocks;
    ch.originalChapterHeight = totalHeight;
    ch.originalContentWidth = innerWidth;
    ch.originalBaseFontSize = baseFontSize;
    ch.element.style.height = `${Math.max(40, totalHeight)}px`;
    ch.element.style.minHeight = '';

    this.measureContainer.innerHTML = '';
  }

  recompute() {
    if (this.chapters.length === 0) return;
    syncMeasureWidth();
    const readerStyle = window.getComputedStyle(reader);
    const baseFontSize = Number.parseFloat(readerStyle.fontSize) || SIZE_DEFAULT;
    const fontFamily = readerStyle.fontFamily;
    const innerWidth = reader.clientWidth - parsePxList(readerStyle.paddingLeft, readerStyle.paddingRight);
    const currentInnerWidth = Math.max(1, innerWidth);

    for (const ch of this.chapters) {
      if (!ch.blocks) continue;
      let delta = 0;
      const widthScale = currentInnerWidth / Math.max(1, ch.originalContentWidth);

      for (const block of ch.blocks) {
        if (block.kind !== 'text') continue;
        const newFontSize = block.fontSizeRatio * baseFontSize;
        const newLineHeight = block.lineHeightRatio * newFontSize;
        const newContentWidth = Math.max(1, block.contentWidthRatio * currentInnerWidth * 1);
        const widthForLayout = newContentWidth * 1;
        const fontStr = buildFontString(block, newFontSize, fontFamily);

        let innerHeight = block.originalHeight - block.paddingY - block.borderY;
        if (pretextLib && typeof pretextLib.prepare === 'function') {
          try {
            const opts = block.letterSpacing
              ? { letterSpacing: block.letterSpacing }
              : undefined;
            const prepared = pretextLib.prepare(block.text, fontStr, opts);
            const result = pretextLib.layout(prepared, widthForLayout, newLineHeight);
            innerHeight = result.height;
          } catch (err) {
            // fall back to scaled estimate below
            innerHeight = (block.originalHeight - block.paddingY - block.borderY)
              * (newLineHeight / block.lineHeightPx)
              * (block.contentWidth / Math.max(1, newContentWidth));
          }
        } else {
          innerHeight = (block.originalHeight - block.paddingY - block.borderY)
            * (newLineHeight / block.lineHeightPx)
            * (block.contentWidth / Math.max(1, newContentWidth));
        }

        const newHeight = innerHeight + block.paddingY + block.borderY;
        delta += newHeight - block.originalHeight;
        block.height = newHeight;
        // ignore unused widthScale
        void widthScale;
      }

      const predicted = Math.max(40, ch.originalChapterHeight + delta);
      if (!ch.mounted) {
        ch.element.style.height = `${predicted}px`;
      }
    }
  }

  _onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const idx = Number(entry.target.dataset.chapterIndex);
      const ch = this.chapters[idx];
      if (ch && !ch.mounted) {
        this._mount(ch);
      }
    }
  }

  _mount(ch) {
    ch.element.innerHTML = ch.html;
    ch.element.style.height = '';
    ch.element.classList.remove('chapter-placeholder');
    ch.mounted = true;
    if (this.observer) this.observer.unobserve(ch.element);
  }
}

function buildFontString(block, fontSize, fallbackFamily) {
  const parts = [];
  if (block.fontStyle && block.fontStyle !== 'normal') parts.push(block.fontStyle);
  if (block.fontWeight && block.fontWeight !== '400' && block.fontWeight !== 'normal') {
    parts.push(block.fontWeight);
  }
  parts.push(`${fontSize}px`);
  parts.push(block.fontFamily || fallbackFamily);
  return parts.join(' ');
}

function scheduleRecompute() {
  if (!virtualReader) return;
  if (recomputeRaf) return;
  recomputeRaf = window.requestAnimationFrame(() => {
    recomputeRaf = 0;
    virtualReader.recompute();
  });
}

async function uploadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.epub')) {
    setStatus('Please choose a valid .epub file.');
    return;
  }

  setStatus('Parsing EPUB...');
  if (virtualReader) {
    virtualReader.destroy();
    virtualReader = null;
  }
  reader.innerHTML = '';

  const formData = new FormData();
  formData.append('epub', file);

  try {
    const response = await fetch('/upload', { method: 'POST', body: formData });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Upload failed.');
    }

    document.title = payload.title ? `${payload.title} - ${BASE_TITLE}` : BASE_TITLE;
    baseHue = hashToHue(payload.title || file.name);
    updateAdaptiveHue();

    const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
    if (chapters.length === 0) {
      throw new Error('No readable chapters found.');
    }

    virtualReader = new VirtualReader(reader, measureNode);
    setStatus(`Measuring 0 / ${chapters.length} chapters...`);
    await virtualReader.load(chapters, (done, total) => {
      setStatus(`Measuring ${done} / ${total} chapters...`);
    });

    setStatus('Loaded. Scroll to read.');
    window.scrollTo({ top: reader.offsetTop - 16, behavior: 'smooth' });
  } catch (err) {
    setStatus(err.message);
  }
}

['dragenter', 'dragover'].forEach((evtName) => {
  dropzone.addEventListener(evtName, (evt) => {
    evt.preventDefault();
    dropzone.classList.add('active');
  });
});

['dragleave', 'drop'].forEach((evtName) => {
  dropzone.addEventListener(evtName, (evt) => {
    evt.preventDefault();
    dropzone.classList.remove('active');
  });
});

dropzone.addEventListener('drop', (evt) => {
  const file = evt.dataTransfer?.files?.[0];
  uploadFile(file);
});

input.addEventListener('change', () => {
  uploadFile(input.files?.[0]);
});

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

fontFamilySelect.addEventListener('change', () => {
  setFontFamily(fontFamilySelect.value);
  scheduleRecompute();
});

fontSizeInput.addEventListener('input', () => {
  setFontSize(fontSizeInput.value);
  scheduleRecompute();
});

readerWidthInput.addEventListener('input', () => {
  setReaderWidth(readerWidthInput.value);
  scheduleRecompute();
});

settingsOpenBtn.addEventListener('click', () => {
  if (typeof settingsDialog.showModal === 'function') {
    settingsDialog.showModal();
  } else {
    settingsDialog.setAttribute('open', '');
  }
});

settingsDialog.addEventListener('click', (evt) => {
  if (evt.target === settingsDialog) {
    settingsDialog.close();
  }
});

window.addEventListener('scroll', updateAdaptiveHue, { passive: true });
window.addEventListener('resize', () => {
  syncMeasureWidth();
  scheduleRecompute();
});

initTheme();
initReaderPrefs();
setHue(baseHue);
syncMeasureWidth();
