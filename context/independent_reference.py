from math import sqrt, pi

G = 6.67430e-11

def dot(a, b): return sum(x*y for x, y in zip(a, b))
def add(a, b): return tuple(x+y for x, y in zip(a, b))
def scale(c, a): return tuple(c*x for x in a)
def norm(a): return sqrt(dot(a, a))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def swept(r0, u, dt, radius_sum):
    u2 = dot(u, u)
    tau = 0.0 if u2 == 0 else max(0.0, min(dt, -dot(r0, u)/u2))
    rmin = add(r0, scale(tau, u))
    return tau, norm(rmin), norm(rmin) <= radius_sum

# Gravity example: m1=2e10 kg at origin, m2=3e10 kg at (3000,4000,0) m.
m1, m2, r = 2e10, 3e10, (3000., 4000., 0.)
d = norm(r)
a1 = scale(G*m2/d**3, r)
a2 = scale(-G*m1/d**3, r)
print('gravity distance_m', d)
print('gravity a1_m_s2', a1, 'magnitude', norm(a1))
print('gravity a2_m_s2', a2, 'magnitude', norm(a2))

# Head-on merger: m=(2,1) kg, v=(+3,-3) m/s, contact d=2 m.
m1, m2, v1, v2, d = 2., 1., (3.,0.,0.), (-3.,0.,0.), 2.
M = m1+m2
V = scale(1/M, add(scale(m1,v1), scale(m2,v2)))
mu = m1*m2/M
Ki = .5*m1*dot(v1,v1)+.5*m2*dot(v2,v2)
Kf = .5*M*dot(V,V)
Erel = .5*mu*dot(tuple(x-y for x,y in zip(v1,v2)), tuple(x-y for x,y in zip(v1,v2)))
print('head_on P', add(scale(m1,v1),scale(m2,v2)), 'Vmerge',V,'Ki',Ki,'Kf',Kf,'loss',Ki-Kf,'Erel',Erel,'Ugrav',-G*m1*m2/d)

# Grazing merger: equal 1 kg spheres, R=1 m, relative contact vector (-1.6,1.2,0), relative velocity (10,0,0).
rrel, vrel = (-1.6,1.2,0.), (10.,0.,0.)
mu=0.5
L = scale(mu, cross(rrel,vrel))
Krel=.5*mu*dot(vrel,vrel)
Rmerge=2**(1/3)
I=.4*2.*Rmerge**2
Erot=dot(L,L)/(2*I)
print('grazing d',norm(rrel),'L_orb',L,'Krel',Krel,'Rmerge',Rmerge,'I_uniform_sphere',I,'omega',scale(1/I,L),'spin_energy',Erot,'remaining_heat_if_spin',Krel-Erot)

for name, r0, u, dt, rs in [
    ('slow_head_on',(-5.,0.,0.),(1.,0.,0.),4.,2.),
    ('fast_head_on',(-100.,0.,0.),(1000.,0.,0.),.2,2.),
    ('grazing',(-5.,1.9,0.),(10.,0.,0.),1.,2.),
    ('near_miss',(-5.,2.1,0.),(10.,0.,0.),1.,2.),
    ('two_hits_target1',(-5.,0.,0.),(20.,0.,0.),1.,1.),
]: print('sweep',name,swept(r0,u,dt,rs))
