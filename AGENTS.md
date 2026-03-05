# Repository Guidelines

## Project Structure & Module Organization
- `app.py`: Flask entry point, upload route, and EPUB parsing helpers.
- `templates/index.html`: base UI markup served by Flask.
- `static/app.js`: client upload flow, theme toggle, and adaptive hue behavior.
- `static/styles.css`: visual styles for layout, theme, and reader content.
- `requirements.txt`: pinned runtime dependency versions.
- There is no committed `tests/` directory yet; add future tests under `tests/` and mirror target modules (example: `tests/test_upload.py`).

## Build, Test, and Development Commands
- `python3 -m venv .venv && source .venv/bin/activate`: create/activate local environment.
- `pip install -r requirements.txt`: install dependencies.
- `python3 app.py`: run the app locally on `http://127.0.0.1:5000`.
- `python3 -m py_compile app.py`: fast syntax validation before opening a PR.
- If tests are added, run `pytest -q`.

## Coding Style & Naming Conventions
- Python: PEP 8, 4-space indentation, `snake_case` for functions/variables, `UPPER_CASE` for constants.
- JavaScript/CSS/HTML: 2-space indentation; use `camelCase` for JS identifiers and `kebab-case` for CSS class names.
- Keep Flask route handlers thin and move parsing logic into helper functions.
- Preserve current defensive patterns for user input and error messages (for example, escaping exception text before returning JSON).

## Testing Guidelines
- No automated coverage gate exists yet; every change should include manual verification.
- Minimum manual checks:
  - valid `.epub` upload renders chapters
  - invalid file type is rejected
  - files over 100 MB are rejected
  - theme toggle and scrolling reader behavior still work
- For automated tests, prefer `pytest` with `tests/test_*.py` naming and focus on EPUB parsing edge cases plus `/upload` success/error responses.

## Commit & Pull Request Guidelines
- Follow the repo’s concise, imperative commit style (examples in history: `add README`, `Dom + dark theme`).
- Keep commit subjects short (target <= 72 chars) and scope each commit to one logical change.
- PRs should include: summary of behavior changes, manual test steps/results, linked issue (if any), and screenshots/GIFs for UI changes.
