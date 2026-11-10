/**
 * The two Studio pages. Server-rendered shell; the widgets and AG Grid tables render in the
 * browser from /api/dashboard and re-poll it, so a refund void shows without a reload.
 */

export const AG_GRID_VERSION = "36.2.0";
export const AG_GRID_SRC = `https://cdn.jsdelivr.net/npm/ag-grid-enterprise@${AG_GRID_VERSION}/dist/ag-grid-enterprise.min.js`;

export type View = "brand" | "creator";

const CSS = `
:root{--ink:#1c2128;--muted:#5b6571;--line:#dcd9d1;--bg:#f6f5f1;--paper:#fff;--test:#0a6b53;--test-bg:#e4f2ec;--placebo:#7a5c12;--placebo-bg:#f3ecd6;--none:#5b6571;--none-bg:#ebeae6;--navy:#003087;--sky:#0070e0;--void:#a3361f;--void-bg:#f8e3dd;--held:#8a4b08;--held-bg:#fbeedb}
*{box-sizing:border-box}
html{font-size:16px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.4}
main{max-width:1840px;margin:0 auto;padding:28px 40px 24px}
header.top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;gap:24px;flex-wrap:wrap}
header.top h1{font-size:1.7rem;margin:0;font-weight:600}
header.top p{margin:.15rem 0 0;color:var(--muted)}
.meta{display:flex;gap:18px;align-items:center;color:var(--muted);font-size:.95rem}
.meta nav a{color:var(--muted);text-decoration:none;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--paper)}
.meta nav a.on{color:#fff;background:var(--navy);border-color:var(--navy)}
.live{display:inline-flex;align-items:center;gap:6px}
.live i{width:9px;height:9px;border-radius:50%;background:var(--test);display:inline-block}
.live.stale i{background:var(--void)}
.cards{display:grid;grid-template-columns:1.05fr 1.15fr 1.25fr;gap:20px;margin-bottom:20px}
.cards.creator{grid-template-columns:repeat(3,1fr)}
.card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:18px 22px}
.card h2{font-size:.85rem;font-weight:600;color:var(--muted);margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em}
.hero{font-size:4rem;font-weight:650;line-height:1;color:var(--test);letter-spacing:-.02em}
.hero small{font-size:1.3rem;color:var(--ink);font-weight:600;margin-left:.3rem;letter-spacing:0}
.why{color:var(--muted);margin:.6rem 0 0}
.rival{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline}
.rival b{font-size:1.15rem}
.rival span{color:var(--muted)}
.arms{display:grid;gap:10px}
.arm{display:grid;grid-template-columns:150px 1fr 92px;gap:12px;align-items:center}
.arm .lbl{font-weight:600}
.arm .lbl small{display:block;font-weight:400;color:var(--muted);font-size:.8rem}
.arm .bar{height:26px;background:var(--bg);border-radius:6px;overflow:hidden;position:relative}
.arm .bar b{display:block;height:100%;background:var(--c);border-radius:6px 0 0 6px;transition:width .6s}
.arm .pct{text-align:right;font-weight:650;font-size:1.25rem;color:var(--c)}
.arm .pct small{display:block;font-size:.75rem;font-weight:400;color:var(--muted)}
.arm.test{--c:var(--test)}.arm.placebo{--c:var(--placebo)}.arm.none{--c:var(--none)}
.note{color:var(--muted);font-size:.85rem;margin:12px 0 0}
.meter{display:flex;height:30px;border-radius:6px;overflow:hidden;background:var(--bg);margin:4px 0 12px}
.meter b{transition:flex-grow .6s;min-width:0}
.meter .paid{background:var(--sky)}.meter .reserved{background:var(--held)}.meter .returned{background:#9aa6b2}.meter .available{background:#cdd5dd}
.ledger{display:grid;grid-template-columns:1fr auto;gap:5px 16px;margin:0}
.ledger dt{color:var(--muted);display:flex;align-items:center;gap:8px}
.ledger dt i{width:11px;height:11px;border-radius:3px;display:inline-block;background:var(--k,transparent)}
.ledger dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.ledger .sum{border-top:1px solid var(--line);padding-top:5px}
.ledger .neg{color:var(--void)}
.big{font-size:2.6rem;font-weight:650;line-height:1.05;font-variant-numeric:tabular-nums}
.big.pending{color:var(--held)}.big.voided{color:var(--void)}.big.paid{color:var(--sky)}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.panel h2{font-size:.85rem;font-weight:600;color:var(--muted);margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em;display:flex;justify-content:space-between}
.panel h2 span{text-transform:none;letter-spacing:0;font-weight:400}
.grid{height:max(360px,calc(100vh - 525px))}
.creator-grid{height:max(420px,calc(100vh - 405px))}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.82rem;font-weight:600;line-height:1.6}
.pill.test{background:var(--test-bg);color:var(--test)}.pill.placebo{background:var(--placebo-bg);color:var(--placebo)}.pill.none{background:var(--none-bg);color:var(--none)}
.pill.paid{background:#dfeefc;color:var(--navy)}.pill.held,.pill.pending{background:var(--held-bg);color:var(--held)}.pill.voided{background:var(--void-bg);color:var(--void)}.pill.nocredit{background:var(--none-bg);color:var(--none)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
s.void{color:var(--void)}
.detail{padding:14px 22px 16px 56px;display:grid;grid-template-columns:1.2fr 1fr;gap:28px;background:#fbfaf7;height:100%}
.detail h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px}
.hops{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hop{border:2px solid var(--line);background:var(--paper);border-radius:8px;padding:6px 12px;font-weight:600}
.hop small{display:block;font-weight:400;font-size:.78rem;color:var(--muted)}
.hop.chosen{border-color:var(--test)}
.arrow{color:var(--muted);font-size:1.3rem}
.shares{width:100%;border-collapse:collapse}
.shares td{padding:5px 0;border-top:1px solid var(--line)}
.shares td:last-child{text-align:right;font-weight:600}
.analyst{margin-bottom:20px;display:grid;grid-template-columns:1.6fr 1fr;gap:28px;align-items:start}
.analyst h3{margin:0 0 6px;font-size:1.25rem;font-weight:600}
.analyst .rat{margin:0 0 12px;max-width:62ch}
.analyst .cites{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 18px;margin:0 0 14px}
.analyst .cites div{border-top:1px solid var(--line);padding-top:5px}
.analyst .cites dt{color:var(--muted);font-size:.8rem}
.analyst .cites dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.analyst .cites dd small{display:block;font-weight:400;color:var(--muted);font-size:.72rem}
.analyst .guard{color:var(--muted);font-size:.85rem;margin:10px 0 0}
.approve{background:var(--navy);color:#fff;border:0;border-radius:8px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer}
.approve:disabled{background:#9aa6b2;cursor:default}
.approved{color:var(--test);font-weight:600}
.runway{display:grid;gap:10px}
.runway .row{display:grid;grid-template-columns:190px 1fr 86px;gap:10px;align-items:center;font-size:.9rem}
.runway .bar{height:22px;background:var(--bg);border-radius:6px;overflow:hidden}
.runway .bar b{display:block;height:100%;background:#9aa6b2;border-radius:6px 0 0 6px;transition:width .6s}
.runway .row.hl .bar b{background:var(--sky)}
.runway .row.hl{font-weight:600}
.runway .amt{text-align:right;font-variant-numeric:tabular-nums}
.analyst[hidden]{display:none}
.err{background:var(--void-bg);color:var(--void);padding:10px 14px;border-radius:8px;margin-bottom:16px;display:none}
footer{margin-top:16px;color:var(--muted);font-size:.8rem;display:flex;justify-content:space-between}
.clean footer,.clean .meta nav{display:none}
`;

function shell(view: View, opts: { clean: boolean; licenseKey?: string | undefined }): string {
  const title = view === "brand" ? "CITED Studio · Winix" : "CITED Studio · HouseFresh";
  const heading =
    view === "brand"
      ? `<h1>Purifier programme · Winix</h1><p>Maya, brand manager. Winix pays only for the sales the test caused.</p>`
      : `<h1>HouseFresh · creator view</h1><p>Every credit from the purifier test: held, voided or paid.</p>`;
  const body =
    view === "brand"
      ? `<section class="cards">
  <div class="card"><h2>Sales the test caused</h2><div id="tile"></div></div>
  <div class="card"><h2>Winix share by arm</h2><div id="arms"></div></div>
  <div class="card"><h2>Deposit</h2><div id="meter"></div></div>
</section>
<section class="panel analyst" id="analyst" aria-live="polite" hidden></section>
<section class="panel"><h2>Cross-store journeys &amp; Shapley split <span>Expand a row for the agent's store hops and each creator's share</span></h2><div id="journeys" class="grid"></div></section>`
      : `<section class="cards creator">
  <div class="card"><h2>Pending (30-day hold)</h2><div id="t-pending"></div></div>
  <div class="card"><h2>Voided</h2><div id="t-voided"></div></div>
  <div class="card"><h2>Paid by PayPal Payouts</h2><div id="t-paid"></div></div>
</section>
<section class="panel"><h2>Credits <span>Co-exposure splits come from the Shapley ledger</span></h2><div id="credits" class="grid creator-grid"></div></section>`;
  const nav = `<nav><a href="/"${view === "brand" ? ' class="on"' : ""}>Brand</a> <a href="/creator"${view === "creator" ? ' class="on"' : ""}>Creator</a></nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style>
<script src="${AG_GRID_SRC}"></script>
</head><body class="${opts.clean ? "clean" : ""}" data-view="${view}">
<main>
<header class="top"><div>${heading}</div><div class="meta"><span id="asof"></span><span class="live" id="live"><i></i>Live</span>${nav}</div></header>
<div class="err" id="err"></div>
${body}
<footer><span>Live from the CITED engine read API. Tables built with AG Grid.</span><span>Money in integer cents; credits count at the 80% lower bound.</span></footer>
</main>
<script>window.AG_LICENSE=${JSON.stringify(opts.licenseKey ?? "").replace(/</g, "\\u003c")};</script>
<script>${CLIENT}</script>
</body></html>`;
}

export function studioPage(view: View, opts: { clean: boolean; licenseKey?: string | undefined }) {
  return shell(view, opts);
}

/** Browser code. Plain ES2020, no template literals, so it can live in this string. */
const CLIENT = String.raw`
(function(){
var view=document.body.dataset.view;
var root=location.pathname.replace(/\/(creator)?\/?$/,"");
var api=root+"/api/dashboard";
var ag=window.agGrid;
if(ag&&window.AG_LICENSE&&ag.LicenseManager)ag.LicenseManager.setLicenseKey(window.AG_LICENSE);
if(ag&&ag.ModuleRegistry&&ag.AllEnterpriseModule)ag.ModuleRegistry.registerModules([ag.AllEnterpriseModule]);
var theme=ag?ag.themeQuartz.withParams({fontFamily:"inherit",fontSize:15,headerFontSize:13,accentColor:"#0070e0",headerBackgroundColor:"#f6f5f1",borderColor:"#dcd9d1",rowHoverColor:"#f1f6fd",wrapperBorderRadius:8}):undefined;

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function usd(m){if(m==null)return "—";var s=m<0?"-":"";var a=Math.abs(m);return s+"$"+Math.floor(a/100).toString().replace(/\B(?=(\d{3})+(?!\d))/g,",")+"."+String(a%100).padStart(2,"0");}
function pct(x){return (x*100).toFixed(1).replace(/\.0$/,"")+"%";}
var SHOPS={northwind:"Northwind",lumen:"Lumen",megamart:"MegaMart"};
function shop(id){return SHOPS[id]||id;}
function model(m){var x=String(m||"").replace(/^fake-/,"");return {gpt:"GPT",gemini:"Gemini",sonnet:"Sonnet"}[x]||x;}
var ARM={test:"Shown the test",placebo:"Other content",none:"Held out"};
function day(iso){if(!iso)return "—";var d=new Date(iso);return isNaN(d)?iso:d.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});}
function $(id){return document.getElementById(id);}

function renderTile(b,rivals){
  var lb=b.lowerBound==null?"—":pct(Math.max(0,b.lowerBound));
  var h='<div class="hero">+'+b.causedUnits+'<small>extra '+esc(b.name)+'</small></div>'+
    '<p class="why">Only the sales the test caused: '+b.exposedSales+' exposed sales × '+lb+', the lift at its 80% lower bound.</p>';
  rivals.forEach(function(r){
    h+='<div class="rival"><b>'+esc(r.name)+'</b><span>'+r.causedUnits+' extra · '+usd(r.paid)+' paid · '+(r.causedUnits>0?"lift":"no lift")+'</span></div>';
  });
  $("tile").innerHTML=h;
}
function renderArms(b){
  var h='<div class="arms">';
  b.arms.forEach(function(a){
    h+='<div class="arm '+a.arm+'"><div class="lbl">'+ARM[a.arm]+'<small>'+a.sessions+' agent sessions</small></div>'+
      '<div class="bar"><b style="width:'+(a.share*100).toFixed(1)+'%"></b></div>'+
      '<div class="pct">'+pct(a.share)+'<small>'+a.purchases+' of '+a.sessions+'</small></div></div>';
  });
  h+='</div><p class="note">Same ranking in every arm. The catalogue only adds or withholds the test.</p>';
  $("arms").innerHTML=h;
}
function renderMeter(b){
  var d=b.deposit,t=Math.max(1,d.deposited);
  function seg(k,v){return '<b class="'+k+'" style="flex-grow:'+(v/t)+'"></b>';}
  var h='<div class="meter">'+seg("paid",d.spent)+seg("reserved",d.reserved)+seg("returned",d.returned)+seg("available",d.available)+'</div>'+
  '<dl class="ledger">'+
  '<dt>Deposited</dt><dd>'+usd(d.initial)+'</dd>'+
  '<dt>Credited to creators</dt><dd>'+usd(b.credited)+'</dd>'+
  '<dt>Voided by refunds</dt><dd class="neg">−'+usd(b.voided)+'</dd>'+
  '<dt style="--k:var(--sky)"><i></i>Paid to HouseFresh</dt><dd>'+usd(d.spent)+'</dd>'+
  (d.reserved?'<dt style="--k:var(--held)"><i></i>Held for pending credits</dt><dd>'+usd(d.reserved)+'</dd>':'')+
  '<dt class="sum" style="--k:#9aa6b2"><i></i>Returning to Winix</dt><dd class="sum">'+usd(d.returned)+'</dd>'+
  (d.topUps?'<dt style="--k:#cdd5dd"><i></i>Approved top-up, next cycle</dt><dd>'+usd(d.available)+'</dd>':'')+
  '</dl>';
  $("meter").innerHTML=h;
}

function armPill(p){return p.value?'<span class="pill '+esc(p.value)+'">'+esc(ARM[p.value]||p.value)+'</span>':"";}
function holdPill(p){var s=p.value;var label={none:"No credit",held:"Held",paid:"Paid",voided:"Voided"}[s]||s;
  var cls=s==="none"?"nocredit":s;var until=p.data.holdUntil&&s==="held"?' <span class="mono">until '+day(p.data.holdUntil)+'</span>':"";
  return '<span class="pill '+esc(cls)+'">'+esc(label)+'</span>'+until;}

function JourneyDetail(){}
JourneyDetail.prototype.init=function(p){
  var j=p.data,el=document.createElement("div");el.className="detail";
  var hops=j.hops.map(function(h,i){var chosen=h.shop===j.storeChosen;
    return (i?'<span class="arrow">→</span>':'')+'<div class="hop'+(chosen?' chosen':'')+'">'+esc(shop(h.shop))+' '+usd(h.priceMinor)+'<small>'+(chosen?'paid here':(j.arm==="test"?'read the test here':'looked here'))+'</small></div>';}).join("");
  var why=j.hops.length>1?'<p class="note">The passport from '+esc(shop(j.hops[0].shop))+' rode in custom_id to the '+esc(shop(j.storeChosen))+' capture, so the sale still joined its arm.</p>':'<p class="note">Read and paid at the same shop.</p>';
  var rows=j.shares.length?j.shares.map(function(s){return '<tr><td>'+esc(s.name)+' <span class="pill '+esc(s.state)+'">'+esc(s.state)+'</span></td><td>'+(s.state==="voided"?'<s class="void">'+usd(s.amountMinor)+'</s>':usd(s.amountMinor))+'</td></tr>';}).join(""):
    '<tr><td class="dim">'+(j.arm==="test"?'No credit: outside the caused units counted at the lower bound.':'No credit: this agent was not shown a test.')+'</td><td></td></tr>';
  el.innerHTML='<div><h3>Agent store hops · '+esc(model(j.model))+'</h3><div class="hops">'+hops+'</div>'+why+'</div>'+
    '<div><h3>Shapley payout per creator</h3><table class="shares">'+rows+'</table></div>';
  this.el=el;
};
JourneyDetail.prototype.getGui=function(){return this.el;};
JourneyDetail.prototype.refresh=function(){return false;};

// Sort by header click; the menu and filter buttons stay out of the video frame.
var COLS={sortable:true,filter:true,resizable:true,enableCellChangeFlash:true,suppressHeaderMenuButton:true,suppressHeaderFilterButton:true};
function plural(n,w){return n+" "+w+(n===1?"":"s");}
var grid=null;
function renderJourneys(rows){
  if(!ag){$("journeys").innerHTML='<p class="note">AG Grid failed to load.</p>';return;}
  if(grid){grid.setGridOption("rowData",rows);return;}
  grid=ag.createGrid($("journeys"),{
    theme:theme,rowData:rows,getRowId:function(p){return p.data.orderId;},
    masterDetail:true,detailCellRenderer:JourneyDetail,detailRowHeight:150,
    defaultColDef:COLS,animateRows:true,
    columnDefs:[
      {field:"orderId",headerName:"PayPal order",cellRenderer:"agGroupCellRenderer",cellClass:"mono",minWidth:230},
      {field:"model",headerName:"Agent",valueFormatter:function(p){return model(p.value);},width:110},
      {field:"arm",headerName:"Arm",cellRenderer:armPill,width:170},
      {field:"product",headerName:"Bought",width:120},
      {field:"storeChosen",headerName:"Store chosen",valueFormatter:function(p){return shop(p.value);},width:140},
      {field:"priceMinor",headerName:"Paid",valueFormatter:function(p){return usd(p.value);},type:"rightAligned",width:110},
      {field:"priceSavedMinor",headerName:"Price saved",type:"rightAligned",width:170,cellRenderer:function(p){var j=p.data;
        if(!j.priceSavedMinor)return '<span class="dim">—</span>';return usd(j.priceSavedMinor)+' <span class="dim">at '+esc(shop(j.storeChosen))+'</span>';}},
      {colId:"commission",headerName:"Commission",type:"rightAligned",width:150,sort:"desc",
        valueGetter:function(p){return p.data.commissionMinor+p.data.voidedMinor;},
        cellRenderer:function(p){var j=p.data;if(j.voidedMinor)return '<s class="void">'+usd(j.voidedMinor)+'</s>';return j.commissionMinor?usd(j.commissionMinor):'<span class="dim">$0.00</span>';}},
      {field:"holdStatus",headerName:"30-day hold",cellRenderer:holdPill,flex:1,minWidth:200}
    ]
  });
  // #expand opens the first journey, for the video and for screenshots.
  if(location.hash==="#expand")setTimeout(function(){var r=grid.getDisplayedRowAtIndex(0);if(r)r.setExpanded(true);},50);
}

var STATE_RANK={voided:0,pending:1,paid:2};
var cgrid=null;
function renderCreator(c){
  var n=function(s){return c.credits.filter(function(x){return x.state===s;}).length;};
  var reasons={};c.credits.forEach(function(x){if(x.state==="voided"){var r=x.voidReason||"void";reasons[r]=(reasons[r]||0)+1;}});
  var why=Object.keys(reasons).map(function(r){return reasons[r]+" by "+r;}).join(", ")||"none";
  var batches={};c.credits.forEach(function(x){if(x.payoutBatchId)batches[x.payoutBatchId]=1;});
  $("t-pending").innerHTML='<div class="big pending">'+usd(c.totals.pending)+'</div><p class="note">'+plural(n("pending"),"credit")+' waiting out the hold</p>';
  $("t-voided").innerHTML='<div class="big voided">'+usd(c.totals.voided)+'</div><p class="note">'+plural(n("voided"),"credit")+' voided: '+esc(why)+'</p>';
  $("t-paid").innerHTML='<div class="big paid">'+usd(c.totals.paid)+'</div><p class="note">'+plural(n("paid"),"credit")+' · batch '+esc(Object.keys(batches).join(", ")||"—")+'</p>';
  if(!ag)return;
  if(cgrid){cgrid.setGridOption("rowData",c.credits);return;}
  cgrid=ag.createGrid($("credits"),{
    theme:theme,rowData:c.credits,getRowId:function(p){return p.data.id;},
    defaultColDef:COLS,animateRows:true,
    columnDefs:[
      {field:"captureId",headerName:"PayPal capture",cellClass:"mono",minWidth:210},
      {field:"brand",headerName:"Brand",width:120},
      {field:"amountMinor",headerName:"Credit",type:"rightAligned",width:120,cellRenderer:function(p){return p.data.state==="voided"?'<s class="void">'+usd(p.value)+'</s>':usd(p.value);}},
      {field:"state",headerName:"State",width:130,sort:"asc",comparator:function(a,b){return (STATE_RANK[a]??9)-(STATE_RANK[b]??9);},
        cellRenderer:function(p){return '<span class="pill '+esc(p.value)+'">'+esc(p.value)+'</span>';}},
      {field:"voidReason",headerName:"Void reason",width:140,valueFormatter:function(p){return p.value||"";}},
      {field:"holdUntil",headerName:"Hold ends",width:150,valueFormatter:function(p){return day(p.value);}},
      {field:"payoutBatchId",headerName:"Payout batch",cellClass:"mono",width:170,valueFormatter:function(p){return p.value||"—";}},
      {colId:"split",headerName:"Co-exposure split",flex:1,minWidth:240,
        valueGetter:function(p){return p.data.split.map(function(s){return s.name;}).join(" + ");},
        cellRenderer:function(p){var s=p.data.split,t=s.reduce(function(a,x){return a+x.amountMinor;},0)||1;
          if(s.length<2)return esc(s[0]?s[0].name:"")+' <span class="dim">· sole creator, 100%</span>';
          return s.map(function(x){return esc(x.name)+' '+usd(x.amountMinor)+' <span class="dim">('+Math.round(x.amountMinor/t*100)+'%)</span>';}).join(" · ");}}
    ]
  });
}

var approving=false;
function renderAnalyst(r){
  var el=$("analyst");el.hidden=false;
  var cites=r.citations.map(function(c){return '<div><dt>'+esc(c.label)+'</dt><dd>'+esc(c.value)+'<small class="mono">'+esc(c.source)+'</small></dd></div>';}).join("");
  var max=Math.max.apply(null,r.chart.bars.map(function(b){return b.minor;}).concat([1]));
  var bars=r.chart.bars.map(function(b){return '<div class="row'+(b.key===r.chart.highlight?' hl':'')+'"><span>'+esc(b.label)+'</span><span class="bar"><b style="width:'+(b.minor/max*100).toFixed(1)+'%"></b></span><span class="amt">'+usd(b.minor)+'</span></div>';}).join("");
  var act=r.action==="raise_cap"
    ?'<button class="approve" id="approve"'+(approving?' disabled':'')+'>'+(approving?'Approving…':'Approve '+usd(r.amountMinor)+' top-up')+'</button>'
    :'<span class="approved">'+esc(r.headline)+'</span>';
  el.innerHTML='<div><h2>Analyst <span>'+(r.wording==="template"?'recommendation from the engine numbers':'wording by '+esc(r.wording))+'</span></h2>'+
    '<h3>'+esc(r.headline)+'</h3><p class="rat">'+esc(r.rationale)+'</p><dl class="cites">'+cites+'</dl>'+act+'<p class="guard">'+esc(r.guard)+'</p></div>'+
    '<div><h2>Runway</h2><div class="runway">'+bars+'</div></div>';
  var btn=$("approve");
  if(btn)btn.onclick=function(){
    approving=true;renderAnalyst(r);
    fetch(root+"/api/analyst/approve",{method:"POST",headers:{"x-studio":"approve"}})
      .then(function(x){if(!x.ok)throw new Error("approval answered "+x.status);return x.json();})
      .then(function(){approving=false;poll();})
      .catch(function(e){approving=false;var er=$("err");er.textContent="Could not approve: "+e.message;er.style.display="block";poll();});
  };
}
function pollAnalyst(){
  fetch(root+"/api/analyst",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(r){if(r&&!approving)renderAnalyst(r);}).catch(function(){});
}

function render(d){
  $("asof").textContent="Programme clock: "+day(d.asOf);
  if(view==="brand"){
    var b=d.brands.find(function(x){return x.brandId==="winix";})||d.brands[0];
    if(!b){$("tile").innerHTML='<p class="note">No programme yet. Run the demo.</p>';return;}
    renderTile(b,d.brands.filter(function(x){return x!==b;}));
    renderArms(b);renderMeter(b);renderJourneys(d.journeys);
    pollAnalyst();
  }else{
    var c=d.creators.find(function(x){return x.creatorId==="housefresh";})||d.creators[0];
    if(c)renderCreator(c);
  }
}

function poll(){
  if(document.hidden)return;
  fetch(api,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("engine answered "+r.status);return r.json();})
  .then(function(d){$("err").style.display="none";$("live").className="live";render(d);})
  .catch(function(e){$("live").className="live stale";var el=$("err");el.textContent="Can't reach the engine: "+e.message;el.style.display="block";});
}
poll();setInterval(poll,3000);
})();
`;
