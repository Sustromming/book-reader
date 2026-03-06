import base64
import json
import unittest
import zipfile
from io import BytesIO

from app import app, epub_to_long_html


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=="
)


def build_epub(chapter_body: str) -> bytes:
    epub_bytes = BytesIO()
    with zipfile.ZipFile(epub_bytes, "w") as zf:
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""",
        )
        zf.writestr(
            "OEBPS/content.opf",
            """<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Sample Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>""",
        )
        zf.writestr(
            "OEBPS/chapter1.xhtml",
            f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>{chapter_body}</body>
</html>""",
        )
        zf.writestr("OEBPS/images/cover.png", PNG_BYTES)
    return epub_bytes.getvalue()


class EpubReaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_epub_html_is_sanitized_and_images_are_inlined(self) -> None:
        epub_bytes = build_epub(
            '<p>Hello<script>alert(1)</script>'
            '<img src="images/cover.png" onerror="alert(1)">'
            '<a href="javascript:alert(2)" onclick="alert(3)">link</a></p>'
        )

        title, html = epub_to_long_html(epub_bytes)

        self.assertEqual(title, "Sample Book")
        self.assertIn('src="data:image/png;base64,', html)
        self.assertNotIn("<script", html)
        self.assertNotIn("onerror=", html)
        self.assertNotIn("onclick=", html)
        self.assertNotIn('href="javascript:alert(2)"', html)

    def test_upload_rejects_payloads_over_limit_before_parsing(self) -> None:
        original_limit = app.config["MAX_CONTENT_LENGTH"]
        app.config["MAX_CONTENT_LENGTH"] = 32
        try:
            response = self.client.post(
                "/upload",
                data={"epub": (BytesIO(b"x" * 64), "book.epub")},
                content_type="multipart/form-data",
            )
        finally:
            app.config["MAX_CONTENT_LENGTH"] = original_limit

        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            json.loads(response.data),
            {"error": "File is too large. Max size is 100MB."},
        )

    def test_upload_rejects_invalid_epub_extension(self) -> None:
        response = self.client.post(
            "/upload",
            data={"epub": (BytesIO(b"plain text"), "book.txt")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            json.loads(response.data),
            {"error": "Only .epub files are supported."},
        )


if __name__ == "__main__":
    unittest.main()
