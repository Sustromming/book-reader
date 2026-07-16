# EPUB Reader (Flask)

Simple drag-and-drop EPUB reader built with Python and Flask.
It converts an `.epub` into one long-form HTML document and embeds it directly into the page for continuous reading.

- Demo:  https://sustromming.pythonanywhere.com/
## Features

- Drag-and-drop `.epub` upload
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
│   └── styles.css
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
2. Drag and drop an `.epub` file into the drop zone (or click **Choose file**).
3. Wait for parsing to complete.
4. Read in the rendered long-form view.
5. Use **Settings** to change the theme, typography, and reading filters.

## API

### `POST /upload`

Uploads and parses a single EPUB file.

- Form field: `epub`
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

- Supported upload type: `.epub` only
- Max file size: 100 MB
- EPUBs with invalid structure, missing spine documents, suspicious compression, or excessive output are rejected
- Local raster images up to 5 MB are embedded as data URLs; unsupported or remote images are removed
- EPUB-local chapter links are rewritten to work in the continuous reader
- Unexpected server failures return a generic error and are logged server-side

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
