# Project map
- Single-process Flask EPUB reader; upload parsing and sanitization live in `app.py`.
- Browser UI is server-rendered from `templates/index.html`; all interaction is in `static/app.js`, styling in `static/styles.css`.
- Upload contract: multipart field `epub`; success returns book title plus chapter HTML payloads in spine order.
- EPUBs are processed in memory and ZIP members are not extracted to disk.
- Tests live in `tests/test_app.py`; repository documentation claiming no tests is stale.
- Read `mem:tech_stack` for dependencies, `mem:conventions` for implementation rules, `mem:suggested_commands` for local commands, and `mem:task_completion` before finishing code changes.