import math, sys

# ---- fin outline control pts (X back, Z up): flared foot -> leading edge ->
#      swept tip -> concave trailing -> flared foot. Splined smooth. ----
CP = [
 (-2.6,0.0),(-1.0,1.4),(0.2,4.2),(1.1,8.0),(2.2,11.5),(3.6,14.6),
 (5.3,17.4),(7.2,19.6),(8.7,20.7),                     # tip
 (10.7,15.8),(12.6,10.8),(14.4,6.8),(16.1,3.6),
 (17.4,1.6),(19.0,0.5),(20.9,0.0)
]
def catmull(P,seg=16):
    Q=[P[0]]+P+[P[-1]]; out=[]
    for i in range(len(P)-1):
        p0,p1,p2,p3=Q[i],Q[i+1],Q[i+2],Q[i+3]
        for s in range(seg):
            t=s/seg; t2=t*t; t3=t2*t
            x=0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            z=0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            out.append((x,z))
    out.append(P[-1]); return out
prof=catmull(CP)
T=1.6

verts=[]; faces=[]
def V(x,y,z): verts.append((x,y,z)); return len(verts)-1
front=[V(x,-T/2,z) for (x,z) in prof]
back =[V(x, T/2,z) for (x,z) in prof]
faces.append((front[::-1],1.0)); faces.append((back,1.0))
n=len(prof)
for i in range(n-1):
    faces.append(([front[i],front[i+1],back[i+1],back[i]],1.0))
faces.append(([front[-1],front[0],back[0],back[-1]],1.0))  # flat bottom

# thin tapered flange the foot sweeps down onto
def frustum(cx,bx,by,tx,ty,z0,z1,s):
    b=[V(cx-bx,-by,z0),V(cx+bx,-by,z0),V(cx+bx,by,z0),V(cx-bx,by,z0)]
    t=[V(cx-tx,-ty,z1),V(cx+tx,-ty,z1),V(cx+tx,ty,z1),V(cx-tx,ty,z1)]
    faces.append((b[::-1],s)); faces.append((t,s))
    for i in range(4):
        j=(i+1)%4; faces.append(([b[i],b[j],t[j],t[i]],s))
frustum(9.15, 12.6,6.2, 10.8,4.2, -1.2,0.0, 0.9)

tz=math.radians(float(sys.argv[3]) if len(sys.argv)>3 else 166)
tx=math.radians(float(sys.argv[4]) if len(sys.argv)>4 else 18)
def rot(p):
    x,y,z=p
    x,y=x*math.cos(tz)-y*math.sin(tz), x*math.sin(tz)+y*math.cos(tz)
    y,z=y*math.cos(tx)-z*math.sin(tx), y*math.sin(tx)+z*math.cos(tx)
    return (x,y,z)
rv=[rot(p) for p in verts]
def newell(idx):
    nx=ny=nz=0
    for k in range(len(idx)):
        x0,y0,z0=rv[idx[k]]; x1,y1,z1=rv[idx[(k+1)%len(idx)]]
        nx+=(y0-y1)*(z0+z1); ny+=(z0-z1)*(x0+x1); nz+=(x0-x1)*(y0+y1)
    m=math.hypot(nx,ny,nz) or 1; return (nx/m,ny/m,nz/m)
L=(-0.32,-0.62,0.72); Lm=math.hypot(*L); L=tuple(c/Lm for c in L)
def shade(nrm,s):
    d=max(0.0,nrm[0]*L[0]+nrm[1]*L[1]+nrm[2]*L[2]); i=(0.46+0.54*d)*s
    dk=(26,60,104); lt=(150,201,255)
    return '#%02x%02x%02x'%tuple(round(dk[k]+(lt[k]-dk[k])*i) for k in range(3))
draw=[]
for idx,s in faces:
    nrm=newell(idx)
    if nrm[1] > -0.02: continue
    draw.append((sum(rv[i][1] for i in idx)/len(idx),idx,shade(nrm,s)))
draw.sort(key=lambda t:-t[0])
xs=[rv[i][0] for _,idx,_ in draw for i in idx]; zs=[rv[i][2] for _,idx,_ in draw for i in idx]
mnx,mxx,mnz,mxz=min(xs),max(xs),min(zs),max(zs)
Sc=54/max(mxx-mnx,mxz-mnz); cx=(mnx+mxx)/2; cz=(mnz+mxz)/2
def proj(i): x,_,z=rv[i]; return 32+(x-cx)*Sc, 32-(z-cz)*Sc
w=sys.argv[1] if len(sys.argv)>1 else '64'
out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{w}" height="{w}">']
if len(sys.argv)>2 and sys.argv[2]=='bg': out.append('<rect width="64" height="64" fill="#14161a"/>')
for _,idx,col in draw:
    pts=' '.join('%.2f,%.2f'%proj(i) for i in idx)
    out.append(f'<polygon points="{pts}" fill="{col}" stroke="{col}" stroke-width="0.6" stroke-linejoin="round"/>')
out.append('</svg>'); print('\n'.join(out))
