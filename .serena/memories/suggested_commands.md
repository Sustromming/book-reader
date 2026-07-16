# Suggested commands
- Sync the locked environment: `uv sync`
- Run development server: `uv run python app.py` (loopback port 5000)
- Run tests: `uv run pytest -q`
- Fast syntax check: `uv run python -m py_compile app.py`
- Check lockfile consistency: `uv lock --check`
- Check installed dependencies: `uv pip check`