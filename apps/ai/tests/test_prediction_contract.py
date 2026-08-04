import json
from pathlib import Path

import pytest

from schemas import PlayerPrediction

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "schemas" / "player_prediction.contract.json"


@pytest.fixture(scope="module")
def contract() -> dict:
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_contract_file_exists():
    assert CONTRACT_PATH.exists(), (
        f"Expected shared contract file at {CONTRACT_PATH}. "
        "If you moved/renamed it, update CONTRACT_PATH in this test too."
    )


def test_python_model_matches_contract_fields(contract):
    expected_fields = set(contract["fields"].keys())
    actual_fields = set(PlayerPrediction.model_fields.keys())

    missing_in_python = expected_fields - actual_fields
    extra_in_python = actual_fields - expected_fields

    assert not missing_in_python, (
        f"schemas.PlayerPrediction is missing fields declared in the shared "
        f"contract: {missing_in_python}. Either restore them in schemas.py or "
        f"remove them from {CONTRACT_PATH.name} AND from ml-prediction.types.ts "
        f"on the TypeScript side."
    )
    assert not extra_in_python, (
        f"schemas.PlayerPrediction has fields NOT declared in the shared "
        f"contract: {extra_in_python}. Add them to {CONTRACT_PATH.name} and to "
        f"ml-prediction.types.ts so the TypeScript side doesn't silently drop them."
    )


def test_confidence_enum_matches_contract(contract):
    expected_enum = set(contract["fields"]["confidence"]["enum"])
    
    assert expected_enum == {"HIGH", "MEDIUM", "LOW"}, (
        "Contract's confidence enum changed — update prompt.service.ts / "
        "ml-prediction.formatter.ts on the TypeScript side to match."
    )
