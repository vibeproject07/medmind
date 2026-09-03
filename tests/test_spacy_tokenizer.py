import json
import unittest
from unittest.mock import patch

from services.spacy_tokenizer import main as tokenizer_main
from services.spacy_tokenizer.main import (
    TokenizeRequest,
    project_result,
    tokenize_payload,
)


class SpacyTokenizerTests(unittest.TestCase):
    def test_returns_tokens_and_sentences_in_source_order(self):
        result = tokenize_payload(
            TokenizeRequest(
                text="Primeira frase médica. Segunda frase com 10 mg!",
                source_type="document",
            )
        )

        self.assertEqual(result["sentence_total"], 2)
        self.assertEqual(
            [sentence["text"] for sentence in result["sentences_in_text_order"]],
            ["Primeira frase médica.", "Segunda frase com 10 mg!"],
        )
        self.assertEqual(
            result["sentences_in_text_order"],
            result["sentences_in_token_order"],
        )
        self.assertEqual(
            result["token_total"],
            len(result["tokens"]),
        )
        self.assertEqual(result["tokens"][0]["text"], "Primeira")
        self.assertEqual(result["offset_basis"], "input_text")
        self.assertIsNone(result["processed_text"])

    def test_normalizes_broad_extraction_json_without_discarded_units(self):
        agent_output = json.dumps(
            {
                "tipo_fonte": "pdf",
                "unidades": [
                    {"unidade": 1, "descartada": False, "texto": "Conteúdo clínico."},
                    {"unidade": 2, "descartada": True, "texto": ""},
                    {"unidade": 3, "descartada": False, "texto": "Conduta final."},
                ],
            },
            ensure_ascii=False,
        )
        result = tokenize_payload(
            TokenizeRequest(text=agent_output, source_type="document")
        )

        self.assertTrue(result["normalization_applied"])
        self.assertEqual(result["offset_basis"], "processed_text")
        self.assertEqual(result["processed_text"], "Conteúdo clínico.\n\nConduta final.")
        self.assertIn("structured_agent_output_normalized", result["warnings"])
        self.assertEqual(
            [sentence["text"] for sentence in result["sentences_in_text_order"]],
            ["Conteúdo clínico.", "Conduta final."],
        )

    def test_maps_groq_segments_to_sentence_timestamps(self):
        text = "Introdução da aula. Conduta terapêutica."
        result = tokenize_payload(
            TokenizeRequest(
                text=text,
                source_type="audio",
                segments=[
                    {
                        "id": 0,
                        "start": 0,
                        "end": 3.2,
                        "text": "Introdução da aula.",
                        "part": 1,
                    },
                    {
                        "id": 1,
                        "start": 3.2,
                        "end": 7.5,
                        "text": "Conduta terapêutica.",
                        "part": 1,
                    },
                ],
            )
        )

        first, second = result["sentences_in_text_order"]
        self.assertEqual((first["start_time"], first["end_time"]), (0.0, 3.2))
        self.assertEqual((second["start_time"], second["end_time"]), (3.2, 7.5))
        self.assertTrue(result["timestamp_mapping_complete"])

    def test_does_not_bind_repeated_segment_to_an_earlier_occurrence(self):
        text = "Repete.\n\nRepete."
        result = tokenize_payload(
            TokenizeRequest(
                text=text,
                source_type="audio",
                segments=[
                    {"id": 0, "start": 0, "end": 1, "text": "Repete."},
                    {"id": 1, "start": 1, "end": 2, "text": "Repete."},
                ],
            )
        )

        first, second = result["sentences_in_text_order"]
        self.assertEqual(first["segment_ids"], [0])
        self.assertEqual(second["segment_ids"], [1])

    def test_pages_detailed_output_and_signals_continuation(self):
        result = tokenize_payload(
            TokenizeRequest(text="Um dois três quatro cinco.", source_type="text")
        )
        projected = project_result(result, "tokens", page=1, page_size=2)

        self.assertEqual(len(projected["tokens"]), 2)
        self.assertTrue(projected["pagination"]["tokens"]["has_more"])
        self.assertEqual(projected["pagination"]["tokens"]["next_page"], 2)

    def test_rejects_adversarial_token_density_before_spacy_materialization(self):
        with patch.object(tokenizer_main, "MAX_TOKEN_COMPLEXITY", 5):
            with self.assertRaisesRegex(ValueError, "Divida-o em chunks"):
                tokenize_payload(
                    TokenizeRequest(
                        text="a b c d e f",
                        source_type="document",
                    )
                )


if __name__ == "__main__":
    unittest.main()