from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_reports_frameworks() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "ready"
    assert payload["framework"].startswith("FastAPI")
    assert payload["orchestration"].startswith("LangGraph")


def test_agent_invoke_returns_typed_result() -> None:
    response = client.post("/v1/agent/invoke", json={"message": "分析这个Excel文件"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "file_analysis"
    assert payload["run_id"].startswith("run-")
    assert payload["steps"]


def test_agent_stream_emits_graph_and_completion_events() -> None:
    with client.stream("POST", "/v1/agent/stream", json={"message": "规划广州出差"}) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: run.started" in body
    assert "event: graph.node.completed" in body
    assert "event: run.completed" in body
    assert "travel_planning" in body


def test_agent_request_rejects_extra_fields() -> None:
    response = client.post(
        "/v1/agent/invoke",
        json={"message": "hello", "unexpected": True},
    )

    assert response.status_code == 422

