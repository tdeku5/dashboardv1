import math
def hex2rgb(h): h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def unlin(c):
    c=max(0,min(1,c)); return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def L(h):
    r,g,b=[lin(x) for x in hex2rgb(h)]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    x,y=sorted([L(a),L(b)],reverse=True); return (x+0.05)/(y+0.05)
def lab(rgb):
    r,g,b=[lin(x) for x in rgb]
    X=(0.4124*r+0.3576*g+0.1805*b)/0.95047; Y=0.2126*r+0.7152*g+0.0722*b; Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
    f=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    return 116*f(Y)-16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z))
def de2000(l1,l2):
    L1,a1,b1=l1;L2,a2,b2=l2
    C1=math.hypot(a1,b1);C2=math.hypot(a2,b2);Cb=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p,a2p=(1+G)*a1,(1+G)*a2
    C1p,C2p=math.hypot(a1p,b1),math.hypot(a2p,b2)
    h1=math.degrees(math.atan2(b1,a1p))%360; h2=math.degrees(math.atan2(b2,a2p))%360
    dL=L2-L1; dC=C2p-C1p
    dh=h2-h1
    if C1p*C2p==0: dh=0
    elif dh>180: dh-=360
    elif dh<-180: dh+=360
    dH=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dh/2))
    Lb=(L1+L2)/2; Cbp=(C1p+C2p)/2
    hb=h1+h2
    if C1p*C2p!=0:
        hb=(h1+h2)/2 if abs(h1-h2)<=180 else ((h1+h2+360)/2 if h1+h2<360 else (h1+h2-360)/2)
    T=1-0.17*math.cos(math.radians(hb-30))+0.24*math.cos(math.radians(2*hb))+0.32*math.cos(math.radians(3*hb+6))-0.20*math.cos(math.radians(4*hb-63))
    dth=30*math.exp(-((hb-275)/25)**2); RC=2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    SL=1+0.015*(Lb-50)**2/math.sqrt(20+(Lb-50)**2); SC=1+0.045*Cbp; SH=1+0.015*Cbp*T
    RT=-math.sin(math.radians(2*dth))*RC
    return math.sqrt((dL/SL)**2+(dC/SC)**2+(dH/SH)**2+RT*(dC/SC)*(dH/SH))
DEUT=[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]]  # Machado sev 1.0
PROT=[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]]
def sim(h,M):
    r=[lin(x) for x in hex2rgb(h)]
    o=[sum(M[i][j]*r[j] for j in range(3)) for i in range(3)]
    return [unlin(x) for x in o]
def d(a,b,M=None):
    A=sim(a,M) if M else hex2rgb(a); B=sim(b,M) if M else hex2rgb(b)
    return de2000(lab(A),lab(B))
