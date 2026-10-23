import os

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.models import Body, BodyCreate, SimulationState
from backend.store import SimulationStore, get_store

app = FastAPI(title="Playing God backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Drop the echoed `input`/`ctx`: they can hold NaN/Infinity, which JSON cannot serialize.
    details = [
        {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/simulation/state", response_model=SimulationState)
def get_state(store: SimulationStore = Depends(get_store)) -> SimulationState:
    return store.snapshot()


@app.post("/api/v1/bodies", response_model=Body, status_code=201)
def create_body(data: BodyCreate, store: SimulationStore = Depends(get_store)) -> Body:
    return store.add_body(data)
