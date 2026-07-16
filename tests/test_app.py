from io import BytesIO
import re
import zipfile

import pytest

import app as app_module
from app import EpubError, MAX_FILE_SIZE, MAX_INLINE_IMAGE_SIZE, app, epub_to_chapters


def make_epub(
    *,
    chapter_body: str = "",
    chapters: list[str] | None = None,
    image_map: dict[str, bytes] | None = None,
    encoding: str = "utf-8",
    language: str | None = None,
    media_type: str = "application/xhtml+xml",
) -> bytes:
    image_map = image_map or {}
    chapter_bodies = chapters or [chapter_body]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>""",
        )
        manifest = "\n".join(
            f'    <item id="chapter-{index}" href="Text/chapter{index}.xhtml" '
            f'media-type="{media_type}" />'
            for index in range(1, len(chapter_bodies) + 1)
        )
        spine = "\n".join(
            f'    <itemref idref="chapter-{index}" />'
            for index in range(1, len(chapter_bodies) + 1)
        )
        language_xml = f"<dc:language>{language}</dc:language>" if language else ""
        zf.writestr(
            "OPS/content.opf",
            f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    {language_xml}
  </metadata>
  <manifest>
{manifest}
  </manifest>
  <spine>
{spine}
  </spine>
</package>""",
        )
        for index, body in enumerate(chapter_bodies, start=1):
            chapter = f"""<?xml version="1.0" encoding="{encoding}"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Ignored</title></head>
  <body>{body}</body>
</html>"""
            zf.writestr(f"OPS/Text/chapter{index}.xhtml", chapter.encode(encoding))
        for path, data in image_map.items():
            zf.writestr(path, data)

    return buffer.getvalue()


@pytest.fixture()
def client():
    previous_testing = app.config.get("TESTING")
    previous_limit = app.config.get("MAX_CONTENT_LENGTH")
    previous_epub_limit = app.config.get("MAX_EPUB_FILE_SIZE")
    app.config["TESTING"] = True
    app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE + app_module.MAX_REQUEST_OVERHEAD
    app.config["MAX_EPUB_FILE_SIZE"] = MAX_FILE_SIZE
    with app.test_client() as test_client:
        yield test_client
    app.config["TESTING"] = previous_testing
    app.config["MAX_CONTENT_LENGTH"] = previous_limit
    app.config["MAX_EPUB_FILE_SIZE"] = previous_epub_limit


def test_epub_to_chapters_inlines_normalized_relative_images():
    epub_bytes = make_epub(
        chapter_body='<p><img src="../Images/pic.png" alt="cover" /></p>',
        image_map={"OPS/Images/pic.png": b"png-bytes"},
    )

    title, chapters = epub_to_chapters(epub_bytes)

    assert title == "Test Book"
    assert chapters[0]["id"] == "chapter-1"
    assert 'src="data:image/png;base64,' in chapters[0]["html"]


def test_epub_to_chapters_resolves_entities_and_drops_remote_images():
    epub_bytes = make_epub(
        chapter_body=(
            '<img src="../Images/a&amp;b.png" alt="local" />'
            '<img src="https://tracker.invalid/pixel" alt="remote" />'
        ),
        image_map={"OPS/Images/a&b.png": b"png-bytes"},
    )

    _, chapters = epub_to_chapters(epub_bytes)
    html = chapters[0]["html"]

    assert html.count('src="data:image/png;base64,') == 1
    assert "tracker.invalid" not in html
    assert 'alt="remote"' in html


def test_epub_to_chapters_drops_oversized_inline_images():
    large_image = b"x" * (MAX_INLINE_IMAGE_SIZE + 1)
    epub_bytes = make_epub(
        chapter_body='<p><img src="../Images/large.png" alt="large" /></p>',
        image_map={"OPS/Images/large.png": large_image},
    )

    _, chapters = epub_to_chapters(epub_bytes)

    assert '<img alt="large">' in chapters[0]["html"]
    assert "large.png" not in chapters[0]["html"]


def test_epub_to_chapters_strips_inline_colors_and_unsafe_css():
    epub_bytes = make_epub(
        chapter_body=(
            '<p><span style="color:#fff">Alpha</span> '
            '<em style="background:#000">Beta</em> '
            '<b style="font-weight:bold;color:red">Gamma</b> '
            '<i style="font-weight:EXPRESSION(alert(1))">Delta</i></p>'
        ),
    )

    _, chapters = epub_to_chapters(epub_bytes)
    html = chapters[0]["html"]

    assert "color" not in html
    assert "background" not in html
    assert "font-weight: bold" in html
    assert "expression" not in html.lower()


def test_epub_to_chapters_rewrites_internal_links_and_namespaces_ids():
    epub_bytes = make_epub(
        chapters=[
            '<p id="intro"><a href="#intro">Start</a> '
            '<a href="chapter2.xhtml#target">Next</a></p>',
            '<p id="target">Second</p>',
        ],
        language="fr",
    )

    _, chapters = epub_to_chapters(epub_bytes)
    first_html = chapters[0]["html"]
    target_id = re.search(r'<p id="([^"]+)">Second', chapters[1]["html"]).group(1)

    assert 'href="#chapter-1-intro-' in first_html
    assert f'href="#{target_id}"' in first_html
    assert chapters[1]["id"] == "chapter-2"


def test_epub_to_chapters_uses_body_not_comments_or_head_text():
    epub_bytes = make_epub(
        chapter_body="<!-- <body>Fake</body> --><p>Real</p>",
    )

    _, chapters = epub_to_chapters(epub_bytes)

    assert "Fake" not in chapters[0]["html"]
    assert "Real" in chapters[0]["html"]


def test_epub_to_chapters_honors_utf16_encoding():
    epub_bytes = make_epub(chapter_body="<p>Bonjour UTF-16</p>", encoding="utf-16")

    _, chapters = epub_to_chapters(epub_bytes)

    assert "Bonjour UTF-16" in chapters[0]["html"]


def test_epub_to_chapters_rejects_suspicious_compression():
    epub_bytes = make_epub(chapter_body=f"<p>{'x' * 100_000}</p>")

    with pytest.raises(EpubError, match="suspiciously compressed"):
        epub_to_chapters(epub_bytes)


def test_epub_to_chapters_enforces_output_budget(monkeypatch):
    monkeypatch.setattr(app_module, "MAX_TOTAL_OUTPUT_SIZE", 10)

    with pytest.raises(EpubError, match="output is too large"):
        epub_to_chapters(make_epub(chapter_body="<p>Output budget test</p>"))


def test_upload_epub_success(client):
    response = client.post(
        "/upload",
        data={"epub": (BytesIO(make_epub(chapter_body="<p>Hello reader.</p>")), "book.epub")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["title"] == "Test Book"
    assert payload["language"] is None
    assert payload["chapters"] == [{"html": "<p>Hello reader.</p>", "id": "chapter-1"}]


def test_upload_rejects_invalid_extension(client):
    response = client.post(
        "/upload",
        data={"epub": (BytesIO(b"not an epub"), "book.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Only .epub files are supported."}


def test_upload_rejects_invalid_zip(client):
    response = client.post(
        "/upload",
        data={"epub": (BytesIO(b"not an epub"), "book.epub")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid EPUB file."}


def test_upload_rejects_large_file_payload(client):
    previous_limit = app.config["MAX_EPUB_FILE_SIZE"]
    app.config["MAX_EPUB_FILE_SIZE"] = 8
    try:
        response = client.post(
            "/upload",
            data={"epub": (BytesIO(b"123456789"), "book.epub")},
            content_type="multipart/form-data",
        )
    finally:
        app.config["MAX_EPUB_FILE_SIZE"] = previous_limit

    assert response.status_code == 413
    assert response.get_json() == {"error": "File is too large. Max size is 8 bytes."}


def test_upload_hides_unexpected_errors(client, monkeypatch):
    def fail(_source):
        raise RuntimeError("internal detail")

    monkeypatch.setattr(app_module, "_parse_epub", fail)
    response = client.post(
        "/upload",
        data={"epub": (BytesIO(b"book"), "book.epub")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": "The EPUB could not be processed."}
