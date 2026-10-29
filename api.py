
import io
import json
import uuid
from collections import OrderedDict

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

import pipeline as P

app = FastAPI(title="Poverty Targeting Tool API", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

SCANS = OrderedDict()      
MAX_SCANS = 20



def _plain(o):
    """Let json.dumps handle numpy numbers."""
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(f"Cannot send {type(o)}")


def send(data, status=200):
    return Response(content=json.dumps(data, default=_plain), status_code=status, media_type="application/json")


def error(code, message, details=None, status=400):
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return send(body, status)


@app.exception_handler(P.ApiError)
async def _api_error(_: Request, e: P.ApiError):
    return error(e.code, e.message, e.details, e.status)


@app.exception_handler(RequestValidationError)
async def _bad_request(_: Request, e: RequestValidationError):
    return error("BAD_REQUEST", "The request is missing something or has a wrong value.",
                 [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()])


@app.exception_handler(Exception)
async def _any_error(_: Request, e: Exception):
    return error("SERVER_ERROR", f"Something went wrong on the server: {type(e).__name__}: {e}", status=500)


async def read_csv(file: UploadFile) -> pd.DataFrame:
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw), low_memory=False)
    except Exception:
        raise P.ApiError("NOT_A_CSV", "The file could not be read as a CSV.")
    if df.shape[1] < 2:
        raise P.ApiError("NOT_A_CSV", "The file could not be read as a CSV.")
    return df


@app.on_event("startup")
def _startup():
    P.load()


@app.get("/health")
def health():
    P.load()
    return send({"status": "ok", "model_loaded": P.A.loaded})


@app.get("/schema")
def schema():
    return send(P.schema())


@app.get("/sample-file")
def sample_file(with_spending: bool = False):
    return Response(content=P.sample_file(with_spending), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="households_sample.csv"'})


@app.post("/validate")
async def validate(file: UploadFile = File(...)):
    try:
        df = await read_csv(file)
    except P.ApiError as e:
        return send({"ok": False, "file_name": file.filename, "rows": 0, "columns": 0,
                     "checks": [{"status": "fail", "code": e.code, "message": e.message}]})
    return send(P.validate(df, file.filename or "upload.csv"))


@app.post("/scan")
async def scan(file: UploadFile = File(...), budget: float = Form(...),
               programs: str = Form(...), fair: bool = Form(True)):
    df = await read_csv(file)
    try:
        program_ids = json.loads(programs)
        assert isinstance(program_ids, list)
    except Exception:
        raise P.ApiError("NO_PROGRAMS", "'programs' must be a JSON list such as [\"direct_support\"].")
    answer, table = P.scan(df, budget, program_ids, fair, file.filename or "upload.csv")
    scan_id = uuid.uuid4().hex[:8]
    answer = {"scan_id": scan_id, **answer}
    SCANS[scan_id] = {"answer": answer, "table": table}
    while len(SCANS) > MAX_SCANS:
        SCANS.popitem(last=False)
    return send(answer)


@app.get("/scan/{scan_id}/csv")
def scan_csv(scan_id: str):
    s = SCANS.get(scan_id)
    if not s:
        raise P.ApiError("NOT_FOUND", "This scan is no longer available. Please run it again.", status=404)
    return Response(content=P.scan_csv(s["answer"]), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="scan_{scan_id}.csv"'})


_overview = {}


@app.get("/overview")
def overview():
    if not _overview:
        _overview.update(P.overview())
    return send(_overview)


@app.get("/household/{hhid}")
def household(hhid: int, scan_id: str | None = None):
    if scan_id is None:
        row = P.survey_row(hhid)
        return send(P.explain(row, true_spending=float(row.sol_jan.iloc[0])))
    s = SCANS.get(scan_id)
    if not s:
        raise P.ApiError("NOT_FOUND", "This scan is no longer available. Please run it again.", status=404)
    t = s["table"]
    r = t[pd.to_numeric(t.hhid) == hhid]
    if r.empty:
        raise P.ApiError("NOT_FOUND", f"Household {hhid} is not in this scan.", status=404)
    program = r["_chosen"].iloc[0]
    decision = {"chosen": program is not None and not pd.isna(program),
                "program": P.PROGRAMS[program]["name"] if program else None,
                "amount": P.PROGRAMS[program]["cost"] if program else 0}
    spend = float(pd.to_numeric(r.sol_jan).iloc[0]) if "sol_jan" in r.columns else None
    return send(P.explain(r.reset_index(drop=True), decision, spend))


_fairness = {}


@app.get("/fairness")
def fairness():
    if not _fairness:
        _fairness.update(P.fairness())
    return send(_fairness)