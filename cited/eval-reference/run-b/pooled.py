import json, math
A=[json.loads(l) for l in open('../run-a/results.jsonl')]
B=[json.loads(l) for l in open('results.jsonl')]
W=lambda r: r.get("sku") in ("NW-WNX-A230","LU-A230")
R=[r for r in A+B if r.get("relevant") and r.get("sku") and r["price_ok"]]
def kn(arm,m=None): s=[r for r in R if r["arm"]==arm and (m is None or r["model"]==m)]; return sum(W(r) for r in s), len(s)
def d(a,b):
    (ka,na),(kb,nb)=a,b; pa,pb=ka/na,kb/nb; se=math.sqrt(pa*(1-pa)/na+pb*(1-pb)/nb); return pa-pb,se
t,p,c=kn("T"),kn("P"),kn("C"); x,se=d(t,p)
print("pooled T",t,"P",p,"C",c, f"T-P {x:+.3f} 95% [{x-1.96*se:+.3f},{x+1.96*se:+.3f}] 80%LB {x-0.8416*se:+.3f}")
x2,se2=d(p,c); print(f"P-C {x2:+.3f} 95% [{x2-1.96*se2:+.3f},{x2+1.96*se2:+.3f}]")
# model-stratified, weights = share of T+P sessions
ms=["gpt-5.6-luna","gemini-3.5-flash","claude-sonnet-5-5"]; tot=sum(kn("T",m)[1]+kn("P",m)[1] for m in ms); est=0; var=0
for m in ms:
    tm,pm=kn("T",m),kn("P",m); w=(tm[1]+pm[1])/tot
    pa,pb=tm[0]/tm[1],pm[0]/pm[1]
    v=max(pa*(1-pa),0.5/tm[1])/tm[1]+max(pb*(1-pb),0.5/pm[1])/pm[1]  # floor variance for 0/1 cells
    est+=w*(pa-pb); var+=w*w*v; print(m,"T",tm,"P",pm,f"lift {pa-pb:+.2f}")
se=math.sqrt(var); print(f"stratified {est:+.3f} 95% [{est-1.96*se:+.3f},{est+1.96*se:+.3f}] 80%LB {est-0.8416*se:+.3f}")
lb=est-0.8416*se; units=round(200*lb); print("units/200 exposed sessions",units,"fee 8% of $95.99 ->",round(units*95.99*0.08,2))
Tw=[r for r in R if r["arm"]=="T" and W(r)]; print("T Winix at Lumen", sum(r["sku"]=="LU-A230" for r in Tw), len(Tw), "late-days Lumen", sum(r["sku"]=="LU-A230" for r in Tw if r["day"]>=4), sum(1 for r in Tw if r["day"]>=4))
