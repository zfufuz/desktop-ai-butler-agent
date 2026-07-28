"""LangChain-backed runtime for user-configured HTTP tools."""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx
from langchain_core.tools import StructuredTool
from pydantic import ConfigDict, create_model

from app.schemas import (
    HttpToolConfigRequest,
    ToolInputSchemaRequest,
    ToolInvokeRequest,
    ToolInvokeResult,
)


MAX_RESPONSE_BYTES = 1_000_000
MAX_RESULT_CHARACTERS = 8_000
_circuit_states: dict[str, tuple[int, float]] = {}


async def invoke_http_tool(
    request: ToolInvokeRequest,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ToolInvokeResult:
    started_at = time.perf_counter()
    failures, open_until = _circuit_states.get(request.tool.id, (0, 0.0))
    if open_until > time.monotonic():
        wait_seconds = max(1, round(open_until - time.monotonic()))
        raise RuntimeError(f"Tool circuit is open; retry in {wait_seconds} seconds")

    variables = validate_variables(
        request.tool.input_schema,
        {
            **parse_tool_input(request.input),
            "apiKey": secret_value(request.tool),
        },
    )
    runtime_tool = create_langchain_tool(request.tool, transport)

    try:
        content = await runtime_tool.ainvoke(variables)
        _circuit_states.pop(request.tool.id, None)
        return ToolInvokeResult(
            name=request.tool.name,
            content=str(content)[:MAX_RESULT_CHARACTERS],
            durationMs=round((time.perf_counter() - started_at) * 1_000),
        )
    except Exception:
        failures += 1
        _circuit_states[request.tool.id] = (
            failures,
            time.monotonic() + 30 if failures >= 3 else 0.0,
        )
        raise


def create_langchain_tool(
    tool: HttpToolConfigRequest,
    transport: httpx.AsyncBaseTransport | None = None,
) -> StructuredTool:
    schema_model = create_input_model(tool.input_schema)

    async def execute(**variables: Any) -> str:
        return await execute_http_request(tool, variables, transport)

    return StructuredTool.from_function(
        coroutine=execute,
        name=sanitize_tool_name(tool.name),
        description=tool.description or f"Invoke HTTP tool {tool.name}",
        args_schema=schema_model,
    )


def create_input_model(schema: ToolInputSchemaRequest | None):
    fields: dict[str, tuple[type[Any], Any]] = {}
    for key, definition in (schema.properties.items() if schema else []):
        python_type: type[Any] = {
            "string": str,
            "number": float,
            "boolean": bool,
        }[definition.type]
        default = ... if key in schema.required else None
        fields[key] = (python_type, default)
    for legacy_key in ("input", "query", "city", "origin", "destination", "apiKey"):
        fields.setdefault(legacy_key, (Any, None))
    return create_model(
        "DynamicHttpToolInput",
        __config__=ConfigDict(extra="allow"),
        **fields,
    )


async def execute_http_request(
    tool: HttpToolConfigRequest,
    variables: dict[str, Any],
    transport: httpx.AsyncBaseTransport | None,
) -> str:
    endpoint, headers, body = prepare_request(tool, variables)
    timeout_seconds = tool.timeout_ms / 1_000
    last_error: Exception | None = None

    async with httpx.AsyncClient(
        timeout=timeout_seconds,
        transport=transport,
        follow_redirects=False,
    ) as client:
        for attempt in range(tool.retries + 1):
            try:
                response = await client.request(
                    tool.method,
                    endpoint,
                    headers=headers,
                    json=body if tool.method == "POST" else None,
                )
                if response.status_code >= 500 and attempt < tool.retries:
                    continue
                raw = await response.aread()
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("Tool response exceeded 1000000 bytes")
                text = raw.decode(response.encoding or "utf-8", errors="replace")
                if not response.is_success:
                    raise RuntimeError(
                        f"Custom tool request failed: {response.status_code} {text[:200]}"
                    )
                if has_business_error(text):
                    raise RuntimeError(f"Tool returned a business error: {text[:180]}")
                return extract_response(text, tool.response_path)
            except (httpx.TransportError, httpx.TimeoutException) as error:
                last_error = error
                if attempt >= tool.retries:
                    raise
    raise last_error or RuntimeError("Tool request failed")


def prepare_request(
    tool: HttpToolConfigRequest,
    variables: dict[str, Any],
) -> tuple[str, dict[str, str], dict[str, Any] | None]:
    endpoint = apply_template(tool.endpoint, variables)
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Tool endpoint must be an HTTP or HTTPS URL")
    if parsed.username or parsed.password:
        raise ValueError("Tool endpoint must not contain credentials")

    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(map_values(tool.query_params, variables))
    api_key = secret_value(tool)
    if api_key and tool.api_key_placement == "query":
        query.setdefault(tool.api_key_name or "key", api_key)
    endpoint = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))

    headers = {
        key: apply_template(value, variables)
        for key, value in tool.headers.items()
    }
    headers.setdefault("Content-Type", "application/json")
    if api_key and tool.api_key_placement == "bearer":
        headers["Authorization"] = f"Bearer {api_key}"
    elif api_key and tool.api_key_placement == "header":
        headers[tool.api_key_name or "X-API-Key"] = api_key

    body = None
    if tool.method == "POST":
        body = (
            map_values(tool.body_params, variables)
            if tool.body_params
            else variables
        )
    return endpoint, headers, body


def parse_tool_input(value: str) -> dict[str, Any]:
    city_match = re.search(r"(?:今天|明天|后天)?([^，。,.?\s]{2,12})(?:的)?天气", value)
    variables: dict[str, Any] = {
        "input": value,
        "query": value,
        "city": city_match.group(1) if city_match else value,
        "origin": value,
        "destination": value,
    }
    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            variables.update(parsed)
    except json.JSONDecodeError:
        pass
    return variables


def validate_variables(
    schema: ToolInputSchemaRequest | None,
    variables: dict[str, Any],
) -> dict[str, Any]:
    if not schema:
        return variables
    normalized = dict(variables)
    for key, definition in schema.properties.items():
        if key not in normalized:
            continue
        value = normalized[key]
        if definition.type == "number":
            try:
                normalized[key] = float(value)
            except (TypeError, ValueError):
                raise ValueError(f"Tool parameter {key} must be a number") from None
        elif definition.type == "boolean":
            if value in (True, "true"):
                normalized[key] = True
            elif value in (False, "false"):
                normalized[key] = False
            else:
                raise ValueError(f"Tool parameter {key} must be a boolean")
        elif not isinstance(value, str):
            raise ValueError(f"Tool parameter {key} must be a string")
    for key in schema.required:
        if key not in normalized or str(normalized[key]).strip() == "":
            raise ValueError(f"Tool is missing required parameter: {key}")
    return normalized


def apply_template(template: str, variables: dict[str, Any]) -> str:
    return re.sub(
        r"\{\{\s*(\w+)\s*\}\}",
        lambda match: quote(str(variables.get(match.group(1), "")), safe=""),
        template,
    )


def map_values(mapping: dict[str, str], variables: dict[str, Any]) -> dict[str, Any]:
    return {
        target: (
            variables[source]
            if source in variables
            else apply_template(source, variables)
        )
        for target, source in mapping.items()
    }


def extract_response(text: str, response_path: str | None) -> str:
    if not response_path or not response_path.strip():
        return text[:MAX_RESULT_CHARACTERS]
    try:
        current: Any = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("Tool response is not JSON") from error
    for segment in filter(None, response_path.split(".")):
        if isinstance(current, list) and segment.isdigit():
            current = current[int(segment)]
        elif isinstance(current, dict) and segment in current:
            current = current[segment]
        else:
            raise ValueError(f"Tool response path does not exist: {response_path}")
    return current if isinstance(current, str) else json.dumps(current, ensure_ascii=False, indent=2)


def has_business_error(text: str) -> bool:
    return bool(
        re.search(
            r'"status"\s*:\s*"?0|"success"\s*:\s*false|'
            r'ENGINE_RESPONSE_DATA_ERROR|INVALID_USER_KEY|"infocode"\s*:\s*"?3\d+',
            text,
            re.IGNORECASE,
        )
    )


def sanitize_tool_name(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")
    return (sanitized or "http_tool")[:64]


def secret_value(tool: HttpToolConfigRequest) -> str:
    return tool.api_key.get_secret_value() if tool.api_key else ""
