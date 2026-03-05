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
- Light/Dark theme toggle
- Adaptive color spectrum that shifts while scrolling

## Tech Stack

- Python 3
- Flask
- Vanilla HTML/CSS/JavaScript

## Project Structure

```text
.
├── app.py
├── requirements.txt
├── templates/
│   └── index.html
├── static/
│   ├── app.js
│   └── styles.css
└── README.md
```

## Quick Start

1. Create and activate virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate 
pip install -r requirements.txt 
python3 app.py
```

4. Open in browser:

```bash
http://127.0.0.1:5000
```

## How to Use

1. Open the site in browser.
2. Drag and drop an `.epub` file into the drop zone (or click **Choose file**).
3. Wait for parsing to complete.
4. Read in the rendered long-form view.
5. Use **Dark Theme / Light Theme** toggle in the header.

## API

### `POST /upload`

Uploads and parses a single EPUB file.

- Form field: `epub`
- Success response:

```json
{
  "title": "Book Title",
  "html": "<section class=\"chapter\">...</section>"
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
- Parsing depends on valid EPUB/OPF structure
- Remote assets referenced by chapter HTML are not fetched

## Development

Syntax check:

```bash
python3 -m py_compile app.py
```

## License

No license file is included yet.
