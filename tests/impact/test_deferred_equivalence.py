"""Stage 1: deferred resolution (mode "outcome-v1") reproduces the legacy in-callback merger.

The GOLDEN values below were produced by running the scenarios of tests/impact/legacy_scenarios.py on the UNCHANGED legacy
engine of commit f2c2da3 (backend/simulation.py and backend/collisions.py as of that commit; mode "legacy-merge" is still that
code path, bit for bit: the refactor that shares the merge arithmetic was re-checked to reproduce these values byte for byte).
They are data, not expectations derived from the code under test. Floats are exact `repr` values.

What the golden comparison shows (measured, see context/WORKLOG.md "Stage 1" and the CP-1 evidence table):
- EXACT: every scenario with one contact per detection pass, the chain and the five independent pairs: event fields agree to
  <= 1e-12 relative (mostly bit for bit).
- ORDER ONLY: simultaneous contacts are resolved in the plan's deterministic order (estimated contact time, then sorted ids),
  not in REBOUND's index order, so ties can swap which of two mirror-image pairs merges first (ring of 4) or which
  intermediate remnant a three-body cluster passes through (the last two events of the 10-body collapse). Times, speeds and
  the final state are unchanged.
- LEGACY DEFECT (not reproduced on purpose): after the first removal in a detection pass the legacy resolver receives
  callbacks whose indices refer to shifted particles, and merges bodies that do not touch (rings of 6 and 12). The deferred
  engine re-checks the live overlap and merges them when they really touch.
"""
import math
import random
import sys

import pytest

from backend.impact.config import CollisionConfig
from backend.simulation import LEGACY_MERGE_CONFIG, SimulationService
from tests.impact import legacy_scenarios as ls

SWEEP_INDICES = [0, 4, 5, 6, 14, 16]

GOLDEN = {'kepler_merge': {'t': 9928.905593543364,
                  'events': [{'id': 'evt-1',
                              'simulationTimeS': 4905.31939759295,
                              'estimatedContactTimeS': 4902.72735580853,
                              'bodyIds': ['one', 'two'],
                              'resultBodyId': 'one',
                              'resultMassKg': 6000000000000.0,
                              'relativeSpeedMPerS': 2.2490678794556036,
                              'kineticEnergyLostJ': 2107627635999.552,
                              'spinAddedKgM2PerS': [-0.0, 0.0, 229865631039817.16]}],
                  'bodies': [{'id': 'one',
                              'massKg': 6000000000000.0,
                              'radiusM': 104.00419115259518,
                              'positionM': [5.3385416666666665e-14, 1.5625e-14, 0.0],
                              'velocityMPerS': [0.0, 0.0, 0.0]}]},
 'ring4': {'t': 15.0,
           'events': [{'id': 'evt-1',
                       'simulationTimeS': 9.320242385641501,
                       'estimatedContactTimeS': 9.292893108998255,
                       'bodyIds': ['ring0', 'ring3'],
                       'resultBodyId': 'ring0',
                       'resultMassKg': 2000000.0,
                       'relativeSpeedMPerS': 14.142136862397185,
                       'kineticEnergyLostJ': 50000008.75869332,
                       'spinAddedKgM2PerS': [0.0, -0.0, 0.0]},
                      {'id': 'evt-2',
                       'simulationTimeS': 9.320242385641501,
                       'estimatedContactTimeS': None,
                       'bodyIds': ['ring0', 'ring1'],
                       'resultBodyId': 'ring0',
                       'resultMassKg': 3000000.0,
                       'relativeSpeedMPerS': 15.811389685712843,
                       'kineticEnergyLostJ': 83333347.93115549,
                       'spinAddedKgM2PerS': [-0.0, -0.0, 9.473903143468002e-09]},
                      {'id': 'evt-3',
                       'simulationTimeS': 9.347132551965851,
                       'estimatedContactTimeS': None,
                       'bodyIds': ['ring0', 'ring2'],
                       'resultBodyId': 'ring0',
                       'resultMassKg': 4000000.0,
                       'relativeSpeedMPerS': 13.333334592150969,
                       'kineticEnergyLostJ': 66666679.254843615,
                       'spinAddedKgM2PerS': [-0.0, -0.0, -4.220491292480793e-09]}],
           'bodies': [{'id': 'ring0',
                       'massKg': 4000000.0,
                       'radiusM': 7.937005259840996,
                       'positionM': [2.632321532831596e-15, -4.175651815749586e-15, 0.0],
                       'velocityMPerS': [4.656612873077392e-16, -7.718229977100566e-16, 0.0]}]},
 'ring6': {'t': 15.0,
           'events': [{'id': 'evt-1',
                       'simulationTimeS': 9.021690877555704,
                       'estimatedContactTimeS': 8.999999828966294,
                       'bodyIds': ['ring1', 'ring2'],
                       'resultBodyId': 'ring1',
                       'resultMassKg': 2000000.0,
                       'relativeSpeedMPerS': 10.000001124707069,
                       'kineticEnergyLostJ': 25000005.62353566,
                       'spinAddedKgM2PerS': [0.0, -0.0, 1.7570914158697176e-08]},
                      {'id': 'evt-2',
                       'simulationTimeS': 9.021690877555704,
                       'estimatedContactTimeS': 8.999999828966295,
                       'bodyIds': ['ring4', 'ring5'],
                       'resultBodyId': 'ring4',
                       'resultMassKg': 2000000.0,
                       'relativeSpeedMPerS': 10.000001124707076,
                       'kineticEnergyLostJ': 25000005.623535696,
                       'spinAddedKgM2PerS': [0.0, 0.0, -7.105428156753445e-08]},
                      {'id': 'evt-3',
                       'simulationTimeS': 9.021690877555704,
                       'estimatedContactTimeS': None,
                       'bodyIds': ['ring4', 'ring3'],
                       'resultBodyId': 'ring4',
                       'resultMassKg': 3000000.0,
                       'relativeSpeedMPerS': 13.228758043170554,
                       'kineticEnergyLostJ': 58333346.454916544,
                       'spinAddedKgM2PerS': [-0.0, -0.0, 1.8947806286936004e-08]},
                      {'id': 'evt-4',
                       'simulationTimeS': 9.021690877555704,
                       'estimatedContactTimeS': None,
                       'bodyIds': ['ring1', 'ring0'],
                       'resultBodyId': 'ring1',
                       'resultMassKg': 3000000.0,
                       'relativeSpeedMPerS': 13.228758043170554,
                       'kineticEnergyLostJ': 58333346.454916544,
                       'spinAddedKgM2PerS': [0.0, 0.0, -6.631732200427601e-08]},
                      {'id': 'evt-5',
                       'simulationTimeS': 9.060390143088405,
                       'estimatedContactTimeS': None,
                       'bodyIds': ['ring1', 'ring4'],
                       'resultBodyId': 'ring1',
                       'resultMassKg': 6000000.0,
                       'relativeSpeedMPerS': 13.333334927775592,
                       'kineticEnergyLostJ': 133333365.22218043,
                       'spinAddedKgM2PerS': [0.0, -0.0, 4.263256414560601e-08]}],
           'bodies': [{'id': 'ring1',
                       'massKg': 6000000.0,
                       'radiusM': 9.085602964160696,
                       'positionM': [2.483526865641276e-15, -1.2042682971256451e-15, 0.0],
                       'velocityMPerS': [0.0, -6.20881716410319e-16, 0.0]}]},
 'ring12': {'t': 15.0,
            'events': [{'id': 'evt-1',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': 8.068148069077107,
                        'bodyIds': ['ring6', 'ring7'],
                        'resultBodyId': 'ring6',
                        'resultMassKg': 2000000.0,
                        'relativeSpeedMPerS': 5.176381650383903,
                        'kineticEnergyLostJ': 6698731.747607796,
                        'spinAddedKgM2PerS': [0.0, 0.0, 4.1744385725905886e-08]},
                       {'id': 'evt-2',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': 8.06814806907711,
                        'bodyIds': ['ring4', 'ring5'],
                        'resultBodyId': 'ring4',
                        'resultMassKg': 2000000.0,
                        'relativeSpeedMPerS': 5.1763816503839095,
                        'kineticEnergyLostJ': 6698731.74760781,
                        'spinAddedKgM2PerS': [0.0, -0.0, -8.881784197001252e-09]},
                       {'id': 'evt-3',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': 8.068148069077107,
                        'bodyIds': ['ring0', 'ring1'],
                        'resultBodyId': 'ring0',
                        'resultMassKg': 2000000.0,
                        'relativeSpeedMPerS': 5.176381650383905,
                        'kineticEnergyLostJ': 6698731.7476078,
                        'spinAddedKgM2PerS': [-0.0, -0.0, -4.440892098500626e-09]},
                       {'id': 'evt-4',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': 8.06814806907711,
                        'bodyIds': ['ring9', 'ring10'],
                        'resultBodyId': 'ring9',
                        'resultMassKg': 2000000.0,
                        'relativeSpeedMPerS': 5.1763816503839095,
                        'kineticEnergyLostJ': 6698731.74760781,
                        'spinAddedKgM2PerS': [-0.0, 0.0, -1.5987211554602254e-08]},
                       {'id': 'evt-5',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': 8.06814806907711,
                        'bodyIds': ['ring2', 'ring3'],
                        'resultBodyId': 'ring2',
                        'resultMassKg': 2000000.0,
                        'relativeSpeedMPerS': 5.176381650383906,
                        'kineticEnergyLostJ': 6698731.747607804,
                        'spinAddedKgM2PerS': [-0.0, -0.0, 1.5987211554602254e-08]},
                       {'id': 'evt-6',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': None,
                        'bodyIds': ['ring9', 'ring8'],
                        'resultBodyId': 'ring9',
                        'resultMassKg': 3000000.0,
                        'relativeSpeedMPerS': 7.529856984319277,
                        'kineticEnergyLostJ': 18899582.0681006,
                        'spinAddedKgM2PerS': [-0.0, -0.0, -5.802765675374151e-08]},
                       {'id': 'evt-7',
                        'simulationTimeS': 8.129442791160946,
                        'estimatedContactTimeS': None,
                        'bodyIds': ['ring0', 'ring11'],
                        'resultBodyId': 'ring0',
                        'resultMassKg': 3000000.0,
                        'relativeSpeedMPerS': 7.529856984319278,
                        'kineticEnergyLostJ': 18899582.0681006,
                        'spinAddedKgM2PerS': [0.0, -0.0, -4.381680203853951e-08]},
                       {'id': 'evt-8',
                        'simulationTimeS': 8.69917624037701,
                        'estimatedContactTimeS': 8.695633361609906,
                        'bodyIds': ['ring2', 'ring4'],
                        'resultBodyId': 'ring2',
                        'resultMassKg': 4000000.0,
                        'relativeSpeedMPerS': 9.659260331125127,
                        'kineticEnergyLostJ': 46650655.072223745,
                        'spinAddedKgM2PerS': [0.0, -0.0, 0.35556516664314586]},
                       {'id': 'evt-9',
                        'simulationTimeS': 8.847523478211865,
                        'estimatedContactTimeS': 8.818203907460315,
                        'bodyIds': ['ring9', 'ring6'],
                        'resultBodyId': 'ring9',
                        'resultMassKg': 5000000.0,
                        'relativeSpeedMPerS': 11.432480631915027,
                        'kineticEnergyLostJ': 78420968.03946733,
                        'spinAddedKgM2PerS': [-0.0, -0.0, -2.5115988478319196]},
                       {'id': 'evt-10',
                        'simulationTimeS': 8.89311453033111,
                        'estimatedContactTimeS': 8.872953080963441,
                        'bodyIds': ['ring9', 'ring2'],
                        'resultBodyId': 'ring9',
                        'resultMassKg': 9000000.0,
                        'relativeSpeedMPerS': 14.628401794565253,
                        'kineticEnergyLostJ': 237766821.18137765,
                        'spinAddedKgM2PerS': [-0.0, 0.0, 1.0987819286533016]},
                       {'id': 'evt-11',
                        'simulationTimeS': 8.936895849690977,
                        'estimatedContactTimeS': None,
                        'bodyIds': ['ring9', 'ring0'],
                        'resultBodyId': 'ring9',
                        'resultMassKg': 12000000.0,
                        'relativeSpeedMPerS': 12.142451122955991,
                        'kineticEnergyLostJ': 165869009.18254712,
                        'spinAddedKgM2PerS': [0.0, 0.0, 1.0572517677295228]}],
            'bodies': [{'id': 'ring9',
                        'massKg': 12000000.0,
                        'radiusM': 11.447142425533313,
                        'positionM': [6.012916098320784e-16, -2.432941836876367e-15, 0.0],
                        'velocityMPerS': [-3.104408582051595e-16, -6.552059647150592e-16, 0.0]}]},
 'homologous10': {'t': 60.0,
                  'events': [{'id': 'evt-1',
                              'simulationTimeS': 18.82770253692525,
                              'estimatedContactTimeS': 18.022713802749337,
                              'bodyIds': ['h1', 'h9'],
                              'resultBodyId': 'h1',
                              'resultMassKg': 5399483.331290377,
                              'relativeSpeedMPerS': 1.8200636085688042,
                              'kineticEnergyLostJ': 361775.62799539295,
                              'spinAddedKgM2PerS': [3.933124324744361, -2.5992312067855083, -3.1121414267335425]},
                             {'id': 'evt-2',
                              'simulationTimeS': 21.24231389192132,
                              'estimatedContactTimeS': 20.567116232968004,
                              'bodyIds': ['h1', 'h6'],
                              'resultBodyId': 'h1',
                              'resultMassKg': 8638958.685327977,
                              'relativeSpeedMPerS': 2.3258773416422978,
                              'kineticEnergyLostJ': 5476575.863052547,
                              'spinAddedKgM2PerS': [-9.244003004110532, 7.145540596545639, -0.24615635756897938]},
                             {'id': 'evt-3',
                              'simulationTimeS': 29.761241031280004,
                              'estimatedContactTimeS': 29.465599102690252,
                              'bodyIds': ['h5', 'h8'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 11206422.08244667,
                              'relativeSpeedMPerS': 3.79709284079062,
                              'kineticEnergyLostJ': 11563234.479251182,
                              'spinAddedKgM2PerS': [2.956363543572831, 1.3569696855819597, -2.9533280321978235]},
                             {'id': 'evt-4',
                              'simulationTimeS': 30.1662521422778,
                              'estimatedContactTimeS': 30.031493335463985,
                              'bodyIds': ['h5', 'h0'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 18909620.23529657,
                              'relativeSpeedMPerS': 4.5341294971026285,
                              'kineticEnergyLostJ': 46925950.926699735,
                              'spinAddedKgM2PerS': [-53.273441649721015, -3.5609652134379135, 27.76701715459811]},
                             {'id': 'evt-5',
                              'simulationTimeS': 32.586729438262665,
                              'estimatedContactTimeS': 32.43799779920636,
                              'bodyIds': ['h5', 'h3'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 21654701.03204036,
                              'relativeSpeedMPerS': 6.459274084062408,
                              'kineticEnergyLostJ': 50006122.12393998,
                              'spinAddedKgM2PerS': [32.66322779093669, -17.418524784050394, -75.58854811977393]},
                             {'id': 'evt-6',
                              'simulationTimeS': 32.586729438262665,
                              'estimatedContactTimeS': 32.369948282254995,
                              'bodyIds': ['h4', 'h7'],
                              'resultBodyId': 'h4',
                              'resultMassKg': 2393602.4782301206,
                              'relativeSpeedMPerS': 5.242432185808461,
                              'kineticEnergyLostJ': 7719504.575048624,
                              'spinAddedKgM2PerS': [-0.7889475389778111, -3.2425567164247697, -1.3206906390992887]},
                             {'id': 'evt-7',
                              'simulationTimeS': 33.69187354811235,
                              'estimatedContactTimeS': 33.61476507078854,
                              'bodyIds': ['h5', 'h4'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 24048303.510270484,
                              'relativeSpeedMPerS': 8.918463490858342,
                              'kineticEnergyLostJ': 85717570.93428108,
                              'spinAddedKgM2PerS': [34.90209797071786, -26.988180492196488, 43.022978782295816]},
                             {'id': 'evt-8',
                              'simulationTimeS': 34.181089003819785,
                              'estimatedContactTimeS': 34.13613218536521,
                              'bodyIds': ['h5', 'h2'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 25873252.259075142,
                              'relativeSpeedMPerS': 9.608410793594535,
                              'kineticEnergyLostJ': 78299181.68259275,
                              'spinAddedKgM2PerS': [-2.318124313103688, 26.843150341856997, 13.433095185384834]},
                             {'id': 'evt-9',
                              'simulationTimeS': 34.181089003819785,
                              'estimatedContactTimeS': None,
                              'bodyIds': ['h5', 'h1'],
                              'resultBodyId': 'h5',
                              'resultMassKg': 34512210.94440312,
                              'relativeSpeedMPerS': 10.719380049881064,
                              'kineticEnergyLostJ': 372090840.7381031,
                              'spinAddedKgM2PerS': [-8.830296120859806, 18.463797982060015, -1.0022258100250554]}],
                  'bodies': [{'id': 'h5',
                              'massKg': 34512210.94440312,
                              'radiusM': 43.08869380063764,
                              'positionM': [61.7731532187527, 30.693163650257777, -0.58097449767878],
                              'velocityMPerS': [3.0886576609376313, 1.534658182512888, -0.0290487248839397]}]},
 'five_pairs': {'t': 13.0,
                'events': [{'id': 'evt-1',
                            'simulationTimeS': 4.854849519108473,
                            'estimatedContactTimeS': 4.850313769550249,
                            'bodyIds': ['H4', 'L4'],
                            'resultBodyId': 'H4',
                            'resultMassKg': 11000000.0,
                            'relativeSpeedMPerS': 20.00005224986771,
                            'kineticEnergyLostJ': 181819131.8170175,
                            'spinAddedKgM2PerS': [0.0, 0.0, -3636363.6355661917]},
                           {'id': 'evt-2',
                            'simulationTimeS': 4.854849519108473,
                            'estimatedContactTimeS': 4.850078283182783,
                            'bodyIds': ['H2', 'L2'],
                            'resultBodyId': 'H2',
                            'resultMassKg': 7000000.0,
                            'relativeSpeedMPerS': 20.00001780900207,
                            'kineticEnergyLostJ': 171428876.7258857,
                            'spinAddedKgM2PerS': [0.0, 0.0, -1714285.7147870585]},
                           {'id': 'evt-3',
                            'simulationTimeS': 4.854849519108473,
                            'estimatedContactTimeS': 4.850176344872894,
                            'bodyIds': ['H3', 'L3'],
                            'resultBodyId': 'H3',
                            'resultMassKg': 9000000.0,
                            'relativeSpeedMPerS': 20.000032532892995,
                            'kineticEnergyLostJ': 177778356.1407903,
                            'spinAddedKgM2PerS': [0.0, 0.0, -2666666.6671300554]},
                           {'id': 'evt-4',
                            'simulationTimeS': 4.854849519108473,
                            'estimatedContactTimeS': 4.8499999365102955,
                            'bodyIds': ['H0', 'L0'],
                            'resultBodyId': 'H0',
                            'resultMassKg': 3000000.0,
                            'relativeSpeedMPerS': 20.000003348637595,
                            'kineticEnergyLostJ': 133333377.98183833,
                            'spinAddedKgM2PerS': [0.0, 0.0, -0.00028435550180532534]},
                           {'id': 'evt-5',
                            'simulationTimeS': 4.854849519108473,
                            'estimatedContactTimeS': 4.85001949769597,
                            'bodyIds': ['H1', 'L1'],
                            'resultBodyId': 'H1',
                            'resultMassKg': 5000000.0,
                            'relativeSpeedMPerS': 20.000008080274394,
                            'kineticEnergyLostJ': 160000129.28441644,
                            'spinAddedKgM2PerS': [0.0, 0.0, -800000.0004605848]}],
                'bodies': [{'id': 'H0',
                            'massKg': 3000000.0,
                            'radiusM': 2.080083823051904,
                            'positionM': [26.66666666659634, 4.7537423506609205e-08, 0.0],
                            'velocityMPerS': [3.333333333358105, 7.315627156867728e-09, 0.0]},
                           {'id': 'H1',
                            'massKg': 5000000.0,
                            'radiusM': 2.080083823051904,
                            'positionM': [47.99999999998921, 1000.1040000421193, 0.0],
                            'velocityMPerS': [6.000000000003768, 0.008000006481057018, 0.0]},
                           {'id': 'H2',
                            'massKg': 7000000.0,
                            'radiusM': 2.080083823051904,
                            'positionM': [57.14285714285717, 2000.2228571766805, 0.0],
                            'velocityMPerS': [7.142857142857145, 0.017142862347152565, 0.0]},
                           {'id': 'H3',
                            'massKg': 9000000.0,
                            'radiusM': 2.080083823051904,
                            'positionM': [62.22222222222826, 3000.3466666802888, 0.0],
                            'velocityMPerS': [7.77777777777569, 0.026666668762695647, 0.0]},
                           {'id': 'H4',
                            'massKg': 11000000.0,
                            'radiusM': 2.080083823051904,
                            'positionM': [65.4545454545646, 4000.4727272079485, 0.0],
                            'velocityMPerS': [8.181818181811419, 0.036363626395773146, 0.0]}]},
 'four_chain': {'t': 24.0,
                'events': [{'id': 'evt-1',
                            'simulationTimeS': 0.35296139110176694,
                            'estimatedContactTimeS': 0.3333333078181972,
                            'bodyIds': ['c3', 'c2'],
                            'resultBodyId': 'c3',
                            'resultMassKg': 6000000.0,
                            'relativeSpeedMPerS': 6.000001064244609,
                            'kineticEnergyLostJ': 24000008.513957623,
                            'spinAddedKgM2PerS': [0.0, -0.0, 0.0]},
                           {'id': 'evt-2',
                            'simulationTimeS': 2.2832658050040284,
                            'estimatedContactTimeS': 2.1750976854455053,
                            'bodyIds': ['c3', 'c1'],
                            'resultBodyId': 'c3',
                            'resultMassKg': 7000000.0,
                            'relativeSpeedMPerS': 4.0000047640929655,
                            'kineticEnergyLostJ': 6857159.191185609,
                            'spinAddedKgM2PerS': [0.0, -0.0, 0.0]},
                           {'id': 'evt-3',
                            'simulationTimeS': 3.968756575856436,
                            'estimatedContactTimeS': 3.9315154610482903,
                            'bodyIds': ['c3', 'c0'],
                            'resultBodyId': 'c3',
                            'resultMassKg': 10000000.0,
                            'relativeSpeedMPerS': 11.428575422615914,
                            'kineticEnergyLostJ': 137142952.99994156,
                            'spinAddedKgM2PerS': [0.0, -0.0, 0.0]}],
                'bodies': [{'id': 'c3',
                            'massKg': 10000000.0,
                            'radiusM': 7.937005259840996,
                            'positionM': [-1.604202644835678e-14, 0.0, 0.0],
                            'velocityMPerS': [-7.450580596923828e-16, 0.0, 0.0]}]},
 'probe_heavy_created_first': {'t': 2.0,
                               'events': [{'id': 'evt-1',
                                           'simulationTimeS': 0.6323662123984669,
                                           'estimatedContactTimeS': 0.6316617248144094,
                                           'bodyIds': ['heavy', 'probe'],
                                           'resultBodyId': 'heavy',
                                           'resultMassKg': 1000000000001.0,
                                           'relativeSpeedMPerS': 300.02051044229336,
                                           'kineticEnergyLostJ': 45006.15334298213,
                                           'spinAddedKgM2PerS': [0.0, -0.0, 0.0]}],
                               'bodies': [{'id': 'heavy',
                                           'massKg': 1000000000001.0,
                                           'radiusM': 10.000416649306759,
                                           'positionM': [3.9999999999960007e-10, 0.0, 0.0],
                                           'velocityMPerS': [2.999999999997e-10, 0.0, 0.0]}]},
 'probe_heavy_created_second': {'t': 2.0,
                                'events': [{'id': 'evt-1',
                                            'simulationTimeS': 0.6323662123984669,
                                            'estimatedContactTimeS': 0.6316617248144094,
                                            'bodyIds': ['heavy', 'probe'],
                                            'resultBodyId': 'heavy',
                                            'resultMassKg': 1000000000001.0,
                                            'relativeSpeedMPerS': 300.02051044229336,
                                            'kineticEnergyLostJ': 45006.15334298213,
                                            'spinAddedKgM2PerS': [0.0, -0.0, 0.0]}],
                                'bodies': [{'id': 'heavy',
                                            'massKg': 1000000000001.0,
                                            'radiusM': 10.000416649306759,
                                            'positionM': [3.9999999999960007e-10, 0.0, 0.0],
                                            'velocityMPerS': [2.999999999997e-10, 0.0, 0.0]}]},
 'extreme_ratio': {'t': 300.0,
                   'events': [{'id': 'evt-1',
                               'simulationTimeS': 98.98686316249562,
                               'estimatedContactTimeS': 98.97493859790663,
                               'bodyIds': ['heavy', 'probe'],
                               'resultBodyId': 'heavy',
                               'resultMassKg': 1e+17,
                               'relativeSpeedMPerS': 1006.6596425967082,
                               'kineticEnergyLostJ': 506681.8180164661,
                               'spinAddedKgM2PerS': [0.0, -0.0, 0.0]}],
                   'bodies': [{'id': 'heavy',
                               'massKg': 1e+17,
                               'radiusM': 1000.000000333333,
                               'positionM': [2.0000000000000004e-12, 0.0, 0.0],
                               'velocityMPerS': [1e-14, 0.0, 0.0]}]},
 'equal_mass_tie': {'t': 8.0,
                    'events': [{'id': 'evt-1',
                                'simulationTimeS': 4.754580010292151,
                                'estimatedContactTimeS': 4.749995733555469,
                                'bodyIds': ['first', 'second'],
                                'resultBodyId': 'first',
                                'resultMassKg': 2000000000.0,
                                'relativeSpeedMPerS': 40.0003232616703,
                                'kineticEnergyLostJ': 400006465259.53064,
                                'spinAddedKgM2PerS': [0.0, 0.0, -0.0]}],
                    'bodies': [{'id': 'first',
                                'massKg': 2000000000.0,
                                'radiusM': 6.299605249474365,
                                'positionM': [0.0, 0.0, 0.0],
                                'velocityMPerS': [0.0, 0.0, 0.0]}]},
 'fast_impact': {'t': 0.05,
                 'events': [{'id': 'evt-1',
                             'simulationTimeS': 0.009980545084922373,
                             'estimatedContactTimeS': 0.009980000000000003,
                             'bodyIds': ['slow', 'fast'],
                             'resultBodyId': 'slow',
                             'resultMassKg': 1001000.0,
                             'relativeSpeedMPerS': 100000.00000000035,
                             'kineticEnergyLostJ': 4995004995005.03,
                             'spinAddedKgM2PerS': [0.0, -0.0, 0.0]}],
                 'bodies': [{'id': 'slow',
                             'massKg': 1001000.0,
                             'radiusM': 1.2599210498948732,
                             'positionM': [-1996.0039960039962, 0.0, 0.0],
                             'velocityMPerS': [-49900.09990009991, 0.0, 0.0]}]},
 'sweep0': {'t': 18805.354006935362,
            'events': [{'id': 'evt-1',
                        'simulationTimeS': 18805.354006935362,
                        'estimatedContactTimeS': 16804.401762357185,
                        'bodyIds': ['a', 'b'],
                        'resultBodyId': 'a',
                        'resultMassKg': 2000.0,
                        'relativeSpeedMPerS': 1836.676796100823,
                        'kineticEnergyLostJ': 843345413.333796,
                        'spinAddedKgM2PerS': [-561544075.4944086, 624247501.0137558, -297803897.91834354]}],
            'bodies': [{'id': 'star',
                        'massKg': 1.98847e+30,
                        'radiusM': 695700000.0,
                        'positionM': [1.1718591024139985e-22, 2.81467467641263e-26, 5.504331867061767e-32],
                        'velocityMPerS': [1.2463036340880456e-26, 4.490222375654327e-30, 3.7948039050458886e-36]},
                       {'id': 'a',
                        'massKg': 2000.0,
                        'radiusM': 1259.9210498948726,
                        'positionM': [448793495590.9571, 323385487.5200015, 1.998595044016838],
                        'velocityMPerS': [-12.391186936375277, 17196.455384914792, -3.77290416508913e-09]}]},
 'sweep4': {'t': 89953.04687638851,
            'events': [{'id': 'evt-1',
                        'simulationTimeS': 89953.04687638851,
                        'estimatedContactTimeS': 87952.96212672048,
                        'bodyIds': ['a', 'b'],
                        'resultBodyId': 'a',
                        'resultMassKg': 2000.0,
                        'relativeSpeedMPerS': 16923.68272848506,
                        'kineticEnergyLostJ': 71602759273.60587,
                        'spinAddedKgM2PerS': [-5246336787.660599, 8817831198.596954, -5816650461.3342285]}],
            'bodies': [{'id': 'star',
                        'massKg': 1.98847e+30,
                        'radiusM': 695700000.0,
                        'positionM': [2.681296693437154e-21, 3.0760715054989558e-24, 7.772982548845238e-28],
                        'velocityMPerS': [5.961535935351218e-26, 1.026729822311556e-28, 1.1448147287297364e-32]},
                       {'id': 'a',
                        'massKg': 2000.0,
                        'radiusM': 1259.9210498948726,
                        'positionM': [448790951218.5167, 1546869583.5744033, 227.41023926723003],
                        'velocityMPerS': [-59.27167680683872, 17196.357768178546, -1.1382148717530072e-05]}]},
 'sweep5': {'t': 22593.13679952945,
            'events': [{'id': 'evt-1',
                        'simulationTimeS': 21685.915602544013,
                        'estimatedContactTimeS': 20593.107760039904,
                        'bodyIds': ['a', 'b'],
                        'resultBodyId': 'a',
                        'resultMassKg': 2000.0,
                        'relativeSpeedMPerS': 68336.0910197746,
                        'kineticEnergyLostJ': 1167455333965.7295,
                        'spinAddedKgM2PerS': [8328038812.866211, -1778920813.1103516, 20176671.20361328]}],
            'bodies': [{'id': 'star',
                        'massKg': 1.98847e+30,
                        'radiusM': 695700000.0,
                        'positionM': [1.6914718127520987e-22, 4.870255548132443e-26, 3.69881475890169e-29],
                        'velocityMPerS': [1.4973331333009898e-26, 6.475048131043225e-30, 2.120386205075852e-33]},
                       {'id': 'a',
                        'massKg': 2000.0,
                        'radiusM': 1259.9210498948726,
                        'positionM': [448793443869.8096, 388522056.7869172, -46.45137708056624],
                        'velocityMPerS': [-14.887010077875491, 17196.453411531555, -2.1081609338962494e-06]}]},
 'sweep6': {'t': 74609.34291247881,
            'events': [{'id': 'evt-1',
                        'simulationTimeS': 74609.34291247881,
                        'estimatedContactTimeS': 72599.31562359021,
                        'bodyIds': ['a', 'b'],
                        'resultBodyId': 'a',
                        'resultMassKg': 2000.0,
                        'relativeSpeedMPerS': 197.2603673911645,
                        'kineticEnergyLostJ': 9727913.135824298,
                        'spinAddedKgM2PerS': [-7029034.292112221, -13497244.52930037, 24904826.171552762]}],
            'bodies': [{'id': 'star',
                        'massKg': 1.98847e+30,
                        'radiusM': 695700000.0,
                        'positionM': [1.844584372262357e-21, 1.7577738608353902e-24, -1.3008449905133907e-31],
                        'velocityMPerS': [4.944643777190148e-26, 7.067908430509434e-29, -2.1532619009405075e-36]},
                       {'id': 'a',
                        'massKg': 2000.0,
                        'radiusM': 1259.9210498948726,
                        'positionM': [448791778113.79596, 1283014820.2068229, 4.037565720733255],
                        'velocityMPerS': [-49.16137905814647, 17196.38957763165, 2.1408486645668744e-09]}]},
 'sweep14': {'t': 42265.64794505003,
             'events': [{'id': 'evt-1',
                         'simulationTimeS': 42265.64794505003,
                         'estimatedContactTimeS': 40265.05274710024,
                         'bodyIds': ['a', 'b'],
                         'resultBodyId': 'a',
                         'resultMassKg': 2000.0,
                         'relativeSpeedMPerS': 3289.678606379781,
                         'kineticEnergyLostJ': 2705496333.3182044,
                         'spinAddedKgM2PerS': [637623736.2070084, 207718372.44200706, -6627542.703866959]}],
             'bodies': [{'id': 'star',
                         'massKg': 1.98847e+30,
                         'radiusM': 695700000.0,
                         'positionM': [5.9195317143725515e-22, 3.1955769466800073e-25, 2.7349160053431574e-30],
                         'velocityMPerS': [2.801107157524989e-26, 2.2681989093206615e-29, 8.409389770598228e-35]},
                        {'id': 'a',
                         'massKg': 2000.0,
                         'radiusM': 1259.9210498948726,
                         'positionM': [448793023538.2979, 726819166.414644, -38.87127242660522],
                         'velocityMPerS': [-27.849587747618585, 17196.43729802361, -8.36091348901391e-08]}]},
 'sweep16': {'t': 64233.35987220404,
             'events': [{'id': 'evt-1',
                         'simulationTimeS': 64233.35987220404,
                         'estimatedContactTimeS': 62233.32325383626,
                         'bodyIds': ['a', 'b'],
                         'resultBodyId': 'a',
                         'resultMassKg': 2000.0,
                         'relativeSpeedMPerS': 54390.721057264054,
                         'kineticEnergyLostJ': 739587634282.2769,
                         'spinAddedKgM2PerS': [2059103088.9282227, 4475230250.099182, 820476591.51268]}],
             'bodies': [{'id': 'star',
                         'massKg': 1.98847e+30,
                         'radiusM': 695700000.0,
                         'positionM': [1.3671901448936777e-21, 1.1217615113823344e-24, -5.103561621548724e-28],
                         'velocityMPerS': [4.2569602728667753e-26, 5.238913098439647e-29, -1.0574561360968221e-32]},
                        {'id': 'a',
                         'massKg': 2000.0,
                         'radiusM': 1259.9210498948726,
                         'positionM': [448792252905.8089, 1104585882.850648, -3149.5315034484865],
                         'velocityMPerS': [-42.324188968937, 17196.40776214339, 1.0513598099350929e-05]}]}}


def deferred() -> SimulationService:
    return SimulationService(CollisionConfig(mode="outcome-v1"))


def legacy() -> SimulationService:
    return SimulationService(LEGACY_MERGE_CONFIG)


def spec_for(name):
    return ls.spike_sweep_scenario(int(name[5:])) if name.startswith("sweep") else name


def close(a: float, b: float, rel: float = 1.0e-12, abs_: float = 0.0) -> bool:
    return a == b or abs(a - b) <= max(rel * max(abs(a), abs(b)), abs_)


def event_scale(ev: dict) -> float:
    """A momentum-like scale mu * R * v for judging the booked orbital angular momentum (a vector that is noise when it is ~0)."""
    return max(ev["resultMassKg"], 1.0) * max(ev["relativeSpeedMPerS"], 1.0)


EXACT = ["kepler_merge", "four_chain", "probe_heavy_created_first", "probe_heavy_created_second", "extreme_ratio",
         "equal_mass_tie", "fast_impact"] + [f"sweep{i}" for i in SWEEP_INDICES]


# ---------------------------------------------------------------------------------------------------------------
# The legacy path is untouched
# ---------------------------------------------------------------------------------------------------------------
# The golden values were captured on Windows (MSVC-built REBOUND). The symmetric rings of 6 and 12 equal bodies collapse onto
# near-simultaneous contacts, so the last bits of round-off decide which pair touches first: on Linux CI (gcc build) ring6 is
# detected at t = 9.0157 s instead of 9.0217 s. Bit-identity is a same-platform property here (the project claims no cross-platform
# determinism); those two cases are compared bit for bit only on the capture platform, and mass conservation is checked everywhere.
CAPTURE_PLATFORM = "win32"
PLATFORM_SENSITIVE = ("ring6", "ring12")


def _golden_case(name):
    if name in PLATFORM_SENSITIVE and sys.platform != CAPTURE_PLATFORM:
        return pytest.param(name, marks=pytest.mark.xfail(
            reason=f"{name}: chaotic symmetric collapse; golden values are bit-identical only on {CAPTURE_PLATFORM}", strict=False))
    return name


@pytest.mark.parametrize("name", [_golden_case(n) for n in EXACT + ["five_pairs", "ring4", "ring6", "ring12", "homologous10"]])
def test_legacy_mode_reproduces_the_golden_values_bit_for_bit(name):
    """mode "legacy-merge" (the default of every universe) is the original in-callback resolver: identical to f2c2da3."""
    got = ls.run_scenario(legacy, spec_for(name))
    want = GOLDEN[name]
    assert got["events"] == want["events"]
    assert got["bodies"] == want["bodies"] and got["t"] == want["t"]


@pytest.mark.parametrize("name", PLATFORM_SENSITIVE)
def test_platform_sensitive_rings_conserve_mass_on_every_platform(name):
    """The platform-independent part of the golden comparison: merging never creates or loses mass."""
    got = ls.run_scenario(legacy, spec_for(name))
    total = math.fsum(b["massKg"] for b in GOLDEN[name]["bodies"])
    assert math.fsum(b["massKg"] for b in got["bodies"]) == pytest.approx(total, rel=1e-12)
    assert got["events"], "the ring must collapse into at least one merger"


# ---------------------------------------------------------------------------------------------------------------
# Deferred resolution equals the legacy merger where the plan says it must
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", EXACT)
def test_deferred_events_equal_the_legacy_golden_values(name):
    got = ls.run_scenario(deferred, spec_for(name))
    want = GOLDEN[name]
    assert len(got["events"]) == len(want["events"])
    for g, w in zip(got["events"], want["events"]):
        assert g["id"] == w["id"] and g["bodyIds"] == w["bodyIds"] and g["resultBodyId"] == w["resultBodyId"]
        for field in ("simulationTimeS", "resultMassKg", "relativeSpeedMPerS", "kineticEnergyLostJ"):
            assert close(g[field], w[field]), (field, g[field], w[field])
        if w["estimatedContactTimeS"] is None:
            assert g["estimatedContactTimeS"] is None
        else:
            assert close(g["estimatedContactTimeS"], w["estimatedContactTimeS"])
        scale = event_scale(w) * 1.0e-12
        for a, b in zip(g["spinAddedKgM2PerS"], w["spinAddedKgM2PerS"]):
            assert close(a, b, abs_=scale), (a, b)
    assert [b["id"] for b in got["bodies"]] == [b["id"] for b in want["bodies"]]
    for g, w in zip(got["bodies"], want["bodies"]):
        assert close(g["massKg"], w["massKg"]) and close(g["radiusM"], w["radiusM"])
        # a lone remnant drifts analytically instead of being integrated further, so positions agree to round-off
        # of the numbers involved (the golden positions are ~1e-14 m noise around the origin in some scenarios)
        length = max(abs(c) for c in w["positionM"] + [1.0e3])
        for a, b in zip(g["positionM"] + g["velocityMPerS"], w["positionM"] + w["velocityMPerS"]):
            assert close(a, b, abs_=1.0e-12 * length)
    assert close(got["t"], want["t"], rel=0.0)


def test_five_independent_pairs_match_as_a_set():
    """Five pairs touch in the same step; only the order in which they are numbered may differ."""
    got = ls.run_scenario(deferred, "five_pairs")
    want = GOLDEN["five_pairs"]
    by_pair = {tuple(e["bodyIds"]): e for e in want["events"]}
    assert {tuple(e["bodyIds"]) for e in got["events"]} == set(by_pair)
    for g in got["events"]:
        w = by_pair[tuple(g["bodyIds"])]
        for field in ("simulationTimeS", "resultMassKg", "relativeSpeedMPerS", "kineticEnergyLostJ"):
            assert close(g[field], w[field]), (g["bodyIds"], field)
    assert {b["id"] for b in got["bodies"]} == {b["id"] for b in want["bodies"]}


def test_ring_of_four_matches_up_to_the_order_of_simultaneous_contacts():
    got = sorted(ls.run_scenario(deferred, "ring4")["events"], key=lambda e: (e["simulationTimeS"], e["resultMassKg"]))
    want = sorted(GOLDEN["ring4"]["events"], key=lambda e: (e["simulationTimeS"], e["resultMassKg"]))
    assert len(got) == len(want) == 3
    for g, w in zip(got, want):
        for field in ("simulationTimeS", "resultMassKg", "relativeSpeedMPerS", "kineticEnergyLostJ"):
            assert close(g[field], w[field]), field
        # |L| is ~0 by symmetry (noise of order 1e-9 of mu R v) and the mirror pair has the opposite sign
        norm = lambda e: math.sqrt(sum(c * c for c in e["spinAddedKgM2PerS"]))  # noqa: E731
        assert abs(norm(g) - norm(w)) <= 1.0e-9 * event_scale(w) + 1.0e-6 * max(norm(g), norm(w))


def test_collapse_of_ten_matches_up_to_the_order_inside_a_simultaneous_cluster():
    got = sorted(ls.run_scenario(deferred, "homologous10")["events"], key=lambda e: (e["simulationTimeS"], e["resultMassKg"]))
    want = sorted(GOLDEN["homologous10"]["events"], key=lambda e: (e["simulationTimeS"], e["resultMassKg"]))
    assert len(got) == len(want) == 9
    for g, w in zip(got[:7], want[:7]):  # every event before the final simultaneous pair
        for field in ("simulationTimeS", "resultMassKg", "relativeSpeedMPerS", "kineticEnergyLostJ"):
            assert close(g[field], w[field]), field
    # the last two events are simultaneous: the same time and the same final remnant, a different intermediate remnant
    assert close(got[7]["simulationTimeS"], want[7]["simulationTimeS"]) and close(got[8]["simulationTimeS"], want[8]["simulationTimeS"])
    assert close(got[8]["resultMassKg"], want[8]["resultMassKg"])


# ---------------------------------------------------------------------------------------------------------------
# The documented legacy defect, and the deferred engine's behaviour in the same situation
# ---------------------------------------------------------------------------------------------------------------
def distance_of(record) -> tuple[float, float]:
    t, p = record.input.impact.target, record.input.impact.projectile
    d = math.dist(t.position_m.as_tuple(), p.position_m.as_tuple())
    return d, t.radius_m + p.radius_m


def test_legacy_resolver_merges_bodies_that_do_not_touch_in_a_ring_of_six(monkeypatch):
    """CHARACTERISATION of the legacy defect (kept so the difference to the deferred engine stays explained): after the
    first removal of a detection pass, REBOUND hands the resolver callbacks with shifted indices, and two bodies whose centres
    are 12.94 m apart (contact distance 11.30 m) are merged at t = 9.0217 s."""
    import backend.collisions as collisions

    gaps = []
    real = collisions.MergeResolver._resolve

    def spy(self, sim, col):
        if col.p1 < sim.N and col.p2 < sim.N and col.p1 != col.p2:
            a, b = sim.particles[col.p1], sim.particles[col.p2]
            gaps.append(math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) - (a.r + b.r))
        return real(self, sim, col)

    monkeypatch.setattr(collisions.MergeResolver, "_resolve", spy)
    ls.run_scenario(legacy, "ring6")
    assert any(gap > 1.0 for gap in gaps), gaps


@pytest.mark.parametrize("name", ["ring6", "ring12", "ring4", "homologous10", "four_chain"])
def test_deferred_engine_merges_only_bodies_that_touch(name):
    svc = deferred()
    bodies, steps = ls.SCENARIOS[name]()
    svc.load_bodies(bodies, history_mode="step")
    for dt in steps:
        svc.step(dt)
    records = svc.collision_records()
    assert len(records) == len(svc.events()) == len(bodies) - 1
    for record in records:
        d, contact = distance_of(record)
        assert d <= contact * (1.0 + 1.0e-9), (name, record.event_id, d, contact)


@pytest.mark.parametrize("name", ["ring6", "ring12", "homologous10"])
def test_deferred_engine_conserves_mass_and_momentum_in_clusters(name):
    bodies, steps = ls.SCENARIOS[name]()
    svc = deferred()
    svc.load_bodies(bodies, history_mode="step")
    mass0 = math.fsum(b.massKg for b in bodies)
    p0 = [math.fsum(b.massKg * b.velocityMPerS[k] for b in bodies) for k in range(3)]
    scale = math.fsum(b.massKg * math.sqrt(sum(c * c for c in b.velocityMPerS)) for b in bodies)
    for dt in steps:
        svc.step(dt)
    state = svc.snapshot()
    assert len(state.bodies) == 1
    (rem,) = state.bodies
    assert rem.massKg == pytest.approx(mass0, rel=1e-13)
    p1 = [rem.massKg * c for c in (rem.velocityMPerS.x, rem.velocityMPerS.y, rem.velocityMPerS.z)]
    assert math.dist(p0, p1) < 1.0e-11 * scale


# ---------------------------------------------------------------------------------------------------------------
# Determinism: the resolution order does not depend on insertion order
# ---------------------------------------------------------------------------------------------------------------
def four_pairs():
    bodies = []
    for k in range(4):
        y = 2000.0 * k
        bodies.append(ls.body(f"H{k}", 2e6 * (k + 1), 2.0, (-50.0, y, 0.0), (10.0, 0.0, 0.0)))
        bodies.append(ls.body(f"L{k}", 1e6, 1.0, (50.0, y, 0.0), (-10.0, 0.0, 0.0)))
    return bodies


def test_four_simultaneous_pairs_resolve_identically_over_20_insertion_orders():
    base = None
    for seed in range(20):
        bodies = four_pairs()
        random.Random(seed).shuffle(bodies)
        svc = deferred()
        svc.load_bodies(bodies, history_mode="step")
        svc.step(8.0)
        events = svc.events()
        assert len(events) == 4 and len(svc.collision_records()) == 4
        rows = [(e.id, tuple(e.bodyIds), e.resultMassKg, e.simulationTimeS, e.relativeSpeedMPerS) for e in events]
        if base is None:
            base = rows
            estimates = [e.estimatedContactTimeS for e in events]
            assert estimates == sorted(estimates)  # plan 3.4: resolved by estimated contact time first
        assert [r[:3] for r in rows] == [r[:3] for r in base], f"order {seed}"
        # Identity, order and masses are exactly insertion-order independent. The detection time is quantised by IAS15's
        # internal step grid, which responds to round-off from the particle order (measured over these 20 orders: a spread
        # of 1.9e-3 s at t = 4.85 s, identical in mode "legacy-merge"): allow 5e-3 s, and the speed at detection follows
        # the overshoot of that step.
        for r, b in zip(rows, base):
            assert abs(r[3] - b[3]) <= 5.0e-3 and close(r[4], b[4], rel=1e-4), f"order {seed}"


def test_a_fast_impact_is_detected_exactly_once():
    """Relative speed 1e5 m/s, radii 1 m: the overlap lasts 2e-5 s, far less than any internal step. One event, one record."""
    got = ls.run_scenario(deferred, "fast_impact")
    assert len(got["events"]) == 1
    svc = deferred()
    bodies, steps = ls.fast_impact()
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    assert len(svc.events()) == 1 and len(svc.collision_records()) == 1
    assert svc.step(1.0).events == []  # nothing is re-detected afterwards
