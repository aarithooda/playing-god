"""Reference values for the Stage 3 model tests, each with its provenance. They are TYPED HERE, not produced by the code under test.

AUTHORSHIP / INDEPENDENCE (TEAM_WORKFLOW "Physics changes need an independent check"): the values marked `arithmetic` were computed by
the implementer with plain arithmetic from the formula as written in the paper text (so they check the code against the formula, not the
formula against the paper). An independent AI session or a human has NOT yet re-derived them. Values marked `paper` are numbers printed in
the paper as relayed by a fetch sub-agent (model-assisted, not yet checked against the printed PDF). Nothing here is a signed-off result
(CP-SCI-1 is open, D-038).
"""

# --- LS12 (Leinhardt & Stewart 2012, ApJ 745, 79) -----------------------------------------------------------------------------
# paper (relayed): small bodies c* = 5 +/- 2, mubar = 0.37 +/- 0.01; hydrodynamic planets c* = 1.9 +/- 0.3, mubar = 0.36 +/- 0.01
C_STAR_SMALL, MU_BAR_SMALL = 5.0, 0.37
C_STAR_PLANET, MU_BAR_PLANET = 1.9, 0.36

# arithmetic from eq. 28: c* (4/5) pi rho_1 G R_C1^2 with c* = 5, rho_1 = 1000, G = 6.6743e-11, R_C1 = 2000 m
Q_RD_GAMMA1_R2000_C5 = 3.3548690956566967  # J/kg  (UD-1: the paper prints 5.3 J/kg for its worked example; NOT reproduced)
# paper (relayed): "Q*_RD,gamma=1 = 5.3 J/kg and V*_gamma=1 = 6.5 m/s" for a worked example whose inputs we do not have
UD1_PAPER_Q_RD = 5.3
UD1_PAPER_V_STAR = 6.5
# arithmetic: the R_C1 that reproduces 5.3 J/kg with the same formula and c* = 5
UD1_IMPLIED_R_C1_M = 2514.0  # m (to 4 digits)

# arithmetic from eq. 6 for gamma = 0.1 and equal densities: R_p/R_t = 0.1^(1/3) = 0.4641589, b_crit = 1/1.4641589
B_CRIT_GAMMA_0P1_EQUAL_DENSITY = 1.0 / (1.0 + 0.1 ** (1.0 / 3.0))  # = 0.68299 (typed as arithmetic, not copied from the code)
UD2_PAPER_B_CRIT = 0.66  # paper (relayed): "b_crit = 0.66 for gamma = 0.1"; NOT reproduced with equal densities

# arithmetic from eq. 23: ((gamma+1)^2/(4 gamma))^(2/(3 mubar) - 1) for mubar = 0.37
MASS_RATIO_FACTOR_MU_BAR_0P37 = {
    1.0: 1.0,
    0.5: 1.0 * (2.25 / 2.0) ** (2.0 / 1.11 - 1.0),  # = 1.125 ** 0.8018018...
    0.1: (1.21 / 0.4) ** (2.0 / 1.11 - 1.0),
    0.01: (1.0201 / 0.04) ** (2.0 / 1.11 - 1.0),
}

# --- Genda, Kokubo & Ida 2012 (ApJ 744, 137), eq. 16 (relayed verbatim by a fetch sub-agent) ------------------------------------
G12_COEFFICIENTS = dict(c1=2.43, c2=-0.0408, c3=1.86, c4=1.08, c5=2.5)
# paper (relayed): v_cr/v_esc = 1.39 +/- 0.01 at theta = 30 deg, equal masses, M_T = 0.2 M_earth; ~1.09-1.11 at theta = 60 deg
G12_PAPER_POINTS = [(0.0, 30.0, 1.39, 0.03), (0.0, 60.0, 1.10, 0.03)]  # (Gamma, theta_deg, value, tolerance)
