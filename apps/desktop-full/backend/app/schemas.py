"""Typed contracts shared by the API and Agent graph."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


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


class ModelProviderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal["zhipu", "openai-compatible"]
    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr = Field(alias="apiKey", min_length=1)
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=2_000)


class ModelChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=200_000)
    provider: ModelProviderRequest
    system_prompt: str | None = Field(default=None, max_length=20_000)


class TokenUsage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class ModelChatResult(BaseModel):
    content: str
    usage: TokenUsage | None = None
    runtime: Literal["python-langchain"] = "python-langchain"


class EmbeddingRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr = Field(alias="apiKey", min_length=1)
    base_url: str = Field(alias="baseUrl", min_length=1, max_length=2_000)


class RerankerRequestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr = Field(alias="apiKey", min_length=1)
    base_url: str = Field(alias="baseUrl", min_length=1, max_length=2_000)


class RagSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=20_000)
    limit: int = Field(default=5, ge=1, le=10)
    embedding: EmbeddingRequestConfig | None = None
    reranker: RerankerRequestConfig | None = None


class KnowledgeSearchResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(alias="documentId")
    document_name: str = Field(alias="documentName")
    chunk_index: int = Field(alias="chunkIndex")
    content: str
    score: float
    lexical_score: float = Field(alias="lexicalScore")
    semantic_score: float = Field(alias="semanticScore")
    retrieval_mode: Literal["keyword", "hybrid"] = Field(alias="retrievalMode")


class RagSearchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    results: list[KnowledgeSearchResult]
    runtime: Literal["python"] = "python"
    degraded_reasons: list[str] = Field(default_factory=list, alias="degradedReasons")


class ToolParameterDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["string", "number", "boolean"]
    description: str | None = Field(default=None, max_length=1_000)


class ToolInputSchemaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    properties: dict[str, ToolParameterDefinition] = Field(default_factory=dict)
    required: list[str] = Field(default_factory=list)


class HttpToolConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2_000)
    endpoint: str = Field(min_length=1, max_length=2_000)
    method: Literal["GET", "POST"]
    api_key: SecretStr | None = Field(default=None, alias="apiKey")
    api_key_placement: Literal["none", "bearer", "query", "header"] = Field(
        default="bearer", alias="apiKeyPlacement"
    )
    api_key_name: str | None = Field(default=None, alias="apiKeyName", max_length=200)
    headers: dict[str, str] = Field(default_factory=dict)
    timeout_ms: int = Field(default=20_000, alias="timeoutMs", ge=1_000, le=60_000)
    retries: int = Field(default=0, ge=0, le=3)
    input_schema: ToolInputSchemaRequest | None = Field(default=None, alias="inputSchema")
    query_params: dict[str, str] = Field(default_factory=dict, alias="queryParams")
    body_params: dict[str, str] = Field(default_factory=dict, alias="bodyParams")
    response_path: str | None = Field(default=None, alias="responsePath", max_length=1_000)


class ToolInvokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: HttpToolConfigRequest
    input: str = Field(max_length=50_000)


class ToolInvokeResult(BaseModel):
    name: str
    content: str
    runtime: Literal["python-langchain"] = "python-langchain"
    duration_ms: int = Field(alias="durationMs")


class StreamEvent(BaseModel):
    event: str
    run_id: str
    node: str | None = None
    detail: str
    data: dict[str, Any] = Field(default_factory=dict)

