const dropzone = document.getElementById('dropzone');
const input = document.getElementById('epub-input');
const statusEl = document.getElementById('status');
const reader = document.getElementById('reader');
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
let baseHue = 28;
let rafLocked = false;

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

async function uploadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.epub')) {
    setStatus('Please choose a valid .epub file.');
    return;
  }

  setStatus('Parsing EPUB...');
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
    reader.innerHTML = payload.html;
    baseHue = hashToHue(payload.title || file.name);
    updateAdaptiveHue();
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
});

fontSizeInput.addEventListener('input', () => {
  setFontSize(fontSizeInput.value);
});

readerWidthInput.addEventListener('input', () => {
  setReaderWidth(readerWidthInput.value);
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
initTheme();
initReaderPrefs();
setHue(baseHue);
