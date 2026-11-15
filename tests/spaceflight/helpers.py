"""Shared helpers of the spaceflight tests."""
import math

from backend.models import BodyCreate
from backend.simulation import STOP_ON_CONTACT_CONFIG, InitialBody, SimulationService
from backend.spaceflight.requests import ManeuverCreate, OrbitSpec, SpacecraftCreate

G = 6.67430e-11  # the engine's constant, written out here so the tests do not read it from the code under test
M_EARTH = 5.9722e24
R_EARTH = 6.3710084e6
M_MOON = 7.346e22
R_MOON = 1.7374e6
D_MOON = 3.844e8
MU_EARTH = G * M_EARTH


def body(name, m, r, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0), **extra) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)), velocityMPerS=dict(zip("xyz", v)),
                      colorHex="#ffffff", **extra)


def earth_service(config=None, **kwargs) -> tuple[SimulationService, str]:
    """A sandbox engine with one Earth-like body at rest at the origin. Returns (engine, earth id)."""
    svc = SimulationService(config) if config is not None else SimulationService()
    earth = svc.add_body(body("Earth", M_EARTH, R_EARTH, **kwargs))
    return svc, earth.id


def earth_moon_service(config=STOP_ON_CONTACT_CONFIG, interval=600.0) -> SimulationService:
    """Earth and a Moon on a circular orbit in the x-y plane about their barycentre (ids body-earth, body-moon), grid history."""
    total = M_EARTH + M_MOON
    v = math.sqrt(G * total / D_MOON)
    svc = SimulationService(config)
    svc.load_bodies([
        InitialBody(id="body-earth", name="Earth", kind="planet", massKg=M_EARTH, radiusM=R_EARTH,
                    positionM=(-D_MOON * M_MOON / total, 0.0, 0.0), velocityMPerS=(0.0, -v * M_MOON / total, 0.0), colorHex="#3b82f6"),
        InitialBody(id="body-moon", name="Moon", kind="planet", massKg=M_MOON, radiusM=R_MOON,
                    positionM=(D_MOON * M_EARTH / total, 0.0, 0.0), velocityMPerS=(0.0, v * M_EARTH / total, 0.0), colorHex="#9ca3af",
                    bodyType="moon", primaryId="body-earth"),
    ], history_mode="grid", sample_interval_s=interval)
    return svc


def craft_request(central: str, altitude: float = 400.0e3, *, name="Probe", dry=1000.0, propellant=1000.0, thrust=10000.0, isp=320.0,
                  **orbit) -> SpacecraftCreate:
    return SpacecraftCreate(name=name, dryMassKg=dry, propellantKg=propellant, thrustN=thrust, ispS=isp,
                            orbit=OrbitSpec(centralBodyId=central, periapsisAltitudeM=altitude, **orbit))


def add_craft(svc: SimulationService, central: str, altitude: float = 400.0e3, **kwargs):
    created, _ = svc.add_spacecraft(craft_request(central, altitude, **kwargs))
    return created


def craft_of(state, craft_id):
    return next(b for b in state.bodies if b.id == craft_id)


def node(**kwargs) -> ManeuverCreate:
    return ManeuverCreate(**kwargs)


def rel(state, craft_id, body_id):
    c, b = craft_of(state, craft_id), craft_of(state, body_id)
    r = (c.positionM.x - b.positionM.x, c.positionM.y - b.positionM.y, c.positionM.z - b.positionM.z)
    v = (c.velocityMPerS.x - b.velocityMPerS.x, c.velocityMPerS.y - b.velocityMPerS.y, c.velocityMPerS.z - b.velocityMPerS.z)
    return r, v
