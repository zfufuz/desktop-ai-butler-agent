"""LangChain tool contracts used by the Python Agent runtime."""

from __future__ import annotations

from typing import Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


AgentIntent = Literal["file_analysis", "travel_planning", "planning", "general"]


class CapabilityQuery(BaseModel):
    """Validated input schema exposed to the Agent for capability lookup."""

    intent: AgentIntent = Field(description="The intent selected by the routing node")


def describe_backend_capabilities(intent: AgentIntent) -> str:
    """Return the migration target for a routed Agent intent."""
    capabilities = {
        "file_analysis": "file parsing, hybrid RAG, report generation, and source citations",
        "travel_planning": "weather, route, itinerary, budget, and action-card tools",
        "planning": "plan creation, check-ins, reminders, and retrospective updates",
        "general": "model conversation, memory retrieval, and guarded tool selection",
    }
    return capabilities[intent]


backend_capability_tool = StructuredTool.from_function(
    func=describe_backend_capabilities,
    name="describe_backend_capabilities",
    description=(
        "Describe the backend capabilities required for the intent selected by "
        "the LangGraph router."
    ),
    args_schema=CapabilityQuery,
)


TOOL_REGISTRY = {
    backend_capability_tool.name: backend_capability_tool,
}


def get_tool_schemas() -> list[dict[str, object]]:
    """Expose JSON Schemas for validation, evaluation, and future model binding."""
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.get_input_jsonschema(),
        }
        for tool in TOOL_REGISTRY.values()
    ]
