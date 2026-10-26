"""Web app for the dropout model: a JSON API plus a hand-built front end in app/static.

Run from the project folder:  python app/server.py          (opens the browser)
                              python app/server.py --no-browser --port 8001
"""
import argparse
import io
import json
import sys
import threading
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.features import (APPLICATION_MODE, COURSE_NAMES, DATA_PATH, MARITAL_STATUS, MODELS_DIR, NATIONALITY,
                          QUALIFICATION, clean_columns)

STATIC_DIR = Path(__file__).resolve().parent / "static"

model = joblib.load(MODELS_DIR / "dropout_model.joblib")
meta = json.loads((MODELS_DIR / "model_meta.json").read_text())
CLASSES = meta["class_names"]
INPUTS = meta["input_columns"]
DROPOUT = CLASSES.index("Dropout")


def sem(s, measure):
    return f"Curricular units {s} sem ({measure})"


# UI schema: (column, label, group, control, extra). Order here is display order.
YES_NO = [{"value": 0, "label": "No"}, {"value": 1, "label": "Yes"}]
FIELDS = [
    (sem("1st", "enrolled"), "Units enrolled", "academic-1", "slider", {}),
    (sem("1st", "approved"), "Units passed", "academic-1", "slider", {"maxFrom": sem("1st", "enrolled")}),
    (sem("1st", "evaluations"), "Exams taken", "academic-1", "slider", {}),
    (sem("1st", "grade"), "Average grade", "academic-1", "slider", {"step": 0.1, "suffix": "/20"}),
    (sem("2nd", "enrolled"), "Units enrolled", "academic-2", "slider", {}),
    (sem("2nd", "approved"), "Units passed", "academic-2", "slider", {"maxFrom": sem("2nd", "enrolled")}),
    (sem("2nd", "evaluations"), "Exams taken", "academic-2", "slider", {}),
    (sem("2nd", "grade"), "Average grade", "academic-2", "slider", {"step": 0.1, "suffix": "/20"}),
    ("Tuition fees up to date", "Tuition paid", "finances", "toggle", {}),
    ("Debtor", "Owes the institution", "finances", "toggle", {}),
    ("Scholarship holder", "Scholarship", "finances", "toggle", {}),
    ("Displaced", "Studies away from home", "finances", "toggle", {}),
    ("Course", "Course", "profile", "select", {"labels": COURSE_NAMES}),
    ("Age at enrollment", "Age at enrolment", "profile", "slider", {}),
    ("Admission grade", "Admission grade", "profile", "slider", {"step": 0.1, "suffix": "/200"}),
    ("Gender", "Gender", "profile", "segmented", {"options": [{"value": 0, "label": "Female"}, {"value": 1, "label": "Male"}]}),
    ("Daytime/evening attendance", "Attendance", "profile", "segmented",
     {"options": [{"value": 1, "label": "Daytime"}, {"value": 0, "label": "Evening"}]}),
    ("Marital status", "Marital status", "more", "select", {"labels": MARITAL_STATUS}),
    ("Application mode", "Application mode", "more", "select", {"labels": APPLICATION_MODE}),
    ("Application order", "Application preference", "more", "slider", {}),
    ("Previous qualification", "Previous qualification", "more", "select", {"labels": QUALIFICATION}),
    ("Previous qualification (grade)", "Previous qualification grade", "more", "slider", {"step": 0.1, "suffix": "/200"}),
    ("Nacionality", "Nationality", "more", "select", {"labels": NATIONALITY}),
    ("Mother's qualification", "Mother's qualification", "more", "select", {"labels": QUALIFICATION}),
    ("Father's qualification", "Father's qualification", "more", "select", {"labels": QUALIFICATION}),
    ("Mother's occupation", "Mother's occupation", "more", "select", {}),
    ("Father's occupation", "Father's occupation", "more", "select", {}),
    ("Educational special needs", "Special educational needs", "more", "toggle", {}),
    ("International", "International student", "more", "toggle", {}),
    (sem("1st", "credited"), "1st sem units credited", "more", "slider", {}),
    (sem("1st", "without evaluations"), "1st sem units without exams", "more", "slider", {}),
    (sem("2nd", "credited"), "2nd sem units credited", "more", "slider", {}),
    (sem("2nd", "without evaluations"), "2nd sem units without exams", "more", "slider", {}),
    ("Unemployment rate", "Unemployment rate", "more", "slider", {"step": 0.1, "suffix": "%"}),
    ("Inflation rate", "Inflation rate", "more", "slider", {"step": 0.1, "suffix": "%"}),
    ("GDP", "GDP growth", "more", "slider", {"step": 0.01}),
]
assert sorted(f[0] for f in FIELDS) == sorted(INPUTS), "UI schema must cover every model input exactly once"
LABELS = {f[0]: f[1] for f in FIELDS}
SEMESTER_PREFIX = {"academic-1": "1st sem ", "academic-2": "2nd sem "}
DRIVER_LABELS = {f[0]: SEMESTER_PREFIX.get(f[2], "") + f[1].lower() if f[2] in SEMESTER_PREFIX else f[1] for f in FIELDS}


TIERS = [
    {"key": "High", "min": 0.6, "max": 1.0, "label": "High risk", "hint": "Dropout chance 60% or more"},
    {"key": "Watch", "min": 0.3, "max": 0.6, "label": "Watch", "hint": "Dropout chance 30–60%"},
    {"key": "Low", "min": 0.0, "max": 0.3, "label": "Low risk", "hint": "Dropout chance under 30%"},
]


def risk_tier(p_dropout):
    return next(t["key"] for t in TIERS if p_dropout >= t["min"])


def default_value(col):
    v = meta["defaults"][col]
    return int(round(v)) if col in meta["nominal_columns"] + meta["binary_columns"] else v


def build_schema():
    fields = []
    for col, label, group, control, extra in FIELDS:
        field = {"key": col, "label": label, "group": group, "control": control, "default": default_value(col)}
        if control == "slider":
            lo, hi = meta["numeric_ranges"][col]
            step = extra.get("step", 1)
            field.update(min=lo, max=hi, step=step, suffix=extra.get("suffix", ""))
            decimals = len(str(step).split(".")[1]) if "." in str(step) else 0
            field["default"] = round(field["default"], decimals) if decimals else int(round(field["default"]))
            if "maxFrom" in extra:
                field["maxFrom"] = extra["maxFrom"]
        elif control == "select":
            names = extra.get("labels", {})
            field["options"] = [{"value": c, "label": names.get(c, f"Code {c}")} for c in meta["categories"][col]]
        elif control == "segmented":
            field["options"] = extra["options"]
        elif control == "toggle":
            field["options"] = YES_NO
        fields.append(field)
    return fields


SCHEMA = build_schema()
DEFAULTS = {f["key"]: f["default"] for f in SCHEMA}


def describe(col, value):
    """Human wording for a driver row, e.g. 'Tuition paid · No'."""
    field = next(f for f in SCHEMA if f["key"] == col)
    if "options" in field:
        shown = next((o["label"] for o in field["options"] if o["value"] == value), value)
    else:
        shown = f"{value:g}{field.get('suffix', '')}" if isinstance(value, (int, float)) else value
    return f"{DRIVER_LABELS[col]} · {shown}"


app = FastAPI(title="Dropout Risk", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class PredictRequest(BaseModel):
    values: dict = {}


class BatchRequest(BaseModel):
    csv: str


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/meta")
def get_meta():
    importance = [{"label": DRIVER_LABELS.get(r["feature"], r["feature"]), "value": r["importance"]}
                  for r in meta["permutation_importance_top15"][:8]]
    return {
        "classes": CLASSES,
        "fields": SCHEMA,
        "metrics": meta["test_metrics"],
        "baseline": meta["baseline_test_metrics"],
        "testRows": meta["split"]["test_rows"],
        "modelName": meta["model_name"],
        "importance": importance,
    }


# A semester's results move together (passed can't exceed enrolled), so each semester is one factor.
SEMESTER_GROUPS = {s: [sem(s, m) for m in ("credited", "enrolled", "evaluations", "approved", "grade", "without evaluations")]
                   for s in ("1st", "2nd")}
GROUPED = {c for cols in SEMESTER_GROUPS.values() for c in cols}


def factors(values):
    """Changed inputs as (text, columns) pairs; each semester's results count as one factor."""
    out = []
    for s, cols in SEMESTER_GROUPS.items():
        if any(values[c] != DEFAULTS[c] for c in cols):
            passed, enrolled = values[sem(s, "approved")], values[sem(s, "enrolled")]
            grade = values[sem(s, "grade")]
            out.append((f"{s} semester · {passed:g} of {enrolled:g} passed, avg {grade:.1f}", cols))
    out += [(describe(c, values[c]), [c]) for c in INPUTS if c not in GROUPED and values[c] != DEFAULTS[c]]
    return out


@app.post("/api/predict")
def predict(req: PredictRequest):
    values = {**DEFAULTS, **{k: v for k, v in req.values.items() if k in DEFAULTS}}
    changed = factors(values)
    # Effect of a factor = how much it alone moves a typical (all-default) student's dropout risk.
    # Measured from the typical student, not from this one, so it stays informative even when risk is near 100%.
    rows = [values, DEFAULTS] + [{**DEFAULTS, **{c: values[c] for c in cols}} for _, cols in changed]
    proba = model.predict_proba(pd.DataFrame(rows)[INPUTS])
    current, typical = proba[0], proba[1]
    effects = [(text, float(p[DROPOUT] - typical[DROPOUT])) for (text, _), p in zip(changed, proba[2:])]
    effects = sorted((e for e in effects if abs(e[1]) >= 0.01), key=lambda e: -abs(e[1]))[:3]
    return {
        "label": CLASSES[int(current.argmax())],
        "probabilities": {c: float(p) for c, p in zip(CLASSES, current)},
        "drivers": [{"text": text, "effect": round(e, 4)} for text, e in effects],
    }


@app.post("/api/batch")
def batch(req: BatchRequest):
    try:
        frame = clean_columns(pd.read_csv(io.StringIO(req.csv.lstrip("﻿")), sep=None, engine="python"))
    except Exception as exc:
        raise HTTPException(400, f"Could not read the file as CSV ({exc.__class__.__name__}).")
    missing = [c for c in INPUTS if c not in frame.columns]
    if missing:
        raise HTTPException(422, {"message": f"{len(missing)} required column(s) missing", "missing": missing})
    if frame.empty:
        raise HTTPException(422, {"message": "The file has no rows", "missing": []})
    blanks = [c for c in INPUTS if frame[c].isna().any()]
    if blanks:
        raise HTTPException(422, {"message": f"Empty cells in {len(blanks)} column(s)", "missing": blanks})
    non_numeric = [c for c in INPUTS if not pd.api.types.is_numeric_dtype(frame[c])]
    if non_numeric:
        raise HTTPException(422, {"message": f"Non-numeric values in {len(non_numeric)} column(s)", "missing": non_numeric})

    frame = frame.reset_index(drop=True)
    proba = model.predict_proba(frame[INPUTS])
    pred = np.array(CLASSES)[proba.argmax(axis=1)]
    targets = frame["Target"].astype(str).str.strip().to_numpy() if "Target" in frame else None
    inputs = frame[INPUTS].to_numpy().tolist()  # one list per row, in INPUTS order (keeps the payload small)

    rows = []
    for i in range(len(frame)):
        course = int(frame["Course"].iloc[i])
        rows.append({
            "id": i + 1,
            "course": COURSE_NAMES.get(course, f"Code {course}"),
            "label": pred[i],
            "p": {c: round(float(proba[i, j]), 4) for j, c in enumerate(CLASSES)},
            "tier": risk_tier(proba[i, DROPOUT]),
            "target": targets[i] if targets is not None else None,
            "v": [int(x) if float(x).is_integer() else x for x in inputs[i]],
        })
    return {
        "columns": INPUTS,
        "rows": rows,
        "hasTarget": targets is not None,
        "accuracy": float((pred == targets).mean()) if targets is not None else None,
        "tiers": TIERS,
    }


@app.get("/api/sample", response_class=PlainTextResponse)
def sample():
    return DATA_PATH.read_text(encoding="utf-8-sig")


@app.get("/api/template", response_class=PlainTextResponse)
def template():
    return ";".join(INPUTS) + "\n"


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="Start the Dropout Risk web app.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        threading.Timer(1.2, webbrowser.open, args=[url]).start()
    print(f"Dropout Risk running at {url}  (Ctrl+C to stop)")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
