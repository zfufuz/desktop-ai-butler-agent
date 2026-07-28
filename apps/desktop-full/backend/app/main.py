"""FastAPI entrypoint for the desktop Agent sidecar."""

from __future__ import annotations

import json
import secrets
from collections.abc import AsyncIterator
from importlib.metadata import version

import structlog
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from app import __version__
from app.agent_graph import agent_graph, create_initial_state, invoke_agent
from app.config import settings
from app.http_tool_service import invoke_http_tool
from app.model_gateway import invoke_model, stream_model
from app.rag_service import search_knowledge
from app.schemas import (
    AgentRequest,
    AgentResult,
    BackendState,
    HealthResponse,
    ModelChatRequest,
    ModelChatResult,
    RagSearchRequest,
    RagSearchResponse,
    StreamEvent,
    ToolInvokeRequest,
    ToolInvokeResult,
)

logger = structlog.get_logger()

app = FastAPI(
    title="Desktop AI Butler Backend",
    description="Local FastAPI and LangGraph service managed by Electron.",
    version=__version__,
)


def require_runtime_token(x_butler_token: str | None = Header(default=None)) -> None:
    if not settings.token:
        return
    if not x_butler_token or not secrets.compare_digest(x_butler_token, settings.token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid backend runtime token",
        )


def encode_sse(event: StreamEvent) -> str:
    payload = event.model_dump(mode="json")
    return f"event: {event.event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(
        version=__version__,
        state=BackendState.READY,
        framework=f"FastAPI {version('fastapi')}",
        agent_framework=f"LangChain Core {version('langchain-core')}",
        orchestration=f"LangGraph {version('langgraph')}",
    )


@app.post("/v1/agent/invoke", response_model=AgentResult, tags=["agent"])
async def run_agent(
    request: AgentRequest,
    x_butler_token: str | None = Header(default=None),
) -> AgentResult:
    require_runtime_token(x_butler_token)
    result = await invoke_agent(request)
    logger.info("agent.invoke.completed", run_id=result.run_id, intent=result.intent)
    return result


@app.post("/v1/model/invoke", response_model=ModelChatResult, tags=["model"])
async def run_model(
    request: ModelChatRequest,
    x_butler_token: str | None = Header(default=None),
) -> ModelChatResult:
    require_runtime_token(x_butler_token)
    result = await invoke_model(request)
    logger.info(
        "model.invoke.completed",
        provider_type=request.provider.type,
        model=request.provider.model,
    )
    return result


@app.post("/v1/model/stream", tags=["model"])
async def stream_model_response(
    request: ModelChatRequest,
    x_butler_token: str | None = Header(default=None),
) -> StreamingResponse:
    require_runtime_token(x_butler_token)

    async def generate() -> AsyncIterator[str]:
        run_id = f"model-{secrets.token_hex(12)}"
        content = ""
        usage: dict[str, int | None] | None = None
        yield encode_sse(
            StreamEvent(event="model.started", run_id=run_id, detail="模型流式调用已开始")
        )
        try:
            async for delta, delta_usage in stream_model(request):
                if delta:
                    content += delta
                    if len(content) > 200_000:
                        raise ValueError("Model response exceeded 200000 characters")
                    yield encode_sse(
                        StreamEvent(event="model.delta", run_id=run_id, detail=delta)
                    )
                if delta_usage:
                    usage = delta_usage.model_dump()

            yield encode_sse(
                StreamEvent(
                    event="model.completed",
                    run_id=run_id,
                    detail=content or "模型没有返回内容。",
                    data={"usage": usage},
                )
            )
            logger.info(
                "model.stream.completed",
                run_id=run_id,
                provider_type=request.provider.type,
                model=request.provider.model,
            )
        except Exception as error:
            logger.exception("model.stream.failed", run_id=run_id)
            yield encode_sse(
                StreamEvent(
                    event="model.failed",
                    run_id=run_id,
                    detail=str(error),
                )
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/v1/rag/search", response_model=RagSearchResponse, tags=["rag"])
async def run_rag_search(
    request: RagSearchRequest,
    x_butler_token: str | None = Header(default=None),
) -> RagSearchResponse:
    require_runtime_token(x_butler_token)
    result = await search_knowledge(request, settings.database_path)
    logger.info(
        "rag.search.completed",
        result_count=len(result.results),
        degraded_count=len(result.degraded_reasons),
        embedding_enabled=request.embedding is not None,
        reranker_enabled=request.reranker is not None,
    )
    return result


@app.post("/v1/tools/invoke", response_model=ToolInvokeResult, tags=["tools"])
async def run_http_tool(
    request: ToolInvokeRequest,
    x_butler_token: str | None = Header(default=None),
) -> ToolInvokeResult:
    require_runtime_token(x_butler_token)
    result = await invoke_http_tool(request)
    logger.info(
        "tool.invoke.completed",
        tool_id=request.tool.id,
        tool_name=request.tool.name,
        duration_ms=result.duration_ms,
    )
    return result


@app.post("/v1/agent/stream", tags=["agent"])
async def stream_agent(
    request: AgentRequest,
    x_butler_token: str | None = Header(default=None),
) -> StreamingResponse:
    require_runtime_token(x_butler_token)

    async def generate() -> AsyncIterator[str]:
        initial_state = create_initial_state(request)
        run_id = initial_state["run_id"]
        yield encode_sse(StreamEvent(event="run.started", run_id=run_id, detail="FastAPI已接收任务"))

        final_state = initial_state.copy()
        try:
            async for update in agent_graph.astream(initial_state, stream_mode="updates"):
                for node, values in update.items():
                    if isinstance(values, dict):
                        final_state.update(values)
                    detail = {
                        "normalize_input": "输入标准化完成",
                        "classify_intent": f"意图识别完成：{final_state['intent']}",
                        "compose_response": "响应生成完成",
                    }.get(node, f"节点完成：{node}")
                    yield encode_sse(
                        StreamEvent(
                            event="graph.node.completed",
                            run_id=run_id,
                            node=node,
                            detail=detail,
                        )
                    )

            yield encode_sse(
                StreamEvent(
                    event="run.completed",
                    run_id=run_id,
                    detail=final_state["response"],
                    data={
                        "intent": final_state["intent"],
                        "steps": final_state["steps"],
                    },
                )
            )
            logger.info("agent.stream.completed", run_id=run_id, intent=final_state["intent"])
        except Exception as error:
            logger.exception("agent.stream.failed", run_id=run_id)
            yield encode_sse(
                StreamEvent(
                    event="run.failed",
                    run_id=run_id,
                    detail=str(error),
                )
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

