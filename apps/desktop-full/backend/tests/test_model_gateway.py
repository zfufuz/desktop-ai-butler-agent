from app.model_gateway import normalize_content, resolve_base_url
from app.schemas import ModelChatRequest


def create_request(provider_type: str, base_url: str | None = None) -> ModelChatRequest:
    return ModelChatRequest.model_validate(
        {
            "message": "hello",
            "provider": {
                "type": provider_type,
                "model": "test-model",
                "apiKey": "test-secret",
                "baseUrl": base_url,
            },
        }
    )


def test_zhipu_default_base_url() -> None:
    request = create_request("zhipu")

    assert resolve_base_url(request) == "https://open.bigmodel.cn/api/paas/v4"


def test_full_chat_completion_url_is_normalized() -> None:
    request = create_request(
        "openai-compatible",
        "https://example.com/v1/chat/completions",
    )

    assert resolve_base_url(request) == "https://example.com/v1"


def test_multimodal_content_is_flattened_to_text() -> None:
    content = [
        {"type": "text", "text": "first"},
        {"type": "image", "url": "ignored"},
        " second",
    ]

    assert normalize_content(content) == "first second"


def test_provider_api_key_is_not_serialized_as_plaintext() -> None:
    request = create_request("zhipu")

    serialized = request.model_dump_json(by_alias=True)

    assert "test-secret" not in serialized
    assert "**********" in serialized
