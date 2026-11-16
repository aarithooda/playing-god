"""Space Mission Design (pillar 2): spacecraft as simulation entities, orbital mechanics, manoeuvres and mission planning.

Layout:
  orbits.py      pure two-body orbital mechanics (elements <-> state vectors, derived quantities, frames, transfer estimates)
  propulsion.py  rocket equation, mass flow, burn duration
  craft.py       the per-universe spaceflight state (spacecraft, manoeuvre nodes, missions, collision halt) and its copy semantics
  dynamics.py    burns on a REBOUND simulation: impulses and the finite-thrust force (shared by the engine and the planner)
  planner.py     transfer design: patched-conic estimate refined by shooting on an N-body copy of the universe
  missions.py    mission state machine and the evaluation of the ACTUAL outcome against the intended conditions
  schemas.py     pydantic request / response models of the spaceflight API

SI units throughout (m, kg, s, rad in the maths; degrees only at the API boundary). The integrator is still the universe's own
REBOUND/IAS15 simulation: a spacecraft is a particle of it. Assumptions and limits: docs/SPACE_MISSION_DESIGN.md.
"""
