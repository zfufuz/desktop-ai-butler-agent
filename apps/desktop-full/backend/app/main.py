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
from app.schemas import AgentRequest, AgentResult, BackendState, HealthResponse, StreamEvent

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

