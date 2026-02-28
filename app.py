import base64
import html
import mimetypes
import re
import zipfile
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from flask import Flask, jsonify, render_template, request


app = Flask(__name__)


CONTAINER_PATH = "META-INF/container.xml"
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB


def _read_zip_text(zf: zipfile.ZipFile, path: str) -> str:
    return zf.read(path).decode("utf-8", errors="ignore")


def _get_opf_path(zf: zipfile.ZipFile) -> str:
    container_xml = _read_zip_text(zf, CONTAINER_PATH)
    root = ET.fromstring(container_xml)
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    opf_element = root.find(".//c:rootfile", ns)
    if opf_element is None:
        raise ValueError("Invalid EPUB: OPF rootfile not found.")
    full_path = opf_element.attrib.get("full-path")
    if not full_path:
        raise ValueError("Invalid EPUB: OPF path missing.")
    return full_path


def _parse_opf(zf: zipfile.ZipFile, opf_path: str):
    opf_text = _read_zip_text(zf, opf_path)
    root = ET.fromstring(opf_text)
    ns = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}

    title_element = root.find(".//dc:title", ns)
    title = title_element.text.strip() if title_element is not None and title_element.text else "Untitled"

    manifest = {}
    for item in root.findall(".//opf:manifest/opf:item", ns):
        item_id = item.attrib.get("id")
        href = item.attrib.get("href", "")
        media_type = item.attrib.get("media-type", "")
        if item_id:
            manifest[item_id] = {"href": href, "media_type": media_type}

    spine_ids = []
    for itemref in root.findall(".//opf:spine/opf:itemref", ns):
        idref = itemref.attrib.get("idref")
        if idref:
            spine_ids.append(idref)

    return title, manifest, spine_ids


def _path_in_zip(base_file_path: str, relative_path: str) -> str:
    base_dir = PurePosixPath(base_file_path).parent
    return str((base_dir / relative_path).as_posix())


def _extract_body(xhtml_text: str) -> str:
    match = re.search(r"<body[^>]*>(.*?)</body>", xhtml_text, flags=re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1)
    return xhtml_text


def _inline_images(body_html: str, zf: zipfile.ZipFile, chapter_zip_path: str) -> str:
    img_pattern = re.compile(r'(<img\\b[^>]*\\bsrc=["\'])([^"\']+)(["\'][^>]*>)', re.IGNORECASE)

    def replace(match: re.Match) -> str:
        prefix, src, suffix = match.groups()
        if src.startswith(("data:", "http://", "https://", "#")):
            return match.group(0)

        image_zip_path = _path_in_zip(chapter_zip_path, src)
        try:
            image_bytes = zf.read(image_zip_path)
        except KeyError:
            return match.group(0)

        mime_type, _ = mimetypes.guess_type(src)
        if not mime_type:
            mime_type = "application/octet-stream"

        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64}"
        return f"{prefix}{data_url}{suffix}"

    return img_pattern.sub(replace, body_html)


def epub_to_long_html(epub_bytes: bytes) -> tuple[str, str]:
    with zipfile.ZipFile(BytesIO(epub_bytes)) as zf:
        opf_path = _get_opf_path(zf)
        title, manifest, spine_ids = _parse_opf(zf, opf_path)

        chunks = []
        for spine_id in spine_ids:
            item = manifest.get(spine_id)
            if not item:
                continue

            media_type = item.get("media_type", "")
            if "html" not in media_type and "xhtml" not in media_type:
                continue

            chapter_zip_path = _path_in_zip(opf_path, item["href"])
            try:
                xhtml_text = _read_zip_text(zf, chapter_zip_path)
            except KeyError:
                continue

            body = _extract_body(xhtml_text)
            body = _inline_images(body, zf, chapter_zip_path)
            chunks.append(f"<section class=\"chapter\">{body}</section>")

        if not chunks:
            raise ValueError("No readable HTML chapters found in EPUB spine.")

        long_html = "\n".join(chunks)
        return title, long_html


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/upload")
def upload_epub():
    file = request.files.get("epub")
    if file is None:
        return jsonify({"error": "No file uploaded."}), 400

    if not file.filename.lower().endswith(".epub"):
        return jsonify({"error": "Only .epub files are supported."}), 400

    file_bytes = file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        return jsonify({"error": "File is too large. Max size is 100MB."}), 400

    try:
        title, long_html = epub_to_long_html(file_bytes)
    except zipfile.BadZipFile:
        return jsonify({"error": "Invalid EPUB file."}), 400
    except Exception as exc:
        return jsonify({"error": f"Failed to parse EPUB: {html.escape(str(exc))}"}), 400

    return jsonify({"title": title, "html": long_html})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
