# Tech stack
- Python 3.10+ / Flask 3.1.0 backend; stdlib ZIP, XML, HTML parser, URL, and MIME helpers implement EPUB parsing/sanitization.
- Vanilla HTML, CSS, and JavaScript frontend; no local JS build system or third-party runtime script.
- uv manages the project environment and lockfile through `pyproject.toml` and `uv.lock`.
- Flask is a runtime dependency; pytest 8.3.5 is in the uv `dev` dependency group.
- Local virtual environment convention is `.venv/`.