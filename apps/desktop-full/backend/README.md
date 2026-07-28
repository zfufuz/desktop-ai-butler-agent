# Agent Backend

Python backend for Desktop AI Butler.

## Responsibilities

- FastAPI HTTP and SSE boundary for Electron.
- Pydantic request, response, and Tool Schema validation.
- LangGraph Agent state and future checkpoint migration.
- Python model, RAG, evaluation, and fine-tuning integrations.

The existing TypeScript Agent remains available while capabilities are migrated.

## Development

Python 3.11 or newer is required.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Run tests:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Electron starts this backend automatically when `backend/.venv` is present.

