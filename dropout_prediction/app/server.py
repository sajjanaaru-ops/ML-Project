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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.features import (APPLICATION_MODE, COURSE_NAMES, MARITAL_STATUS, MODELS_DIR, NATIONALITY, QUALIFICATION,
                          clean_columns)

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


@app.post("/api/predict")
def predict(req: PredictRequest):
    values = {**DEFAULTS, **{k: v for k, v in req.values.items() if k in DEFAULTS}}
    changed = [c for c in INPUTS if values[c] != DEFAULTS[c]]
    rows = [values] + [{**values, c: DEFAULTS[c]} for c in changed]
    proba = model.predict_proba(pd.DataFrame(rows)[INPUTS])
    current = proba[0]
    effects = [(c, float(current[DROPOUT] - p[DROPOUT])) for c, p in zip(changed, proba[1:])]
    effects = sorted((e for e in effects if abs(e[1]) >= 0.01), key=lambda e: -abs(e[1]))[:3]
    return {
        "label": CLASSES[int(current.argmax())],
        "probabilities": {c: float(p) for c, p in zip(CLASSES, current)},
        "drivers": [{"text": describe(c, values[c]), "effect": round(e, 4)} for c, e in effects],
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

    proba = model.predict_proba(frame[INPUTS])
    pred = np.array(CLASSES)[proba.argmax(axis=1)]
    out = pd.DataFrame(proba.round(4), columns=[f"P({c})" for c in CLASSES])
    out.insert(0, "Prediction", pred)
    full = pd.concat([out, frame.reset_index(drop=True)], axis=1)

    order = np.argsort(-proba[:, DROPOUT])[:100]
    top = [{"row": int(i) + 1,
            "course": COURSE_NAMES.get(int(frame["Course"].iloc[i]), f"Code {int(frame['Course'].iloc[i])}"),
            "label": pred[i],
            "probabilities": {c: float(proba[i, j]) for j, c in enumerate(CLASSES)}} for i in order]
    accuracy = float((pred == frame["Target"].astype(str).str.strip().to_numpy()).mean()) if "Target" in frame else None
    return {
        "rows": int(len(frame)),
        "counts": {c: int((pred == c).sum()) for c in CLASSES},
        "accuracy": accuracy,
        "top": top,
        "csv": full.to_csv(index=False),
    }


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
