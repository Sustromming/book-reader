const dropzone = document.getElementById('dropzone');
const input = document.getElementById('epub-input');
const statusEl = document.getElementById('status');
const reader = document.getElementById('reader');
const titleEl = document.getElementById('book-title');
const themeToggle = document.getElementById('theme-toggle');

const THEME_KEY = 'epub_reader_theme';
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

    titleEl.textContent = payload.title || file.name;
    reader.innerHTML = payload.html;
    baseHue = hashToHue(payload.title || file.name);
    updateAdaptiveHue();
    setStatus('Loaded. Scroll to read.');
    window.scrollTo({ top: reader.offsetTop - 70, behavior: 'smooth' });
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

window.addEventListener('scroll', updateAdaptiveHue, { passive: true });
initTheme();
setHue(baseHue);
