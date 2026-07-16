# Conventions
- Python follows PEP 8, 4-space indentation, snake_case names, uppercase constants.
- HTML/CSS/JavaScript use 2-space indentation; JS identifiers are camelCase and CSS classes are kebab-case.
- Keep Flask routes thin; EPUB parsing and sanitization belong in focused helpers.
- Preserve defensive upload validation and stable JSON error responses.
- Tests use pytest and `tests/test_*.py` naming.
- Never extract untrusted EPUB members to the filesystem; current parser intentionally processes ZIP content in memory.
- UI has no build step; edit source assets directly while preserving the established reader design.