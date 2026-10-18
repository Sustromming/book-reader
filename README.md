# Book Reader (Flask)

Simple drag-and-drop book reader built with Python and Flask.
It converts `.epub` books and DRM-free `.azw3`/KF8 books into one long-form HTML document and embeds it directly into the page for continuous reading. AZW3 is decoded in the browser by the bundled Foliate-JS MOBI reader; decoded content is still sent through the server's EPUB sanitizer.

- Demo:  https://sustromming.pythonanywhere.com/
## Features

- Drag-and-drop `.epub` and DRM-free `.azw3` upload
- EPUB parsing based on OPF spine order
- Chapter merge into long-form HTML
- Inline chapter images as data URLs
- In-browser reading view
- Multiple reader themes and typography controls
- Adaptive color spectrum that shifts while scrolling
- Keyboard-accessible upload and full-document search/print support

## Tech Stack

- Python 3
- Flask
- Vanilla HTML/CSS/JavaScript

## Project Structure

```text
.
├── app.py
├── pyproject.toml
├── uv.lock
├── templates/
│   └── index.html
├── static/
│   ├── app.js
│   ├── azw3.js
│   ├── styles.css
│   └── vendor/
│       ├── foliate-mobi.js
│       ├── fflate.js
│       ├── FOLIATE-JS-LICENSE.txt
│       └── FFLATE-LICENSE.txt
├── tests/
│   └── test_app.py
└── README.md
```

## Quick Start

1. Install the locked environment:

```bash
uv sync
```

2. Run the development server:

```bash
uv run python app.py
```

3. Open in browser:

```text
http://127.0.0.1:5000
```

## How to Use

1. Open the site in browser.
2. Drag and drop an `.epub` or DRM-free `.azw3` file into the drop zone (or click **Choose file**).
3. Wait for parsing to complete.
4. Read in the rendered long-form view.
5. Use **Settings** to change the theme, typography, and reading filters.

## API

### `POST /upload`

Uploads and parses a single EPUB file.

- Form field: `book` (the legacy `epub` field is still accepted)
- AZW3 files selected in the reader are decoded in the browser and submitted to the internal `POST /upload/decoded` sanitizer endpoint.
- Success response:

```json
{
  "title": "Book Title",
  "language": "en",
  "chapters": [
    {
      "id": "chapter-1",
      "html": "<p>...</p>"
    }
  ]
}
```

- Error response:

```json
{
  "error": "Error message"
}
```

## Notes and Limitations

- Supported upload types: `.epub` and DRM-free `.azw3`
- Max file size: 100 MB
- DRM-protected AZW3, KFX, and AZW4 files are not supported
- EPUBs with invalid structure, missing spine documents, suspicious compression, or excessive output are rejected
- Local raster images up to 5 MB are embedded as data URLs; unsupported or remote images are removed
- EPUB-local chapter links are rewritten to work in the continuous reader
- Unexpected server failures return a generic error and are logged server-side
- AZW3 decoding runs locally in the browser; the server independently validates resource limits and sanitizes the decoded HTML and images before returning reader content
- `static/vendor/foliate-mobi.js` and `static/vendor/fflate.js` are MIT-licensed; see their adjacent license files. Foliate-JS was vendored from revision `78914aef4466eb960965702401634c2cb348e9b1`.
- Calibre's MOBI/KF8 behavior was used as a format reference only; Calibre is not required at runtime

## Development

Syntax check:

```bash
uv run python -m py_compile app.py
```

Run tests:

```bash
uv run pytest -q
```

## License

No license file is included yet.
