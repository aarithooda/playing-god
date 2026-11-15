"""Rocket propulsion relations (pure, SI). A constant-thrust, constant-specific-impulse engine:

    exhaust velocity      v_e  = Isp * g0                (g0 = 9.80665 m/s^2 exactly, the standard gravity that DEFINES Isp in seconds)
    mass flow             mdot = F / v_e
    Tsiolkovsky           dv   = v_e ln(m0 / m1)   <=>   m1 = m0 exp(-dv / v_e)
    burn duration         t    = (m0 - m1) / mdot
    thrust acceleration   a(t) = F / (m0 - mdot (t - t0))     (grows as propellant is spent)

An IMPULSIVE burn is the limit F -> infinity: the velocity changes instantly, the propellant of the rocket equation is consumed.
"""
import math

G0 = 9.80665  # m/s^2, standard gravity (exact by definition, CGPM 1901)


def exhaust_velocity(isp_s: float) -> float:
    return isp_s * G0


def mass_flow(thrust_n: float, isp_s: float) -> float:
    """kg/s. Zero thrust or zero Isp means no engine."""
    if not (thrust_n > 0.0 and isp_s > 0.0):
        return 0.0
    return thrust_n / exhaust_velocity(isp_s)


def delta_v_capacity(dry_mass_kg: float, propellant_kg: float, isp_s: float) -> float:
    """Delta-v available from the propellant on board (Tsiolkovsky)."""
    if not (isp_s > 0.0 and propellant_kg > 0.0 and dry_mass_kg > 0.0):
        return 0.0
    return exhaust_velocity(isp_s) * math.log((dry_mass_kg + propellant_kg) / dry_mass_kg)


def propellant_for(delta_v: float, mass_kg: float, isp_s: float) -> float:
    """Propellant a mass `mass_kg` (before the burn) must expel for `delta_v`."""
    if delta_v <= 0.0:
        return 0.0
    if not isp_s > 0.0:
        return math.inf
    return mass_kg * (1.0 - math.exp(-delta_v / exhaust_velocity(isp_s)))


def delta_v_from(propellant_kg: float, mass_kg: float, isp_s: float) -> float:
    """Delta-v obtained by expelling `propellant_kg` from a mass `mass_kg` (before the burn)."""
    if not (propellant_kg > 0.0 and isp_s > 0.0):
        return 0.0
    if propellant_kg >= mass_kg:
        return math.inf
    return exhaust_velocity(isp_s) * math.log(mass_kg / (mass_kg - propellant_kg))


def burn_duration(delta_v: float, mass_kg: float, thrust_n: float, isp_s: float) -> float:
    """Seconds of constant thrust needed for `delta_v` starting at mass `mass_kg` (inf without an engine)."""
    flow = mass_flow(thrust_n, isp_s)
    if flow <= 0.0:
        return math.inf if delta_v > 0.0 else 0.0
    return propellant_for(delta_v, mass_kg, isp_s) / flow
