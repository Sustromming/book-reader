# Task completion
- Run `python3 -m py_compile app.py` after backend changes.
- Run `uv run pytest -q` for automated coverage.
- For upload/parser changes, manually verify valid EPUB rendering, invalid extension rejection, malformed archive handling, and oversized upload rejection.
- For frontend changes, manually verify initial and replacement upload, theme/settings controls, long-reader scrolling, and mobile layout.
- Inspect `git diff --check` and confirm unrelated worktree changes were not modified.