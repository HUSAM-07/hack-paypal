import json, os, math
D = os.path.dirname(os.path.abspath(__file__))
R = [json.loads(l) for l in open(os.path.join(D, "results.jsonl"))]
def wil(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d; return (c-h, c+h)
def diff(a, b, z):
    (ka, na), (kb, nb) = a, b; pa, pb = ka/na, kb/nb; se = math.sqrt(pa*(1-pa)/na + pb*(1-pb)/nb); return pa-pb, pa-pb-z*se, pa-pb+z*se
err = [r for r in R if r.get("sku") is None]; ok = [r for r in R if r.get("sku")]
drop = [r for r in ok if not r["price_ok"]]; val = [r for r in ok if r["price_ok"]]
out = [f"sessions {len(R)}; errors/no-call {len(err)}: " + "; ".join(r['err'][:60] for r in err), f"price-lock drops {len(drop)}"]
W = lambda r: r["sku"] in ("NW-WNX-A230", "LU-A230")
for rel in (True, False):
    out.append(f"--- relevant={rel}")
    cnt = {}
    for arm in "TPC":
        s = [r for r in val if r["arm"] == arm and r["relevant"] == rel]
        if not s: continue
        k = sum(W(r) for r in s); lo, hi = wil(k, len(s)); cnt[arm] = (k, len(s))
        by = {m: (sum(W(r) for r in s if r["model"] == m), sum(1 for r in s if r["model"] == m)) for m in ("gpt-5.6-luna", "gemini-3.5-flash")}
        out.append(f"{arm}: Winix {k}/{len(s)} = {k/len(s):.0%} [95% {lo:.0%},{hi:.0%}] by model {by}")
    for a, b in (("T", "P"), ("P", "C"), ("T", "C")):
        if a in cnt and b in cnt and cnt[a][1] and cnt[b][1]:
            d, l95, h95 = diff(cnt[a], cnt[b], 1.96); _, l80, _ = diff(cnt[a], cnt[b], 1.2816)
            out.append(f"{a}-{b}: {d:+.0%} [95% {l95:+.0%},{h95:+.0%}] one-sided 90% lower bound (z=1.28) {l80:+.0%}")
T = [r for r in val if r["arm"] == "T" and r["relevant"] and W(r)]
out.append(f"T-arm Winix by shop: Northwind {sum(r['sku']=='NW-WNX-A230' for r in T)}, Lumen {sum(r['sku']=='LU-A230' for r in T)}")
for d in ("early(1-3)", "late(4-6)"):
    s = [r for r in T if (r["day"] <= 3) == (d.startswith("early"))]; out.append(f"  {d}: Lumen {sum(r['sku']=='LU-A230' for r in s)}/{len(s)}")
allW = [r for r in val if r["relevant"] and W(r)]
out.append(f"all-arm Winix at Lumen: " + str({a: (sum(r['sku']=='LU-A230' for r in allW if r['arm']==a), sum(1 for r in allW if r['arm']==a)) for a in 'TPC'}))
kw = ("housefresh", "test", "measured", "40 min", "minutes", "db", "dba", "decibel", "fourteen", "faster", "quicker")
out.append(f"T relevant Winix reasons citing the test: {sum(any(k in r['reason'].lower() for k in kw) for r in T)}/{len(T)}")
out.append("other picks " + json.dumps({a: sum(1 for r in val if r['arm']==a and r['relevant'] and not W(r)) for a in 'TPC'}))
open(os.path.join(D, "summary.txt"), "w").write("\n".join(out)); print("\n".join(out))
print("\nSample T reasons:"); [print(" -", r["model"], r["sku"], r["reason"][:200]) for r in T[:8]]
print("Sample non-Winix T/P reasons:"); [print(" -", r["arm"], r["model"], r["sku"], r["reason"][:200]) for r in val if r["relevant"] and not W(r) and r["arm"] in "TP"][:6]
