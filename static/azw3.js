import { MOBI, isMOBI } from './vendor/foliate-mobi.js';
import { unzlibSync } from './vendor/fflate.js';

const MAX_CHAPTER_SIZE = 4 * 1024 * 1024;
const MAX_TOTAL_CHAPTER_SIZE = 40 * 1024 * 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_COUNT = 1000;
const MAX_RECORD_COUNT = 20000;

const IMAGE_TYPES = new Map([
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
}

async function validateContainer(file) {
  if (file.size < 86) throw new Error('Invalid AZW3 file.');
  const header = new DataView(await file.slice(0, 78).arrayBuffer());
  const signature = new TextDecoder().decode(await file.slice(60, 68).arrayBuffer());
  if (signature !== 'BOOKMOBI') throw new Error('Invalid AZW3 file.');

  const recordCount = header.getUint16(76);
  const tableEnd = 78 + recordCount * 8;
  if (recordCount < 2 || recordCount > MAX_RECORD_COUNT || tableEnd > file.size) {
    throw new Error('Invalid AZW3 file.');
  }
  const table = new DataView(await file.slice(78, tableEnd).arrayBuffer());
  const offsets = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = table.getUint32(index * 8);
    if (offset < tableEnd || offset >= file.size || (index && offset <= offsets[index - 1])) {
      throw new Error('Invalid AZW3 file.');
    }
    offsets.push(offset);
  }

  const record = new DataView(await file.slice(offsets[0], offsets[0] + 16).arrayBuffer());
  if (record.byteLength < 16 || offsets[0] + 20 > file.size) {
    throw new Error('Invalid AZW3 file.');
  }
  if (record.getUint16(12) !== 0) {
    throw new Error('DRM-protected AZW3 files are not supported.');
  }
  const magic = new TextDecoder().decode(
    await file.slice(offsets[0] + 16, offsets[0] + 20).arrayBuffer(),
  );
  if (magic !== 'MOBI') throw new Error('Invalid AZW3 file.');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function readImage(url, { signal, images, imagePaths, totals }) {
  if (imagePaths.has(url)) return imagePaths.get(url);
  if (images.length >= MAX_IMAGE_COUNT) {
    throw new Error('AZW3 contains too many image resources.');
  }

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('AZW3 image resource could not be decoded.');
  const blob = await response.blob();
  const extension = IMAGE_TYPES.get(blob.type.toLowerCase());
  if (!extension || blob.size === 0 || blob.size > MAX_IMAGE_SIZE) return null;
  if (totals.imageBytes + blob.size > MAX_TOTAL_IMAGE_SIZE) {
    throw new Error('AZW3 contains too much image data.');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const id = `image-${images.length + 1}`;
  const path = `asset:${id}`;
  images.push({
    id,
    mime: blob.type.toLowerCase(),
    data: bytesToBase64(bytes),
  });
  imagePaths.set(url, path);
  totals.imageBytes += bytes.byteLength;
  return path;
}

async function sectionHtml(url, options) {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error('AZW3 chapter could not be decoded.');
  const html = await response.text();
  const size = new Blob([html]).size;
  if (size > MAX_CHAPTER_SIZE) {
    throw new Error('An AZW3 chapter is too large to process safely.');
  }
  options.totals.chapterBytes += size;
  if (options.totals.chapterBytes > MAX_TOTAL_CHAPTER_SIZE) {
    throw new Error('AZW3 content is too large to process safely.');
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const image of document.querySelectorAll('img[src]')) {
    throwIfAborted(options.signal);
    const source = image.getAttribute('src') || '';
    if (!source.startsWith('blob:')) continue;
    const path = await readImage(source, options);
    if (path) image.setAttribute('src', path);
    else image.removeAttribute('src');
  }
  return document.documentElement.outerHTML;
}

export async function decodeAzw3(file, { signal, onProgress = () => {} } = {}) {
  throwIfAborted(signal);
  if (!(await isMOBI(file))) {
    throw new Error('Invalid AZW3 file.');
  }
  await validateContainer(file);
  throwIfAborted(signal);

  let book;
  try {
    book = await new MOBI({ unzlib: unzlibSync }).open(file);
    throwIfAborted(signal);

    const sections = (book.sections || []).filter((section) => (
      section && section.linear !== 'no' && typeof section.load === 'function'
    ));
    if (sections.length === 0) throw new Error('AZW3 contains no readable chapters.');

    const images = [];
    const imagePaths = new Map();
    const totals = { chapterBytes: 0, imageBytes: 0 };
    const options = { signal, images, imagePaths, totals };
    const chapters = [];

    for (let index = 0; index < sections.length; index += 1) {
      throwIfAborted(signal);
      onProgress(`Decoding AZW3 chapter ${index + 1} of ${sections.length}...`);
      const url = await sections[index].load();
      chapters.push({ html: await sectionHtml(url, options) });
    }

    const metadata = book.metadata || {};
    const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
    return {
      title: title || file.name.replace(/\.azw3$/i, '') || 'Untitled',
      language: typeof metadata.language === 'string' ? metadata.language : null,
      chapters,
      images,
    };
  } finally {
    if (typeof book?.destroy === 'function') book.destroy();
  }
}
