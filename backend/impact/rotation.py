"""Rigid-body rotation state and quaternion utilities (plan 4.4). Pure functions, SI units, no REBOUND.

Model: torque-free rotation of an isotropic body with constant angular velocity omega (world frame, rad/s). The orientation
(unit quaternion body -> world, order w, x, y, z) is evaluated in closed form, q(t) = exp(1/2 Omega (t - t0)) q0, where Omega is
the pure quaternion (0, omega): exact for a sphere or any body whose inertia tensor is isotropic. Label: `approximation` for
non-spherical or differentiated bodies (no precession or tidal torque is modelled). Spin angular momentum S = I omega with
I = k M R^2 (k = the material profile's moment-of-inertia factor, M and R the body's mass and radius at the epoch).

The body-local frame has its axes parallel to the world axes at orientation q = (1, 0, 0, 0); a surface point fixed in the
body keeps its body-local coordinates while its world direction rotates (spec 5.2: never confuse the two).
Precision: evaluating q(t) from (q0, t0) accumulates no drift, but the rotation angle omega (t - t0) loses absolute precision
for very many turns (an angle of A rad is known to ~A * 1e-16 rad); `rebase` restarts the epoch.
"""
import math
from typing import Sequence

from backend.impact.contracts import RotationState, Vec3

Quat = tuple[float, float, float, float]
IDENTITY: Quat = (1.0, 0.0, 0.0, 0.0)


def q_mul(a: Quat, b: Quat) -> Quat:
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw)


def q_conj(q: Quat) -> Quat:
    return (q[0], -q[1], -q[2], -q[3])


def q_norm(q: Quat) -> float:
    return math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])


def q_normalize(q: Quat) -> Quat:
    n = q_norm(q)
    if not n > 0.0 or not math.isfinite(n):
        raise ValueError("cannot normalise a zero or non-finite quaternion")
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def rotate(q: Quat, v: Sequence[float]) -> tuple[float, float, float]:
    """Body -> world: q v q*."""
    r = q_mul(q_mul(q, (0.0, v[0], v[1], v[2])), q_conj(q))
    return (r[1], r[2], r[3])


def inverse_rotate(q: Quat, v: Sequence[float]) -> tuple[float, float, float]:
    """World -> body: q* v q."""
    r = q_mul(q_mul(q_conj(q), (0.0, v[0], v[1], v[2])), q)
    return (r[1], r[2], r[3])


def exp_rotation(omega: Sequence[float], dt: float) -> Quat:
    """Unit quaternion of the rotation by the angle |omega| dt about the axis omega (world frame)."""
    w = math.sqrt(omega[0] * omega[0] + omega[1] * omega[1] + omega[2] * omega[2])
    if w == 0.0 or dt == 0.0:
        return IDENTITY
    half = 0.5 * w * dt
    s = math.sin(half) / w
    return (math.cos(half), omega[0] * s, omega[1] * s, omega[2] * s)


def advance(q: Quat, omega: Sequence[float], dt: float) -> Quat:
    """One incremental update (renormalised, so a million updates stay unit to round-off)."""
    return q_normalize(q_mul(exp_rotation(omega, dt), q))


def orientation_at(state: RotationState, t_s: float) -> Quat:
    """Orientation (body -> world) at time t_s, evaluated in closed form from the epoch state (no accumulated drift)."""
    return q_normalize(q_mul(exp_rotation(state.omega_rad_per_s.as_tuple(), t_s - state.t0_s), state.q0))


def make_rotation(omega: Sequence[float], k: float, mass_kg: float, radius_m: float, t0_s: float, q0: Quat = IDENTITY) -> RotationState:
    """Rotation state of a body with moment of inertia I = k M R^2 spinning at `omega` from epoch t0 with orientation q0."""
    return RotationState(omega_rad_per_s=Vec3.of(omega), q0=q_normalize(q0), t0_s=t0_s, moment_of_inertia_kg_m2=k * mass_kg * radius_m * radius_m)


def spin_angular_momentum(state: RotationState) -> tuple[float, float, float]:
    """S = I omega, world frame [kg m^2/s]."""
    i = state.moment_of_inertia_kg_m2
    return tuple(i * c for c in state.omega_rad_per_s.as_tuple())  # type: ignore[return-value]


def rotational_energy(state: RotationState) -> float:
    w = state.omega_rad_per_s.as_tuple()
    return 0.5 * state.moment_of_inertia_kg_m2 * (w[0] * w[0] + w[1] * w[1] + w[2] * w[2])


def rebase(state: RotationState, t_s: float) -> RotationState:
    """The same rotation described from a new epoch (orientation at t_s becomes q0)."""
    return RotationState(omega_rad_per_s=state.omega_rad_per_s, q0=orientation_at(state, t_s), t0_s=t_s,
                         moment_of_inertia_kg_m2=state.moment_of_inertia_kg_m2)


def with_inertia(state: RotationState, t_s: float, moment_of_inertia_kg_m2: float) -> RotationState:
    """A new moment of inertia (the body's mass or radius was edited) at the same omega, from epoch t_s."""
    moved = rebase(state, t_s)
    return RotationState(omega_rad_per_s=moved.omega_rad_per_s, q0=moved.q0, t0_s=t_s, moment_of_inertia_kg_m2=moment_of_inertia_kg_m2)


def to_local(state: RotationState, t_s: float, world_vector: Sequence[float]) -> tuple[float, float, float]:
    return inverse_rotate(orientation_at(state, t_s), world_vector)


def to_world(state: RotationState, t_s: float, local_vector: Sequence[float]) -> tuple[float, float, float]:
    return rotate(orientation_at(state, t_s), local_vector)


def rotation_period_s(state: RotationState) -> float | None:
    w = math.sqrt(sum(c * c for c in state.omega_rad_per_s.as_tuple()))
    return None if w == 0.0 else 2.0 * math.pi / w
