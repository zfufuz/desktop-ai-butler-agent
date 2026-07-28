"""Typed contracts shared by the API and Agent graph."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BackendState(StrEnum):
    READY = "ready"
    DEGRADED = "degraded"


class HealthResponse(BaseModel):
    service: str = "desktop-ai-butler-backend"
    version: str
    state: BackendState
    framework: str = "FastAPI"
    agent_framework: str = "LangChain"
    orchestration: str = "LangGraph"


class AgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=20_000)
    run_id: str | None = Field(default=None, max_length=160)
    context: dict[str, Any] = Field(default_factory=dict)


class AgentResult(BaseModel):
    run_id: str
    intent: str
    response: str
    steps: list[str]


class StreamEvent(BaseModel):
    event: str
    run_id: str
    node: str | None = None
    detail: str
    data: dict[str, Any] = Field(default_factory=dict)

