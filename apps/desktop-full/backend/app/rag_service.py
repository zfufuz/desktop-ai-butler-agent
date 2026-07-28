"""Read-only hybrid retrieval over the Electron-owned SQLite knowledge base."""

from __future__ import annotations

import math
import re
import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path

import httpx
from langchain_openai import OpenAIEmbeddings

from app.schemas import (
    EmbeddingRequestConfig,
    KnowledgeSearchResult,
    RagSearchRequest,
    RagSearchResponse,
)


@dataclass(slots=True)
class Candidate:
    document_id: str
    document_name: str
    chunk_index: int
    content: str
    lexical_rank: int | None = None
    vector_rank: int | None = None
    vector_score: float | None = None
    score: float = 0.0
    lexical_score: float = 0.0
    semantic_score: float = 0.0
    retrieval_mode: str = "keyword"


async def search_knowledge(
    request: RagSearchRequest,
    database_path: Path | None,
) -> RagSearchResponse:
    if not database_path or not database_path.exists():
        raise RuntimeError("Knowledge database is unavailable")

    terms = create_search_terms(request.query)
    if not terms:
        return RagSearchResponse(results=[])

    candidate_limit = max(20, request.limit * 6)
    degraded_reasons: list[str] = []
    candidates: dict[str, Candidate] = {}

    with open_readonly_database(database_path) as connection:
        lexical_rows = lexical_search(connection, terms, candidate_limit)
        for lexical_rank, row in enumerate(lexical_rows):
            candidate = row_to_candidate(row)
            candidate.lexical_rank = lexical_rank
            candidates[candidate_key(candidate)] = candidate

        if request.embedding:
            try:
                query_vector = await embed_query(request.query, request.embedding)
                vector_rows = vector_search(
                    connection,
                    query_vector,
                    request.embedding.model,
                    candidate_limit,
                )
                for vector_rank, (candidate, vector_score) in enumerate(vector_rows):
                    key = candidate_key(candidate)
                    current = candidates.get(key, candidate)
                    current.vector_rank = vector_rank
                    current.vector_score = vector_score
                    candidates[key] = current
            except Exception as error:
                degraded_reasons.append(f"Embedding degraded: {type(error).__name__}")

    ranked = rerank_candidates(list(candidates.values()), terms, candidate_limit)
    if request.reranker and ranked:
        try:
            ranked = await rerank_with_model(request.query, ranked, request.reranker)
        except Exception as error:
            degraded_reasons.append(f"Reranker degraded: {type(error).__name__}")

    results = [
        KnowledgeSearchResult(
            document_id=item.document_id,
            document_name=item.document_name,
            chunk_index=item.chunk_index,
            content=compress_context(item.content, terms),
            score=item.score,
            lexical_score=item.lexical_score,
            semantic_score=item.semantic_score,
            retrieval_mode="hybrid" if item.vector_rank is not None else "keyword",
        )
        for item in ranked[: request.limit]
    ]
    return RagSearchResponse(results=results, degraded_reasons=degraded_reasons)


def open_readonly_database(database_path: Path) -> sqlite3.Connection:
    uri = f"{database_path.resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    return connection


def lexical_search(
    connection: sqlite3.Connection,
    terms: list[str],
    limit: int,
) -> list[sqlite3.Row]:
    fts_query = " OR ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms)
    try:
        rows = connection.execute(
            """
            SELECT document_id, document_name, CAST(chunk_index AS INTEGER) AS chunk_index,
                   content, bm25(knowledge_chunks_fts) AS rank
            FROM knowledge_chunks_fts
            WHERE knowledge_chunks_fts MATCH ?
            ORDER BY rank ASC LIMIT ?
            """,
            (fts_query, limit),
        ).fetchall()
        if rows:
            return rows
    except sqlite3.Error:
        pass

    fallback_terms = terms[:8]
    where_clause = " OR ".join("content LIKE ?" for _ in fallback_terms)
    return connection.execute(
        f"""
        SELECT document_id, document_name, chunk_index, content
        FROM knowledge_chunks
        WHERE {where_clause}
        LIMIT ?
        """,
        (*[f"%{term}%" for term in fallback_terms], limit),
    ).fetchall()


async def embed_query(query: str, config: EmbeddingRequestConfig) -> list[float]:
    base_url = config.base_url.strip().rstrip("/")
    if base_url.endswith("/embeddings"):
        base_url = base_url[: -len("/embeddings")]
    embeddings = OpenAIEmbeddings(
        model=config.model,
        api_key=config.api_key.get_secret_value(),
        base_url=base_url,
        request_timeout=60,
        max_retries=1,
    )
    return await embeddings.aembed_query(query)


def vector_search(
    connection: sqlite3.Connection,
    query_vector: list[float],
    model: str,
    limit: int,
) -> list[tuple[Candidate, float]]:
    rows = connection.execute(
        """
        SELECT document_id, document_name, chunk_index, content,
               embedding_blob, embedding_dimensions
        FROM knowledge_chunks
        WHERE embedding_blob IS NOT NULL AND embedding_model = ?
        """,
        (model,),
    ).fetchall()
    scored: list[tuple[Candidate, float]] = []
    for row in rows:
        dimensions = int(row["embedding_dimensions"] or 0)
        vector = decode_vector(row["embedding_blob"], dimensions)
        if len(vector) != len(query_vector):
            continue
        scored.append((row_to_candidate(row), cosine_similarity(query_vector, vector)))
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:limit]


def decode_vector(blob: bytes, dimensions: int) -> list[float]:
    if dimensions <= 0 or len(blob) < dimensions * 4:
        return []
    return list(struct.unpack(f"<{dimensions}f", blob[: dimensions * 4]))


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_magnitude = math.sqrt(sum(value * value for value in left))
    right_magnitude = math.sqrt(sum(value * value for value in right))
    if left_magnitude == 0 or right_magnitude == 0:
        return 0.0
    return dot / (left_magnitude * right_magnitude)


def rerank_candidates(
    candidates: list[Candidate],
    terms: list[str],
    limit: int,
) -> list[Candidate]:
    for candidate in candidates:
        lexical = 0.0 if candidate.lexical_rank is None else 1 / (candidate.lexical_rank + 1)
        semantic = (
            0.0
            if candidate.vector_score is None
            else max(0.0, min(1.0, (candidate.vector_score + 1) / 2))
        )
        coverage = term_coverage(candidate.content, terms)
        if candidate.vector_rank is not None:
            score = semantic * 0.5 + lexical * 0.3 + coverage * 0.2
            candidate.retrieval_mode = "hybrid"
        else:
            score = lexical * 0.75 + coverage * 0.25
        candidate.score = round(score, 6)
        candidate.lexical_score = round(lexical, 6)
        candidate.semantic_score = round(semantic, 6)
    return sorted(candidates, key=lambda item: item.score, reverse=True)[: max(1, limit)]


async def rerank_with_model(query: str, candidates: list[Candidate], config) -> list[Candidate]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            config.base_url,
            headers={"Authorization": f"Bearer {config.api_key.get_secret_value()}"},
            json={
                "model": config.model,
                "query": query,
                "documents": [candidate.content for candidate in candidates],
                "top_n": len(candidates),
                "return_documents": False,
            },
        )
        response.raise_for_status()
    results = response.json().get("results", [])
    indices = [
        int(item["index"])
        for item in results
        if isinstance(item, dict) and isinstance(item.get("index"), int)
    ]
    if len(indices) != len(candidates) or any(index >= len(candidates) for index in indices):
        raise ValueError("Reranker returned an invalid result set")
    return [candidates[index] for index in indices]


def create_search_terms(query: str) -> list[str]:
    terms: dict[str, None] = {}
    for word in re.findall(r"[a-z0-9_-]{3,}", query.lower()):
        terms[word] = None
    for sequence in re.findall(r"[\u3400-\u9fff]{3,}", query):
        if len(sequence) <= 6:
            terms[sequence] = None
        for index in range(max(0, len(sequence) - 2)):
            if len(terms) >= 16:
                break
            terms[sequence[index : index + 3]] = None
    return list(terms)[:16]


def term_coverage(content: str, terms: list[str]) -> float:
    if not terms:
        return 0.0
    normalized = content.lower()
    return sum(1 for term in terms if term.lower() in normalized) / len(terms)


def compress_context(content: str, terms: list[str], max_length: int = 700) -> str:
    if len(content) <= max_length:
        return content
    sentences = [item.strip() for item in re.split(r"(?<=[。！？!?\n])", content) if item.strip()]
    if len(sentences) <= 1:
        return content[:max_length]
    selected = {0}
    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (-term_coverage(item[1], terms), item[0]),
    )
    for index, sentence in ranked:
        if term_coverage(sentence, terms) == 0 and len(selected) >= 2:
            break
        selected.add(index)
        if sum(len(sentences[item]) for item in selected) >= max_length:
            break
    return "\n".join(sentences[index] for index in sorted(selected))[:max_length]


def row_to_candidate(row: sqlite3.Row) -> Candidate:
    return Candidate(
        document_id=str(row["document_id"]),
        document_name=str(row["document_name"]),
        chunk_index=int(row["chunk_index"]),
        content=str(row["content"]),
    )


def candidate_key(candidate: Candidate) -> str:
    return f"{candidate.document_id}:{candidate.chunk_index}"
