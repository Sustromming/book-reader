const dropzone = document.getElementById('dropzone');
const input = document.getElementById('epub-input');
const chooseBookBtn = document.getElementById('choose-book');
const statusEl = document.getElementById('status');
const reader = document.getElementById('reader');
const themeSelect = document.getElementById('theme-select');
const fontFamilySelect = document.getElementById('font-family');
const fontSizeInput = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');
const readerWidthInput = document.getElementById('reader-width');
const readerWidthValue = document.getElementById('reader-width-value');
const brightnessInput = document.getElementById('brightness');
const brightnessValue = document.getElementById('brightness-value');
const contrastInput = document.getElementById('contrast');
const contrastValue = document.getElementById('contrast-value');
const sepiaInput = document.getElementById('sepia');
const sepiaValue = document.getElementById('sepia-value');
const grayscaleInput = document.getElementById('grayscale');
const grayscaleValue = document.getElementById('grayscale-value');
const settingsDialog = document.getElementById('settings-dialog');
const settingsOpenBtn = document.getElementById('settings-open');
const newBookBtn = document.getElementById('new-book');
const bookHeader = document.getElementById('book-header');
const bookTitle = document.getElementById('book-title');
const layout = document.querySelector('.layout');

const BASE_TITLE = 'EPUB Reader';
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const THEME_KEY = 'epub_reader_theme';
const FONT_KEY = 'epub_reader_font';
const SIZE_KEY = 'epub_reader_size';
const WIDTH_KEY = 'epub_reader_width';
const BRIGHTNESS_KEY = 'epub_reader_brightness';
const CONTRAST_KEY = 'epub_reader_contrast';
const SEPIA_KEY = 'epub_reader_sepia';
const GRAYSCALE_KEY = 'epub_reader_grayscale';
const FONT_OPTIONS = new Set(['serif', 'sans', 'mono']);
const THEME_OPTIONS = new Set([
  'light', 'sepia', 'dark', 'black', 'nord', 'dracula',
  'gruvbox-dark', 'catppuccin-dark', 'solarized-dark', 'system',
]);
const SIZE_MIN = 10;
const SIZE_MAX = 26;
const SIZE_DEFAULT = 17;
const WIDTH_MIN = 520;
const WIDTH_MAX = 1100;
const WIDTH_DEFAULT = 760;
const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 150;
const BRIGHTNESS_DEFAULT = 100;
const CONTRAST_MIN = 50;
const CONTRAST_MAX = 150;
const CONTRAST_DEFAULT = 100;
const SEPIA_MIN = 0;
const SEPIA_MAX = 100;
const SEPIA_DEFAULT = 0;
const GRAYSCALE_MIN = 0;
const GRAYSCALE_MAX = 100;
const GRAYSCALE_DEFAULT = 0;

let baseHue = 28;
let hueRaf = 0;
let activeUploadController = null;
let uploadSequence = 0;

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_err) {
    // Storage may be disabled or full.
  }
}

function closeSettingsDialog() {
  if (typeof settingsDialog.close === 'function' && settingsDialog.open) {
    settingsDialog.close();
  } else {
    settingsDialog.removeAttribute('open');
  }
  settingsOpenBtn.setAttribute('aria-expanded', 'false');
  settingsOpenBtn.focus();
}

settingsDialog.addEventListener('close', () => {
  settingsOpenBtn.setAttribute('aria-expanded', 'false');
});

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
  const scrollableHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = Math.min(1, Math.max(0, window.scrollY / scrollableHeight));
  setHue((baseHue + Math.round(progress * 120)) % 360);
}

function scheduleAdaptiveHue() {
  if (hueRaf) return;
  hueRaf = window.requestAnimationFrame(() => {
    hueRaf = 0;
    updateAdaptiveHue();
  });
}

function setTheme(theme) {
  const resolved = THEME_OPTIONS.has(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  themeSelect.value = resolved;
  safeSetItem(THEME_KEY, resolved);
}

function initTheme() {
  const saved = safeGetItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function setFontFamily(font) {
  const resolved = FONT_OPTIONS.has(font) ? font : 'serif';
  document.documentElement.setAttribute('data-font', resolved);
  fontFamilySelect.value = resolved;
  safeSetItem(FONT_KEY, resolved);
}

function setFontSize(size) {
  const parsed = Number.parseInt(String(size).replace(/px$/i, ''), 10);
  const resolved = Number.isFinite(parsed)
    ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, parsed))
    : SIZE_DEFAULT;
  document.documentElement.style.setProperty('--reader-font-size', `${resolved}px`);
  fontSizeInput.value = String(resolved);
  fontSizeValue.textContent = `${resolved}px`;
  safeSetItem(SIZE_KEY, String(resolved));
}

function setReaderWidth(width) {
  const parsed = Number.parseInt(String(width).replace(/px$/i, ''), 10);
  const resolved = Number.isFinite(parsed)
    ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, parsed))
    : WIDTH_DEFAULT;
  document.documentElement.style.setProperty('--reader-max-width', `${resolved}px`);
  readerWidthInput.value = String(resolved);
  readerWidthValue.textContent = `${resolved}px`;
  safeSetItem(WIDTH_KEY, String(resolved));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function setBrightness(value) {
  const resolved = clampInt(value, BRIGHTNESS_MIN, BRIGHTNESS_MAX, BRIGHTNESS_DEFAULT);
  document.documentElement.style.setProperty('--reader-brightness', `${resolved}%`);
  brightnessInput.value = String(resolved);
  brightnessValue.textContent = `${resolved}%`;
  safeSetItem(BRIGHTNESS_KEY, String(resolved));
}

function setContrast(value) {
  const resolved = clampInt(value, CONTRAST_MIN, CONTRAST_MAX, CONTRAST_DEFAULT);
  document.documentElement.style.setProperty('--reader-contrast', `${resolved}%`);
  contrastInput.value = String(resolved);
  contrastValue.textContent = `${resolved}%`;
  safeSetItem(CONTRAST_KEY, String(resolved));
}

function setSepia(value) {
  const resolved = clampInt(value, SEPIA_MIN, SEPIA_MAX, SEPIA_DEFAULT);
  document.documentElement.style.setProperty('--reader-sepia', `${resolved}%`);
  sepiaInput.value = String(resolved);
  sepiaValue.textContent = `${resolved}%`;
  safeSetItem(SEPIA_KEY, String(resolved));
}

function setGrayscale(value) {
  const resolved = clampInt(value, GRAYSCALE_MIN, GRAYSCALE_MAX, GRAYSCALE_DEFAULT);
  document.documentElement.style.setProperty('--reader-grayscale', `${resolved}%`);
  grayscaleInput.value = String(resolved);
  grayscaleValue.textContent = `${resolved}%`;
  safeSetItem(GRAYSCALE_KEY, String(resolved));
}

function initReaderPrefs() {
  setFontFamily(safeGetItem(FONT_KEY) || 'serif');
  setFontSize(safeGetItem(SIZE_KEY) || SIZE_DEFAULT);
  setReaderWidth(safeGetItem(WIDTH_KEY) || WIDTH_DEFAULT);
  setBrightness(safeGetItem(BRIGHTNESS_KEY) || BRIGHTNESS_DEFAULT);
  setContrast(safeGetItem(CONTRAST_KEY) || CONTRAST_DEFAULT);
  setSepia(safeGetItem(SEPIA_KEY) || SEPIA_DEFAULT);
  setGrayscale(safeGetItem(GRAYSCALE_KEY) || GRAYSCALE_DEFAULT);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function validPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.title !== 'string') return false;
  if (!Array.isArray(payload.chapters) || payload.chapters.length === 0) return false;
  return payload.chapters.every((chapter) => (
    chapter && typeof chapter === 'object' && typeof chapter.html === 'string'
  ));
}

async function renderChapters(chapters, language) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < chapters.length; index += 1) {
    const payload = chapters[index];
    const section = document.createElement('section');
    section.className = 'chapter';
    section.id = typeof payload.id === 'string' && /^chapter-\d+$/.test(payload.id)
      ? payload.id
      : `chapter-${index + 1}`;
    if (typeof language === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) {
      section.lang = language;
    }
    section.innerHTML = payload.html;
    fragment.appendChild(section);
    if ((index + 1) % 4 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return fragment;
}

async function waitForImages(container) {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.allSettled(images.map((image) => {
    if (typeof image.decode === 'function') return image.decode().catch(() => undefined);
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
}

async function uploadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.epub')) {
    setStatus('Please choose a valid .epub file.');
    input.value = '';
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    setStatus('This file is too large. The maximum size is 100MB.');
    input.value = '';
    return;
  }

  if (activeUploadController) activeUploadController.abort();
  const controller = new AbortController();
  activeUploadController = controller;
  const sequence = ++uploadSequence;
  layout.setAttribute('aria-busy', 'true');
  setStatus('Parsing EPUB...');

  const formData = new FormData();
  formData.append('epub', file);

  try {
    const response = await fetch(dropzone.dataset.uploadUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Upload failed (${response.status}).`);
    if (!validPayload(payload)) throw new Error('Server returned an invalid book.');
    if (sequence !== uploadSequence) return;

    setStatus(`Rendering ${payload.chapters.length} chapters...`);
    const fragment = await renderChapters(payload.chapters, payload.language);
    reader.replaceChildren(fragment);
    reader.lang = typeof payload.language === 'string'
      && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(payload.language)
      ? payload.language
      : '';
    await waitForImages(reader);
    if (sequence !== uploadSequence) return;

    const title = payload.title.trim() || 'Untitled';
    document.title = `${title} - ${BASE_TITLE}`;
    bookTitle.textContent = title;
    bookHeader.hidden = false;
    layout.classList.add('has-book');
    newBookBtn.hidden = false;
    baseHue = hashToHue(title || file.name);
    updateAdaptiveHue();
    setStatus('Loaded. Scroll to read.');
    bookTitle.focus({ preventScroll: true });
  } catch (err) {
    if (err.name !== 'AbortError' && sequence === uploadSequence) {
      setStatus(err.message || 'The EPUB could not be loaded.');
    }
  } finally {
    if (activeUploadController === controller) activeUploadController = null;
    if (sequence === uploadSequence) layout.removeAttribute('aria-busy');
    if (sequence === uploadSequence) input.value = '';
  }
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function clearDragState() {
  pageDragDepth = 0;
  dropzone.classList.remove('active');
  document.body.classList.remove('page-dragging');
}

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropzone.classList.add('active');
  });
});

dropzone.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && dropzone.contains(event.relatedTarget)) return;
  dropzone.classList.remove('active');
});

dropzone.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  clearDragState();
  uploadFile(event.dataTransfer.files?.[0]);
});

let pageDragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event) || dropzone.contains(event.target)) return;
  event.preventDefault();
  pageDragDepth += 1;
  if (layout.classList.contains('has-book')) document.body.classList.add('page-dragging');
});

document.addEventListener('dragover', (event) => {
  if (!hasFiles(event) || dropzone.contains(event.target)) return;
  event.preventDefault();
});

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) clearDragState();
});

document.addEventListener('dragend', clearDragState);

document.addEventListener('drop', (event) => {
  if (dropzone.contains(event.target) || !hasFiles(event)) return;
  event.preventDefault();
  clearDragState();
  uploadFile(event.dataTransfer.files?.[0]);
});

function openFilePicker() {
  input.value = '';
  input.click();
}

chooseBookBtn.addEventListener('click', openFilePicker);
newBookBtn.addEventListener('click', openFilePicker);
input.addEventListener('change', () => uploadFile(input.files?.[0]));

themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
fontFamilySelect.addEventListener('change', () => setFontFamily(fontFamilySelect.value));
fontSizeInput.addEventListener('input', () => setFontSize(fontSizeInput.value));
readerWidthInput.addEventListener('input', () => setReaderWidth(readerWidthInput.value));
brightnessInput.addEventListener('input', () => setBrightness(brightnessInput.value));
contrastInput.addEventListener('input', () => setContrast(contrastInput.value));
sepiaInput.addEventListener('input', () => setSepia(sepiaInput.value));
grayscaleInput.addEventListener('input', () => setGrayscale(grayscaleInput.value));

settingsOpenBtn.addEventListener('click', () => {
  if (typeof settingsDialog.showModal === 'function') settingsDialog.showModal();
  else settingsDialog.setAttribute('open', '');
  settingsOpenBtn.setAttribute('aria-expanded', 'true');
  settingsDialog.querySelector('.control')?.focus();
});

settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) closeSettingsDialog();
});

settingsDialog.addEventListener('submit', (event) => {
  event.preventDefault();
  closeSettingsDialog();
});

settingsDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsDialog();
});

window.addEventListener('scroll', scheduleAdaptiveHue, { passive: true });
window.addEventListener('resize', scheduleAdaptiveHue);

initTheme();
initReaderPrefs();
setHue(baseHue);
