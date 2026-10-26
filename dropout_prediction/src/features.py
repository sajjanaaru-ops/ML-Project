"""Shared data loading and preprocessing for the dropout prediction project.

The notebook and the Streamlit app both import from here, so a model trained in
the notebook sees exactly the same transformations at prediction time.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = (
    PROJECT_ROOT.parent
    / "Analysis"
    / "Track_1_Academic_Performance_and_Dropout"
    / "predict_students_dropout_uci"
    / "data.csv"
)
MODELS_DIR = PROJECT_ROOT / "models"
FIGURES_DIR = PROJECT_ROOT / "reports" / "figures"

TARGET = "Target"

# Integer codes with no order between them -> one-hot encoded.
NOMINAL = [
    "Marital status",
    "Application mode",
    "Course",
    "Previous qualification",
    "Nacionality",
    "Mother's qualification",
    "Father's qualification",
    "Mother's occupation",
    "Father's occupation",
]

# 0/1 flags -> passed through unchanged.
BINARY = [
    "Daytime/evening attendance",
    "Displaced",
    "Educational special needs",
    "Debtor",
    "Tuition fees up to date",
    "Gender",
    "Scholarship holder",
    "International",
]

# Known at enrolment -> scaled.
NUMERIC_BASE = [
    "Application order",
    "Previous qualification (grade)",
    "Admission grade",
    "Age at enrollment",
    "Unemployment rate",
    "Inflation rate",
    "GDP",
]

UNIT_MEASURES = ["credited", "enrolled", "evaluations", "approved", "grade", "without evaluations"]
SEM1 = [f"Curricular units 1st sem ({m})" for m in UNIT_MEASURES]
SEM2 = [f"Curricular units 2nd sem ({m})" for m in UNIT_MEASURES]

ENGINEERED_SEM1 = ["sem1_approval_rate", "sem1_failed_evaluations"]
ENGINEERED_SEM2 = ["sem2_approval_rate", "sem2_failed_evaluations", "grade_delta", "total_approved"]

CLASS_NAMES = ["Dropout", "Enrolled", "Graduate"]  # LabelEncoder order (alphabetical)

# Code lists from the UCI dataset documentation (used for readable labels only).
COURSE_NAMES = {
    33: "Biofuel Production Technologies",
    171: "Animation and Multimedia Design",
    8014: "Social Service (evening)",
    9003: "Agronomy",
    9070: "Communication Design",
    9085: "Veterinary Nursing",
    9119: "Informatics Engineering",
    9130: "Equinculture",
    9147: "Management",
    9238: "Social Service",
    9254: "Tourism",
    9500: "Nursing",
    9556: "Oral Hygiene",
    9670: "Advertising and Marketing Management",
    9773: "Journalism and Communication",
    9853: "Basic Education",
    9991: "Management (evening)",
}
MARITAL_STATUS = {1: "Single", 2: "Married", 3: "Widower", 4: "Divorced", 5: "Facto union", 6: "Legally separated"}
APPLICATION_MODE = {
    1: "1st phase, general contingent",
    2: "Ordinance No. 612/93",
    5: "1st phase, special contingent (Azores)",
    7: "Holders of other higher courses",
    10: "Ordinance No. 854-B/99",
    15: "International student (bachelor)",
    16: "1st phase, special contingent (Madeira)",
    17: "2nd phase, general contingent",
    18: "3rd phase, general contingent",
    26: "Ordinance No. 533-A/99, b2 (different plan)",
    27: "Ordinance No. 533-A/99, b3 (other institution)",
    39: "Over 23 years old",
    42: "Transfer",
    43: "Change of course",
    44: "Technological specialization diploma",
    51: "Change of institution/course",
    53: "Short cycle diploma",
    57: "Change of institution/course (international)",
}
NATIONALITY = {
    1: "Portuguese", 2: "German", 6: "Spanish", 11: "Italian", 13: "Dutch", 14: "English", 17: "Lithuanian",
    21: "Angolan", 22: "Cape Verdean", 24: "Guinean", 25: "Mozambican", 26: "Santomean", 32: "Turkish",
    41: "Brazilian", 62: "Romanian", 100: "Moldovan", 101: "Mexican", 103: "Ukrainian", 105: "Russian",
    108: "Cuban", 109: "Colombian",
}
# Shared by the student's previous qualification and both parents' qualifications.
QUALIFICATION = {
    1: "Secondary education (12th year)",
    2: "Higher education, bachelor's",
    3: "Higher education, degree",
    4: "Higher education, master's",
    5: "Higher education, doctorate",
    6: "Frequency of higher education",
    9: "12th year, not completed",
    10: "11th year, not completed",
    11: "7th year (old)",
    12: "Other, 11th year",
    13: "2nd year complementary high school",
    14: "10th year",
    15: "10th year, not completed",
    18: "General commerce course",
    19: "Basic education 3rd cycle (9th-11th year)",
    20: "Complementary high school",
    22: "Technical-professional course",
    25: "Complementary high school, not concluded",
    26: "7th year",
    27: "2nd cycle general high school",
    29: "9th year, not completed",
    30: "8th year",
    31: "General course of administration and commerce",
    33: "Supplementary accounting and administration",
    34: "Unknown",
    35: "Can't read or write",
    36: "Can read, no 4th year",
    37: "Basic education 1st cycle (4th/5th year)",
    38: "Basic education 2nd cycle (6th-8th year)",
    39: "Technological specialization course",
    40: "Higher education, degree (1st cycle)",
    41: "Specialized higher studies course",
    42: "Professional higher technical course",
    43: "Higher education, master (2nd cycle)",
    44: "Higher education, doctorate (3rd cycle)",
}
BINARY_LABELS = {"Gender": {0: "Female", 1: "Male"}, "Daytime/evening attendance": {0: "Evening", 1: "Daytime"}}


def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Strip stray whitespace/tabs from headers (the raw file has one with a trailing tab)."""
    df = df.copy()
    df.columns = df.columns.str.strip()
    return df


def load_raw(path=DATA_PATH) -> pd.DataFrame:
    """Load the semicolon-separated UCI file, handling its byte-order mark."""
    return clean_columns(pd.read_csv(path, sep=";", encoding="utf-8-sig"))


def _semester_features(df: pd.DataFrame, sem: str, prefix: str) -> None:
    enrolled = df[f"Curricular units {sem} sem (enrolled)"]
    approved = df[f"Curricular units {sem} sem (approved)"]
    evaluations = df[f"Curricular units {sem} sem (evaluations)"]
    df[f"{prefix}_approval_rate"] = np.where(enrolled > 0, approved / enrolled.replace(0, 1), 0.0)
    df[f"{prefix}_failed_evaluations"] = (evaluations - approved).clip(lower=0)


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add engineered academic-progress features. 2nd-semester ones only if those columns exist."""
    df = df.copy()
    _semester_features(df, "1st", "sem1")
    if SEM2[0] in df.columns:
        _semester_features(df, "2nd", "sem2")
        df["grade_delta"] = df["Curricular units 2nd sem (grade)"] - df["Curricular units 1st sem (grade)"]
        df["total_approved"] = df["Curricular units 1st sem (approved)"] + df["Curricular units 2nd sem (approved)"]
    return df


def input_columns(early: bool = False) -> list[str]:
    """Raw columns the model expects. `early=True` drops 2nd-semester data (early-warning model)."""
    cols = NOMINAL + BINARY + NUMERIC_BASE + SEM1
    return cols if early else cols + SEM2


def numeric_columns(early: bool = False) -> list[str]:
    cols = NUMERIC_BASE + SEM1 + ENGINEERED_SEM1
    return cols if early else cols + SEM2 + ENGINEERED_SEM2


def build_preprocessor(early: bool = False) -> ColumnTransformer:
    return ColumnTransformer(
        [
            ("nominal", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10), NOMINAL),
            ("binary", "passthrough", BINARY),
            ("numeric", StandardScaler(), numeric_columns(early)),
        ],
        sparse_threshold=0,
    )


def build_pipeline(model, early: bool = False) -> Pipeline:
    """Raw columns in -> engineered features -> encoding/scaling -> model."""
    return Pipeline(
        [
            ("features", FunctionTransformer(add_features)),
            ("preprocess", build_preprocessor(early)),
            ("model", model),
        ]
    )
