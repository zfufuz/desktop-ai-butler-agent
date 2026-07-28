import httpx
import pytest

from app.http_tool_service import (
    extract_response,
    invoke_http_tool,
    validate_variables,
)
from app.schemas import ToolInputSchemaRequest, ToolInvokeRequest


def create_request() -> ToolInvokeRequest:
    return ToolInvokeRequest.model_validate(
        {
            "tool": {
                "id": "weather",
                "name": "Weather Tool",
                "description": "Look up weather",
                "endpoint": "https://example.com/weather/{{city}}",
                "method": "GET",
                "apiKey": "secret-key",
                "apiKeyPlacement": "query",
                "apiKeyName": "key",
                "inputSchema": {
                    "properties": {
                        "city": {"type": "string"},
                        "days": {"type": "number"},
                    },
                    "required": ["city"],
                },
                "queryParams": {"days": "days"},
                "responsePath": "data.forecast",
            },
            "input": '{"city":"广州","days":3}',
        }
    )


@pytest.mark.asyncio
async def test_langchain_http_tool_maps_request_and_extracts_response() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert b"/weather/%E5%B9%BF%E5%B7%9E" in request.url.raw_path
        assert request.url.params["days"] == "3.0"
        assert request.url.params["key"] == "secret-key"
        return httpx.Response(
            200,
            json={"data": {"forecast": {"weather": "sunny"}}},
        )

    result = await invoke_http_tool(
        create_request(),
        transport=httpx.MockTransport(handler),
    )

    assert result.runtime == "python-langchain"
    assert '"weather": "sunny"' in result.content


def test_required_parameter_validation() -> None:
    schema = ToolInputSchemaRequest.model_validate(
        {
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        }
    )

    with pytest.raises(ValueError, match="required parameter"):
        validate_variables(schema, {"city": ""})


def test_response_path_rejects_missing_value() -> None:
    with pytest.raises(ValueError, match="does not exist"):
        extract_response('{"data": {}}', "data.items")


def test_api_key_is_masked_when_serialized() -> None:
    serialized = create_request().model_dump_json(by_alias=True)

    assert "secret-key" not in serialized
    assert "**********" in serialized
