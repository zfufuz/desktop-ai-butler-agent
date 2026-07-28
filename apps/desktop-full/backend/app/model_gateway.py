"""LangChain model adapter for Zhipu and OpenAI-compatible providers."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.schemas import ModelChatRequest, ModelChatResult, TokenUsage


SYSTEM_PROMPT = (
    "你是一个桌面 AI 管家。请用通俗、可靠、简洁的语言帮助用户读取本地文件、"
    "分析数据、整理资料、生成报告和可执行计划。回答应抓住重点并给出下一步行动。"
)


def resolve_base_url(request: ModelChatRequest) -> str:
    configured = (request.provider.base_url or "").strip().rstrip("/")
    if configured.endswith("/chat/completions"):
        configured = configured[: -len("/chat/completions")]
    if configured:
        return configured
    if request.provider.type == "zhipu":
        return "https://open.bigmodel.cn/api/paas/v4"
    return "https://api.openai.com/v1"


def create_chat_model(request: ModelChatRequest) -> ChatOpenAI:
    return ChatOpenAI(
        model=request.provider.model,
        api_key=request.provider.api_key.get_secret_value(),
        base_url=resolve_base_url(request),
        timeout=60,
        max_retries=1,
        temperature=0.2,
    )


def create_messages(request: ModelChatRequest) -> list[SystemMessage | HumanMessage]:
    return [
        SystemMessage(content=request.system_prompt or SYSTEM_PROMPT),
        HumanMessage(content=request.message),
    ]


def normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content or "")

    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


def extract_usage(message: AIMessage | AIMessageChunk) -> TokenUsage | None:
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        return TokenUsage(
            prompt_tokens=_to_optional_int(usage.get("input_tokens")),
            completion_tokens=_to_optional_int(usage.get("output_tokens")),
            total_tokens=_to_optional_int(usage.get("total_tokens")),
        )

    response_metadata = getattr(message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        token_usage = response_metadata.get("token_usage")
        if isinstance(token_usage, dict):
            return TokenUsage(
                prompt_tokens=_to_optional_int(token_usage.get("prompt_tokens")),
                completion_tokens=_to_optional_int(token_usage.get("completion_tokens")),
                total_tokens=_to_optional_int(token_usage.get("total_tokens")),
            )
    return None


async def invoke_model(request: ModelChatRequest) -> ModelChatResult:
    response = await create_chat_model(request).ainvoke(create_messages(request))
    content = normalize_content(response.content).strip()
    return ModelChatResult(
        content=content or "模型没有返回内容。",
        usage=extract_usage(response),
        runtime="python-langchain",
    )


async def stream_model(
    request: ModelChatRequest,
) -> AsyncIterator[tuple[str, TokenUsage | None]]:
    model = create_chat_model(request)
    async for chunk in model.astream(create_messages(request)):
        yield normalize_content(chunk.content), extract_usage(chunk)


def _to_optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None
