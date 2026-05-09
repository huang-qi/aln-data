# Python environment rules

- This project uses uv.
- Always use the project-local virtual environment at `.venv`.
- Never install packages globally.
- Never run `pip install` directly unless explicitly requested.
- Use `uv add <package>` to add dependencies.
- Use `uv sync` to sync the environment.
- Use `uv run <command>` to run Python, pytest, scripts, and tools.
