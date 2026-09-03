from __future__ import annotations

import json
import os
import re
from collections import Counter
from typing import Any, Literal

import spacy
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


MAX_TEXT_CHARS = int(os.getenv("SPACY_TOKENIZER_MAX_CHARS", "500000"))
MAX_TOKEN_COMPLEXITY = int(os.getenv("SPACY_TOKENIZER_MAX_TOKENS", "150000"))
MAX_SENTENCE_COMPLEXITY = int(os.getenv("SPACY_TOKENIZER_MAX_SENTENCES", "50000"))
PIPELINE_NAME = "spacy.blank.pt+sentencizer"
SCHEMA_VERSION = "1.0"
MAX_PAGE_SIZE = 1000
MAX_SENTENCE_TOKENS_IN_RESPONSE = 500

nlp = spacy.blank("pt")
nlp.add_pipe("sentencizer")
nlp.max_length = MAX_TEXT_CHARS + 1

app = FastAPI(
    title="MedMind spaCy Tokenizer",
    version=SCHEMA_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

TOKEN_COMPLEXITY_PATTERN = re.compile(r"\w+|[^\w\s]", re.UNICODE)


class SourceSegment(BaseModel):
    id: int | str | None = None
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    part: int | None = None


class TokenizeRequest(BaseModel):
    text: str = Field(min_length=1)
    source_type: str = Field(default="text", max_length=50)
    segments: list[SourceSegment] = Field(default_factory=list, max_length=10000)
    content_format: Literal["auto", "plain"] = "auto"
    view: Literal[
        "totals",
        "tokens",
        "sentences_text_order",
        "sentences_token_order",
        "mixed",
    ] = "sentences_text_order"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=250, ge=1, le=MAX_PAGE_SIZE)


def _normalise_agent_output(text: str, content_format: str) -> tuple[str, list[str]]:
    if content_format == "plain":
        return text, []

    stripped = text.strip()
    if not stripped or stripped[0] not in "[{":
        return text, []

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return text, ["structured_output_invalid_json"]

    extracted: list[str] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("unidades"), list):
        for unit in parsed["unidades"]:
            if not isinstance(unit, dict) or unit.get("descartada") is True:
                continue
            unit_text = unit.get("texto")
            if isinstance(unit_text, str) and unit_text.strip():
                extracted.append(unit_text.strip())
    elif isinstance(parsed, dict):
        for key in ("text", "texto", "content", "conteudo"):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                extracted.append(value.strip())
                break

    if not extracted:
        return text, ["structured_output_without_extractable_text"]

    return "\n\n".join(extracted), ["structured_agent_output_normalized"]


def _locate_segments(text: str, segments: list[SourceSegment]) -> tuple[list[dict[str, Any]], list[str]]:
    located: list[dict[str, Any]] = []
    warnings: list[str] = []
    cursor = 0

    for position, segment in enumerate(segments):
        segment_text = segment.text.strip()
        if not segment_text:
            continue

        start_char = text.find(segment_text, cursor)
        if start_char < 0:
            warnings.append(f"segment_text_not_located:{position}")
            continue

        end_char = start_char + len(segment_text)
        located.append(
            {
                "id": segment.id if segment.id is not None else position,
                "start": float(segment.start),
                "end": float(segment.end),
                "start_char": start_char,
                "end_char": end_char,
            }
        )
        cursor = end_char

    return located, warnings


def _sentence_timing(
    start_char: int,
    end_char: int,
    located_segments: list[dict[str, Any]],
) -> dict[str, Any]:
    overlaps = [
        segment
        for segment in located_segments
        if segment["end_char"] > start_char and segment["start_char"] < end_char
    ]
    if not overlaps:
        return {"start_time": None, "end_time": None, "segment_ids": []}

    return {
        "start_time": min(segment["start"] for segment in overlaps),
        "end_time": max(segment["end"] for segment in overlaps),
        "segment_ids": [segment["id"] for segment in overlaps],
    }


def _validate_complexity(text: str) -> None:
    estimated_tokens = 0
    estimated_sentence_boundaries = 0

    for match in TOKEN_COMPLEXITY_PATTERN.finditer(text):
        estimated_tokens += 1
        if estimated_tokens > MAX_TOKEN_COMPLEXITY:
            raise ValueError(
                "O texto excede o limite de complexidade de "
                f"{MAX_TOKEN_COMPLEXITY} tokens. Divida-o em chunks antes de tokenizar."
            )
        if match.group(0) in {".", "!", "?"}:
            estimated_sentence_boundaries += 1
            if estimated_sentence_boundaries > MAX_SENTENCE_COMPLEXITY:
                raise ValueError(
                    "O texto excede o limite de complexidade de "
                    f"{MAX_SENTENCE_COMPLEXITY} frases. Divida-o em chunks antes de tokenizar."
                )


def tokenize_payload(payload: TokenizeRequest) -> dict[str, Any]:
    input_text = payload.text
    if len(input_text) > MAX_TEXT_CHARS:
        raise ValueError(
            f"Texto excede o limite de {MAX_TEXT_CHARS} caracteres do serviço de tokenização."
        )

    text, warnings = _normalise_agent_output(input_text, payload.content_format)
    if not text.strip():
        raise ValueError("O conteúdo normalizado não possui texto tokenizável.")

    _validate_complexity(text)
    doc = nlp(text)
    if len(doc) > MAX_TOKEN_COMPLEXITY:
        raise ValueError(
            "O spaCy identificou mais de "
            f"{MAX_TOKEN_COMPLEXITY} tokens. Divida o texto em chunks antes de continuar."
        )
    located_segments, segment_warnings = _locate_segments(text, payload.segments)
    warnings.extend(segment_warnings)

    visible_tokens = [token for token in doc if not token.is_space]
    visible_index_by_spacy_index = {
        token.i: index for index, token in enumerate(visible_tokens)
    }

    sentence_index_by_spacy_token: dict[int, int] = {}
    sentence_spans = list(doc.sents)
    if len(sentence_spans) > MAX_SENTENCE_COMPLEXITY:
        raise ValueError(
            "O spaCy identificou mais de "
            f"{MAX_SENTENCE_COMPLEXITY} frases. Divida o texto em chunks antes de continuar."
        )
    for sentence_index, sentence in enumerate(sentence_spans):
        for token in sentence:
            sentence_index_by_spacy_token[token.i] = sentence_index

    tokens = [
        {
            "index": visible_index_by_spacy_index[token.i],
            "spacy_index": token.i,
            "text": token.text,
            "start_char": token.idx,
            "end_char": token.idx + len(token.text),
            "sentence_index": sentence_index_by_spacy_token.get(token.i),
            "is_punct": token.is_punct,
            "like_num": token.like_num,
        }
        for token in visible_tokens
    ]

    sentences: list[dict[str, Any]] = []
    for sentence_index, sentence in enumerate(sentence_spans):
        sentence_tokens = [token for token in sentence if not token.is_space]
        if not sentence_tokens:
            continue

        token_start = visible_index_by_spacy_index[sentence_tokens[0].i]
        token_end = visible_index_by_spacy_index[sentence_tokens[-1].i] + 1
        timing = _sentence_timing(sentence.start_char, sentence.end_char, located_segments)
        sentences.append(
            {
                "index": sentence_index,
                "number": sentence_index + 1,
                "text": sentence.text.strip(),
                "start_char": sentence.start_char,
                "end_char": sentence.end_char,
                "token_start": token_start,
                "token_end": token_end,
                "token_count": len(sentence_tokens),
                "tokens": [token.text for token in sentence_tokens],
                **timing,
            }
        )

    first_occurrence: dict[str, int] = {}
    frequency_source: list[str] = []
    for token in visible_tokens:
        if token.is_punct:
            continue
        normalized = token.text.casefold()
        first_occurrence.setdefault(normalized, visible_index_by_spacy_index[token.i])
        frequency_source.append(normalized)

    frequencies = Counter(frequency_source)
    token_frequencies = [
        {
            "token": token,
            "count": count,
            "first_token_index": first_occurrence[token],
        }
        for token, count in sorted(
            frequencies.items(),
            key=lambda item: (-item[1], first_occurrence[item[0]]),
        )
    ]

    return {
        "schema_version": SCHEMA_VERSION,
        "pipeline": PIPELINE_NAME,
        "language": "pt",
        "source_type": payload.source_type,
        "input_character_total": len(input_text),
        "processed_character_total": len(text),
        "normalization_applied": text != input_text,
        "offset_basis": "processed_text" if text != input_text else "input_text",
        "processed_text": text if text != input_text else None,
        "timestamp_mapping_complete": not segment_warnings,
        "spacy_token_total": len(doc),
        "token_total": len(visible_tokens),
        "sentence_total": len(sentences),
        "tokens": tokens,
        "sentences_in_text_order": sentences,
        "sentences_in_token_order": sorted(
            sentences, key=lambda sentence: sentence["token_start"]
        ),
        "token_frequencies": token_frequencies,
        "warnings": warnings,
    }


def _page(items: list[Any], page: int, page_size: int) -> tuple[list[Any], dict[str, Any]]:
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end], {
        "page": page,
        "page_size": page_size,
        "total": len(items),
        "has_more": end < len(items),
        "next_page": page + 1 if end < len(items) else None,
    }


def _bounded_sentences(sentences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bounded: list[dict[str, Any]] = []
    for sentence in sentences:
        sentence_copy = dict(sentence)
        sentence_tokens = sentence_copy["tokens"]
        sentence_copy["tokens"] = sentence_tokens[:MAX_SENTENCE_TOKENS_IN_RESPONSE]
        sentence_copy["tokens_truncated"] = (
            len(sentence_tokens) > MAX_SENTENCE_TOKENS_IN_RESPONSE
        )
        bounded.append(sentence_copy)
    return bounded


def project_result(
    result: dict[str, Any],
    view: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    collection_keys = {
        "tokens",
        "sentences_in_text_order",
        "sentences_in_token_order",
        "token_frequencies",
    }
    response = {key: value for key, value in result.items() if key not in collection_keys}
    response["view"] = view

    if view == "totals":
        response["pagination"] = {}
        return response

    if view == "tokens":
        response["tokens"], pagination = _page(result["tokens"], page, page_size)
        response["pagination"] = {"tokens": pagination}
        return response

    if view in {"sentences_text_order", "sentences_token_order"}:
        source_key = (
            "sentences_in_text_order"
            if view == "sentences_text_order"
            else "sentences_in_token_order"
        )
        sentences, pagination = _page(result[source_key], page, page_size)
        response["sentences"] = _bounded_sentences(sentences)
        response["pagination"] = {"sentences": pagination}
        return response

    tokens, token_pagination = _page(result["tokens"], page, page_size)
    text_sentences, text_sentence_pagination = _page(
        result["sentences_in_text_order"], page, page_size
    )
    token_sentences, token_sentence_pagination = _page(
        result["sentences_in_token_order"], page, page_size
    )
    frequencies, frequency_pagination = _page(
        result["token_frequencies"], page, page_size
    )
    response.update(
        {
            "tokens": tokens,
            "sentences_in_text_order": _bounded_sentences(text_sentences),
            "sentences_in_token_order": _bounded_sentences(token_sentences),
            "token_frequencies": frequencies,
            "pagination": {
                "tokens": token_pagination,
                "sentences_in_text_order": text_sentence_pagination,
                "sentences_in_token_order": token_sentence_pagination,
                "token_frequencies": frequency_pagination,
            },
        }
    )
    return response


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "pipeline": PIPELINE_NAME,
        "schema_version": SCHEMA_VERSION,
        "max_text_chars": MAX_TEXT_CHARS,
        "max_tokens": MAX_TOKEN_COMPLEXITY,
        "max_sentences": MAX_SENTENCE_COMPLEXITY,
    }


@app.post("/tokenize")
def tokenize(payload: TokenizeRequest) -> dict[str, Any]:
    try:
        result = tokenize_payload(payload)
        return project_result(result, payload.view, payload.page, payload.page_size)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error