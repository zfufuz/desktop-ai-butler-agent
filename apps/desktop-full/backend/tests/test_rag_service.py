import sqlite3
from pathlib import Path

import pytest

from app.rag_service import (
    compress_context,
    create_search_terms,
    search_knowledge,
)
from app.schemas import RagSearchRequest


def create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE knowledge_chunks (
          document_id TEXT NOT NULL,
          document_name TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          embedding_blob BLOB,
          embedding_dimensions INTEGER,
          embedding_model TEXT
        );
        CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
          document_id UNINDEXED,
          document_name UNINDEXED,
          chunk_index UNINDEXED,
          content,
          tokenize='unicode61'
        );
        """
    )
    rows = [
        ("travel", "出差计划.md", 0, "广州出差预算五千元，需要查询天气和路线。"),
        ("sales", "销售数据.md", 0, "上海销售额增长，退款率有所下降。"),
    ]
    connection.executemany(
        "INSERT INTO knowledge_chunks(document_id, document_name, chunk_index, content) VALUES (?, ?, ?, ?)",
        rows,
    )
    connection.executemany(
        "INSERT INTO knowledge_chunks_fts(document_id, document_name, chunk_index, content) VALUES (?, ?, ?, ?)",
        rows,
    )
    connection.commit()
    connection.close()


@pytest.mark.asyncio
async def test_keyword_search_reads_electron_database(tmp_path: Path) -> None:
    database_path = tmp_path / "knowledge.sqlite"
    create_database(database_path)

    response = await search_knowledge(
        RagSearchRequest(query="广州出差天气", limit=5),
        database_path,
    )

    assert response.runtime == "python"
    assert response.results[0].document_id == "travel"
    assert response.results[0].retrieval_mode == "keyword"
    assert response.degraded_reasons == []


def test_chinese_terms_include_trigrams() -> None:
    terms = create_search_terms("分析广州出差天气安排")

    assert "广州出" in terms
    assert len(terms) <= 16


def test_context_compression_keeps_relevant_sentence() -> None:
    content = "背景信息。" * 200 + "广州天气需要准备雨具。" + "其他说明。" * 100

    compressed = compress_context(content, ["广州天气"])

    assert len(compressed) <= 700
    assert "广州天气" in compressed
