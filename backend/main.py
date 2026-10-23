import os

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from backend.models import (Body, BodyCreate, BodyUpdate, EventList, SimulationState, StepRequest, StepResponse)
from backend.simulation import (ConflictError, NotFoundError, SimulationFailure, SimulationService, get_service)

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


@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ConflictError)
async def conflict_handler(request: Request, exc: ConflictError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(SimulationFailure)
async def simulation_failure_handler(request: Request, exc: SimulationFailure):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/simulation/state", response_model=SimulationState)
def get_state(service: SimulationService = Depends(get_service)) -> SimulationState:
    return service.snapshot()


@app.post("/api/v1/bodies", response_model=Body, status_code=201)
def create_body(data: BodyCreate, service: SimulationService = Depends(get_service)) -> Body:
    return service.add_body(data)


@app.patch("/api/v1/bodies/{body_id}", response_model=Body)
def update_body(body_id: str, patch: BodyUpdate, service: SimulationService = Depends(get_service)) -> Body:
    return service.update_body(body_id, patch)


@app.delete("/api/v1/bodies/{body_id}", status_code=204)
def delete_body(body_id: str, service: SimulationService = Depends(get_service)) -> Response:
    service.delete_body(body_id)
    return Response(status_code=204)


@app.post("/api/v1/simulation/step", response_model=StepResponse)
def step(req: StepRequest, service: SimulationService = Depends(get_service)) -> StepResponse:
    return service.step(req.dtS)


@app.post("/api/v1/simulation/reset", response_model=SimulationState)
def reset(service: SimulationService = Depends(get_service)) -> SimulationState:
    return service.reset()


@app.get("/api/v1/events", response_model=EventList)
def get_events(service: SimulationService = Depends(get_service)) -> EventList:
    return EventList(events=service.events())
