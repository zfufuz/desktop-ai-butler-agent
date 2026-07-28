# Agent Backend

Python backend for Desktop AI Butler.

## Responsibilities

- FastAPI HTTP and SSE boundary for Electron.
- Pydantic request, response, and Tool Schema validation.
- LangGraph Agent state and future checkpoint migration.
- LangChain model gateway with synchronous and streaming responses.
- Hybrid RAG over the Electron SQLite knowledge base, with optional Embedding and reranker services.
- LangChain StructuredTool execution for user-configured HTTP tools.
- Future evaluation automation and fine-tuning integrations.

Electron prefers the Python model, RAG, and HTTP Tool runtimes. The existing TypeScript implementations remain available as a stable fallback when the sidecar cannot start.

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
