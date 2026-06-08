from io import BytesIO
import zipfile

import pytest

from app import MAX_FILE_SIZE, MAX_INLINE_IMAGE_SIZE, app, epub_to_chapters


def make_epub(*, chapter_body: str, image_map: dict[str, bytes] | None = None) -> bytes:
    image_map = image_map or {}
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>""",
        )
        zf.writestr(
            "OPS/content.opf",
            """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter-1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter-1" />
  </spine>
</package>""",
        )
        zf.writestr(
            "OPS/Text/chapter1.xhtml",
            f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>{chapter_body}</body>
</html>""",
        )
        for path, data in image_map.items():
            zf.writestr(path, data)

    return buffer.getvalue()


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


def test_epub_to_chapters_inlines_normalized_relative_images():
    epub_bytes = make_epub(
        chapter_body='<p><img src="../Images/pic.png" alt="cover" /></p>',
        image_map={"OPS/Images/pic.png": b"png-bytes"},
    )

    title, chapters = epub_to_chapters(epub_bytes)

    assert title == "Test Book"
    assert len(chapters) == 1
    assert 'src="data:image/png;base64,' in chapters[0]["html"]


def test_epub_to_chapters_skips_oversized_inline_images():
    large_image = b"x" * (MAX_INLINE_IMAGE_SIZE + 1)
    epub_bytes = make_epub(
        chapter_body='<p><img src="../Images/large.png" alt="large" /></p>',
        image_map={"OPS/Images/large.png": large_image},
    )

    _, chapters = epub_to_chapters(epub_bytes)

    assert 'src="../Images/large.png"' in chapters[0]["html"]
    assert 'src="data:image/png;base64,' not in chapters[0]["html"]


def test_epub_to_chapters_preserves_safe_style_and_strips_unsafe():
    epub_bytes = make_epub(
        chapter_body=(
            '<p><span style="color:#fff">Alpha</span> '
            '<em style="background:#000">Beta</em> '
            '<b style="font-weight:bold;color:red">Gamma</b> '
            '<i style="display:none;position:fixed">Delta</i></p>'
        ),
    )

    _, chapters = epub_to_chapters(epub_bytes)

    html = chapters[0]["html"]
    assert "color: #fff" in html, f"safe color should be preserved, got: {html}"
    assert html.count("background") == 0, f"unsafe background should be stripped, got: {html}"
    assert "font-weight: bold" in html, f"safe font-weight should be preserved, got: {html}"
    assert "color: red" in html, f"safe color should be preserved, got: {html}"
    assert "display" not in html, f"unsafe display should be stripped, got: {html}"
    assert "position" not in html, f"unsafe position should be stripped, got: {html}"


def test_upload_epub_success(client):
    epub_bytes = make_epub(chapter_body="<p>Hello reader.</p>")

    response = client.post(
        "/upload",
        data={"epub": (BytesIO(epub_bytes), "book.epub")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["title"] == "Test Book"
    assert payload["chapters"] == [{"html": "<p>Hello reader.</p>"}]


def test_upload_rejects_invalid_extension(client):
    response = client.post(
        "/upload",
        data={"epub": (BytesIO(b"not an epub"), "book.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Only .epub files are supported."}


def test_upload_rejects_large_files(client):
    app.config["MAX_CONTENT_LENGTH"] = 8
    try:
        response = client.post(
            "/upload",
            data={"epub": (BytesIO(b"123456789"), "book.epub")},
            content_type="multipart/form-data",
        )
    finally:
        app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE

    assert response.status_code == 413
    assert response.get_json() == {"error": "File is too large. Max size is 100MB."}
