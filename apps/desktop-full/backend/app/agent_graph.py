"""Minimal LangGraph workflow used as the migration boundary for the Agent."""

from __future__ import annotations

from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from app.schemas import AgentRequest, AgentResult
from app.tool_registry import backend_capability_tool


class AgentState(TypedDict):
    run_id: str
    message: str
    normalized_message: str
    intent: str
    steps: list[str]
    response: str


def normalize_input(state: AgentState) -> dict[str, object]:
    normalized = " ".join(state["message"].split())
    return {
        "normalized_message": normalized,
        "steps": [*state["steps"], "输入已标准化"],
    }


def classify_intent(state: AgentState) -> dict[str, object]:
    message = state["normalized_message"].lower()
    if any(keyword in message for keyword in ("文件", "excel", "表格", "文档", "pdf")):
        intent = "file_analysis"
    elif any(keyword in message for keyword in ("出差", "天气", "路线", "酒店", "行程")):
        intent = "travel_planning"
    elif any(keyword in message for keyword in ("计划", "待办", "提醒", "打卡")):
        intent = "planning"
    else:
        intent = "general"
    return {
        "intent": intent,
        "steps": [*state["steps"], f"意图识别：{intent}"],
    }


def compose_diagnostic_response(state: AgentState) -> dict[str, object]:
    capabilities = backend_capability_tool.invoke({"intent": state["intent"]})
    response = (
        "FastAPI、LangChain 与 LangGraph 后端链路已就绪。"
        f"本次识别意图为 {state['intent']}。"
        f"对应能力边界：{capabilities}。"
        "当前处于并行迁移阶段，正式模型、Tool 与 RAG 仍由现有 TypeScript Agent 提供。"
    )
    return {
        "response": response,
        "steps": [*state["steps"], "LangChain Tool Schema 已验证", "诊断响应已生成"],
    }


builder = StateGraph(AgentState)
builder.add_node("normalize_input", normalize_input)
builder.add_node("classify_intent", classify_intent)
builder.add_node("compose_response", compose_diagnostic_response)
builder.add_edge(START, "normalize_input")
builder.add_edge("normalize_input", "classify_intent")
builder.add_edge("classify_intent", "compose_response")
builder.add_edge("compose_response", END)
agent_graph = builder.compile()


def create_initial_state(request: AgentRequest) -> AgentState:
    return {
        "run_id": request.run_id or f"run-{uuid4().hex}",
        "message": request.message,
        "normalized_message": "",
        "intent": "unknown",
        "steps": [],
        "response": "",
    }


async def invoke_agent(request: AgentRequest) -> AgentResult:
    result = await agent_graph.ainvoke(create_initial_state(request))
    return AgentResult(
        run_id=result["run_id"],
        intent=result["intent"],
        response=result["response"],
        steps=result["steps"],
    )

