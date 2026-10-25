"""REBOUND 5.2.2 particle-name safety (found in Stage 4a). Identity of a body is its REBOUND particle name, and `Simulation.add(name=...)`
leaves a dangling string: after enough interleaved remove()/add() calls names read as None or garbage bytes. Measured on plain REBOUND
(no project code): first corruption after 203-754 operations in 5 of 5 seeds with the kwarg; none in 20,000 operations with the setter.
`add_named_particle` therefore adds the particle and sets the name through the setter (memory owned by the simulation); every place that
adds a particle uses it. These tests fuzz the helper; they do not assert that the library bug exists (a fixed REBOUND would still pass)."""
import random
import warnings

import pytest
import rebound

from backend.collisions import add_named_particle


def fuzz(seed, operations=1200):
    rnd = random.Random(seed)
    sim = rebound.Simulation()
    sim.G, sim.units = 6.67e-11, ("m", "s", "kg")
    live = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for step in range(operations):
            if rnd.random() < 0.5 or len(live) < 3:
                name = f"debris-{step}-0-{rnd.getrandbits(40):x}"
                add_named_particle(sim, name, m=1.0, x=float(step))
                live.append(name)
            else:
                victim = live.pop(rnd.randrange(len(live)))
                sim.remove(next(p.index for p in sim.particles if p.name == victim))
            assert [p.name for p in sim.particles] == live, (seed, step)
    return len(live)


@pytest.mark.parametrize("seed", range(4))
def test_names_survive_a_long_random_mix_of_adds_and_removals(seed):
    assert fuzz(seed) > 0


def test_names_survive_integration_and_copying():
    sim = rebound.Simulation()
    sim.G, sim.units = 6.67e-11, ("m", "s", "kg")
    for i in range(5):
        add_named_particle(sim, f"b{i}", m=1e20, x=1e7 * i, vy=100.0)
    sim.remove(2)
    add_named_particle(sim, "late", m=1e19, x=9e7)
    sim.integrator = "ias15"
    sim.integrate(1e3)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        copy = sim.copy()
    assert [p.name for p in sim.particles] == ["b0", "b1", "b3", "b4", "late"] == [p.name for p in copy.particles]
