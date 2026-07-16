import base64
import hashlib
import html
import mimetypes
import os
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import BytesIO
from pathlib import PurePosixPath
from typing import BinaryIO
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge


app = Flask(__name__)


CONTAINER_PATH = "META-INF/container.xml"
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_REQUEST_OVERHEAD = 1024 * 1024
MAX_INLINE_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB per image
MAX_TOTAL_INLINE_IMAGE_SIZE = 25 * 1024 * 1024
MAX_CHAPTER_SOURCE_SIZE = 4 * 1024 * 1024
MAX_CHAPTER_OUTPUT_SIZE = 6 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_SIZE = 150 * 1024 * 1024
MAX_TOTAL_OUTPUT_SIZE = 40 * 1024 * 1024
MAX_XML_SIZE = 1024 * 1024
MAX_ARCHIVE_ENTRIES = 10_000
MAX_CHAPTER_COUNT = 500
MAX_INLINE_IMAGE_REFERENCES = 1_000
MAX_COMPRESSION_RATIO = 200
COMPRESSION_RATIO_MIN_SIZE = 64 * 1024
HTML_MEDIA_TYPES = {"application/xhtml+xml", "text/html"}
SAFE_IMAGE_MIME_TYPES = {
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
ALLOWED_TAGS = {
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "caption",
    "cite",
    "code",
    "dd",
    "del",
    "details",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
}
GLOBAL_ATTRS = {"class", "id", "lang", "role", "title", "dir", "style"}
TAG_ATTRS = {
    "a": {"href", "name", "target", "rel"},
    "blockquote": {"cite"},
    "img": {"src", "alt", "width", "height"},
    "ol": {"start", "type", "reversed"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
}
SKIP_CONTENT_TAGS = {"script", "style"}

app.config.update(
    MAX_CONTENT_LENGTH=MAX_FILE_SIZE + MAX_REQUEST_OVERHEAD,
    MAX_EPUB_FILE_SIZE=MAX_FILE_SIZE,
)


class EpubError(ValueError):
    """An expected, user-correctable EPUB validation or parsing failure."""


@dataclass
class _EpubBudget:
    total_uncompressed: int = 0
    total_output: int = 0
    inline_image_bytes: int = 0
    inline_image_references: int = 0
    image_cache: dict[str, str | None] = field(default_factory=dict)

    def add_output(self, value: str, chapter_output: int) -> None:
        size = len(value.encode("utf-8"))
        if chapter_output + size > MAX_CHAPTER_OUTPUT_SIZE:
            raise EpubError("EPUB chapter output is too large.")
        if self.total_output + size > MAX_TOTAL_OUTPUT_SIZE:
            raise EpubError("EPUB output is too large to display safely.")
        self.total_output += size


def _zip_info(zf: zipfile.ZipFile, path: str) -> zipfile.ZipInfo:
    try:
        info = zf.getinfo(path)
    except KeyError as exc:
        raise EpubError(f"EPUB resource is missing: {path}.") from exc
    if info.is_dir() or info.flag_bits & 0x1:
        raise EpubError(f"EPUB resource cannot be read: {path}.")
    if info.file_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
        raise EpubError("EPUB resource is too large.")
    if (
        info.file_size >= COMPRESSION_RATIO_MIN_SIZE
        and info.file_size / max(1, info.compress_size) > MAX_COMPRESSION_RATIO
    ):
        raise EpubError("EPUB contains a suspiciously compressed resource.")
    return info


def _read_zip_bytes(
    zf: zipfile.ZipFile,
    path: str,
    budget: _EpubBudget,
    *,
    max_size: int,
) -> bytes:
    info = _zip_info(zf, path)
    if info.file_size > max_size:
        raise EpubError("EPUB resource is too large.")
    if budget.total_uncompressed + info.file_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
        raise EpubError("EPUB contains too much uncompressed content.")

    try:
        with zf.open(info) as member:
            data = member.read(max_size + 1)
    except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
        raise EpubError("EPUB resource could not be read.") from exc
    if len(data) > max_size:
        raise EpubError("EPUB resource is too large.")
    budget.total_uncompressed += len(data)
    return data


def _decode_xml_bytes(data: bytes, label: str) -> str:
    """Decode an XML/XHTML member using its BOM or encoding declaration."""
    encoding = None
    if data.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        encoding = "utf-32"
    elif data.startswith((b"\xff\xfe", b"\xfe\xff")):
        encoding = "utf-16"
    elif data[:4] in {b"\x00<\x00?", b"<\x00?\x00"}:
        encoding = "utf-16-be" if data[:2] == b"\x00<" else "utf-16-le"
    elif data[:4] in {b"\x00\x00\x00<", b"<\x00\x00\x00"}:
        encoding = "utf-32-be" if data[:1] == b"\x00" else "utf-32-le"
    elif data.startswith(b"\xef\xbb\xbf"):
        encoding = "utf-8-sig"
    else:
        declaration = re.search(
            br"<\?xml[^>]{0,256}?encoding\s*=\s*['\"]([^'\"]+)['\"]",
            data[:512],
            flags=re.IGNORECASE,
        )
        if declaration:
            encoding = declaration.group(1).decode("ascii", errors="ignore")
    try:
        return data.decode(encoding or "utf-8")
    except (LookupError, UnicodeDecodeError) as exc:
        raise EpubError(f"EPUB {label} has an unsupported text encoding.") from exc


def _parse_xml(data: bytes, label: str) -> ET.Element:
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise EpubError(f"EPUB {label} is not valid XML.") from exc


def _get_opf_path(zf: zipfile.ZipFile, budget: _EpubBudget) -> str:
    container_xml = _read_zip_bytes(zf, CONTAINER_PATH, budget, max_size=MAX_XML_SIZE)
    root = _parse_xml(container_xml, "container.xml")
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    opf_element = root.find(".//c:rootfile", ns)
    if opf_element is None:
        raise EpubError("Invalid EPUB: OPF rootfile not found.")
    full_path = opf_element.attrib.get("full-path")
    if not full_path:
        raise EpubError("Invalid EPUB: OPF path missing.")
    return _path_in_zip("", full_path)


def _parse_opf(zf: zipfile.ZipFile, opf_path: str, budget: _EpubBudget):
    opf_data = _read_zip_bytes(zf, opf_path, budget, max_size=MAX_XML_SIZE)
    root = _parse_xml(opf_data, "content.opf")
    ns = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}

    title_element = root.find(".//dc:title", ns)
    title = title_element.text.strip() if title_element is not None and title_element.text else "Untitled"
    language_element = root.find(".//dc:language", ns)
    language = language_element.text.strip() if language_element is not None and language_element.text else None
    if language and not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", language):
        language = None

    manifest = {}
    for item in root.findall(".//opf:manifest/opf:item", ns):
        item_id = item.attrib.get("id")
        href = item.attrib.get("href", "")
        media_type = item.attrib.get("media-type", "").lower()
        if item_id and href:
            manifest[item_id] = {"href": href, "media_type": media_type}

    spine_ids = []
    for itemref in root.findall(".//opf:spine/opf:itemref", ns):
        idref = itemref.attrib.get("idref")
        if idref:
            spine_ids.append(idref)

    return title, language, manifest, spine_ids


def _path_in_zip(base_file_path: str, relative_path: str) -> str:
    try:
        parsed = urlsplit(relative_path.strip())
    except ValueError as exc:
        raise EpubError("EPUB contains an invalid resource URL.") from exc
    if parsed.scheme or parsed.netloc or "\\" in parsed.path or "\x00" in parsed.path:
        raise EpubError("EPUB contains an invalid resource URL.")
    path = unquote(parsed.path)
    base_dir = PurePosixPath(base_file_path).parent.as_posix() if base_file_path else ""
    normalized = posixpath.normpath(posixpath.join(base_dir, path))
    if normalized in {"", ".", ".."} or normalized.startswith("../"):
        raise EpubError("EPUB resource path escapes the archive.")
    return normalized.lstrip("/")


_SAFE_STYLE_PROPS = {"font-style", "font-weight", "text-decoration"}


def _sanitize_style(value: str) -> str:
    safe_parts: list[str] = []
    for declaration in value.split(";"):
        declaration = declaration.strip()
        if not declaration or ":" not in declaration:
            continue
        prop, _, val = declaration.partition(":")
        prop = prop.strip().lower()
        val = val.strip()
        if prop not in _SAFE_STYLE_PROPS:
            continue
        if not val:
            continue
        lowered = val.lower().replace("\\", "")
        if any(ch in lowered for ch in (";", "expression", "url(", "javascript:", "vbscript:", "&#")):
            continue
        safe_parts.append(f"{prop}: {val}")
    return "; ".join(safe_parts)


def _local_name(value: str) -> str:
    return value.rsplit(":", 1)[-1].lower()


def _fragment_id(chapter_id: str, original_id: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", original_id).strip("-")[:48] or "target"
    digest = hashlib.sha256(original_id.encode("utf-8")).hexdigest()[:8]
    return f"{chapter_id}-{slug}-{digest}"


def _rewrite_href(
    value: str,
    *,
    chapter_path: str,
    chapter_id: str,
    chapter_paths: dict[str, str],
) -> tuple[str | None, bool]:
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return None, False
    if parsed.scheme:
        if parsed.scheme.lower() in {"http", "https", "mailto"}:
            return value.strip(), True
        return None, False
    if parsed.netloc or "\\" in parsed.path or "\x00" in value:
        return None, False

    if not parsed.path:
        target_id = chapter_id
    else:
        try:
            target_path = _path_in_zip(chapter_path, parsed.path)
        except EpubError:
            return None, False
        target_id = chapter_paths.get(target_path)
        if target_id is None:
            return None, False

    if parsed.fragment:
        return f"#{_fragment_id(target_id, unquote(parsed.fragment))}", False
    return f"#{target_id}", False


class _SafeHtmlParser(HTMLParser):
    def __init__(
        self,
        *,
        zf: zipfile.ZipFile,
        chapter_path: str,
        chapter_id: str,
        chapter_paths: dict[str, str],
        budget: _EpubBudget,
    ) -> None:
        super().__init__(convert_charrefs=False)
        self.zf = zf
        self.chapter_path = chapter_path
        self.chapter_id = chapter_id
        self.chapter_paths = chapter_paths
        self.budget = budget
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.skip_depth = 0
        self.body_depth = 0
        self.saw_body = False
        self.chapter_output = 0

    def _append(self, value: str) -> None:
        self.budget.add_output(value, self.chapter_output)
        self.chapter_output += len(value.encode("utf-8"))
        self.parts.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = _local_name(tag)
        if tag == "body":
            self.body_depth += 1
            self.saw_body = True
            return
        if self.body_depth == 0:
            return
        self._append_start_tag(tag, attrs, close=False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = _local_name(tag)
        if tag == "body" or self.body_depth == 0:
            return
        self._append_start_tag(tag, attrs, close=True)

    def _append_start_tag(self, tag: str, attrs: list[tuple[str, str | None]], *, close: bool) -> None:
        if tag in SKIP_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return

        allowed_attrs = GLOBAL_ATTRS | TAG_ATTRS.get(tag, set())
        cleaned_attrs: list[str] = []
        seen_attrs: set[str] = set()
        external_link = False
        for attr_name, attr_value in attrs:
            attr_name = attr_name.lower()
            if attr_name.startswith("on"):
                continue
            if attr_name in {"target", "rel"}:
                continue
            if attr_name not in allowed_attrs and not attr_name.startswith("aria-"):
                continue
            if attr_name in seen_attrs:
                continue
            seen_attrs.add(attr_name)
            if attr_value is None:
                cleaned_attrs.append(attr_name)
                continue
            if attr_name == "id":
                attr_value = _fragment_id(self.chapter_id, attr_value)
            elif attr_name == "name" and tag == "a":
                attr_name = "id"
                attr_value = _fragment_id(self.chapter_id, attr_value)
            elif attr_name == "href" and tag == "a":
                attr_value, external_link = _rewrite_href(
                    attr_value,
                    chapter_path=self.chapter_path,
                    chapter_id=self.chapter_id,
                    chapter_paths=self.chapter_paths,
                )
                if attr_value is None:
                    continue
            elif attr_name == "src" and tag == "img":
                attr_value = self._inline_image(attr_value)
                if attr_value is None:
                    continue
            if attr_name == "style":
                attr_value = _sanitize_style(attr_value)
                if not attr_value:
                    continue
            escaped_value = html.escape(attr_value, quote=True)
            cleaned_attrs.append(f'{attr_name}="{escaped_value}"')

        if external_link:
            cleaned_attrs.extend([
                'target="_blank"',
                'rel="noopener noreferrer"',
            ])

        attr_text = f" {' '.join(cleaned_attrs)}" if cleaned_attrs else ""
        if close or tag in VOID_TAGS:
            self._append(f"<{tag}{attr_text}>")
            return

        self._append(f"<{tag}{attr_text}>")
        self.open_tags.append(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = _local_name(tag)
        if tag == "body":
            self.body_depth = max(0, self.body_depth - 1)
            return
        if tag in SKIP_CONTENT_TAGS:
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS or tag in VOID_TAGS:
            return

        for index in range(len(self.open_tags) - 1, -1, -1):
            open_tag = self.open_tags[index]
            self._append(f"</{open_tag}>")
            self.open_tags.pop()
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self.body_depth and not self.skip_depth:
            self._append(html.escape(data))

    def handle_entityref(self, name: str) -> None:
        if self.body_depth and not self.skip_depth:
            self._append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self.body_depth and not self.skip_depth:
            self._append(f"&#{name};")

    def _inline_image(self, value: str) -> str | None:
        self.budget.inline_image_references += 1
        if self.budget.inline_image_references > MAX_INLINE_IMAGE_REFERENCES:
            raise EpubError("EPUB contains too many image references.")
        try:
            parsed = urlsplit(value.strip())
        except ValueError:
            return None
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return None
        try:
            image_path = _path_in_zip(self.chapter_path, parsed.path)
        except EpubError:
            return None
        if image_path in self.budget.image_cache:
            return self.budget.image_cache[image_path]

        mime_type, _ = mimetypes.guess_type(unquote(parsed.path))
        if mime_type not in SAFE_IMAGE_MIME_TYPES:
            self.budget.image_cache[image_path] = None
            return None
        try:
            info = _zip_info(self.zf, image_path)
        except EpubError:
            self.budget.image_cache[image_path] = None
            return None
        if info.file_size > MAX_INLINE_IMAGE_SIZE:
            self.budget.image_cache[image_path] = None
            return None
        if self.budget.inline_image_bytes + info.file_size > MAX_TOTAL_INLINE_IMAGE_SIZE:
            raise EpubError("EPUB contains too much image data.")

        image_bytes = _read_zip_bytes(
            self.zf,
            image_path,
            self.budget,
            max_size=MAX_INLINE_IMAGE_SIZE,
        )
        self.budget.inline_image_bytes += len(image_bytes)
        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64}"
        self.budget.image_cache[image_path] = data_url
        return data_url

    def get_html(self) -> str:
        while self.open_tags:
            self._append(f"</{self.open_tags.pop()}>")
        if not self.saw_body:
            raise EpubError("EPUB chapter does not contain a body.")
        return "".join(self.parts)


def _sanitize_body_html(
    xhtml_text: str,
    *,
    zf: zipfile.ZipFile,
    chapter_path: str,
    chapter_id: str,
    chapter_paths: dict[str, str],
    budget: _EpubBudget,
) -> str:
    parser = _SafeHtmlParser(
        zf=zf,
        chapter_path=chapter_path,
        chapter_id=chapter_id,
        chapter_paths=chapter_paths,
        budget=budget,
    )
    parser.feed(xhtml_text)
    parser.close()
    return parser.get_html()


def _parse_epub(epub_source: bytes | BinaryIO) -> tuple[str, str | None, list[dict]]:
    source = BytesIO(epub_source) if isinstance(epub_source, bytes) else epub_source
    with zipfile.ZipFile(source) as zf:
        archive_entries = zf.infolist()
        if len(archive_entries) > MAX_ARCHIVE_ENTRIES:
            raise EpubError("EPUB contains too many archive entries.")
        if len({entry.filename for entry in archive_entries}) != len(archive_entries):
            raise EpubError("EPUB contains duplicate archive entries.")
        budget = _EpubBudget()
        mimetype_data = _read_zip_bytes(zf, "mimetype", budget, max_size=64)
        if mimetype_data != b"application/epub+zip":
            raise EpubError("Invalid EPUB mimetype entry.")
        opf_path = _get_opf_path(zf, budget)
        title, language, manifest, spine_ids = _parse_opf(zf, opf_path, budget)
        if len(spine_ids) > MAX_CHAPTER_COUNT:
            raise EpubError("EPUB contains too many chapters.")

        chapter_records: list[tuple[str, str, str]] = []
        chapter_paths: dict[str, str] = {}
        for index, spine_id in enumerate(spine_ids, start=1):
            item = manifest.get(spine_id)
            if not item:
                raise EpubError("EPUB spine references a missing manifest item.")
            if item["media_type"] not in HTML_MEDIA_TYPES:
                raise EpubError("EPUB spine contains a non-HTML reading item.")
            chapter_zip_path = _path_in_zip(opf_path, item["href"])
            chapter_id = f"chapter-{index}"
            if chapter_zip_path in chapter_paths:
                raise EpubError("EPUB spine contains a duplicate chapter.")
            chapter_paths[chapter_zip_path] = chapter_id
            chapter_records.append((chapter_id, chapter_zip_path, item["media_type"]))

        chapters: list[dict] = []
        for chapter_id, chapter_zip_path, _media_type in chapter_records:
            chapter_bytes = _read_zip_bytes(
                zf,
                chapter_zip_path,
                budget,
                max_size=MAX_CHAPTER_SOURCE_SIZE,
            )
            xhtml_text = _decode_xml_bytes(chapter_bytes, "chapter")
            body = _sanitize_body_html(
                xhtml_text,
                zf=zf,
                chapter_path=chapter_zip_path,
                chapter_id=chapter_id,
                chapter_paths=chapter_paths,
                budget=budget,
            )
            chapters.append({"id": chapter_id, "html": body})

        if not chapters:
            raise EpubError("No readable HTML chapters found in EPUB spine.")

        return title, language, chapters


def epub_to_chapters(epub_source: bytes | BinaryIO) -> tuple[str, list[dict]]:
    title, _language, chapters = _parse_epub(epub_source)
    return title, chapters


@app.get("/")
def index():
    return render_template("index.html")


@app.after_request
def add_security_headers(response):
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


def _max_file_size_label() -> str:
    size = app.config.get("MAX_EPUB_FILE_SIZE", MAX_FILE_SIZE)
    if size % (1024 * 1024) == 0:
        return f"{size // (1024 * 1024)}MB"
    return f"{size} bytes"


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(_exc: RequestEntityTooLarge):
    return jsonify({"error": f"File is too large. Max size is {_max_file_size_label()}."}), 413


def _uploaded_size(file) -> int | None:
    stream = file.stream
    if not all(hasattr(stream, method) for method in ("tell", "seek")):
        return None
    try:
        current = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(current)
        return size
    except (OSError, ValueError):
        return None


@app.post("/upload")
def upload_epub():
    file = request.files.get("epub")
    if file is None:
        return jsonify({"error": "No file uploaded."}), 400

    filename = file.filename or ""
    if not filename.lower().endswith(".epub"):
        return jsonify({"error": "Only .epub files are supported."}), 400

    uploaded_size = _uploaded_size(file)
    if uploaded_size is not None and uploaded_size > app.config.get("MAX_EPUB_FILE_SIZE", MAX_FILE_SIZE):
        return handle_file_too_large(RequestEntityTooLarge())

    try:
        if hasattr(file.stream, "seek"):
            file.stream.seek(0)
        title, language, chapters = _parse_epub(file.stream)
    except zipfile.BadZipFile:
        return jsonify({"error": "Invalid EPUB file."}), 400
    except EpubError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("Unexpected EPUB upload failure")
        return jsonify({"error": "The EPUB could not be processed."}), 500

    return jsonify({"title": title, "language": language, "chapters": chapters})


if __name__ == "__main__":
    app.run(
        host=os.environ.get("FLASK_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
