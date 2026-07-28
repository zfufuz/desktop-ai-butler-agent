from app.tool_registry import backend_capability_tool, get_tool_schemas


def test_langchain_tool_uses_a_validated_json_schema() -> None:
    result = backend_capability_tool.invoke({"intent": "travel_planning"})
    schemas = get_tool_schemas()

    assert "weather" in result
    assert schemas[0]["name"] == "describe_backend_capabilities"
    assert schemas[0]["input_schema"]["properties"]["intent"]["enum"] == [
        "file_analysis", "travel_planning", "planning", "general"
    ]
