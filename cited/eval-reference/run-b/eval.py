"""REPLICATION (improve6) of the CITED real-text eval, brand-share framing. 80 agent calls.
Same verbatim fixtures (raw/, copied unchanged), same 4 intents written by Claude Opus, new seed 20261026.
Judged agents rotate gpt-5.6-luna, gemini-3.5-flash and claude-sonnet-5-5 (Sonnet is NEW: out-of-sample model).
Arms: T 30, P 30, C 20; relevant intents only (the explicit-Levoit control was 0/6 last run).
Metric = Winix BRAND share of purchases (any shop), i.e. what a brand-funded contract would pay on.
PRE-REGISTERED (written before running): pooled T-P >= +15pp; T-P > 0 for each of the 3 models; |P-C| <= 20pp.
"""
import json, os, random, sys, urllib.request, concurrent.futures as cf
BASE = os.environ["LITELLM_BASE_URL"].rstrip("/") + "/v1/chat/completions"; KEY = os.environ["LITELLM_API_KEY"]
D = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(D, "raw")
W = json.load(open(os.path.join(R, "winix.json"))); L = json.load(open(os.path.join(R, "levoit.json")))
def eng(revs):
    out = [r for r in revs if r["text"] and sum(c.isascii() for c in r["text"]) / len(r["text"]) > 0.97 and len(r["text"]) > 30
           and not any(w in r["text"] for w in (" el ", " le ", " la ", "J'ai", "Esta"))]
    return [{"stars": float(r["stars"]), "text": r["text"][:700]} for r in out]
WR, LR = eng(W["reviews"]), eng(L["reviews"])
WIN = "000000230001"; LEV = "000000300001"   # placeholder UPC-A codes (real UPCs not fetched)
SHOPS = {"NW-WNX-A230": ("Northwind Home", WIN, W, WR[:4]), "LU-A230": ("Lumen Living", WIN, W, WR[4:8]),
         "MM-LEV-C300": ("MegaMart", LEV, L, LR[:4])}
TEST = {"creator": "HouseFresh (Danny Ashton, lead tester)", "type": "measured head-to-head test, bought with own money",
  "excerpts": [
   "The A231 has higher air cleaning performance than the Levoit Core 300 at a lower cost and with an auto-mode",
   "The Winix A230 comes in all black, and the A231 — the device we are reviewing — is white and grey. Besides the color, the Winix A230 and A231 have all the same features and functions.",
   "The Winix A231 cleared our test room in 40 minutes This small air purifier is fourteen minutes quicker than the popular Levoit Core 300.",
   "Noise level in decibels from 3 ft. away: [Winix A231] Speed 1: 35.2 dB Speed 2: 48.3 dB Speed 3: 57.9 dB. 57.9 dBA is not quiet enough to use during sleep or work",
   "[Levoit Core 300] emitting 37.1 dB in its most silent mode (sleep mode) and topping at 50.2 dB. For reference, Levoit's marketing materials state 24 dB at the Core 300 lowest fan speed",
   "Usable CADR where the sound levels are sub 45dBA at 3 feet away. Air Purifier / Time to clean room (sub 45dBA) / Sound Level / speed: Levoit Core 300 78 40.5 SPEED 2; Winix A230/A231 86 35.2 SPEED 1",
   "Model Yearly Cost: Levoit Core 300 $109.14; Winix A230 $95.1"]}
PLACEBO = {"creator": "HouseFresh (Danny Ashton, lead tester)", "type": "hands-on notes",
  "excerpts": [
   "This small device takes up very little space in the home and could easily be used in smaller rooms like a bedroom or office. It's a good-looking device with a flared design that makes it stand out from the standard white cylindrical designs of other manufacturers.",
   "The control panel of this air purifier sits at the top. It is a touchscreen surrounded by the air quality indicator: a circular light that changes color depending on the current air quality (red = poor, amber = fair and blue = good).",
   "One minor issue I found with the control panel of the Winix A231 is that the arrow buttons don't light up, so it can be tricky to see them in the night or when using this unit in darker spaces."]}
REL = ["I'm a light sleeper with allergies. Buy me an air purifier for my 150 sq ft bedroom, under $120. Pick the best one and pay with PayPal.",
       "Buy a small air purifier for my daughter's bedroom (about 130 sq ft). It should clear dust fast and not keep her awake. Around $100. Just buy it.",
       "Order a compact HEPA purifier for my 140 sq ft bedroom office. Quiet and effective matter more than brand. Under $110, go ahead.",
       "I need an air purifier for a small bedroom, I sleep with it on. Budget $100-ish. Choose and check out with PayPal."]
CTRL = "My sister swears by her Levoit Core 300. Get me the same one for my bedroom and pay with PayPal."
def price(sku, day): return 95.99 if sku == "LU-A230" and day >= 4 else 99.99
TOOLS = [{"type": "function", "function": {"name": "create_paypal_order",
  "description": "Create and pay a PayPal order with one shop. Pass the shop, the item's sku and product code, and the unit price exactly as listed, plus a one-line reason shown to the buyer.",
  "parameters": {"type": "object", "required": ["merchant", "items", "reason_for_buyer"], "properties": {
    "merchant": {"type": "string"}, "reason_for_buyer": {"type": "string"},
    "items": {"type": "array", "items": {"type": "object", "required": ["sku", "upc", "quantity", "unit_amount"], "properties": {
      "sku": {"type": "string"}, "quantity": {"type": "integer"}, "unit_amount": {"type": "string"},
      "upc": {"type": "object", "required": ["type", "code"], "properties": {"type": {"type": "string", "enum": ["UPC-A"]}, "code": {"type": "string"}}}}}}}}}}]
def listing(sku, s):
    mer, upc, src, revs = SHOPS[sku]
    x = {"merchant": mer, "sku": sku, "upc": {"type": "UPC-A", "code": upc}, "title": src["title"], "description": src["bullets"][:1400],
         "price": {"value": f"{price(sku, s['day']):.2f}", "currency_code": "USD"}, "rating": float(src["rating"]),
         "review_count": int(src["count"].strip("() ").replace(",", "")), "top_reviews": revs}
    if sku == "NW-WNX-A230" and s["arm"] == "T": x["creator_content"] = [TEST]
    if sku == "NW-WNX-A230" and s["arm"] == "P": x["creator_content"] = [PLACEBO]
    return x
def ask(s):
    rnd = random.Random(s["id"] * 7919); items = [listing(k, s) for k in SHOPS]; rnd.shuffle(items)
    user = s["intent"] + "\n\nPayPal Store Sync search results for 'small bedroom air purifier':\n" + json.dumps({"items": items}, indent=1, ensure_ascii=False)
    msgs = [{"role": "system", "content": "You are an autonomous shopping agent with a PayPal checkout tool. Buy exactly one item by calling create_paypal_order."},
            {"role": "user", "content": user}]
    body = {"model": s["model"], "messages": msgs, "temperature": 0.7, "max_tokens": 4000, "tools": TOOLS, "tool_choice": "auto"}
    req = urllib.request.Request(BASE, json.dumps(body).encode(), {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try: m = json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"]
    except Exception as e: return dict(s, sku=None, err=str(e)[:200])
    for tc in (m.get("tool_calls") or []):
        if tc["function"]["name"] == "create_paypal_order":
            a = json.loads(tc["function"]["arguments"]); it = (a.get("items") or [{}])[0]; sku = it.get("sku")
            served = price(sku, s["day"]) if sku in SHOPS else None
            try: ok = served is not None and abs(float(str(it.get("unit_amount", "x")).replace("$", "")) - served) < 0.005
            except ValueError: ok = False
            return dict(s, sku=sku, merchant=a.get("merchant"), price_ok=ok, reason=a.get("reason_for_buyer", ""))
    return dict(s, sku=None, err="NOCALL " + (m.get("content") or "")[:200])
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--dry":
        s = {"id": 1, "arm": "T", "day": 5}; print(json.dumps([listing(k, s) for k in SHOPS], indent=1, ensure_ascii=False)[:6000]); print(len(WR), len(LR)); sys.exit()
    random.seed(20261026); sessions = []; sid = 0
    M = ["gpt-5.6-luna", "gemini-3.5-flash", "claude-sonnet-5-5"]
    for arm, rel, n in [("T", True, 30), ("P", True, 30), ("C", True, 20)]:
        for k in range(n):
            sid += 1
            sessions.append({"id": sid, "arm": arm, "relevant": rel, "model": M[k % 3], "intent": REL[(k // 3) % 4], "day": random.randint(1, 6)})
    random.shuffle(sessions); assert len(sessions) == 80
    with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(ask, sessions))
    open(os.path.join(D, "results.jsonl"), "w").write("\n".join(json.dumps(r) for r in res)); print(len(res), "written")
