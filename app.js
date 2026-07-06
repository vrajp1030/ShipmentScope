// ── CONSTANTS ────────────────────────────────────────────────────
const CATS={packs:{e:'<i class="ti ti-box-seam"></i>',c:'ci-packs'},cards:{e:'<i class="ti ti-cards"></i>',c:'ci-cards'},graded:{e:'<i class="ti ti-award"></i>',c:'ci-graded'},figures:{e:'<i class="ti ti-chess-king"></i>',c:'ci-figures'},accessories:{e:'<i class="ti ti-briefcase"></i>',c:'ci-accessories'},other:{e:'<i class="ti ti-package"></i>',c:'ci-other'}};
const SL={ordered:'Ordered',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled',preorder:'Pre-order'};
const SP={ordered:'p-ordered',shipped:'p-shipped',delivered:'p-delivered',cancelled:'p-cancelled',preorder:'p-preorder'};
const CAT_COLORS={packs:'#6eb3f7',cards:'#c084fc',graded:'#ffb830',figures:'#3dd68c',accessories:'#ff7f5c',other:'#7878a0'};
const SC={ordered:'#6eb3f7',shipped:'#ffb830',delivered:'#3dd68c',cancelled:'#ff5f57',preorder:'#c084fc'};
const STORE_ICO_DEFAULT='<i class="ti ti-building-store"></i>';
const API=location.origin;

// ── INVENTORY CONSTANTS ──────────────────────────────────────────
// Resale-oriented categories (distinct from the order CATS above, which are
// purchase-oriented). Icons + colors follow the same shape as CATS/CAT_COLORS.
const INV_CATS={
  singles:{e:'<i class="ti ti-cards"></i>',label:'Singles'},
  sealed:{e:'<i class="ti ti-box-seam"></i>',label:'Sealed'},
  graded:{e:'<i class="ti ti-award"></i>',label:'Graded'},
  figures:{e:'<i class="ti ti-chess-king"></i>',label:'Figures'},
  accessories:{e:'<i class="ti ti-briefcase"></i>',label:'Accessories'},
  other:{e:'<i class="ti ti-package"></i>',label:'Other'},
};
const INV_CAT_COLORS={singles:'#c084fc',sealed:'#6eb3f7',graded:'#ffb830',figures:'#3dd68c',accessories:'#ff7f5c',other:'#7878a0'};
// Card conditions (badge in the table). Sealed/Graded double as condition+category.
const INV_CONDITIONS={NM:'Near Mint',LP:'Lightly Played',MP:'Moderately Played',HP:'Heavily Played',DMG:'Damaged',Sealed:'Sealed',Graded:'Graded'};
const INV_STATUS_LABEL={'in-stock':'In Stock','low-stock':'Low Stock','sold':'Sold','on-hold':'On Hold'};
// Map an order category → the closest inventory category (for "Add from order").
const ORDER_TO_INV_CAT={packs:'sealed',cards:'singles',graded:'graded',figures:'figures',accessories:'accessories',other:'other'};

// ── STATE ────────────────────────────────────────────────────────
let orders=JSON.parse(localStorage.getItem('po_orders')||'[]');
let inventory=JSON.parse(localStorage.getItem('po_inventory')||'[]');
let settings=JSON.parse(localStorage.getItem('po_settings')||'{"new-order":true,"cancel":true,"dup":true,"delivery":true,"autopoll":true,"desktop":false}');
let nid=Math.max(0,...orders.map(o=>o.id||0))+1;
let invId=Math.max(0,...inventory.map(x=>x.id||0))+1;
let fil='all',timeFil='all',catFil='all',efil='all',selCat='other',showArchived=false;
let invStatusFil='all',invPage=1,invEditCat='singles';
let serverOnline=false;
let cY=new Date().getFullYear(),cM=new Date().getMonth(),cSel=new Date().getDate();
let charts=[],dashCharts=[],invCharts=[],currentEmailId=null,pollTimerId=null;
let pendingChallenge=null; // in-progress email-2FA challenge token

const $=id=>document.getElementById(id);
// Quota-safe localStorage write. Order/inventory records can carry large
// embedded email HTML; once the ~5MB localStorage quota is hit, a naive
// setItem throws and used to crash every save. On overflow we retry with the
// heavy fields stripped (the server keeps the full copy either way).
function writeLocalSafe(key,arr,heavyFields){
  try{ localStorage.setItem(key,JSON.stringify(arr)); return true; }
  catch(e){
    try{
      const slim=arr.map(o=>{const c={...o};(heavyFields||[]).forEach(f=>delete c[f]);return c;});
      localStorage.setItem(key,JSON.stringify(slim));
      return true;
    }catch(_){ console.warn('localStorage full — could not cache '+key+' locally; server copy still saved'); return false; }
  }
}
function save(){
  // 1) browser cache (works offline)  2) durable file on the computer via the server
  pruneDeliveredOrders();
  writeLocalSafe('po_orders',orders,['emailHtml','emailText']);
  try{
    fetch(API+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(orders)}).catch(()=>{});
  }catch(_){}
}
function saveInventory(){
  writeLocalSafe('po_inventory',inventory,['image']);
  try{
    fetch(API+'/api/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inventory)}).catch(()=>{});
  }catch(_){}
}
// Pull the saved inventory file from the server on startup (mirrors loadOrdersFromServer).
async function loadInventoryFromServer(){
  try{
    const res=await fetch(API+'/api/inventory');
    const data=await res.json();
    if(data.ok&&Array.isArray(data.inventory)&&data.inventory.length>=inventory.length){
      inventory=data.inventory;
      sanitizeInventory();
      writeLocalSafe('po_inventory',inventory,['image']);
      invId=Math.max(0,...inventory.map(x=>x.id||0))+1;
      if($('pane-inventory')&&$('pane-inventory').classList.contains('on'))safeRun(rInventory);
    }else if(inventory.length){
      saveInventory();
    }
  }catch(_){/* server offline — keep the browser copy */}
}
// Coerce numeric fields so rendering/aggregation can never crash on bad data.
function sanitizeInventory(){
  inventory.forEach(x=>{
    ['qty','cost','market','lowStockThreshold'].forEach(f=>{const n=parseFloat(x[f]);x[f]=isFinite(n)?n:0;});
    if(!x.qty||x.qty<0)x.qty=x.qty===0?0:1;
    if(!x.status)x.status='in-stock';
    if(!x.cat)x.cat='other';
  });
}
// Pull the saved order file from the server on startup so orders never "disappear"
let ordersLoading=false;
async function loadOrdersFromServer(){
  if(!orders.length){ ordersLoading=true; rOrders(); }
  try{
    const res=await fetch(API+'/api/orders');
    const data=await res.json();
    if(data.ok&&Array.isArray(data.orders)){
      const localPruned=orders.filter(o=>!shouldAutoDeleteDelivered(o));
      orders=data.orders.length>=localPruned.length ? data.orders : localPruned;
      sanitizeOrders();
      localStorage.setItem('po_orders',JSON.stringify(orders));
      nid=Math.max(0,...orders.map(o=>o.id||0))+1;
      rOrders();rStats();
      if(data.orders.length<localPruned.length) save();
    }else if(orders.length){
      // Server file is empty but we have local orders — push them up so they're saved durably
      save();
    }
  }catch(_){/* server offline — fall back to the browser copy */
  }finally{ ordersLoading=false; rOrders(); }
}
function saveSettings(){localStorage.setItem('po_settings',JSON.stringify(settings));}
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// escHtml doesn't escape quotes, so it's not safe inside an attribute value
// (e.g. src="..."). Use this instead whenever untrusted text lands in one.
function escAttr(s){return(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function isSafeImageUrl(u){return /^https?:\/\/[^\s"'<>]+$/i.test(u||'')&&u.length<=500;}
function fd(d){if(!d)return'';const dt=new Date(d+'T00:00:00');return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
// Safe money formatter — never throws even if price is text/null/undefined.
function money(v){const n=typeof v==='number'?v:parseFloat(v);return isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'0.00';}
// Coerce every order's price to a real number so rendering can never crash on bad data.
const DELIVERED_RETENTION_DAYS=4;
function deliveredDateForOrder(o){
  const hist=Array.isArray(o&&o.history)?o.history:[];
  for(let i=hist.length-1;i>=0;i--)if(hist[i]&&hist[i].status==='delivered'&&hist[i].date)return hist[i].date;
  return o&&o.status==='delivered'?o.date:null;
}
function shouldAutoDeleteDelivered(o){
  const deliveredAt=deliveredDateForOrder(o);
  if(!deliveredAt)return false;
  const d=new Date(deliveredAt+'T00:00:00');
  if(isNaN(d.getTime()))return false;
  const cutoff=new Date();cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-DELIVERED_RETENTION_DAYS);
  return d<=cutoff;
}
function pruneDeliveredOrders(){
  const before=orders.length;
  orders=orders.filter(o=>!shouldAutoDeleteDelivered(o));
  return orders.length!==before;
}
function sanitizeOrders(){
  orders.forEach(o=>{const n=typeof o.price==='number'?o.price:parseFloat(o.price);o.price=isFinite(n)?n:0;});
  pruneDeliveredOrders();
}
// ── Inventory derived values (never stored — always computed from cost/market/qty) ──
function invTotalCost(x){return (x.qty||0)*(x.cost||0);}
function invMarketValue(x){return (x.qty||0)*(x.market||0);}
function invProfitEach(x){return (x.market||0)-(x.cost||0);}
function invProfitPct(x){return x.cost?((x.market-x.cost)/x.cost*100):0;}
function invTotalProfit(x){return (x.qty||0)*invProfitEach(x);}
// A held item at/under its threshold is "low stock" — derived, not a stored status.
function invIsLowStock(x){return x.status==='in-stock'&&(x.qty||0)<=(x.lowStockThreshold||3);}
// The effective status used by filters/pills: real status, but in-stock items
// that have run low surface as "low-stock".
function invEffStatus(x){return invIsLowStock(x)?'low-stock':x.status;}

// ── TOAST ────────────────────────────────────────────────────────
let toastActionFn=null;
// ── CONFETTI — a small celebratory burst when a real delivery lands.
// Lazy-loaded (same reasoning as Chart.js): most sessions never trigger it,
// so don't make everyone pay for the library on every page load.
let _confettiLoaded=false,_confettiQueued=false;
function loadConfettiLib(){
  if(window.confetti||_confettiLoaded)return Promise.resolve();
  _confettiLoaded=true;
  return new Promise(resolve=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
    s.onload=resolve;s.onerror=resolve;
    document.head.appendChild(s);
  });
}
function queueConfetti(){
  if(_confettiQueued)return;
  _confettiQueued=true;
  setTimeout(async()=>{
    _confettiQueued=false;
    await loadConfettiLib();
    if(window.confetti)confetti({particleCount:90,spread:75,origin:{y:0.3},colors:['#7c5cff','#c4b5fd','#f1eefc','#4fbf8b']});
  },60);
}

function showToast(msg,type='',dur=4000){
  const t=$('toast');t.className='toast'+(type?' '+type:'');
  $('toast-msg').textContent=msg;
  $('toast-action').style.display='none';toastActionFn=null;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),dur);
}
// Toast with a clickable action (e.g. "Undo"). Reverts to a normal toast after it's used or times out.
function showUndoToast(msg,actionLabel,actionFn,dur=6000){
  const t=$('toast');t.className='toast';
  $('toast-msg').textContent=msg;
  toastActionFn=actionFn;
  $('toast-action').textContent=actionLabel;$('toast-action').style.display='inline';
  t.classList.add('show');
  setTimeout(()=>{t.classList.remove('show');toastActionFn=null;},dur);
}
function runToastAction(){
  if(toastActionFn)toastActionFn();
  $('toast').classList.remove('show');
  toastActionFn=null;
}

// ── TAB SWITCHING ────────────────────────────────────────────────
function toggleMobileSidebar(){
  $('sidebar').classList.toggle('mobile-open');
  $('sidebar-backdrop').classList.toggle('show');
}
// The metric-tiles header is persistent across every tab (by design — see
// below), but its title/subtitle previously always said "Dashboard" even
// while looking at Insights or Tracking, which read as a real UX mismatch
// once you noticed it. Keeps the KPI strip's context in sync with wherever
// you actually are.
const TAB_HERO={
  dashboard:{title:'Dashboard',sub:'Your collecting activity at a glance'},
  orders:{title:'Orders',sub:'Track and manage your Pokémon orders across every store'},
  inventory:{title:'Inventory',sub:'Track your inventory, costs, and profitability in real-time'},
  emails:{title:'Emails',sub:'Every order-related email that has been scanned or synced'},
  tracking:{title:'Tracking',sub:'Last known status from your emails, sorted by expected delivery'},
  calendar:{title:'Calendar',sub:'Expected deliveries laid out by date'},
  sync:{title:'Sync',sub:'Connect and manage your email accounts'},
  insights:{title:'Insights',sub:'Your spending and delivery patterns, computed from your order history'},
};
function sw(tab){
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('on'));
  document.querySelector('[data-tab="'+tab+'"]').classList.add('on');
  document.querySelectorAll('.pane').forEach(el=>el.classList.remove('on'));
  $('pane-'+tab).classList.add('on');
  $('sidebar').classList.remove('mobile-open'); $('sidebar-backdrop').classList.remove('show'); // close the mobile drawer after picking a tab
  const hero=TAB_HERO[tab];
  if(hero){$('hero-title').textContent=hero.title;$('hero-sub').textContent=hero.sub;}
  // The global metric-tile row is a quick-glance summary meant for tabs that
  // don't have their own stat row. Dashboard and Insights both do — showing
  // the generic tiles right above them reads as a duplicate.
  $('hero-metric-tiles').classList.toggle('hide-on-tab',tab==='insights'||tab==='dashboard'||tab==='inventory');
  safeRun(rStats); // header metric tiles are always visible regardless of active tab
  if(tab==='dashboard')safeRun(rDashboard);
  if(tab==='orders')safeRun(rOrders);
  if(tab==='inventory')safeRun(rInventory);
  if(tab==='emails')safeRun(rEmails);
  if(tab==='tracking')safeRun(rTracking);
  if(tab==='calendar')safeRun(rCal);
  if(tab==='sync'){safeRun(renderSyncHistory);safeRun(updateScanMeta);}
  if(tab==='insights')safeRun(rInsights);
}
function safeRun(fn){try{fn();}catch(e){console.error('render error in',fn.name,e);}}
function quickFilter(f){sw('orders');sf(f);}

// ── ANIMATED COUNTERS — KPI numbers count up/down to their new value
// instead of just snapping, so a change actually reads as a change.
const _countAnims={};
function animateNumber(id,target,opts){
  const el=$(id);if(!el)return;
  opts=opts||{};
  const prefix=opts.prefix||'';
  const from=parseInt((el.textContent||'0').replace(/[^0-9-]/g,''),10)||0;
  if(from===target){el.textContent=prefix+target.toLocaleString();return;}
  if(_countAnims[id])cancelAnimationFrame(_countAnims[id]);
  const duration=Math.min(600,200+Math.abs(target-from)*15);
  const start=performance.now();
  function tick(now){
    const p=Math.min(1,(now-start)/duration);
    const eased=1-Math.pow(1-p,3); // ease-out cubic
    const val=Math.round(from+(target-from)*eased);
    el.textContent=prefix+val.toLocaleString();
    if(p<1)_countAnims[id]=requestAnimationFrame(tick);
    else delete _countAnims[id];
  }
  _countAnims[id]=requestAnimationFrame(tick);
}

// ── STATS ────────────────────────────────────────────────────────
function monthSpend(m,y){
  return orders.filter(o=>{
    if(!o.date||o.status==='cancelled')return false;
    const d=new Date(o.date+'T00:00:00');
    return d.getMonth()===m&&d.getFullYear()===y;
  }).reduce((s,o)=>s+(o.price||0),0);
}
// Inclusive spend total between two 'YYYY-MM-DD' bounds (plain string compare — safe since all dates share that format).
function spendInRange(fromStr,toStr){
  return orders.filter(o=>o.date&&o.status!=='cancelled'&&o.date>=fromStr&&o.date<=toStr).reduce((s,o)=>s+(o.price||0),0);
}
// Sidebar "This period" select: reveal the custom date pickers (animated) and seed a
// sensible default range the first time someone switches to Custom, then re-render.
function onPeriodChange(){
  const rangeEl=$('ss-range'),customWrap=$('ss-custom-range');
  const isCustom=rangeEl&&rangeEl.value==='custom';
  if(customWrap)customWrap.classList.toggle('show',isCustom);
  if(isCustom){
    const fromEl=$('ss-custom-from'),toEl=$('ss-custom-to');
    if(fromEl&&!fromEl.value){
      const iso=d=>d.toISOString().slice(0,10);
      const to=new Date(),from=new Date();from.setDate(from.getDate()-29);
      fromEl.value=iso(from);if(toEl)toEl.value=iso(to);
    }
  }
  rStats();
}
function rStats(){
  const t=orders.length;
  const od=orders.filter(o=>o.status==='ordered'||o.status==='preorder').length;
  const sh=orders.filter(o=>o.status==='shipped').length;
  const dl=orders.filter(o=>o.status==='delivered').length;
  const cx=orders.filter(o=>o.status==='cancelled').length;
  const sp=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);

  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  animateNumber('h-total',t);
  animateNumber('h-ordered',od);
  animateNumber('h-sh',sh);animateNumber('h-dl',dl);animateNumber('h-cx',cx);
  animateNumber('h-sp',Math.round(sp),{prefix:'$'});
  set('h-transit-lbl','in transit');

  // Live counts on the status filter chips
  const pre=orders.filter(o=>o.status==='preorder').length;
  set('ct-all',t);set('ct-ordered',orders.filter(o=>o.status==='ordered').length);
  set('ct-shipped',sh);set('ct-delivered',dl);set('ct-cancelled',cx);set('ct-preorder',pre);

  // Cancelled badge on sidebar
  const nb=$('nb-cancelled');
  if(cx>0){nb.textContent=cx;nb.style.display='inline';}else nb.style.display='none';

  // Monthly sidebar stats (monthSpend is defined once, top-level, above)
  // Rolling last-3-months widget (instead of hardcoded months) so it never goes stale.
  const now=new Date();
  let periodTotal=0,prevPeriodTotal=0;
  const monthDates=[];
  for(let i=2;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    monthDates.push(d);
    const lbl=$('ss-lbl-'+(2-i)), val=$('ss-val-'+(2-i));
    const mAmt=monthSpend(d.getMonth(),d.getFullYear());
    periodTotal+=mAmt;
    if(lbl) lbl.textContent=d.toLocaleDateString('en-US',{month:'long'});
    if(val) val.textContent='$'+Math.round(mAmt).toLocaleString();
  }
  for(let i=5;i>=3;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    prevPeriodTotal+=monthSpend(d.getMonth(),d.getFullYear());
  }
  const rangeOpt=$('ss-range-opt-3m'),rangeOptYear=$('ss-range-opt-year'),rangeEl=$('ss-range'),trendEl=$('ss-trend'),breakdownEl=$('ss-breakdown');
  if(rangeOpt)rangeOpt.textContent=monthDates[0].toLocaleDateString('en-US',{month:'short'})+' – '+monthDates[2].toLocaleDateString('en-US',{month:'short',year:'numeric'});
  if(rangeOptYear)rangeOptYear.textContent=now.getFullYear()+' (calendar year)';

  // Which period is selected — 3m/all keep their original math; year and custom are
  // computed fresh here. The monthly breakdown only makes sense for the rolling-3-months
  // view, so it collapses (animated) for the others.
  const mode=rangeEl?rangeEl.value:'3m';
  if(breakdownEl)breakdownEl.classList.toggle('hide',mode!=='3m');
  let displayTotal=periodTotal,showTrend=true;
  if(mode==='all'){
    displayTotal=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
    showTrend=false;
  }else if(mode==='year'){
    const y=now.getFullYear();
    displayTotal=spendInRange(y+'-01-01',y+'-12-31');
    prevPeriodTotal=spendInRange((y-1)+'-01-01',(y-1)+'-12-31');
  }else if(mode==='custom'){
    const fromEl=$('ss-custom-from'),toEl=$('ss-custom-to');
    const from=fromEl&&fromEl.value,to=toEl&&toEl.value;
    if(from&&to&&from<=to){
      displayTotal=spendInRange(from,to);
      const iso=d=>d.toISOString().slice(0,10);
      const days=Math.round((new Date(to+'T00:00:00')-new Date(from+'T00:00:00'))/86400000)+1;
      const prevTo=new Date(from+'T00:00:00');prevTo.setDate(prevTo.getDate()-1);
      const prevFrom=new Date(prevTo);prevFrom.setDate(prevFrom.getDate()-days+1);
      prevPeriodTotal=spendInRange(iso(prevFrom),iso(prevTo));
    }else{displayTotal=0;showTrend=false;}
  }
  animateNumber('ss-total',Math.round(displayTotal),{prefix:'$'});
  if(trendEl){
    if(!showTrend||(!prevPeriodTotal&&!displayTotal)){trendEl.textContent='';trendEl.className='ss-trend';}
    else if(!prevPeriodTotal){trendEl.textContent='New';trendEl.className='ss-trend up';}
    else{
      const pct=Math.round(((displayTotal-prevPeriodTotal)/prevPeriodTotal)*100);
      trendEl.textContent=(pct>0?'▲ ':pct<0?'▼ ':'– ')+Math.abs(pct)+'%';
      trendEl.className='ss-trend '+(pct>0?'up':pct<0?'down':'flat');
    }
  }

  // Cancellation banner
  const cxList=orders.filter(o=>o.status==='cancelled');
  const z=$('cx-zone');
  if(cxList.length&&settings['cancel']){
    const names=cxList.slice(0,3).map(o=>'<strong style="cursor:pointer;text-decoration:underline dotted;" onclick="openEmail(&quot;'+escAttr(String(o.id))+'&quot;)">'+escHtml((o.name||'Order').slice(0,40))+'</strong>').join('<br>');
    z.innerHTML='<div class="cx-banner"><i class="ti ti-alert-triangle"></i><div class="cx-txt">'+cxList.length+' cancelled order'+(cxList.length>1?'s':'')+':<br>'+names+(cxList.length>3?'<br>+' +(cxList.length-3)+' more':'')+'</div><button class="cx-close" onclick="this.parentElement.parentElement.innerHTML=\'\'" aria-label="Dismiss"><i class="ti ti-x"></i></button></div>';
  }else z.innerHTML='';


  renderKpiBars();

  if(document.getElementById('pane-dashboard')?.classList.contains('on'))safeRun(rDashboard);
}

// ── KPI BARS — each card's bottom bar is that stat's real share of total
// orders (Total is trivially 100%; Spend just shows whether there's any
// spend at all, since money has no natural "out of what" ceiling here).
function renderKpiBars(){
  const t=orders.length;
  const pct=n=>t?Math.round((n/t)*100):0;
  const bars={
    total:100,
    ordered:pct(orders.filter(o=>o.status==='ordered'||o.status==='preorder').length),
    sh:pct(orders.filter(o=>o.status==='shipped').length),
    dl:pct(orders.filter(o=>o.status==='delivered').length),
    cx:pct(orders.filter(o=>o.status==='cancelled').length),
    sp:orders.some(o=>o.price&&o.status!=='cancelled')?100:0,
  };
  Object.entries(bars).forEach(([key,val])=>{
    const el=$('h-'+key+'-bar');if(el)el.style.width=val+'%';
  });
}

// ── STORE LOGOS — real brand logos via Google's public favicon service for
// known store domains (CSP already allows img-src https:). Unknown stores
// fall back to the generic storefront icon so nothing ever looks broken.
const STORE_DOMAINS={
  'amazon':'amazon.com','target':'target.com','walmart':'walmart.com','best buy':'bestbuy.com',
  'pokemon center':'pokemoncenter.com','pokémon center':'pokemoncenter.com','ebay':'ebay.com',
  'tcgplayer':'tcgplayer.com','tiktok shop':'tiktok.com','tiktok':'tiktok.com',
  'mattel creations':'mattel.com','mattel':'mattel.com','whatnot':'whatnot.com','mercari':'mercari.com',
  'gamestop':'gamestop.com','costco':'costco.com','bandai':'bandai.com','etsy':'etsy.com',
  'shopify':'shopify.com','card kingdom':'cardkingdom.com','troll and toad':'trollandtoad.com',
};
function storeDomain(store){
  if(!store)return null;
  const k=store.trim().toLowerCase();
  if(STORE_DOMAINS[k])return STORE_DOMAINS[k];
  for(const key in STORE_DOMAINS){ if(k.includes(key))return STORE_DOMAINS[key]; }
  return null;
}
function storeFaviconUrl(domain,sz){return 'https://www.google.com/s2/favicons?domain='+domain+'&sz='+(sz||64);}
// Inline variant for order-card meta rows — renders nothing for unknown
// stores (the store name is already there; a generic icon would be noise).
function storeLogoInline(store,size){
  const d=storeDomain(store);
  if(!d)return'';
  return '<img class="store-favicon" src="'+storeFaviconUrl(d)+'" width="'+size+'" height="'+size+'" alt="" loading="lazy" onerror="this.remove()"/>';
}

// A lightweight inline-SVG spend chart (axis ticks, grid lines, dots) built
// fresh from real monthly totals — deliberately not a Chart.js instance,
// since the Dashboard should render instantly and Chart.js is meant to stay
// a lazy Insights-only dependency.
function renderSpendChartSVG(values,labels){
  const w=760,h=250,padL=58,padR=20,padT=14,padB=32;
  const plotW=w-padL-padR,plotH=h-padT-padB;
  // "Nice" axis ceiling: 1/2/5 × 10^k just above the real max (min $1 so an
  // all-zero month still draws a sensible $0–$1 axis like an empty state).
  const rawMax=Math.max(...values,0);
  let niceMax=1;
  if(rawMax>0){
    const pow=Math.pow(10,Math.floor(Math.log10(rawMax)));
    const n=rawMax/pow;
    niceMax=(n<=1?1:n<=2?2:n<=5?5:10)*pow;
  }
  const fmt=v=>v>=1000?'$'+(v/1000)+(v%1000===0?'k':'k'):(niceMax<=2?'$'+v.toFixed(2):'$'+Math.round(v).toLocaleString());
  const x=i=>padL+(values.length>1?i*(plotW/(values.length-1)):plotW/2);
  const y=v=>padT+plotH*(1-v/niceMax);
  let out='<svg viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'+
    '<defs><linearGradient id="dashSpendGrad" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0%" style="stop-color:var(--accent);stop-opacity:0.3"/>'+
    '<stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/>'+
    '</linearGradient></defs>';
  // Grid lines + $ tick labels (4 steps)
  for(let t=0;t<=4;t++){
    const v=niceMax*t/4, gy=y(v);
    out+='<line x1="'+padL+'" y1="'+gy+'" x2="'+(w-padR)+'" y2="'+gy+'" style="stroke:rgba(255,255,255,0.05);stroke-width:1;'+(t===0?'':'stroke-dasharray:3 4;')+'"/>';
    out+='<text x="'+(padL-10)+'" y="'+(gy+4)+'" text-anchor="end" style="fill:var(--txt3);font-size:11px;font-family:var(--font-body);font-weight:500;">'+fmt(v)+'</text>';
  }
  // X labels — thin out when there are many months
  const step=Math.ceil(labels.length/6);
  labels.forEach((lbl,i)=>{
    if(i%step!==0&&i!==labels.length-1)return;
    out+='<text x="'+x(i)+'" y="'+(h-8)+'" text-anchor="middle" style="fill:var(--txt3);font-size:11px;font-family:var(--font-body);font-weight:500;">'+lbl+'</text>';
  });
  const pts=values.map((v,i)=>[x(i),y(v)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  out+='<path d="'+line+' L'+pts[pts.length-1][0].toFixed(1)+','+(padT+plotH)+' L'+pts[0][0].toFixed(1)+','+(padT+plotH)+' Z" fill="url(#dashSpendGrad)" stroke="none"/>';
  out+='<path d="'+line+'" fill="none" style="stroke:var(--accent);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;"/>';
  pts.forEach(p=>{out+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="4" style="fill:var(--accent);stroke:var(--bg2);stroke-width:2;"/>';});
  return out+'</svg>';
}

// "X% vs last period" delta line under each stat tile — this month's slice
// of the metric vs last month's. invert=true flips the good/bad coloring
// (more cancellations is bad).
function deltaHTML(cur,prev,invert){
  if(!prev&&!cur)return '<span class="flat">– 0% vs last period</span>';
  if(!prev)return '<span class="'+(invert?'down':'up')+'">▲ New this period</span>';
  const pct=Math.round(((cur-prev)/prev)*100);
  if(pct===0)return '<span class="flat">– 0% vs last period</span>';
  const up=pct>0;
  const cls=up?(invert?'down':'up'):(invert?'up':'down');
  return '<span class="'+cls+'">'+(up?'▲ ':'▼ ')+Math.abs(pct)+'% vs last period</span>';
}
// Orders of a given status placed in a given month (by order date).
function monthStatusCount(status,m,y){
  return orders.filter(o=>{
    if(!o.date)return false;
    if(status!=='all'&&o.status!==status)return false;
    const d=new Date(o.date+'T00:00:00');
    return d.getMonth()===m&&d.getFullYear()===y;
  }).length;
}

// ── DASHBOARD (overview) — welcome hero, 5 stat tiles with MoM deltas,
// spending-overview chart, top-store logos, quick actions, and the
// at-a-glance / gauge / activity side column. No order list here on
// purpose — that's what the Orders tab is for.
function rDashboard(){
  const actEl=$('dash-activity'),gaugeSubEl=$('dash-gauge-sub');
  if(!actEl||!$('d-total'))return;

  // Personalized hero title (overrides the static TAB_HERO entry). The wave
  // emoji sits in its own span so the gradient text-clip doesn't blank it.
  const heroT=$('hero-title'),heroS=$('hero-sub');
  if(heroT&&document.getElementById('pane-dashboard').classList.contains('on')){
    const raw=((typeof currentUserEmail==='string'&&currentUserEmail)||'').split('@')[0].replace(/[^a-zA-Z].*$/,'');
    const name=raw?raw.charAt(0).toUpperCase()+raw.slice(1):'';
    heroT.innerHTML='Welcome back'+(name?', '+escHtml(name):'')+' <span class="wave-emoji">👋</span>';
    if(heroS)heroS.textContent="Here's what's happening with your orders.";
  }

  const now=new Date();
  const prevM=new Date(now.getFullYear(),now.getMonth()-1,1);
  const spend=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);

  // 5 stat tiles — all-time totals, with this-month-vs-last-month delta lines
  const sh=orders.filter(o=>o.status==='shipped').length;
  const dl=orders.filter(o=>o.status==='delivered').length;
  const cx=orders.filter(o=>o.status==='cancelled').length;
  animateNumber('d-total',orders.length);
  animateNumber('d-sh',sh);animateNumber('d-dl',dl);animateNumber('d-cx',cx);
  animateNumber('d-sp',Math.round(spend),{prefix:'$'});
  const pctOf=n=>orders.length?Math.round((n/orders.length)*100):0;
  const setBar=(id,v)=>{const el=$(id);if(el)el.style.width=v+'%';};
  setBar('d-total-bar',100);setBar('d-sh-bar',pctOf(sh));setBar('d-dl-bar',pctOf(dl));setBar('d-cx-bar',pctOf(cx));
  setBar('d-sp-bar',orders.some(o=>o.price&&o.status!=='cancelled')?100:0);
  const setDelta=(id,html)=>{const el=$(id);if(el)el.innerHTML=html;};
  const mm=(status)=>[monthStatusCount(status,now.getMonth(),now.getFullYear()),monthStatusCount(status,prevM.getMonth(),prevM.getFullYear())];
  const [tC,tP]=mm('all'),[sC,sP]=mm('shipped'),[dC,dP]=mm('delivered'),[cC,cP]=mm('cancelled');
  setDelta('d-total-delta',deltaHTML(tC,tP));
  setDelta('d-sh-delta',deltaHTML(sC,sP));
  setDelta('d-dl-delta',deltaHTML(dC,dP));
  setDelta('d-cx-delta',deltaHTML(cC,cP,true));
  setDelta('d-sp-delta',deltaHTML(monthSpend(now.getMonth(),now.getFullYear()),monthSpend(prevM.getMonth(),prevM.getFullYear())));

  // Spending overview — selectable window of real monthly totals
  const months=parseInt(($('dash-spend-range')||{}).value)||3;
  const vals=[],lbls=[];
  for(let i=months-1;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    vals.push(monthSpend(d.getMonth(),d.getFullYear()));
    lbls.push(d.toLocaleDateString('en-US',months<=4?{month:'short',year:'numeric'}:{month:'short'}));
  }
  animateNumber('dash-spend-total',Math.round(vals.reduce((s,v)=>s+v,0)),{prefix:'$'});
  const chartEl=$('dash-spend-chart');
  if(chartEl)chartEl.innerHTML=renderSpendChartSVG(vals,lbls);

  // Top stores — real brand logos, count badge, tooltip. Empty state shows
  // dimmed logos of the popular supported stores (like the mockup) so the
  // card still reads as "this is what will appear here".
  const storeCounts={};
  orders.forEach(o=>{if(o.store)storeCounts[o.store]=(storeCounts[o.store]||0)+1;});
  const topStores=Object.entries(storeCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const storesEl=$('dash-top-stores'),storesNote=$('dash-stores-note');
  if(storesEl){
    const tile=(store,domain,count,dim)=>
      '<div class="dash-store-tile'+(dim?' dim':'')+'" title="'+escAttr(store)+(count?' · '+count+' order'+(count>1?'s':''):'')+'">'+
        (domain?'<img src="'+storeFaviconUrl(domain)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';"/><i class="ti ti-building-store fallback-ico"></i>':'<i class="ti ti-building-store fallback-ico" style="display:block;"></i>')+
        (count?'<span class="dash-store-count">'+count+'</span>':'')+
      '</div>';
    if(topStores.length){
      if(storesNote)storesNote.textContent='Your most-ordered stores.';
      storesEl.innerHTML=topStores.map(([store,count])=>tile(store,storeDomain(store),count,false)).join('');
    }else{
      if(storesNote)storesNote.textContent="You haven't ordered from any stores yet.";
      storesEl.innerHTML=[['Amazon','amazon.com'],['Target','target.com'],['Walmart','walmart.com'],['Pokémon Center','pokemoncenter.com'],['Best Buy','bestbuy.com']]
        .map(([s,d])=>tile(s,d,0,true)).join('')+'<div class="dash-store-tile dim" title="And many more"><span style="color:var(--txt3);font-weight:800;letter-spacing:1px;">…</span></div>';
    }
  }

  // At a glance — avg delivery time / on-time rate / delay rate / fastest carrier
  const delivered=orders.filter(o=>o.status==='delivered'&&o.history&&o.history.length>1);
  let avgDays=null;
  if(delivered.length){
    const totalDays=delivered.reduce((s,o)=>{
      const first=new Date(o.history[0].date+'T00:00:00');
      const last=new Date(o.history[o.history.length-1].date+'T00:00:00');
      return s+Math.max(0,Math.round((last-first)/86400000));
    },0);
    avgDays=(totalDays/delivered.length).toFixed(1);
  }
  const deliveredWithEta=orders.filter(o=>o.status==='delivered'&&o.expectedDelivery);
  let onTimePct=null;
  if(deliveredWithEta.length){
    const onTime=deliveredWithEta.filter(o=>{
      const actualDate=(o.history&&o.history.length)?o.history[o.history.length-1].date:o.date;
      return actualDate&&new Date(actualDate+'T00:00:00')<=new Date(o.expectedDelivery+'T00:00:00');
    }).length;
    onTimePct=Math.round((onTime/deliveredWithEta.length)*100);
  }
  const overdueShipped=orders.filter(o=>o.status==='shipped'&&o.expectedDelivery&&new Date(o.expectedDelivery+'T00:00:00')<new Date());
  const delayRate=orders.length?Math.round((overdueShipped.length/orders.length)*100):0;
  const carrierDays={};
  delivered.forEach(o=>{
    if(!o.carrier)return;
    const first=new Date(o.history[0].date+'T00:00:00');
    const last=new Date(o.history[o.history.length-1].date+'T00:00:00');
    const days=Math.max(0,Math.round((last-first)/86400000));
    (carrierDays[o.carrier]=carrierDays[o.carrier]||[]).push(days);
  });
  const carrierAvgs=Object.entries(carrierDays).map(([c,arr])=>[c,arr.reduce((s,v)=>s+v,0)/arr.length]);
  carrierAvgs.sort((a,b)=>a[1]-b[1]);
  const fastestCarrier=carrierAvgs[0]?carrierAvgs[0][0]:null;
  const glanceEl=$('dash-glance');
  if(glanceEl){
    glanceEl.innerHTML=[
      ['Avg. delivery time',avgDays!=null?avgDays+' days':'–',''],
      ['On-time delivery rate',onTimePct!=null?onTimePct+'%':'–',''],
      ['Delay rate',delayRate+'%','color:var(--red);'],
      ['Fastest carrier',fastestCarrier||'–',''],
    ].map(([lbl,val,style])=>
      '<div class="glance-row"><span class="glance-lbl">'+lbl+'</span><span class="glance-val" style="'+style+'">'+val+'</span></div>'
    ).join('');
  }

  if(gaugeSubEl)gaugeSubEl.textContent=deliveredWithEta.length?onTimePct+'% of '+deliveredWithEta.length+' delivered order'+(deliveredWithEta.length===1?'':'s')+' with an ETA arrived on time':'No delivered orders with an ETA yet.';
  actEl.innerHTML=renderActivityList(getRecentActivity(6));

  loadChartJs().then(()=>{
    dashCharts.forEach(c=>{try{c.destroy();}catch(_){}});dashCharts=[];
    renderGaugeChart('dashGaugeChart',onTimePct,'#7c5cff','rgba(255,255,255,0.08)',dashCharts);
  }).catch(e=>console.error('Chart.js failed to load',e));
}

// ── GLOBAL SEARCH (header) ────────────────────────────────────────
function onGlobalSearch(){
  if(!document.getElementById('pane-orders').classList.contains('on'))sw('orders');
  rOrders();
}

// ── RECENT ACTIVITY (shared by the notification bell + dashboard panel) ──
function getRecentActivity(limit=8){
  const events=[];
  orders.forEach(o=>{
    const hist=(o.history&&o.history.length)?o.history:[{status:o.status,date:o.date}];
    hist.forEach(h=>events.push({order:o,status:h.status,date:h.date}));
  });
  events.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  return events.slice(0,limit);
}
function activityIcon(status){return STATUS_ICON[status]||'ti-circle';}
function activityVerb(status){
  const v={ordered:'was ordered',preorder:'was pre-ordered',shipped:'shipped',delivered:'was delivered',cancelled:'was cancelled'};
  return v[status]||status;
}
function relativeTime(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr+'T00:00:00');
  const days=Math.round((new Date().setHours(0,0,0,0)-d.getTime())/86400000);
  if(days<=0)return'Today';
  if(days===1)return'Yesterday';
  if(days<7)return days+' days ago';
  if(days<30)return Math.round(days/7)+'w ago';
  return fd(dateStr);
}
// Minute/hour-precision "time ago", for full timestamps (sync history, last-synced)
// rather than relativeTime()'s day-precision (order history dates).
function timeAgo(ts){
  if(!ts)return'';
  const mins=Math.round((Date.now()-new Date(ts).getTime())/60000);
  if(mins<1)return'Just now';
  if(mins<60)return mins+'m ago';
  const hrs=Math.round(mins/60);
  if(hrs<24)return hrs+'h ago';
  const days=Math.round(hrs/24);
  if(days<7)return days+'d ago';
  return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function renderActivityList(events){
  if(!events.length)return'<div class="notif-empty">No recent activity yet.<br>Once you add orders, activity will appear here.</div>';
  return events.map((e,i)=>
    '<div class="notif-item" style="animation-delay:'+(i*50)+'ms;" onclick="closeNotifAndOpen(\''+e.order.id+'\')">'+
      '<div class="notif-ico" style="background:'+(SC[e.status]||'var(--txt3)')+'22;color:'+(SC[e.status]||'var(--txt3)')+';"><i class="ti '+activityIcon(e.status)+'"></i></div>'+
      '<div><div class="notif-txt"><b>'+escHtml((e.order.name||'Order').slice(0,30))+'</b> '+activityVerb(e.status)+'</div><div class="notif-time">'+relativeTime(e.date)+'</div></div>'+
    '</div>'
  ).join('');
}
// The bell dropdown is gone (replaced by the always-visible sidebar Recent
// Activity panel), but renderActivityList()'s click handler still calls this.
function closeNotifAndOpen(id){openOrderDetail(id);}

// ── FILTERS ──────────────────────────────────────────────────────
function toggleFilters(){
  const box=$('more-filters'),btn=$('filter-toggle');
  const show=box.style.display==='none';
  box.style.display=show?'flex':'none';
  btn.classList.toggle('on',show);
}
function toggleArchivedView(){
  showArchived=!showArchived;
  $('archive-toggle').classList.toggle('on',showArchived);
  rOrders();
}
function sf(f){
  fil=f;
  document.querySelectorAll('[id^="stab-"]').forEach(el=>el.classList.remove('on'));
  $('stab-'+f).classList.add('on');rOrders();
}
function tf(f){
  timeFil=f;
  document.querySelectorAll('[id^="tf-"]').forEach(el=>el.classList.remove('on'));
  $('tf-'+f).classList.add('on');rOrders();
}
function cf(f){
  catFil=f;
  document.querySelectorAll('[id^="cf-"]').forEach(el=>el.classList.remove('on'));
  $('cf-'+f).classList.add('on');rOrders();
}

function inTimeRange(dateStr){
  if(timeFil==='all'||!dateStr)return true;
  const d=new Date(dateStr+'T00:00:00');
  const now=new Date();
  const yr=now.getFullYear();
  if(timeFil==='today'){const s=new Date();s.setHours(0,0,0,0);return d>=s;}
  if(timeFil==='week'){const s=new Date();s.setHours(0,0,0,0);s.setDate(s.getDate()-7);return d>=s;}
  if(timeFil==='30'){const s=new Date();s.setHours(0,0,0,0);s.setDate(s.getDate()-30);return d>=s;}
  if(timeFil==='year')return d.getFullYear()===yr;
  return true;
}

// ── DELIVERY PROGRESS ────────────────────────────────────────────
function deliveryProgress(o){
  if(!settings['delivery'])return'';
  if(!o.expectedDelivery||(o.status!=='shipped'&&o.status!=='ordered'))return'';
  const now=new Date();
  const ordered=new Date((o.date||now.toISOString().split('T')[0])+'T00:00:00');
  const expected=new Date(o.expectedDelivery+'T00:00:00');
  const total=Math.max(1,expected-ordered);
  const pct=Math.min(100,Math.max(0,Math.round(((now-ordered)/total)*100)));
  const daysLeft=Math.ceil((expected-now)/(86400000));
  const label=daysLeft>0?'~'+daysLeft+' day'+(daysLeft!==1?'s':'')+' left':'Expected today';
  return'<div class="del-progress">'+
    '<div class="del-meta"><div class="del-days">'+label+'</div><div class="del-date">Est. '+fd(o.expectedDelivery)+'</div></div>'+
    '<div class="prog-bar"><div class="prog-fill" style="width:'+pct+'%"></div></div>'+
  '</div>';
}

// ── RENDER ORDERS ────────────────────────────────────────────────
function anyFilterActive(){return fil!=='all'||timeFil!=='all'||catFil!=='all'||(($('srch').value||'').trim()!=='')||!!($('price-min')||{}).value||!!($('price-max')||{}).value;}

function rOrders(){
  const q=($('srch').value||'').toLowerCase();
  const pMin=parseFloat(($('price-min')||{}).value);
  const pMax=parseFloat(($('price-max')||{}).value);
  const filtered=orders.filter(o=>{
    if(!showArchived&&o.archived)return false;
    if(showArchived&&!o.archived)return false;
    if(fil!=='all'&&o.status!==fil)return false;
    if(!inTimeRange(o.date))return false;
    if(catFil!=='all'&&o.cat!==catFil)return false;
    if(!isNaN(pMin)&&(o.price||0)<pMin)return false;
    if(!isNaN(pMax)&&(o.price||0)>pMax)return false;
    if(q&&!(o.name||'').toLowerCase().includes(q)&&!(o.store||'').toLowerCase().includes(q)&&!(o.orderNum||'').toLowerCase().includes(q))return false;
    return true;
  });

  // Sort
  const sortBy=($('sort-sel')||{}).value||'date-desc';
  filtered.sort((a,b)=>{
    if(sortBy==='date-asc') return new Date(a.date||0)-new Date(b.date||0);
    if(sortBy==='price-desc')return (b.price||0)-(a.price||0);
    if(sortBy==='price-asc') return (a.price||0)-(b.price||0);
    if(sortBy==='store')     return (a.store||'').localeCompare(b.store||'');
    return new Date(b.date||0)-new Date(a.date||0); // newest first (default)
  });

  // Result bar
  const spent=filtered.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
  $('result-count').textContent=filtered.length+' order'+(filtered.length!==1?'s':'');
  $('result-spent').textContent=spent>0?'· $'+Math.round(spent).toLocaleString()+' spent':'';
  $('clear-filters').style.display=anyFilterActive()?'inline-flex':'none';

  const el=$('olist');
  if(!filtered.length){
    el.innerHTML=!orders.length
      ? (ordersLoading
        ? Array(3).fill('<div class="ocard skeleton-card"><div class="ocard-top"><div class="oico skel-block"></div><div class="ocard-info"><div class="skel-line" style="width:60%;height:13px;"></div><div class="skel-line" style="width:40%;height:10px;margin-top:8px;"></div></div><div class="skel-line" style="width:50px;height:20px;"></div></div></div>').join('')
        : '<div class="empty-s empty-brand" style="grid-column:1/-1;"><img src="/assets/favicon.png" width="56" height="56" alt=""/><p>No orders yet</p><p style="font-size:13px;color:var(--txt3);margin-top:6px;">Open Sync to scan your inbox, or use Add order.</p><div style="display:flex;gap:10px;justify-content:center;margin-top:16px;"><button class="empty-cta primary" onclick="sw(\'sync\')"><i class="ti ti-refresh"></i>Sync emails</button><button class="empty-cta secondary" onclick="openM()"><i class="ti ti-plus"></i>Add order</button></div></div>')
      : '<div class="empty-s" style="grid-column:1/-1;"><i class="ti ti-filter"></i><p>No orders match these filters</p><p style="font-size:12px;color:var(--txt3);margin-top:6px;">You have '+orders.length+' order'+(orders.length!==1?'s':'')+' total — try <span style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="clearFilters()">clearing the filters</span>.</p></div>';
    return;
  }

  // Crash-proof: one bad order can never blank the whole list.
  el.innerHTML=filtered.map((o,i)=>{ try{ return orderCardHTML(o,i); }catch(e){ console.error('card render error',o,e); return ''; } }).join('')+
    '<div class="list-end" style="grid-column:1/-1;">You\'ve reached the end! 🚀</div>';
}

function carrierClass(c){c=(c||'').toLowerCase();if(c.includes('ups'))return'c-ups';if(c.includes('fedex'))return'c-fedex';if(c.includes('usps'))return'c-usps';if(c.includes('dhl'))return'c-dhl';return'';}
function orderCardHTML(o,i){
  const cat=CATS[o.cat]||CATS.other;
  const delBar=deliveryProgress(o);
  const trackHtml=o.trackingUrl?'<a class="track-link '+carrierClass(o.carrier)+'" href="'+o.trackingUrl+'" target="_blank" onclick="event.stopPropagation()"><i class="ti ti-truck" style="font-size:11px;"></i>'+escHtml(o.carrier||'Track')+'</a>':'';
  const oicoInner=isSafeImageUrl(o.image)?'<img src="'+escAttr(o.image)+'" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\''+cat.e.replace(/'/g,"\\'")+'\';"/>':cat.e;
  // Entrance stagger caps at the first 10 cards so long lists don't leave late cards waiting.
  const delay=Math.min(i||0,10)*18;
  return'<div class="ocard'+(o.status==='cancelled'?' cx':'')+'" style="animation-delay:'+delay+'ms;" onclick="openOrderDetail(\''+o.id+'\')">'+
    '<div class="ocard-top">'+
      '<div class="oico '+cat.c+'">'+oicoInner+'</div>'+
      '<div class="ocard-info">'+
        '<div class="oname">'+escHtml(o.name||'Unnamed order')+'</div>'+
        '<div class="ometa">'+
          '<span>'+(o.store?storeLogoInline(o.store,14):'')+escHtml(o.store||'')+'</span>'+
          (o.date?'<span>'+fd(o.date)+'</span>':'')+
          (o.orderNum?'<span>#'+escHtml(o.orderNum)+'</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="ocard-right">'+
        (o.price?'<div class="oprice">$'+money(o.price)+'</div>':'')+
        '<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span>'+
      '</div>'+
    '</div>'+
    delBar+
    '<div class="ocard-actions">'+
      '<div style="display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation()">'+
        (trackHtml||'<span class="order-age">'+relativeTime(o.date)+'</span>')+
      '</div>'+
      '<i class="ti ti-chevron-right ocard-chevron"></i>'+
    '</div>'+
  '</div>';
}
function quickArchive(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  o.archived=!o.archived;save();
  showToast(o.archived?'Order archived':'Order unarchived');
  safeRun(rOrders);
}

function clearFilters(){
  fil='all';timeFil='all';catFil='all';
  const s=$('srch'); if(s) s.value='';
  if($('price-min'))$('price-min').value='';
  if($('price-max'))$('price-max').value='';
  document.querySelectorAll('[id^="stab-"]').forEach(el=>el.classList.remove('on'));$('stab-all').classList.add('on');
  document.querySelectorAll('[id^="tf-"]').forEach(el=>el.classList.remove('on'));$('tf-all').classList.add('on');
  document.querySelectorAll('[id^="cf-"]').forEach(el=>el.classList.remove('on'));$('cf-all').classList.add('on');
  rOrders();
}

function exportCSV(){
  if(!orders.length){showToast('No orders to export yet','warn');return;}
  const cols=['name','store','price','date','status','cat','orderNum','tracking','carrier','expectedDelivery'];
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=[cols.join(',')].concat(orders.map(o=>cols.map(c=>esc(o[c])).join(',')));
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='shipmentscope-'+new Date().toISOString().split('T')[0]+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  showToast('Exported '+orders.length+' orders to CSV');
}

function dO(id){
  const idx=orders.findIndex(o=>String(o.id)===String(id));
  if(idx===-1)return;
  const removed=orders[idx];
  orders.splice(idx,1);
  save();safeRun(rOrders);safeRun(rStats);
  showUndoToast('Order deleted','Undo',()=>{
    orders.splice(Math.min(idx,orders.length),0,removed);
    save();safeRun(rOrders);safeRun(rStats);
  });
}

// ══ INVENTORY ══════════════════════════════════════════════════════
const INV_PER_PAGE=12;

// ── Optional price provider seam (currently inert) ──────────────────
// When a TCG price source is wired up later (e.g. the free Pokémon TCG API
// at api.pokemontcg.io, or a TCGplayer key), set PRICE_PROVIDER and implement
// fetchMarketPrice(); the "Refresh prices" button and refreshAllPrices() are
// already here waiting for it. Everything downstream (profit, margin, charts)
// recomputes automatically once item.market values change.
const PRICE_PROVIDER=null;
async function fetchMarketPrice(name,set,condition){ return null; } // returns null until a provider is configured
async function refreshAllPrices(){
  if(!PRICE_PROVIDER){showToast('No price source connected yet','warn');return;}
  // (future) loop items, call fetchMarketPrice, update item.market, saveInventory(), rInventory()
}

// The item's thumbnail: its own image if set, else its category glyph.
function invItemIcon(x,cls){
  cls=cls||'inv-item-ico';
  if(isSafeImageUrl(x.image))return '<div class="'+cls+'"><img src="'+escAttr(x.image)+'" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\''+(INV_CATS[x.cat]||INV_CATS.other).e.replace(/'/g,"\\'")+'\';"/></div>';
  return '<div class="'+cls+'">'+(INV_CATS[x.cat]||INV_CATS.other).e+'</div>';
}
// Condition badge tint: graded→amber, sealed→blue, everything else→neutral/purple.
function invCondBadge(x){
  const c=x.condition||'';
  const cls=c==='Graded'?'b-graded':c==='Sealed'?'b-sealed':'b-nm';
  return '<span class="inv-badge '+cls+'">'+escHtml(c||'—')+'</span>';
}

function invFilter(status){
  invStatusFil=status;invPage=1;
  document.querySelectorAll('#inv-chips .chip').forEach(el=>el.classList.remove('on'));
  const el=$('ic-'+status);if(el)el.classList.add('on');
  rInventory();
}
// The filtered + sorted view that feeds the TABLE (stat cards/charts use the
// full portfolio, not this).
function invFilteredSorted(){
  const q=($('inv-search')?$('inv-search').value:'').toLowerCase().trim();
  const catF=($('inv-cat-fil')||{}).value||'all';
  const condF=($('inv-cond-fil')||{}).value||'all';
  const storeF=($('inv-store-fil')||{}).value||'all';
  let list=inventory.filter(x=>{
    if(invStatusFil!=='all'&&invEffStatus(x)!==invStatusFil)return false;
    if(catF!=='all'&&x.cat!==catF)return false;
    if(condF!=='all'&&x.condition!==condF)return false;
    if(storeF!=='all'&&(x.store||'')!==storeF)return false;
    if(q&&!((x.name||'').toLowerCase().includes(q)||(x.set||'').toLowerCase().includes(q)||(x.store||'').toLowerCase().includes(q)))return false;
    return true;
  });
  const sort=($('inv-sort')||{}).value||'name';
  const cmp={
    'name':(a,b)=>(a.name||'').localeCompare(b.name||''),
    'profit-desc':(a,b)=>invTotalProfit(b)-invTotalProfit(a),
    'profit-asc':(a,b)=>invTotalProfit(a)-invTotalProfit(b),
    'pct-desc':(a,b)=>invProfitPct(b)-invProfitPct(a),
    'value-desc':(a,b)=>invMarketValue(b)-invMarketValue(a),
    'qty-desc':(a,b)=>(b.qty||0)-(a.qty||0),
  }[sort]||((a,b)=>0);
  return list.sort(cmp);
}

function invRowHTML(x){
  const profitEach=invProfitEach(x), pct=invProfitPct(x);
  const pcls=v=>v>0?'inv-pos':v<0?'inv-neg':'';
  const eff=invEffStatus(x);
  const sign=v=>(v>0?'+':v<0?'-':'')+'$'+money(Math.abs(v));
  return '<div class="inv-row" data-id="'+x.id+'">'+
    '<div class="inv-item-cell">'+invItemIcon(x)+
      '<div class="inv-item-name"><div class="nm">'+escHtml(x.name||'Untitled')+'</div><div class="st">'+escHtml(x.set||x.store||'')+'</div></div></div>'+
    '<div class="inv-c-cond">'+invCondBadge(x)+'</div>'+
    '<div class="inv-c-num">'+(x.qty||0)+'</div>'+
    '<div class="inv-c-num">$'+money(x.cost)+'</div>'+
    '<div class="inv-c-num">$'+money(invTotalCost(x))+'</div>'+
    '<div class="inv-c-num"><span class="inv-market-cell" onclick="editMarket('+x.id+',event)">$'+money(x.market)+'</span></div>'+
    '<div class="inv-c-num">$'+money(invMarketValue(x))+'</div>'+
    '<div class="inv-c-num '+pcls(profitEach)+'">'+sign(profitEach)+'</div>'+
    '<div class="inv-c-num '+pcls(pct)+'">'+(pct>0?'+':'')+pct.toFixed(1)+'%</div>'+
    '<div class="inv-c-status"><span class="inv-status-pill inv-s-'+eff+'">'+INV_STATUS_LABEL[eff]+'</span></div>'+
    '<div class="inv-c-menu"><button class="inv-menu-btn" onclick="invMenu('+x.id+',event)" aria-label="Item actions"><i class="ti ti-dots-vertical"></i></button></div>'+
  '</div>';
}

function rInventory(){
  if(!$('inv-table'))return;
  sanitizeInventory();
  const holdings=inventory.filter(x=>x.status!=='sold');

  // ── Stat header (whole portfolio, not the filtered table) ──
  const totalItems=holdings.reduce((s,x)=>s+(x.qty||0),0);
  const invested=holdings.reduce((s,x)=>s+invTotalCost(x),0);
  const market=holdings.reduce((s,x)=>s+invMarketValue(x),0);
  const profit=market-invested;
  const margin=invested?profit/invested*100:0;
  animateNumber('inv-k-items',Math.round(totalItems));
  animateNumber('inv-k-invested',Math.round(invested),{prefix:'$'});
  animateNumber('inv-k-market',Math.round(market),{prefix:'$'});
  const profEl=$('inv-k-profit');if(profEl)profEl.textContent=(profit>=0?'+':'-')+'$'+money(Math.abs(profit));
  const subEl=$('inv-k-profit-sub');if(subEl){subEl.textContent=(margin>=0?'↑ ':'↓ ')+Math.abs(margin).toFixed(1)+'% overall';subEl.className='inv-stat-sub '+(profit>=0?'pos':'neg');}
  const marEl=$('inv-k-margin');if(marEl)marEl.textContent=margin.toFixed(1)+'%';

  // ── Chip counts (line items by effective status) ──
  const cnt={all:inventory.length,'in-stock':0,'low-stock':0,'sold':0,'on-hold':0};
  inventory.forEach(x=>{const e=invEffStatus(x);if(cnt[e]!=null)cnt[e]++;});
  Object.keys(cnt).forEach(k=>{const el=$('ic-ct-'+k);if(el)el.textContent=cnt[k];});

  // ── Store filter options (rebuild from data, preserving selection) ──
  const storeSel=$('inv-store-fil');
  if(storeSel){
    const cur=storeSel.value;
    const stores=[...new Set(inventory.map(x=>x.store).filter(Boolean))].sort();
    storeSel.innerHTML='<option value="all">All Stores</option>'+stores.map(s=>'<option value="'+escAttr(s)+'">'+escHtml(s)+'</option>').join('');
    if([...storeSel.options].some(o=>o.value===cur))storeSel.value=cur;
  }

  // ── Table (filtered + sorted + paginated) ──
  const list=invFilteredSorted();
  const totalPages=Math.max(1,Math.ceil(list.length/INV_PER_PAGE));
  if(invPage>totalPages)invPage=totalPages;
  const start=(invPage-1)*INV_PER_PAGE;
  const pageItems=list.slice(start,start+INV_PER_PAGE);
  $('inv-table').innerHTML=pageItems.length
    ? pageItems.map(invRowHTML).join('')
    : '<div class="inv-empty"><i class="ti ti-package-off"></i><p>'+(inventory.length?'No items match these filters':'No inventory yet — click <b>Add item</b>, or add one from a delivered order.')+'</p></div>';
  renderInvPager(list.length,start,pageItems.length,totalPages);

  // ── Right rail ──
  renderInvTopPerformers(holdings);
  renderInvLowStock();
  renderInvCharts(holdings,profit);
}

function renderInvPager(total,start,shown,totalPages){
  const el=$('inv-pager');if(!el)return;
  if(!total){el.innerHTML='';return;}
  const from=start+1,to=start+shown;
  let btns='<button class="inv-pg" '+(invPage<=1?'disabled':'')+' onclick="invGoPage('+(invPage-1)+')" aria-label="Previous page"><i class="ti ti-chevron-left"></i></button>';
  const pages=[];
  for(let p=1;p<=totalPages;p++){
    if(p===1||p===totalPages||Math.abs(p-invPage)<=1)pages.push(p);
    else if(pages[pages.length-1]!=='…')pages.push('…');
  }
  pages.forEach(p=>{ btns+= p==='…' ? '<span class="inv-pg-dots">…</span>' : '<button class="inv-pg'+(p===invPage?' on':'')+'" onclick="invGoPage('+p+')">'+p+'</button>'; });
  btns+='<button class="inv-pg" '+(invPage>=totalPages?'disabled':'')+' onclick="invGoPage('+(invPage+1)+')" aria-label="Next page"><i class="ti ti-chevron-right"></i></button>';
  el.innerHTML='<span class="inv-pager-info">Showing '+from+' to '+to+' of '+total+' item'+(total===1?'':'s')+'</span><span class="inv-pager-btns">'+btns+'</span>';
}
function invGoPage(p){invPage=p;rInventory();}

function renderInvTopPerformers(holdings){
  const el=$('inv-top');if(!el)return;
  const top=holdings.filter(x=>invTotalProfit(x)>0).sort((a,b)=>invTotalProfit(b)-invTotalProfit(a)).slice(0,4);
  el.innerHTML=top.length?top.map(x=>
    '<div class="inv-top-item">'+invItemIcon(x,'inv-top-ico')+
    '<div class="inv-top-info"><div class="nm">'+escHtml(x.name||'')+'</div><div class="st">'+escHtml(x.set||x.store||'')+'</div></div>'+
    '<div class="inv-top-profit"><div class="v">+$'+money(invTotalProfit(x))+'</div><div class="p">↑ '+invProfitPct(x).toFixed(1)+'%</div></div></div>'
  ).join(''):'<div style="font-size:12.5px;color:var(--txt3);padding:6px 0;">No profitable items yet — set market values to see winners.</div>';
}
function renderInvLowStock(){
  const el=$('inv-lowstock');if(!el)return;
  const low=inventory.filter(invIsLowStock).sort((a,b)=>(a.qty||0)-(b.qty||0)).slice(0,5);
  el.innerHTML=low.length?low.map(x=>
    '<div class="inv-low-item">'+invItemIcon(x,'inv-top-ico')+
    '<div class="inv-top-info"><div class="nm">'+escHtml(x.name||'')+'</div><div class="st">'+escHtml(x.set||x.store||'')+'</div></div>'+
    '<div class="inv-low-left">'+(x.qty||0)+' left</div></div>'
  ).join(''):'<div style="font-size:12.5px;color:var(--txt3);padding:6px 0;">Nothing running low. 🎉</div>';
}

function renderInvCharts(holdings,totalProfit){
  const pnlTotalEl=$('inv-pnl-total');
  if(pnlTotalEl){pnlTotalEl.textContent=(totalProfit>=0?'+$':'-$')+money(Math.abs(totalProfit));pnlTotalEl.className='inv-pnl-total'+(totalProfit<0?' neg':'');}

  // Profit-by-category legend (always render; chart needs Chart.js)
  const byCat={};
  holdings.forEach(x=>{byCat[x.cat]=(byCat[x.cat]||0)+invTotalProfit(x);});
  const catEntries=Object.entries(byCat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const catTotal=catEntries.reduce((s,[,v])=>s+v,0);
  const legEl=$('inv-cat-legend');
  if(legEl){
    legEl.innerHTML=catEntries.length?catEntries.map(([k,v])=>
      '<div class="inv-cat-leg-item"><span class="inv-cat-dot" style="background:'+(INV_CAT_COLORS[k]||'#7878a0')+';"></span>'+
      '<span class="inv-cat-leg-name">'+(INV_CATS[k]||INV_CATS.other).label+'</span>'+
      '<span class="inv-cat-leg-val">$'+money(v)+'</span>'+
      '<span class="inv-cat-leg-pct">'+(catTotal?Math.round(v/catTotal*100):0)+'%</span></div>'
    ).join(''):'<div style="font-size:12px;color:var(--txt3);">No positive-profit categories yet.</div>';
  }

  // Cumulative profit-by-acquisition-date series for the P&L line
  const rangeSel=($('inv-pnl-range')||{}).value||'all';
  const dated=holdings.filter(x=>x.date).sort((a,b)=>a.date<b.date?-1:1);
  let cum=0; const series=dated.map(x=>{cum+=invTotalProfit(x);return {date:x.date,val:cum};});
  let sliced=series;
  if(rangeSel!=='all'){
    const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-parseInt(rangeSel));
    const cISO=cutoff.toISOString().slice(0,10);
    sliced=series.filter(p=>p.date>=cISO);
    if(!sliced.length&&series.length)sliced=[series[series.length-1]];
  }

  loadChartJs().then(()=>{
    invCharts.forEach(c=>{try{c.destroy();}catch(_){}});invCharts=[];
    // P&L line/area
    const pc=document.getElementById('invPnlChart');
    if(pc){
      const ctx=pc.getContext('2d');
      const grad=ctx.createLinearGradient(0,0,0,150);
      grad.addColorStop(0,'rgba(124,92,255,0.35)');grad.addColorStop(1,'rgba(124,92,255,0)');
      const labels=sliced.map(p=>fd(p.date));const data=sliced.map(p=>Math.round(p.val));
      invCharts.push(new Chart(pc,{type:'line',
        data:{labels:labels.length?labels:[''],datasets:[{data:data.length?data:[0],borderColor:'#7c5cff',backgroundColor:grad,fill:true,tension:.4,pointRadius:0,pointHoverRadius:4,pointBackgroundColor:'#7c5cff',borderWidth:2.5}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.raw.toLocaleString()}}},
          scales:{x:{grid:{display:false},ticks:{color:'#8a8a94',font:{size:10},maxTicksLimit:5}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8a8a94',font:{size:11},callback:v=>'$'+v.toLocaleString()},border:{display:false}}},
          animation:{duration:800,easing:'easeOutQuart'}}}));
    }
    // Profit-by-category donut
    const cc=document.getElementById('invCatChart');
    if(cc){
      invCharts.push(new Chart(cc,{type:'doughnut',
        data:{labels:catEntries.map(([k])=>(INV_CATS[k]||INV_CATS.other).label),datasets:[{data:catEntries.map(([,v])=>Math.round(v)),backgroundColor:catEntries.map(([k])=>INV_CAT_COLORS[k]||'#7878a0'),borderWidth:0,hoverOffset:6}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': $'+c.raw.toLocaleString()}}},animation:{animateRotate:true,animateScale:true,duration:800,easing:'easeOutQuart'}}}));
    }
  }).catch(e=>console.error('Chart.js failed to load',e));
}

// ── Inline market-value editing (the interaction that drives all profit) ──
function editMarket(id,ev){
  if(ev)ev.stopPropagation();
  const x=inventory.find(i=>i.id===id);if(!x)return;
  const cell=ev&&ev.currentTarget?ev.currentTarget:null;if(!cell)return;
  const input=document.createElement('input');
  input.type='number';input.step='0.01';input.min='0';input.value=x.market||'';input.className='inv-market-input';
  const commit=()=>{const v=parseFloat(input.value);x.market=isFinite(v)&&v>=0?v:0;saveInventory();rInventory();};
  input.onkeydown=e=>{if(e.key==='Enter'){input.blur();}else if(e.key==='Escape'){input.value=x.market||'';input.blur();}};
  input.onblur=commit;
  cell.replaceWith(input);input.focus();input.select();
}

// ── Row action menu ──
function invMenu(id,ev){
  ev.stopPropagation();
  document.querySelectorAll('.inv-menu').forEach(m=>m.remove());
  const row=ev.currentTarget.closest('.inv-row');if(!row)return;
  const x=inventory.find(i=>i.id===id);if(!x)return;
  const menu=document.createElement('div');menu.className='inv-menu';
  menu.innerHTML='<button onclick="openInvModal('+id+')"><i class="ti ti-edit"></i>Edit</button>'+
    (x.status!=='sold'?'<button onclick="invMarkSold('+id+')"><i class="ti ti-cash"></i>Mark as sold</button>':'<button onclick="invMarkInStock('+id+')"><i class="ti ti-rotate"></i>Back to in stock</button>')+
    '<button class="danger" onclick="invDeleteItem('+id+')"><i class="ti ti-trash"></i>Delete</button>';
  row.appendChild(menu);
  setTimeout(()=>{document.addEventListener('click',function h(){menu.remove();document.removeEventListener('click',h);},{once:true});},0);
}
function invMarkSold(id){const x=inventory.find(i=>i.id===id);if(!x)return;x.status='sold';saveInventory();rInventory();showToast('Marked as sold');}
function invMarkInStock(id){const x=inventory.find(i=>i.id===id);if(!x)return;x.status='in-stock';saveInventory();rInventory();showToast('Back in stock');}
function invDeleteItem(id){
  const idx=inventory.findIndex(i=>i.id===id);if(idx===-1)return;
  const removed=inventory[idx];inventory.splice(idx,1);
  saveInventory();rInventory();
  showUndoToast('Item deleted','Undo',()=>{inventory.splice(Math.min(idx,inventory.length),0,removed);saveInventory();rInventory();});
}

// ── Add / edit modal ──
function pcInv(el){document.querySelectorAll('#inv-modal .cchip').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');invEditCat=el.dataset.ic;}
let invEditingId=null,invModalOrderId=null;
function openInvModal(id){
  invEditingId=(typeof id==='number')?id:null;
  invModalOrderId=null;
  const x=invEditingId!=null?inventory.find(i=>i.id===invEditingId):null;
  $('inv-modal-title').textContent=x?'Edit item':'Add item';
  $('inv-modal-save').textContent=x?'Save changes':'Add item';
  $('iv-name').value=x?x.name||'':'';
  $('iv-set').value=x?x.set||'':'';
  $('iv-store').value=x?x.store||'':'';
  $('iv-cond').value=x?(x.condition||'NM'):'NM';
  $('iv-qty').value=x?(x.qty!=null?x.qty:1):1;
  $('iv-cost').value=x&&x.cost?x.cost:'';
  $('iv-market').value=x&&x.market?x.market:'';
  $('iv-status').value=x?(x.status||'in-stock'):'in-stock';
  $('iv-threshold').value=x&&x.lowStockThreshold!=null?x.lowStockThreshold:3;
  $('iv-date').value=x&&x.date?x.date:new Date().toISOString().slice(0,10);
  $('iv-notes').value=x?x.notes||'':'';
  invEditCat=x?(x.cat||'other'):'singles';
  document.querySelectorAll('#inv-modal .cchip').forEach(c=>c.classList.toggle('sel',c.dataset.ic===invEditCat));
  $('inv-modal').classList.add('open');
}
function closeInvModal(){$('inv-modal').classList.remove('open');invEditingId=null;}
function saveInvItem(){
  const name=$('iv-name').value.trim();
  if(!name){showToast('Enter an item name','warn');return;}
  const num=id=>{const v=parseFloat($(id).value);return isFinite(v)?v:0;};
  const data={
    name, set:$('iv-set').value.trim(), store:$('iv-store').value.trim(),
    cat:invEditCat, condition:$('iv-cond').value,
    qty:Math.max(0,Math.round(num('iv-qty'))), cost:num('iv-cost'), market:num('iv-market'),
    status:$('iv-status').value, lowStockThreshold:Math.max(0,Math.round(num('iv-threshold'))),
    date:$('iv-date').value||new Date().toISOString().slice(0,10), notes:$('iv-notes').value.trim(),
  };
  if(invEditingId!=null){
    const x=inventory.find(i=>i.id===invEditingId);
    if(x)Object.assign(x,data);
  }else{
    inventory.push({id:invId++,image:'',orderId:invModalOrderId,...data});
  }
  invModalOrderId=null;
  saveInventory();closeInvModal();
  if(!$('pane-inventory').classList.contains('on'))sw('inventory');else rInventory();
  showToast(invEditingId!=null?'Item updated':'Item added to inventory');
}

// ── Add an existing order into inventory (prefilled) ──
function addToInventoryFromDetail(){
  const o=orders.find(x=>String(x.id)===String(currentDetailId));
  if(!o){showToast('Open an order first','warn');return;}
  if(inventory.some(i=>i.orderId===o.id)){showToast('This order is already in your inventory','warn');return;}
  closeDetail();
  openInvModal();
  $('inv-modal-title').textContent='Add to inventory';
  $('iv-name').value=o.name||'';
  $('iv-store').value=o.store||'';
  $('iv-cost').value=o.price||'';
  $('iv-date').value=o.date||new Date().toISOString().slice(0,10);
  invEditCat=ORDER_TO_INV_CAT[o.cat]||'other';
  document.querySelectorAll('#inv-modal .cchip').forEach(c=>c.classList.toggle('sel',c.dataset.ic===invEditCat));
  // Remember the source order so we can block re-adding it.
  invModalOrderId=o.id;
}

function exportInventoryCSV(){
  if(!inventory.length){showToast('No inventory to export yet','warn');return;}
  const cols=['name','set','cat','condition','qty','cost','market','store','status','date','notes'];
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const extra=['totalCost','marketValue','profitEach','totalProfit','profitPct'];
  const rows=[cols.concat(extra).join(',')].concat(inventory.map(x=>
    cols.map(c=>esc(x[c])).concat([
      esc(invTotalCost(x).toFixed(2)),esc(invMarketValue(x).toFixed(2)),
      esc(invProfitEach(x).toFixed(2)),esc(invTotalProfit(x).toFixed(2)),esc(invProfitPct(x).toFixed(1))
    ]).join(',')));
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='shipmentscope-inventory-'+new Date().toISOString().split('T')[0]+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  showToast('Exported '+inventory.length+' items to CSV');
}

// ── DUPLICATE CHECK ──────────────────────────────────────────────
function checkDup(){
  if(!settings['dup'])return;
  const name=($('mn').value||'').toLowerCase().trim();
  if(name.length<4){$('dup-warn').style.display='none';return;}
  const dup=orders.find(o=>String(o.id)!==String(editingOrderId)&&((o.name||'').toLowerCase().includes(name)||name.includes((o.name||'').toLowerCase().trim().slice(0,10))));
  $('dup-warn').style.display=dup?'block':'none';
}

// True only if we ALREADY have this order at the same-or-newer stage — i.e. the
// email adds nothing. A newer stage (e.g. a delivery notice for an order we have
// as "shipped") is NOT a duplicate; it's an update, so it stays importable.
// Delegates matching to findExisting so "is this a dup?" and "which order does
// this update?" can never disagree (that asymmetry used to cause double cards).
function isDuplicate(order){
  const ex=findExisting(order);
  return ex?statusRank(order.status)<=statusRank(ex.status):false;
}

// ── EMAIL VIEWER ─────────────────────────────────────────────────
function openEmail(orderId){
  const o=orders.find(x=>String(x.id)===String(orderId));
  if(!o)return;
  if(!o.emailHtml&&!o.emailText){showToast('No email stored for this order','warn');return;}
  currentEmailId=orderId;
  $('ev-subject').textContent=o.name||'Order email';
  $('ev-meta').textContent=(o.source||o.store||'')+(o.date?' · '+fd(o.date):'');
  $('ev-pills').innerHTML=
    '<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span>'+
    (o.price?'<span class="pill" style="background:var(--green-d);color:var(--green);">$'+money(o.price)+'</span>':'')+
    (o.orderNum?'<span class="pill" style="background:var(--bg4);color:var(--txt2);">#'+escHtml(o.orderNum)+'</span>':'')+
    (o.trackingUrl?'<a class="track-link" href="'+o.trackingUrl+'" target="_blank"><i class="ti ti-truck" style="font-size:11px;"></i>'+escHtml(o.carrier||'Track')+'</a>':'')+
    (o.expectedDelivery?'<span class="pill" style="background:var(--amber-d);color:var(--amber);">Est. '+fd(o.expectedDelivery)+'</span>':'');
  const evBody=$('ev-body');
  if(o.emailHtml){
    evBody.innerHTML='';
    // Rendered in a fully sandboxed iframe (no scripts, no same-origin, no
    // forms/popups/top-nav) so untrusted email HTML can never execute JS or
    // reach the app, regardless of what a malicious sender puts in it.
    const frame=document.createElement('iframe');
    frame.className='email-iframe';
    frame.setAttribute('sandbox','');
    frame.setAttribute('referrerpolicy','no-referrer');
    evBody.appendChild(frame);
    frame.srcdoc=sanitizeHtml(o.emailHtml);
  } else {
    evBody.innerHTML='<div class="email-body-text">'+escHtml(o.emailText||'')+'</div>';
  }
  $('email-overlay').classList.add('open');
}
// Defense-in-depth only — the iframe's empty sandbox is what actually blocks
// script execution; this just trims the obviously unneeded/risky bits first.
function sanitizeHtml(h){return h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/on\w+\s*=\s*"[^"]*"/gi,'').replace(/on\w+\s*=\s*'[^']*'/gi,'').replace(/on\w+\s*=\s*[^\s>]+/gi,'').replace(/javascript:/gi,'');}
function closeEmail(){$('email-overlay').classList.remove('open');}
function copyEmail(){
  const o=orders.find(x=>String(x.id)===String(currentEmailId));
  if(o?.emailText)navigator.clipboard.writeText(o.emailText).then(()=>showToast('Copied!'));
}

// ── ORDER DETAIL (timeline + notes) ───────────────────────────────
let currentDetailId=null;
const STATUS_ICON={ordered:'ti-shopping-bag',preorder:'ti-star',shipped:'ti-truck',delivered:'ti-circle-check',cancelled:'ti-ban'};
function openOrderDetail(orderId){
  const o=orders.find(x=>String(x.id)===String(orderId));
  if(!o)return;
  currentDetailId=orderId;
  $('dt-name').textContent=o.name||'Unnamed order';
  $('dt-meta').textContent=(o.store||'')+(o.date?' · '+fd(o.date):'')+(o.orderNum?' · #'+o.orderNum:'');
  $('dt-pills').innerHTML=
    '<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span>'+
    (o.price?'<span class="pill" style="background:var(--green-d);color:var(--green);">$'+money(o.price)+'</span>':'')+
    (o.trackingUrl?'<a class="track-link '+carrierClass(o.carrier)+'" href="'+o.trackingUrl+'" target="_blank"><i class="ti ti-truck" style="font-size:11px;"></i>'+escHtml(o.carrier||'Track')+'</a>':'')+
    (o.expectedDelivery&&o.status!=='delivered'&&o.status!=='cancelled'?'<span class="pill" style="background:var(--amber-d);color:var(--amber);">Est. '+fd(o.expectedDelivery)+'</span>':'');
  if(isSafeImageUrl(o.image)){
    $('dt-image').src=o.image;
    $('dt-image').onerror=()=>{$('dt-image-wrap').style.display='none';};
    $('dt-image-wrap').style.display='block';
  }else{
    $('dt-image-wrap').style.display='none';
  }
  $('dt-timeline').innerHTML=renderTimeline(o);
  $('dt-notes').value=o.notes||'';
  const hasEmail=!!(o.emailHtml||o.emailText);
  $('dt-view-email-btn').style.display=hasEmail?'inline-flex':'none';
  $('dt-archive-btn').innerHTML=o.archived?'<i class="ti ti-archive-off" style="font-size:13px;"></i> Unarchive':'<i class="ti ti-archive" style="font-size:13px;"></i> Archive';
  $('detail-overlay').classList.add('open');
}
function closeDetail(){
  saveNoteNow();
  $('detail-overlay').classList.remove('open');
}
function renderTimeline(o){
  const hist=(o.history&&o.history.length)?o.history:[{status:o.status,date:o.date}];
  return '<div class="dt-label">Timeline</div><div class="timeline">'+hist.map((h,i)=>{
    const last=i===hist.length-1;
    const color=SC[h.status]||'var(--txt3)';
    return '<div class="tl-item'+(last?' tl-last':'')+'" style="animation-delay:'+(i*70)+'ms;color:'+color+';">'+
      '<div class="tl-dot" style="background:'+color+';"><i class="ti '+(STATUS_ICON[h.status]||'ti-circle')+'"></i></div>'+
      (last?'':'<div class="tl-line"></div>')+
      '<div class="tl-info"><div class="tl-status">'+(SL[h.status]||h.status)+'</div><div class="tl-date">'+fd(h.date)+'</div></div>'+
    '</div>';
  }).join('')+'</div>';
}
function saveNoteNow(){
  if(!currentDetailId)return;
  const o=orders.find(x=>String(x.id)===String(currentDetailId));
  const val=$('dt-notes').value;
  if(o&&o.notes!==val){o.notes=val;save();}
}
function viewEmailFromDetail(){
  const id=currentDetailId;
  closeDetail();
  openEmail(id);
}
function toggleArchiveFromDetail(){
  const o=orders.find(x=>String(x.id)===String(currentDetailId));
  if(!o)return;
  o.archived=!o.archived;save();
  $('dt-archive-btn').innerHTML=o.archived?'<i class="ti ti-archive-off" style="font-size:13px;"></i> Unarchive':'<i class="ti ti-archive" style="font-size:13px;"></i> Archive';
  showToast(o.archived?'Order archived':'Order unarchived');
  safeRun(rOrders);
}
function deleteFromDetail(){
  const id=currentDetailId;
  closeDetail();
  dO(id);
}
function editFromDetail(){
  const id=currentDetailId;
  if(!id)return;
  saveNoteNow();
  closeDetail();
  openM(id);
}

// ── EMAILS PANE ───────────────────────────────────────────────────
function eFilter(f){
  efil=f;
  document.querySelectorAll('[id^="etab-"]').forEach(el=>el.classList.remove('on'));
  $('etab-'+f).classList.add('on');rEmails();
}
function rEmails(){
  const list=orders.filter(o=>(o.emailHtml||o.emailText)&&(efil==='all'||o.status===efil)).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  const el=$('email-list');
  if(!list.length){el.innerHTML='<div class="empty-s" style="grid-column:1/-1;"><i class="ti ti-mail"></i><p>No emails'+(efil!=='all'?' for '+SL[efil]:'')+'</p></div>';return;}
  el.innerHTML=list.map(o=>{ try{
    const cat=CATS[o.cat]||CATS.other;
    return'<div class="ocard" onclick="openEmail(\''+o.id+'\')">'+
      '<div class="ocard-top">'+
        '<div class="oico '+cat.c+'">'+cat.e+'</div>'+
        '<div class="ocard-info"><div class="oname">'+escHtml(o.name||'')+'</div><div class="ometa"><span>'+escHtml(o.store||'')+'</span>'+(o.date?'<span>'+fd(o.date)+'</span>':'')+'<span style="color:var(--accent)"><i class="ti ti-mail" style="font-size:11px;"></i> tap to read</span></div></div>'+
        '<div class="ocard-right">'+(o.price?'<div class="oprice">$'+money(o.price)+'</div>':'')+'<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span></div>'+
      '</div>'+
    '</div>';
  }catch(e){console.error('email card error',o,e);return '';} }).join('');
}

// ── PACKAGE TRACKING ─────────────────────────────────────────────
// Shows the last known status from your order emails. This is NOT live carrier
// polling (that needs a paid tracking API) — it's honestly labelled as such.
function rTracking(){
  const t=orders.length;
  const counts={shipped:0,delivered:0,ordered:0,cancelled:0,preorder:0,noTracking:0};
  orders.forEach(o=>{
    counts[o.status]=(counts[o.status]||0)+1;
    if((o.status==='shipped'||o.status==='ordered')&&!o.tracking) counts.noTracking++;
  });
  $('trk-sub').textContent=t?t+' order'+(t!==1?'s':'')+' tracked · based on the latest status found in your order emails':'Based on the latest status found in your order emails';
  $('trk-pills').innerHTML=[
    ['In transit',counts.shipped,'var(--amber)'],
    ['Delivered',counts.delivered,'var(--green)'],
    ['Awaiting shipment',counts.ordered+counts.preorder,'var(--blue)'],
    ['Cancelled',counts.cancelled,'var(--red)'],
    ['No tracking # yet',counts.noTracking,'var(--txt3)'],
  ].map(([lbl,n,c])=>'<div class="trk-pill"><b style="color:'+c+'">'+n+'</b>'+lbl+'</div>').join('');

  const rank={shipped:0,ordered:1,preorder:1,delivered:2,cancelled:3};
  const list=[...orders].sort((a,b)=>{
    const r=(rank[a.status]??1)-(rank[b.status]??1);
    if(r!==0)return r;
    return new Date(a.expectedDelivery||a.date||0)-new Date(b.expectedDelivery||b.date||0);
  });

  const el=$('trk-list');
  if(!list.length){el.innerHTML='<div class="empty-s"><i class="ti ti-truck-delivery"></i><p>No orders to track yet</p><p style="font-size:12px;color:var(--txt3);margin-top:6px;">Sync your inbox or add an order to see it here.</p></div>';return;}

  el.innerHTML=list.map(o=>{ try{
    const cat=CATS[o.cat]||CATS.other;
    const hasEmail=!!(o.emailHtml||o.emailText);
    let etaHtml;
    if(o.status==='delivered') etaHtml='<div class="trk-eta" style="color:var(--green);">Delivered</div>';
    else if(o.status==='cancelled') etaHtml='<div class="trk-eta" style="color:var(--red);">Cancelled</div>';
    else if(o.expectedDelivery) etaHtml='<div class="trk-eta">'+fd(o.expectedDelivery)+'<span>est. delivery</span></div>';
    else etaHtml='<div class="trk-eta" style="color:var(--txt3);">—</div>';
    const trackHtml=o.trackingUrl
      ? '<a class="track-link '+carrierClass(o.carrier)+'" href="'+o.trackingUrl+'" target="_blank" onclick="event.stopPropagation()"><i class="ti ti-truck" style="font-size:11px;"></i>'+escHtml(o.carrier||'Track')+'</a>'
      : '<span style="font-size:11px;color:var(--txt3);font-weight:500;">No tracking #</span>';
    const trkIcoInner=isSafeImageUrl(o.image)?'<img src="'+escAttr(o.image)+'" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\''+cat.e.replace(/'/g,"\\'")+'\';"/>':cat.e;
    return '<div class="trk-row"'+(hasEmail?' onclick="openEmail(\''+o.id+'\')" style="cursor:pointer;"':'')+'>'+
      '<div class="trk-ico '+cat.c+'">'+trkIcoInner+'</div>'+
      '<div class="trk-info"><div class="trk-name">'+escHtml(o.name||'Unnamed order')+'</div>'+
        '<div class="trk-meta"><span>'+escHtml(o.store||'')+'</span>'+(o.orderNum?'<span>#'+escHtml(o.orderNum)+'</span>':'')+'</div></div>'+
      '<div class="trk-extra">'+
        trackHtml+
        '<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span>'+
        etaHtml+
      '</div>'+
    '</div>';
  }catch(e){console.error('tracking row error',o,e);return '';} }).join('');
}

// ── CALENDAR ─────────────────────────────────────────────────────
let _calDir='';
function rCal(){
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mo=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date+'T00:00:00');return d.getFullYear()===cY&&d.getMonth()===cM;});
  $('cm-lbl').textContent=MONTHS[cM]+' '+cY;
  if(mo.length){
    const spend=mo.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
    const deliveredCt=mo.filter(o=>o.status==='delivered').length;
    $('cm-sub').innerHTML=mo.length+' order'+(mo.length>1?'s':'')+' this month <span class="cal-sub-dot">·</span> $'+Math.round(spend).toLocaleString()+' spent <span class="cal-sub-dot">·</span> '+deliveredCt+' delivered';
  }else{
    $('cm-sub').textContent='No orders this month';
  }
  const first=new Date(cY,cM,1).getDay(),days=new Date(cY,cM+1,0).getDate(),prev=new Date(cY,cM,0).getDate();
  const today=new Date();
  const byDay={};
  mo.forEach(o=>{const d=parseInt(o.date.split('-')[2]);(byDay[d]=byDay[d]||[]).push(o);});
  let html='';
  for(let i=0;i<first;i++)html+='<div class="cal-cell om">'+(prev-first+i+1)+'</div>';
  for(let d=1;d<=days;d++){
    const isT=today.getFullYear()===cY&&today.getMonth()===cM&&today.getDate()===d;
    const isS=cSel===d&&!isT;
    const dayOrders=byDay[d]||[];
    let extra='';
    if(dayOrders.length){
      const statuses=[...new Set(dayOrders.map(o=>o.status))];
      const dots=statuses.slice(0,3).map(s=>'<span class="cal-dot" style="background:'+(SC[s]||'var(--accent)')+';"></span>').join('')+
        (statuses.length>3?'<span class="cal-dot-more">+'+(statuses.length-3)+'</span>':'');
      extra='<div class="cal-dots">'+dots+'</div>'+(dayOrders.length>1?'<span class="cal-day-badge">'+dayOrders.length+'</span>':'');
    }
    html+='<div class="cal-cell'+(isT?' today':'')+(isS?' sel':'')+(dayOrders.length?' has-o':'')+'" onclick="selDay('+d+')">'+d+extra+'</div>';
  }
  const rem=(first+days)%7;if(rem>0)for(let i=1;i<=7-rem;i++)html+='<div class="cal-cell om">'+i+'</div>';
  const grid=$('cgrid');
  grid.innerHTML=html;
  grid.classList.remove('cal-slide-l','cal-slide-r');
  if(_calDir){ void grid.offsetWidth; grid.classList.add(_calDir==='next'?'cal-slide-l':'cal-slide-r'); }
  _calDir='';
  rCalDay();
}
function selDay(d){cSel=d;rCal();}
function rCalDay(){
  $('cd-lbl').textContent=new Date(cY,cM,cSel).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  const ds=cY+'-'+String(cM+1).padStart(2,'0')+'-'+String(cSel).padStart(2,'0');
  const dos=orders.filter(o=>o.date===ds);
  $('cd-cnt').textContent=dos.length;
  if(!dos.length){$('cd-orders').innerHTML='<div class="cal-empty"><i class="ti ti-calendar-off"></i>No orders on this day</div>';return;}
  $('cd-orders').innerHTML=dos.map(o=>{
    const cat=CATS[o.cat]||CATS.other;
    return'<div class="cal-oi" onclick="'+(o.emailHtml||o.emailText?'openEmail(\''+o.id+'\')':'')+'">'+
      '<div class="ci '+cat.c+'">'+cat.e+'</div>'+
      '<div class="ci-n"><div>'+escHtml(o.name||'')+'</div><div>'+escHtml(o.store||'')+(o.price?' · $'+money(o.price):'')+'</div></div>'+
      '<span class="pill '+(SP[o.status]||'p-ordered')+'">'+(SL[o.status]||o.status)+'</span>'+
    '</div>';
  }).join('');
}
function cPrev(){cM--;if(cM<0){cM=11;cY--;}cSel=1;_calDir='prev';rCal();}
function cNext(){cM++;if(cM>11){cM=0;cY++;}cSel=1;_calDir='next';rCal();}
function cToday(){const t=new Date();cY=t.getFullYear();cM=t.getMonth();cSel=t.getDate();rCal();}

// ── SYNC: multiple IMAP accounts ──────────────────────────────────
let imapAccounts=[];
const PROVIDER_PRESETS={
  icloud:{host:'imap.mail.me.com',port:'993',placeholder:'you@icloud.com',note:'Get an app-specific password at appleid.apple.com → Sign-In & Security → App-Specific Passwords.'},
  gmail:{host:'imap.gmail.com',port:'993',placeholder:'you@gmail.com',note:'Get an app password at myaccount.google.com → Security → 2-Step Verification → App passwords. Also turn on IMAP in Gmail settings.'},
  outlook:{host:'outlook.office365.com',port:'993',placeholder:'you@outlook.com',note:'Use an app password if 2-step verification is on: account.microsoft.com → Security.'},
  custom:{host:'',port:'993',placeholder:'you@example.com',note:"Enter your mail provider's IMAP server and port."},
};
const EMAIL_SETUP_GUIDES={
  gmail:{
    title:'Gmail',
    rows:[
      ['Best option','Use Connect Gmail with Google after OAuth is configured.'],
      ['No OAuth yet','Use a Google app password with IMAP enabled.'],
      ['Server','imap.gmail.com · 993'],
    ],
  },
  icloud:{
    title:'iCloud Mail',
    rows:[
      ['Password type','Use an Apple app-specific password, not your Apple ID password.'],
      ['Where','appleid.apple.com → Sign-In & Security → App-Specific Passwords.'],
      ['Server','imap.mail.me.com · 993'],
    ],
  },
  outlook:{
    title:'Outlook',
    rows:[
      ['Password type','Use your mailbox password, or an app password if 2-step login is on.'],
      ['Where','account.microsoft.com → Security.'],
      ['Server','outlook.office365.com · 993'],
    ],
  },
};
function applyProviderPreset(){
  const p=PROVIDER_PRESETS[$('im-provider').value];
  $('im-host').value=p.host;$('im-port').value=p.port;
  $('im-note').textContent=p.note;$('im-email').placeholder=p.placeholder;
  if(EMAIL_SETUP_GUIDES[$('im-provider').value])switchEmailGuide($('im-provider').value);
}
function switchEmailGuide(provider){
  const guide=EMAIL_SETUP_GUIDES[provider]||EMAIL_SETUP_GUIDES.gmail;
  document.querySelectorAll('.setup-tab').forEach(b=>b.classList.remove('on'));
  const tab=$('setup-tab-'+provider);if(tab)tab.classList.add('on');
  const el=$('email-setup-guide');if(!el)return;
  el.innerHTML='<div class="setup-guide-card">'+
    '<div class="setup-guide-title">'+escHtml(guide.title)+'</div>'+
    guide.rows.map(([k,v])=>'<div class="setup-guide-row"><span>'+escHtml(k)+'</span><strong>'+escHtml(v)+'</strong></div>').join('')+
  '</div>';
}
function showAddAccountForm(){
  $('im-email').value='';$('im-pass').value='';$('im-provider').value='icloud';
  applyProviderPreset();
  $('imap-fw').style.display='block';
}
function connectGmailOAuth(){
  if(!serverOnline){showToast('Server offline — try again after it reconnects','error');return;}
  location.href=API+'/api/oauth/google/start';
}
function providerIcon(provider){
  if(provider==='gmail'||provider==='gmail-oauth')return'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4Z" fill="#EA4335"/><path d="M20 4L12 13L4 4" stroke="#fff" stroke-width="2"/></svg>';
  if(provider==='icloud')return'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 18H7A5 5 0 1 1 7.1 8H7A7 7 0 1 0 17 18Z" fill="#5b9ee6"/></svg>';
  return'<i class="ti ti-mail" style="font-size:18px;color:var(--txt2);"></i>';
}
function providerLabel(provider){return provider==='gmail-oauth'?'Gmail via Google':provider==='gmail'?'Gmail app password':provider==='icloud'?'iCloud Mail':provider==='outlook'?'Outlook':'Custom IMAP';}
// Per-account last-synced/health lives in localStorage, keyed by email — kept
// separate from `imapAccounts` (which is refetched wholesale from the server
// on every load, so anything stored directly on those objects would be lost).
function getAcctSyncMeta(){try{return JSON.parse(localStorage.getItem('po_acctSyncMeta')||'{}');}catch(_){return{};}}
function setAcctSyncMeta(email,meta){
  const all=getAcctSyncMeta();
  all[email.toLowerCase()]=meta;
  localStorage.setItem('po_acctSyncMeta',JSON.stringify(all));
}
function renderAccountList(){
  const el=$('account-list');if(!el)return;
  if(!imapAccounts.length){el.innerHTML='<div style="font-size:14px;color:var(--txt3);padding:8px 0;">No accounts connected yet — click below to add one.</div>';return;}
  const meta=getAcctSyncMeta();
  el.innerHTML=imapAccounts.map(a=>{
    const m=meta[a.email.toLowerCase()];
    const health=!m?'amber':(m.ok?'green':'red');
    const status=!m?'Never synced':(m.ok?'Synced '+timeAgo(m.lastSync):'Sync failed '+timeAgo(m.lastSync));
    return '<div class="srow"><div class="sico" style="background:var(--bg3);">'+providerIcon(a.provider)+'</div>'+
    '<div class="sinfo"><h4><span class="acct-health-dot '+health+'" title="'+status+'"></span>'+escHtml(a.email)+'</h4><p>'+providerLabel(a.provider)+' · '+status+' · encrypted on server</p></div>'+
    '<button class="sbtn" onclick="disconnectAccount(\''+a.email.replace(/'/g,"\\'")+'\')">Disconnect</button></div>';
  }).join('');
}
// ── SYNC HISTORY — localStorage log of past scans (mirrors the po_orders/
// po_settings pattern), so the Sync page has something to show besides a
// bare connect form + a scan button that forgets its own results on nav.
function loadSyncHistory(){try{return JSON.parse(localStorage.getItem('po_syncHistory')||'[]');}catch(_){return[];}}
function pushSyncHistory(entry){
  const hist=loadSyncHistory();
  hist.unshift(entry);
  if(hist.length>20)hist.length=20;
  localStorage.setItem('po_syncHistory',JSON.stringify(hist));
}
function renderSyncHistory(){
  const el=$('sync-history');if(!el)return;
  const hist=loadSyncHistory().slice(0,5);
  if(!hist.length){el.innerHTML='<div class="notif-empty">No syncs yet — connect an account and hit Scan inbox.</div>';return;}
  el.innerHTML=hist.map(h=>{
    const hasErr=h.errors&&h.errors.length;
    const health=hasErr?'red':(h.added>0?'green':'amber');
    const summary=hasErr?h.errors.length+' error'+(h.errors.length>1?'s':''):h.found+' found · '+h.added+' new';
    return '<div class="sync-hist-item"><span class="acct-health-dot '+health+'"></span>'+
      '<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:600;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escHtml(h.accountLabel||'')+'</div>'+
      '<div style="font-size:11px;color:var(--txt3);font-weight:500;">'+summary+'</div></div>'+
      '<div style="font-size:11px;color:var(--txt3);flex-shrink:0;">'+timeAgo(h.ts)+'</div></div>';
  }).join('');
}
// Surfaces the scan-window/poll-interval settings (otherwise buried in the
// Settings modal) right on the Sync page, where they're actually relevant.
function updateScanMeta(){
  const el=$('scan-meta');if(!el)return;
  const days=localStorage.getItem('ss_scanDays')||'30';
  const mins=localStorage.getItem('ss_pollInterval')||'5';
  el.innerHTML='Scanning last '+days+' days · Auto-sync every '+mins+' min · <span style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="openSettings()">Change in Settings</span>';
}
function copyWebhookUrl(){
  const url=$('webhook-url-display').textContent;
  navigator.clipboard.writeText(url).then(()=>showToast('Webhook URL copied')).catch(()=>showToast('Could not copy — select and copy manually','error'));
}
// Accounts now live server-side, scoped to the logged-in user (so they follow
// you across devices/browsers instead of being stuck in one browser's storage).
async function saveImap(){
  const e=$('im-email').value.trim(),p=$('im-pass').value.trim(),h=$('im-host').value.trim(),port=$('im-port').value.trim();
  if(!e||!p){showToast('Enter email and password','error');return;}
  const acct={email:e,password:p,host:h,port,provider:$('im-provider').value};
  try{
    const res=await fetch(API+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(acct)});
    const data=await res.json();
    if(!data.ok){showToast('Could not save account: '+(data.message||'unknown error'),'error');return;}
  }catch(e){showToast('Server offline — could not save account','error');return;}
  imapAccounts=imapAccounts.filter(a=>a.email.toLowerCase()!==e.toLowerCase());
  imapAccounts.push(acct);
  renderAccountList();
  $('imap-fw').style.display='none';$('scan-btn').disabled=false;
  showToast('Account connected: '+e);
  fetch(API+'/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:h,port,email:e,password:p})}).then(r=>r.json()).then(d=>{if(!d.ok)showToast('Connected, but the test failed: '+d.message,'warn');}).catch(()=>{});
}
function disconnectAccount(email){
  if(!confirm('Disconnect '+email+'? This removes the saved email credential from ShipmentScope and stops syncing. Already-imported orders are kept.'))return;
  imapAccounts=imapAccounts.filter(a=>a.email!==email);
  renderAccountList();
  if(!imapAccounts.length)$('scan-btn').disabled=true;
  fetch(API+'/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}).catch(()=>{});
  showToast('Disconnected '+email);
}

async function runScan(){
  if(!serverOnline){showToast('Server offline — run node server.js first','error');return;}
  if(!imapAccounts.length){showToast('Connect an email account first','warn');return;}
  const scanDays=parseInt(localStorage.getItem('ss_scanDays'))||30;
  $('det-zone').innerHTML='<div style="color:var(--txt3);font-size:13px;padding:14px 0;font-weight:600;display:flex;align-items:center;gap:8px;"><img src="/assets/favicon.png" width="20" height="20" alt="" class="brand-loader"/> Scanning '+imapAccounts.length+' account'+(imapAccounts.length>1?'s':'')+' — may take a minute…</div>';
  const allFound=[];const errors=[];const now=new Date().toISOString();
  for(const acct of imapAccounts){
    try{
      const cfg={...acct,scanDays};
      const res=await fetch(API+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
      const data=await res.json();
      if(!data.ok)throw new Error(data.message);
      allFound.push(...(data.orders||[]));
      setAcctSyncMeta(acct.email,{lastSync:now,ok:true});
    }catch(err){errors.push(acct.email+': '+err.message);setAcctSyncMeta(acct.email,{lastSync:now,ok:false});}
  }
  const found=allFound;
  // Mark duplicates; also flag which "new" ones are really status updates to
  // an order we already track (delivered/shipped notices) so the button can
  // say Update instead of Import.
  const marked=found.map(f=>({...f,isDup:isDuplicate(f),isUpdate:!isDuplicate(f)&&!!findExisting(f)}));
  const newOnes=marked.filter(f=>!f.isDup);
  const dups=marked.filter(f=>f.isDup);
  pushSyncHistory({ts:now,accountLabel:imapAccounts.length===1?imapAccounts[0].email:imapAccounts.length+' accounts',found:found.length,added:newOnes.length,errors});
  renderAccountList();renderSyncHistory();
  window._det=newOnes;
  const errorHtml=errors.length?'<div style="background:rgba(255,95,87,.12);border:1px solid rgba(255,95,87,.25);border-radius:9px;padding:12px;font-size:13px;color:var(--red);font-weight:600;margin-bottom:10px;">'+errors.map(escHtml).join('<br>')+'</div>':'';
  if(!newOnes.length&&!dups.length){$('det-zone').innerHTML=errorHtml+'<div style="color:var(--txt3);font-size:14px;font-weight:700;padding:14px 0;">No new order emails found in the last '+scanDays+' days.</div>';return;}
  let html=errorHtml+'<div style="font-size:14px;font-weight:700;color:var(--txt2);margin:12px 0 8px;">'+found.length+' found · <span style="color:var(--green);">'+newOnes.length+' new</span>'+(dups.length?' · <span style="color:var(--amber);">'+dups.length+' duplicate'+(dups.length>1?'s':'')+'</span>':'')+'</div>';
  html+='<div class="det-list">'+
    newOnes.slice(0,200).map((d,i)=>
      '<div class="det-item">'+
        (isSafeImageUrl(d.image)
          ? '<img src="'+escAttr(d.image)+'" alt="" loading="lazy" style="width:28px;height:28px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.remove();"/>'
          : '<span style="font-size:17px;">'+(CATS[d.cat]?.e||'<i class="ti ti-package"></i>')+'</span>')+
        '<div class="di-info">'+
          '<div class="di-name">'+escHtml((d.name||'').slice(0,60))+'</div>'+
          '<div class="di-sub">'+escHtml(d.store||'')+' · '+escHtml(d.date||'')+(d.price?' · $'+money(d.price):'')+' · <span style="color:'+(SC[d.status]||'var(--txt3)')+';">'+(SL[d.status]||d.status)+'</span></div>'+
        '</div>'+
        '<button class="di-add" id="det-btn-'+i+'" onclick="impD('+i+')">'+(d.isUpdate?'Update':'Import')+'</button>'+
      '</div>'
    ).join('')+
    dups.slice(0,5).map(d=>
      '<div class="det-item" style="opacity:.6;">'+
        '<span style="font-size:17px;">'+(CATS[d.cat]?.e||'<i class="ti ti-package"></i>')+'</span>'+
        '<div class="di-info"><div class="di-name">'+escHtml((d.name||'').slice(0,60))+'</div><div class="di-sub">Already imported</div></div>'+
        '<span class="di-dup">Duplicate</span>'+
      '</div>'
    ).join('')+
  '</div>';
  if(newOnes.length>1)html+='<button onclick="importAll()" style="margin-top:10px;background:var(--green-d);border:1px solid rgba(61,214,140,.3);border-radius:20px;padding:7px 18px;font-size:14px;font-weight:700;color:var(--green);cursor:pointer;display:inline-flex;align-items:center;gap:6px;"><i class="ti ti-check-all" style="font-size:15px;"></i>Import all '+newOnes.length+'</button>';
  $('det-zone').innerHTML=html;
}

// Status lifecycle ranking — a higher rank is a "newer" stage of the same order.
const STATUS_RANK={preorder:0,ordered:1,shipped:2,delivered:3,cancelled:4};
function statusRank(s){return STATUS_RANK[s]!=null?STATUS_RANK[s]:1;}

// Find the existing order this email belongs to. Matching strength, in order:
// order number + store → tracking number → exact same email seen before →
// "only open order from this store" heuristic → name+date+store fallback.
function findExisting(d){
  const num=(d.orderNum||'').trim().toLowerCase();
  if(num){
    const ex=orders.find(o=>(o.orderNum||'').trim().toLowerCase()===num && (o.store||'').toLowerCase()===(d.store||'').toLowerCase());
    if(ex) return ex;
    // Don't stop here: delivery notifications often carry a different reference
    // (or none) than the confirmation did — tracking number is the stronger key.
  }
  // A tracking number is unique per shipment, so a status email carrying the
  // same tracking number IS the same order — this is what lets a "delivered"
  // email actually flip the original card instead of importing as a new one.
  if(d.tracking){
    const ex=orders.find(o=>o.tracking&&o.tracking===d.tracking);
    if(ex) return ex;
  }
  // Exact same email seen before (original import or a later status update).
  if(d.emailId){
    const ex=orders.find(o=>o.emailId===d.emailId||(o.emailIds||[]).includes(d.emailId));
    if(ex) return ex;
  }
  // Status-update emails (shipped/delivered/cancelled) with no number and no
  // tracking to key on: if exactly ONE order from this store is still at an
  // earlier stage, it can only be that one. With two or more candidates we
  // deliberately do nothing — guessing wrong would corrupt a different order.
  if(d.status==='shipped'||d.status==='delivered'||d.status==='cancelled'){
    const store=(d.store||'').toLowerCase();
    const cands=orders.filter(o=>(o.store||'').toLowerCase()===store&&o.status!=='cancelled'&&statusRank(o.status)<statusRank(d.status));
    if(cands.length===1) return cands[0];
  }
  // Last resort: identical subject on the same day from the same store — but
  // never merge by this alone when either side has an order number or emailId,
  // since distinct same-day orders often share an identical subject template
  // (that bug used to silently swallow separate real orders into one card).
  if(!num&&!d.emailId) return orders.find(o=>!(o.orderNum||'').trim() && !o.emailId && o.name===d.name && o.date===d.date && o.store===d.store);
  return undefined;
}

function todayISO(){return new Date().toISOString().split('T')[0];}

// Add a new order, OR if we already track this order number, update it in place
// (advance the status, fill in tracking/price, attach the newer email).
function upsertOrder(d){
  const ex=findExisting(d);
  if(ex){
    // Remember every email that fed this order, so a future re-scan of the
    // same status-update email is recognized as "already applied".
    if(d.emailId&&d.emailId!==ex.emailId){
      ex.emailIds=ex.emailIds||[];
      if(!ex.emailIds.includes(d.emailId))ex.emailIds.push(d.emailId);
    }
    if(statusRank(d.status)>=statusRank(ex.status)){
      if(d.status!==ex.status){
        if(!ex.history)ex.history=[{status:ex.status,date:ex.date||todayISO()}];
        ex.history.push({status:d.status,date:d.date||todayISO()});
        if(d.status==='delivered'&&ex.status!=='delivered')queueConfetti(); // a real delivery just landed, not a historical backfill
      }
      ex.status=d.status; // advance to newer stage
    }
    if(d.tracking && !ex.tracking){ex.tracking=d.tracking;ex.carrier=d.carrier||ex.carrier;ex.trackingUrl=d.trackingUrl||ex.trackingUrl;}
    if(d.price && !ex.price) ex.price=d.price;
    if(d.expectedDelivery) ex.expectedDelivery=d.expectedDelivery;
    if(d.emailHtml && !ex.emailHtml) ex.emailHtml=d.emailHtml;
    if(d.emailText && !ex.emailText) ex.emailText=d.emailText;
    if(d.image && !ex.image) ex.image=d.image;
    if(d.date && (!ex.date || d.date<ex.date)) ex.date=d.date; // keep earliest (the order date)
    return 'updated';
  }
  orders.push({id:nid++,name:d.name,store:d.store,price:d.price||0,date:d.date,status:d.status,cat:d.cat,orderNum:d.orderNum||'',tracking:d.tracking||'',carrier:d.carrier||'',trackingUrl:d.trackingUrl||'',expectedDelivery:d.expectedDelivery||'',source:d.source||'',image:d.image||'',emailHtml:d.emailHtml||'',emailText:d.emailText||'',emailId:d.emailId||'',notes:'',archived:false,history:[{status:d.status,date:d.date||todayISO()}]});
  return 'added';
}

function impD(i){
  const d=window._det[i];if(!d)return;
  const r=upsertOrder(d);
  save();
  const btn=$('det-btn-'+i);
  if(btn){btn.textContent='✓';btn.style.opacity='.5';btn.disabled=true;}
  rOrders();rStats();
  if(settings['new-order'])showToast(r==='updated'?'Order updated: '+(d.name||'').slice(0,30):'Order imported: '+(d.name||'').slice(0,30));
}
function importAll(){
  if(!window._det)return;
  let added=0,updated=0;
  window._det.forEach(d=>{ upsertOrder(d)==='updated'?updated++:added++; });
  save();rOrders();rStats();
  showToast(''+added+' added'+(updated?', '+updated+' updated':''));
  $('det-zone').innerHTML='<div style="color:var(--green);font-size:13px;font-weight:700;padding:14px 0;">✓ '+added+' added'+(updated?', '+updated+' updated':'')+'! Go to Orders tab.</div>';
}

// ── INSIGHTS ─────────────────────────────────────────────────────
// ── INSIGHTS WIDGET CATALOG ────────────────────────────────────────
// Only 2 widgets show by default (per user request) — the rest are opt-in via
// "Add widget". Each widget knows how to render itself and, if it has a chart,
// how to initialize it after the HTML is in the DOM.
const DEFAULT_INSIGHT_WIDGETS=['activity-trend','status-donut','on-time-gauge','monthly-chart'];
const INSIGHT_WIDGETS={
  'monthly-chart':{label:'Monthly spend trend',
    html:ctx=>'<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'monthly-chart\')" title="Remove" aria-label="Remove monthly spend chart widget"><i class="ti ti-x"></i></button><h3>'+ctx.monthRangeLbl+' <span>'+ctx.monthYearLbl+' spend</span></h3><div style="height:200px;position:relative;"><canvas id="monthChart"></canvas></div></div>',
    after:ctx=>{const mc=document.getElementById('monthChart');if(mc)charts.push(new Chart(mc,{type:'bar',data:{labels:ctx.monthlyData.map(d=>d.label),datasets:[{label:'$',data:ctx.monthlyData.map(d=>d.total),backgroundColor:ctx.monthlyData.map(d=>d.color),borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.raw.toLocaleString()}}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#c3c3cc',font:{weight:'700',size:11}}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8a8a94',font:{size:11},callback:v=>'$'+v.toLocaleString()},border:{display:false}}}}}));}
  },
  'category-chart':{label:'Spend by category',
    html:ctx=>'<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'category-chart\')" title="Remove" aria-label="Remove spend by category chart widget"><i class="ti ti-x"></i></button><h3>Spend by category <span>all time</span></h3><div style="height:200px;position:relative;"><canvas id="catChart"></canvas></div></div>',
    after:ctx=>{const catData=Object.entries(CATS).filter(([k])=>ctx.byCat[k]).sort((a,b)=>(ctx.byCat[b[0]]||0)-(ctx.byCat[a[0]]||0));const cc=document.getElementById('catChart');if(cc)charts.push(new Chart(cc,{type:'bar',data:{labels:catData.map(([k])=>k.charAt(0).toUpperCase()+k.slice(1)),datasets:[{label:'$',data:catData.map(([k])=>Math.round(ctx.catSpend[k]||0)),backgroundColor:catData.map(([k])=>CAT_COLORS[k]||'#8a8a94'),borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.raw.toLocaleString()}}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#c3c3cc',font:{weight:'700',size:11}}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8a8a94',font:{size:11},callback:v=>'$'+v.toLocaleString()},border:{display:false}}}}}));}
  },
  'status-bars':{label:'Orders by status',
    html:ctx=>{const bars=Object.entries({ordered:'Ordered',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled',preorder:'Pre-order'}).map(([k,v])=>{const c=ctx.byStatus[k]||0,pct=ctx.t?Math.round((c/ctx.t)*100):0;return'<div class="bar-row"><div class="bar-lbl"><span>'+v+'</span><span style="color:'+SC[k]+'">'+c+'</span></div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+SC[k]+'"></div></div></div>';}).join('');
      return '<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'status-bars\')" title="Remove" aria-label="Remove orders by status widget"><i class="ti ti-x"></i></button><h3>Orders by status <span>'+ctx.t+' total</span></h3>'+bars+'</div>';}
  },
  'top-stores':{label:'Top stores by spend',
    html:ctx=>{const rows=ctx.topStores.map(([name,amt],i)=>'<div class="store-row"><div class="store-rank">#'+(i+1)+'</div><div class="store-ico ci-packs">'+STORE_ICO_DEFAULT+'</div><div class="store-info"><div class="store-name">'+escHtml(name)+'</div><div class="store-cnt">'+(ctx.byStore[name]||0)+' orders</div></div><div class="store-amt">$'+ctx.fmt(amt)+'</div></div>').join('')||'<div style="font-size:12px;color:var(--txt3);">No spend yet</div>';
      return '<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'top-stores\')" title="Remove" aria-label="Remove top stores widget"><i class="ti ti-x"></i></button><h3>Top stores <span>by spend</span></h3>'+rows+'</div>';}
  },
  'category-cards':{label:'Category breakdown',
    html:ctx=>{const cards=Object.entries(CATS).filter(([k])=>ctx.byCat[k]).sort((a,b)=>(ctx.byCat[b[0]]||0)-(ctx.byCat[a[0]]||0)).map(([k,v])=>'<div class="cat-ins"><div class="cat-ins-top"><div class="cat-ins-ico ci-'+k+'">'+v.e+'</div><div><div class="cat-ins-name">'+k.charAt(0).toUpperCase()+k.slice(1)+'</div><div class="cat-ins-cnt">'+(ctx.byCat[k]||0)+' orders</div></div></div><div class="cat-ins-val">$'+ctx.fmt(ctx.catSpend[k]||0)+'</div><div class="cat-ins-sub">total spent</div></div>').join('');
      return '<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'category-cards\')" title="Remove" aria-label="Remove category breakdown widget"><i class="ti ti-x"></i></button><h3>Category breakdown</h3><div class="cat-grid2">'+cards+'</div></div>';}
  },
  'budget':{label:'Monthly budget tracker',
    html:ctx=>{
      const budget=parseInt(localStorage.getItem('po_budget')||'0');
      if(!budget)return '<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'budget\')" title="Remove" aria-label="Remove monthly budget widget"><i class="ti ti-x"></i></button><h3>Monthly budget</h3><p style="font-size:12px;color:var(--txt3);">Set a monthly budget in Settings to track it here.</p></div>';
      const pct=Math.min(100,Math.round((ctx.thisMonthSpend/budget)*100));
      return '<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'budget\')" title="Remove" aria-label="Remove monthly budget widget"><i class="ti ti-x"></i></button><h3>Monthly budget <span>'+new Date().toLocaleDateString('en-US',{month:'long'})+'</span></h3><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:14px;font-weight:600;color:var(--txt2);">$'+ctx.fmt(ctx.thisMonthSpend)+' spent</span><span style="font-size:14px;font-weight:600;color:var(--txt3);">$'+ctx.fmt(budget)+' budget</span></div><div class="bar-track" style="height:10px;"><div class="bar-fill" style="width:'+pct+'%;background:'+(ctx.thisMonthSpend>budget?'var(--red)':'var(--accent)')+'"></div></div>'+(ctx.thisMonthSpend>budget?'<div style="font-size:12px;color:var(--red);font-weight:600;margin-top:6px;">Over budget by $'+ctx.fmt(ctx.thisMonthSpend-budget)+'</div>':'<div style="font-size:12px;color:var(--green);font-weight:600;margin-top:6px;">$'+ctx.fmt(budget-ctx.thisMonthSpend)+' remaining</div>')+'</div>';}
  },
  'trophy':{label:'Top category highlight',
    html:ctx=>'<div class="trophy"><button class="widget-remove" onclick="removeWidget(\'trophy\')" title="Remove" aria-label="Remove top category widget"><i class="ti ti-x"></i></button><div class="trophy-ico"><i class="ti ti-trophy" style="font-size:22px;color:var(--amber);"></i></div><div class="trophy-info"><h4>'+ctx.topCat[0].charAt(0).toUpperCase()+ctx.topCat[0].slice(1)+'</h4><p>Top category</p></div><div class="trophy-num">'+ctx.topCat[1]+'</div></div>'
  },
  'activity-trend':{label:'Order activity trend',
    html:ctx=>'<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'activity-trend\')" title="Remove" aria-label="Remove order activity trend widget"><i class="ti ti-x"></i></button><h3>Order activity <span>last 8 weeks</span></h3><div style="height:200px;position:relative;"><canvas id="activityChart"></canvas></div></div>',
    after:ctx=>{
      const ac=document.getElementById('activityChart');if(!ac)return;
      const gctx=ac.getContext('2d');
      const gradient=gctx.createLinearGradient(0,0,0,200);
      gradient.addColorStop(0,'rgba(102,58,243,0.35)');
      gradient.addColorStop(1,'rgba(102,58,243,0)');
      charts.push(new Chart(ac,{
        type:'line',
        data:{labels:ctx.activityTrend.map(w=>w.label),datasets:[{data:ctx.activityTrend.map(w=>w.count),borderColor:'#7c5cff',backgroundColor:gradient,fill:true,tension:.4,pointRadius:0,pointHoverRadius:4,pointBackgroundColor:'#7c5cff',borderWidth:2.5}]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+' order'+(c.raw===1?'':'s')}}},
          scales:{x:{grid:{display:false},ticks:{color:'#8a8a94',font:{size:10}}},y:{beginAtZero:true,ticks:{stepSize:1,color:'#8a8a94',font:{size:11}},grid:{color:'rgba(255,255,255,0.04)'},border:{display:false}}},
          animation:{duration:900,easing:'easeOutQuart'}
        }
      }));
    }
  },
  'status-donut':{label:'Orders by status (donut)',
    html:ctx=>'<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'status-donut\')" title="Remove" aria-label="Remove orders by status donut widget"><i class="ti ti-x"></i></button><h3>Orders by status <span>'+ctx.t+' total</span></h3><div style="height:200px;position:relative;"><canvas id="statusDonutChart"></canvas></div></div>',
    after:ctx=>{
      const labels=Object.keys(SL).filter(k=>ctx.byStatus[k]);
      const dc=document.getElementById('statusDonutChart');if(!dc)return;
      charts.push(new Chart(dc,{
        type:'doughnut',
        data:{labels:labels.map(k=>SL[k]),datasets:[{data:labels.map(k=>ctx.byStatus[k]),backgroundColor:labels.map(k=>SC[k]),borderWidth:0,hoverOffset:6}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
          plugins:{legend:{position:'right',labels:{color:'#c3c3cc',font:{size:11},boxWidth:10,padding:10}},tooltip:{callbacks:{label:c=>c.label+': '+c.raw}}},
          animation:{animateRotate:true,animateScale:true,duration:900,easing:'easeOutQuart'}
        }
      }));
    }
  },
  'on-time-gauge':{label:'On-time delivery gauge',
    html:ctx=>'<div class="chart-card"><button class="widget-remove" onclick="removeWidget(\'on-time-gauge\')" title="Remove" aria-label="Remove on-time delivery gauge widget"><i class="ti ti-x"></i></button><h3>On-time delivery</h3><div style="height:200px;position:relative;display:flex;align-items:center;justify-content:center;"><div style="width:150px;height:150px;position:relative;"><canvas id="insightsGaugeChart"></canvas></div></div></div>',
    after:ctx=>{ renderGaugeChart('insightsGaugeChart',ctx.onTimePct,'#7c5cff','rgba(255,255,255,0.08)',charts); }
  },
};
function getActiveWidgets(){
  try{const saved=JSON.parse(localStorage.getItem('ss_insightsWidgets'));if(Array.isArray(saved))return saved.filter(id=>INSIGHT_WIDGETS[id]);}catch(_){}
  return [...DEFAULT_INSIGHT_WIDGETS];
}
function saveActiveWidgets(list){localStorage.setItem('ss_insightsWidgets',JSON.stringify(list));}
function removeWidget(id){
  const list=getActiveWidgets().filter(w=>w!==id);
  saveActiveWidgets(list);rInsights();
}
function addWidget(id){
  const list=getActiveWidgets();
  if(!list.includes(id))list.push(id);
  saveActiveWidgets(list);$('widget-picker').style.display='none';rInsights();
}
function toggleWidgetPicker(){
  const el=$('widget-picker');
  const show=el.style.display==='none';
  if(show){
    const active=getActiveWidgets();
    const avail=Object.entries(INSIGHT_WIDGETS).filter(([id])=>!active.includes(id));
    el.innerHTML=avail.length
      ? avail.map(([id,w])=>'<div class="widget-picker-item" onclick="addWidget(\''+id+'\')">'+w.label+'</div>').join('')
      : '<div class="widget-picker-empty">All widgets are already added</div>';
  }
  el.style.display=show?'block':'none';
}
document.addEventListener('click',(e)=>{
  const picker=$('widget-picker');
  if(picker&&picker.style.display!=='none'&&!e.target.closest('#widget-picker')&&!e.target.closest('[onclick="toggleWidgetPicker()"]')) picker.style.display='none';
});

let _chartJsPromise=null;
function loadChartJs(){
  if(window.Chart)return Promise.resolve();
  if(_chartJsPromise)return _chartJsPromise;
  _chartJsPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

// Circular progress gauge (doughnut with a cutout + a center-text plugin) —
// shared by the dashboard side panel and the Insights "on-time delivery"
// widget so both read the same real onTimePct rather than a fake static ring.
function renderGaugeChart(canvasId,pct,color,trackColor,targetArray,centerLabel){
  const el=document.getElementById(canvasId);if(!el)return;
  const val=pct==null?0:pct;
  const centerTextPlugin={
    id:'gaugeCenterText',
    afterDraw(chart){
      const {ctx,chartArea:{left,right,top,bottom}}=chart;
      const cx=(left+right)/2, cy=(top+bottom)/2;
      ctx.save();
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--txt')||'#fff';
      ctx.font='700 16px Inter, sans-serif';
      ctx.fillText(pct==null?'–':pct+'%', cx, cy);
      ctx.restore();
    }
  };
  targetArray.push(new Chart(el,{
    type:'doughnut',
    data:{datasets:[{data:[val,Math.max(0,100-val)],backgroundColor:[color,trackColor],borderWidth:0}]},
    options:{
      responsive:true,maintainAspectRatio:false,cutout:'76%',
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      animation:{animateRotate:true,animateScale:true,duration:900,easing:'easeOutQuart'}
    },
    plugins:[centerTextPlugin]
  }));
}

// Weekly order-activity trend (last 8 weeks, Sunday-anchored) — feeds the
// Insights line/area chart from real order dates, no hardcoded periods.
function computeActivityTrend(){
  const weeks=[];
  const now=new Date();
  for(let i=7;i>=0;i--){
    const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i*7);
    const start=new Date(end); start.setDate(end.getDate()-6);
    const count=orders.filter(o=>{
      if(!o.date)return false;
      const d=new Date(o.date+'T00:00:00');
      return d>=start&&d<=end;
    }).length;
    weeks.push({label:(start.getMonth()+1)+'/'+start.getDate(),count});
  }
  return weeks;
}
async function rInsights(){
  const t=orders.length;
  if(!t){$('ins-inner').innerHTML='<div class="empty-s empty-brand"><img src="/assets/favicon.png" width="56" height="56" alt=""/><p>Add orders to see insights</p></div>';return;}
  const fmt=n=>Math.round(n||0).toLocaleString();
  const spend=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
  const cxSpend=orders.filter(o=>o.status==='cancelled').reduce((s,o)=>s+(o.price||0),0);
  const nonCx=orders.filter(o=>o.status!=='cancelled').length;
  const avg=nonCx?spend/nonCx:0;
  const dlRate=Math.round((orders.filter(o=>o.status==='delivered').length/t)*100);
  const byCat={};orders.forEach(o=>byCat[o.cat]=(byCat[o.cat]||0)+1);
  const catSpend={};orders.forEach(o=>{if(o.status!=='cancelled')catSpend[o.cat]=(catSpend[o.cat]||0)+(o.price||0);});
  const storeSpend={};orders.forEach(o=>{if(o.status!=='cancelled')storeSpend[o.store]=(storeSpend[o.store]||0)+(o.price||0);});
  const byStore={};orders.forEach(o=>byStore[o.store]=(byStore[o.store]||0)+1);
  const byStatus={};orders.forEach(o=>byStatus[o.status]=(byStatus[o.status]||0)+1);
  const topCat=Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0]||['other',0];
  const topStores=Object.entries(storeSpend).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // Rolling last-3-months spend (not hardcoded April/May/June, so it never goes stale)
  function mSpend(m,y){return orders.filter(o=>{if(!o.date||o.status==='cancelled')return false;const d=new Date(o.date+'T00:00:00');return d.getMonth()===m&&d.getFullYear()===y;}).reduce((s,o)=>s+(o.price||0),0);}
  const nowD=new Date();
  const monthlyColors=['#7c5cff','#c4b5fd','#4fbf8b'];
  const monthlyData=[2,1,0].map((i,idx)=>{
    const d=new Date(nowD.getFullYear(),nowD.getMonth()-i,1);
    return {label:d.toLocaleDateString('en-US',{month:'long'}),year:d.getFullYear(),total:Math.round(mSpend(d.getMonth(),d.getFullYear())),color:monthlyColors[idx]};
  });
  const monthRangeLbl=monthlyData.map(d=>d.label).join(' · ');
  const monthYearLbl=monthlyData[0].year===monthlyData[2].year?String(monthlyData[0].year):monthlyData[0].year+'–'+monthlyData[2].year;
  const thisMonthSpend=mSpend(nowD.getMonth(),nowD.getFullYear());

  // Same on-time definition rDashboard uses: delivered orders that had an ETA,
  // compared against when they actually landed.
  const deliveredWithEta=orders.filter(o=>o.status==='delivered'&&o.expectedDelivery);
  let onTimePct=null;
  if(deliveredWithEta.length){
    const onTime=deliveredWithEta.filter(o=>{
      const actualDate=(o.history&&o.history.length)?o.history[o.history.length-1].date:o.date;
      return actualDate&&new Date(actualDate+'T00:00:00')<=new Date(o.expectedDelivery+'T00:00:00');
    }).length;
    onTimePct=Math.round((onTime/deliveredWithEta.length)*100);
  }
  const activityTrend=computeActivityTrend();

  const ctx={t,fmt,spend,cxSpend,avg,dlRate,byCat,catSpend,storeSpend,byStore,byStatus,topCat,topStores,monthlyData,monthRangeLbl,monthYearLbl,thisMonthSpend,onTimePct,activityTrend};

  $('ins-p').textContent=t+' orders · '+Object.keys(byStore).length+' stores · $'+fmt(spend)+' total';

  const active=getActiveWidgets();
  const widgetsHtml=active.map(id=>{try{return INSIGHT_WIDGETS[id].html(ctx);}catch(e){console.error('widget render error',id,e);return '';}}).join('');

  $('ins-inner').innerHTML=
    '<div class="kpi-grid" style="margin-bottom:12px;">'+
      '<div class="kpi green"><div class="kpi-lbl">Total spent</div><div class="kpi-val">$'+fmt(spend)+'</div><div class="kpi-sub">excl. cancelled</div></div>'+
      '<div class="kpi amber"><div class="kpi-lbl">Avg order</div><div class="kpi-val">$'+fmt(avg)+'</div><div class="kpi-sub">per order</div></div>'+
      '<div class="kpi purple"><div class="kpi-lbl">Delivery rate</div><div class="kpi-val">'+dlRate+'%</div><div class="kpi-sub">orders delivered</div></div>'+
      '<div class="kpi red"><div class="kpi-lbl">Cancelled $</div><div class="kpi-val">$'+fmt(cxSpend)+'</div><div class="kpi-sub">lost value</div></div>'+
    '</div>'+
    (active.length?'<div class="insights-grid">'+widgetsHtml+'</div>':'<div class="empty-s"><i class="ti ti-layout-grid-add"></i><p>No widgets added</p><p style="font-size:13px;color:var(--txt3);margin-top:6px;">Click <b>Add widget</b> above to add charts.</p></div>');

  const hasCharts=active.some(id=>INSIGHT_WIDGETS[id].after);
  if(!hasCharts)return;
  try{ await loadChartJs(); }catch(e){ console.error('Chart.js failed to load',e); return; }
  setTimeout(()=>{
    charts.forEach(c=>{try{c.destroy();}catch(_){}});charts=[];
    active.forEach(id=>{try{if(INSIGHT_WIDGETS[id].after)INSIGHT_WIDGETS[id].after(ctx);}catch(e){console.error('widget chart-init error',id,e);}});
  },100);
}

// ── ADD MODAL ─────────────────────────────────────────────────────
let editingOrderId=null;
function openM(id=null){
  const existing=id!=null?orders.find(o=>String(o.id)===String(id)):null;
  editingOrderId=existing?existing.id:null;
  $('order-modal-title').textContent=existing?'Edit order':'Add order';
  $('order-modal-save').textContent=existing?'Save changes':'Add order';
  $('mn').value=existing?existing.name||'':'';
  $('ms').value=existing?existing.store||'':'';
  $('mp').value=existing&&existing.price?money(existing.price):'';
  $('md').value=existing?existing.date||new Date().toISOString().slice(0,10):new Date().toISOString().slice(0,10);
  $('mo').value=existing?existing.orderNum||'':'';
  $('mt').value=existing?existing.tracking||'':'';
  $('med').value=existing?existing.expectedDelivery||'':'';
  $('mst').value=existing?existing.status||'ordered':'ordered';
  $('dup-warn').style.display='none';
  document.querySelectorAll('.cchip').forEach(el=>el.classList.remove('sel'));
  selCat=(existing&&CATS[existing.cat])?existing.cat:'other';
  document.querySelector('[data-c="'+selCat+'"]').classList.add('sel');
  $('mwrap').classList.add('open');
}
function closeM(){$('mwrap').classList.remove('open');editingOrderId=null;}
function pc(el){document.querySelectorAll('.cchip').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');selCat=el.dataset.c;}
// Same carrier-detection rules server.js uses for email-synced orders — kept here too
// so a manually-typed tracking number gets a real clickable link, not just stored text.
function detectCarrierClient(tracking){
  if(!tracking) return null;
  const t=encodeURIComponent(tracking);
  if(/^1Z[A-Z0-9]{16}$/.test(tracking)) return {name:'UPS',url:'https://www.ups.com/track?tracknum='+t};
  if(/^9[2-4]\d{20}$/.test(tracking)||/^\d{22}$/.test(tracking)) return {name:'USPS',url:'https://tools.usps.com/go/TrackConfirmAction?tLabels='+t};
  if(/^\d{12,15}$/.test(tracking)) return {name:'FedEx',url:'https://www.fedex.com/apps/fedextrack/?tracknumbers='+t};
  if(/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tracking)) return {name:'DHL',url:'https://www.dhl.com/en/express/tracking.html?AWB='+t};
  return {name:'Track',url:'https://parcelsapp.com/en/tracking/'+t};
}
function saveO(){
  const name=$('mn').value.trim();if(!name){showToast('Enter an item name','warn');return;}
  const tracking=$('mt').value.trim();
  const carrierInfo=detectCarrierClient(tracking);
  const data={name,store:$('ms').value.trim()||'Unknown',price:parseFloat($('mp').value.replace(/[^0-9.]/g,''))||0,date:$('md').value,status:$('mst').value,cat:selCat,orderNum:$('mo').value.trim(),tracking,expectedDelivery:$('med').value,carrier:carrierInfo?carrierInfo.name:'',trackingUrl:carrierInfo?carrierInfo.url:''};
  if(editingOrderId!=null){
    const o=orders.find(x=>String(x.id)===String(editingOrderId));
    if(!o){showToast('Order not found','error');closeM();return;}
    const oldStatus=o.status;
    Object.assign(o,data);
    if(oldStatus!==data.status){
      o.history=Array.isArray(o.history)?o.history:[];
      o.history.push({status:data.status,date:data.date||todayISO()});
    }
    save();closeM();rOrders();rStats();showToast('Order updated');
    return;
  }
  const o={id:nid++,...data,emailHtml:'',emailText:'',notes:'',archived:false,history:[{status:data.status,date:data.date||todayISO()}]};
  if(settings['dup']&&isDuplicate(o)){if(!confirm('This looks like a duplicate. Add anyway?'))return;}
  orders.push(o);save();closeM();rOrders();rStats();showToast('Order added');
}

// ── CHECKOUT CARD GENERATOR ─────────────────────────────────────────
// Aurora-native themes — a low-alpha accent wash over the app's own deep
// indigo-black base, never a loud saturated gradient. Accent drives the
// hero number, sparkline, glow and badge. Violet is the true "this app"
// default; the other three exist for contrast against real order-status
// colors when someone wants the card to pop differently.
const CARD_THEMES=[
  {accent:'#7c5cff'},
  {accent:'#6eb3f7'},
  {accent:'#3DDC84'},
  {accent:'#E8E8EA'},
];
let cardBgMode='gradient', cardBgIndex=0, cardBgImage=null;

function computeCardStats(){
  const spend=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
  const deliveredWithEta=orders.filter(o=>o.status==='delivered'&&o.expectedDelivery);
  let onTimePct=null;
  if(deliveredWithEta.length){
    const onTime=deliveredWithEta.filter(o=>{
      const actualDate=(o.history&&o.history.length)?o.history[o.history.length-1].date:o.date;
      return actualDate&&new Date(actualDate+'T00:00:00')<=new Date(o.expectedDelivery+'T00:00:00');
    }).length;
    onTimePct=Math.round((onTime/deliveredWithEta.length)*100);
  }
  const storeCounts={};
  orders.forEach(o=>{ if(o.store) storeCounts[o.store]=(storeCounts[o.store]||0)+1; });
  let topStore='—', topCount=0;
  Object.entries(storeCounts).forEach(([s,c])=>{ if(c>topCount){topStore=s;topCount=c;} });
  const topStoresList=Object.entries(storeCounts).sort((a,b)=>b[1]-a[1]).slice(0,3);

  // Rolling month-over-month spend trend — never hardcoded, and never shown
  // unless there's a real prior-month baseline to compare against.
  // (monthSpend is defined once, near the sidebar stats code above.)
  const now=new Date();
  const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
  const thisMonth=monthSpend(now.getMonth(),now.getFullYear());
  const prevMonth=monthSpend(prev.getMonth(),prev.getFullYear());
  const trendPct=prevMonth>0?Math.round(((thisMonth-prevMonth)/prevMonth)*100):null;

  // Same rolling 6-month window the Dashboard's hero sparkline uses, so the
  // checkout card's mini trend line is built from real monthly totals too.
  const monthlyTrend=[];
  for(let i=5;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    monthlyTrend.push(monthSpend(d.getMonth(),d.getFullYear()));
  }

  const dated=orders.filter(o=>o.date&&o.status!=='cancelled').sort((a,b)=>a.date<b.date?-1:1);
  const trackingSince=dated.length?new Date(dated[0].date+'T00:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'}):null;

  return { spend, total:orders.length, onTimePct, topStore, topCount, topStoresList, trendPct, trackingSince, monthlyTrend };
}
// A tier based only on the user's own order count — never a comparison to
// other real users, since we don't have that data.
function getCardTier(total){
  if(total>=25) return 'ELITE COLLECTOR';
  if(total>=10) return 'TOP COLLECTOR';
  if(total>=3)  return 'ACTIVE COLLECTOR';
  return 'NEW COLLECTOR';
}

function openCheckoutCard(){
  $('card-wrap').classList.add('open');
  renderCheckoutCard();
}
function closeCheckoutCard(){ $('card-wrap').classList.remove('open'); }

function setCardBg(idx, el){
  cardBgMode='gradient'; cardBgIndex=idx; cardBgImage=null;
  document.querySelectorAll('.card-bg-swatch').forEach(s=>s.classList.remove('sel'));
  if(el) el.classList.add('sel');
  renderCheckoutCard();
}
function onCardImageUpload(event){
  const file=event.target.files&&event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{ cardBgMode='image'; cardBgImage=img; document.querySelectorAll('.card-bg-swatch').forEach(s=>s.classList.remove('sel')); renderCheckoutCard(); };
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}

let _cardNoiseCanvas=null;
function getCardNoisePattern(ctx){
  if(!_cardNoiseCanvas){
    _cardNoiseCanvas=document.createElement('canvas');
    _cardNoiseCanvas.width=96; _cardNoiseCanvas.height=96;
    const nctx=_cardNoiseCanvas.getContext('2d');
    const img=nctx.createImageData(96,96);
    for(let i=0;i<img.data.length;i+=4){
      const v=Math.random()*255;
      img.data[i]=v; img.data[i+1]=v; img.data[i+2]=v; img.data[i+3]=Math.random()*12;
    }
    nctx.putImageData(img,0,0);
  }
  return ctx.createPattern(_cardNoiseCanvas,'repeat');
}
// Small hand-drawn line icons (package / check / storefront) so the card
// never depends on a webfont being loaded at render time.
function drawCardIcon(ctx,type,cx,cy,size,color){
  ctx.save();
  ctx.strokeStyle=color; ctx.fillStyle=color;
  ctx.lineWidth=1.6; ctx.lineJoin='round'; ctx.lineCap='round';
  const s=size/2;
  if(type==='package'){
    ctx.beginPath(); ctx.moveTo(cx-s,cy-s*0.55); ctx.lineTo(cx,cy-s); ctx.lineTo(cx+s,cy-s*0.55); ctx.lineTo(cx+s,cy+s*0.55); ctx.lineTo(cx,cy+s); ctx.lineTo(cx-s,cy+s*0.55); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s,cy-s*0.55); ctx.lineTo(cx,cy-s*0.1); ctx.lineTo(cx+s,cy-s*0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy-s*0.1); ctx.lineTo(cx,cy+s); ctx.stroke();
  } else if(type==='check'){
    ctx.beginPath(); ctx.arc(cx,cy,s,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s*0.45,cy); ctx.lineTo(cx-s*0.1,cy+s*0.4); ctx.lineTo(cx+s*0.5,cy-s*0.4); ctx.stroke();
  } else if(type==='store'){
    ctx.beginPath(); ctx.moveTo(cx-s,cy-s*0.2); ctx.lineTo(cx-s*0.7,cy-s*0.9); ctx.lineTo(cx+s*0.7,cy-s*0.9); ctx.lineTo(cx+s,cy-s*0.2); ctx.stroke();
    ctx.strokeRect(cx-s*0.75,cy-s*0.2,s*1.5,s*1.4);
    ctx.beginPath(); ctx.moveTo(cx-s*0.22,cy+s*1.2); ctx.lineTo(cx-s*0.22,cy+s*0.3); ctx.lineTo(cx+s*0.22,cy+s*0.3); ctx.lineTo(cx+s*0.22,cy+s*1.2); ctx.stroke();
  }
  ctx.restore();
}
// Barcode-style divider — a tasteful nod to shipping labels, quiet enough
// to read as texture rather than a literal barcode.
function drawBarcodeDivider(ctx,cx,cy,totalW){
  ctx.save();
  ctx.fillStyle='rgba(255,255,255,0.10)';
  let x=cx-totalW/2;
  while(x<cx+totalW/2){
    const w=Math.random()<0.3?2:1;
    const h=6+Math.random()*10;
    ctx.fillRect(x,cy-h/2,w,h);
    x+=w+3;
  }
  ctx.restore();
}
function renderCheckoutCard(){
  const canvas=$('card-canvas'); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const accent=(cardBgMode==='image')?'#7c5cff':CARD_THEMES[cardBgIndex].accent;
  const BASE='#0a0a17', PANEL='#1b1d38', BORDER='rgba(255,255,255,0.08)', TXT2='rgba(255,255,255,0.65)';

  ctx.save();
  roundRect(ctx,0,0,W,H,22); ctx.clip();

  // Background — near-black base, optional photo, then a very soft accent wash
  ctx.fillStyle=BASE; ctx.fillRect(0,0,W,H);
  if(cardBgMode==='image'&&cardBgImage){
    const img=cardBgImage;
    const scale=Math.max(W/img.width,H/img.height);
    const dw=img.width*scale, dh=img.height*scale;
    ctx.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle='rgba(18,18,20,0.78)';
    ctx.fillRect(0,0,W,H);
  } else {
    const wash=ctx.createRadialGradient(W*0.28,110,10,W*0.28,110,560);
    wash.addColorStop(0,hexToRgba(accent,0.14));
    wash.addColorStop(1,hexToRgba(accent,0));
    ctx.fillStyle=wash; ctx.fillRect(0,0,W,H);
  }

  // Faint shipping-route arc — barely visible, reads as texture not content
  ctx.save();
  ctx.strokeStyle=hexToRgba(accent,0.16); ctx.lineWidth=1; ctx.setLineDash([3,6]);
  ctx.beginPath(); ctx.moveTo(-40,H+60); ctx.quadraticCurveTo(W*0.5,-40,W+40,H*0.4); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle=hexToRgba(accent,0.3);
  ctx.beginPath(); ctx.arc(70,H-30,2.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(W-70,H*0.36,2.5,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // Very faint dot grid for depth
  ctx.fillStyle='rgba(255,255,255,0.03)';
  for(let x=20;x<W;x+=28){ for(let y=20;y<H;y+=28){ ctx.beginPath(); ctx.arc(x,y,1,0,Math.PI*2); ctx.fill(); } }

  // Grain
  ctx.fillStyle=getCardNoisePattern(ctx); ctx.fillRect(0,0,W,H);

  ctx.textBaseline='top';

  // Logo, top-left — plain lockup, no chip
  ctx.fillStyle='#ffffff';
  ctx.font='700 17px Inter, sans-serif';
  ctx.fillText('Shipment', 48, 46);
  const smW=ctx.measureText('Shipment').width;
  ctx.fillStyle=accent;
  ctx.fillText('Scope', 48+smW, 46);

  // Status badge, top-right
  const stats=computeCardStats();
  const tierText=getCardTier(stats.total);
  ctx.font='700 11px Inter, sans-serif';
  ctx.textAlign='left';
  const tierW=ctx.measureText(tierText).width+40;
  const badgeX=W-48-tierW, badgeY=32, badgeH=28;
  ctx.fillStyle='rgba(255,255,255,0.05)';
  roundRect(ctx,badgeX,badgeY,tierW,badgeH,14); ctx.fill();
  ctx.strokeStyle=BORDER; ctx.lineWidth=1;
  roundRect(ctx,badgeX,badgeY,tierW,badgeH,14); ctx.stroke();
  ctx.save();
  ctx.shadowColor=hexToRgba('#3DDC84',0.9); ctx.shadowBlur=6;
  ctx.fillStyle='#3DDC84';
  ctx.beginPath(); ctx.arc(badgeX+16,badgeY+badgeH/2,3,0,Math.PI*2); ctx.fill();
  ctx.restore();
  ctx.fillStyle=TXT2;
  ctx.fillText(tierText, badgeX+28, badgeY+9);

  // HERO number
  ctx.textAlign='center';
  ctx.fillStyle=TXT2;
  ctx.font='600 12px Inter, sans-serif';
  ctx.fillText('T O T A L   S P E N T   T R A C K E D', W/2, 148);

  // Soft radial glow + tiny floating particles behind the number
  const glow=ctx.createRadialGradient(W/2,235,10,W/2,235,300);
  glow.addColorStop(0,hexToRgba(accent,0.16));
  glow.addColorStop(1,hexToRgba(accent,0));
  ctx.fillStyle=glow; ctx.fillRect(0,120,W,260);
  ctx.fillStyle=hexToRgba(accent,0.4);
  for(let i=0;i<12;i++){
    const px=W/2+(Math.random()-0.5)*440, py=170+Math.random()*140, pr=0.6+Math.random()*1.1;
    ctx.beginPath(); ctx.arc(px,py,pr,0,Math.PI*2); ctx.fill();
  }

  // Hand-drawn 6-month spend sparkline, low-opacity behind the hero number —
  // pure canvas path drawing (no Chart.js) since this card must render even
  // if Insights was never opened. Real monthly totals, not fabricated data.
  if(stats.monthlyTrend&&stats.monthlyTrend.some(v=>v>0)){
    const sx=64, sw=W-128, sy=200, sh=100, n=stats.monthlyTrend.length;
    const maxV=Math.max(1,...stats.monthlyTrend);
    const pts=stats.monthlyTrend.map((v,i)=>[sx+i*(sw/(n-1)),sy+sh*(1-v/maxV)]);
    ctx.save();
    ctx.globalAlpha=0.32;
    ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.lineTo(pts[pts.length-1][0],sy+sh);
    ctx.lineTo(pts[0][0],sy+sh);
    ctx.closePath();
    const sparkFill=ctx.createLinearGradient(0,sy,0,sy+sh);
    sparkFill.addColorStop(0,hexToRgba(accent,0.35));
    sparkFill.addColorStop(1,hexToRgba(accent,0));
    ctx.fillStyle=sparkFill; ctx.fill();
    ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.strokeStyle=accent; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor=hexToRgba(accent,0.4);
  ctx.shadowBlur=28;
  const heroGrad=ctx.createLinearGradient(0,172,0,300);
  heroGrad.addColorStop(0,shadeHex(accent,0.55));
  heroGrad.addColorStop(0.45,accent);
  heroGrad.addColorStop(1,shadeHex(accent,-0.35));
  ctx.fillStyle=heroGrad;
  ctx.font='900 106px Inter, sans-serif';
  ctx.fillText('$'+Math.round(stats.spend).toLocaleString(), W/2, 176);
  ctx.restore();

  // Trend line — only shown when there's a real prior-month baseline
  ctx.textAlign='left';
  ctx.font='600 14px Inter, sans-serif';
  if(stats.trendPct!==null){
    const up=stats.trendPct>=0;
    const label=(up?'+':'')+stats.trendPct+'% this month';
    const col=up?'#3DDC84':TXT2;
    const tw=ctx.measureText(label).width;
    ctx.fillStyle=col;
    ctx.beginPath();
    if(up){ ctx.moveTo(W/2-tw/2-16,306); ctx.lineTo(W/2-tw/2-10,296); ctx.lineTo(W/2-tw/2-4,306); }
    else { ctx.moveTo(W/2-tw/2-16,296); ctx.lineTo(W/2-tw/2-10,306); ctx.lineTo(W/2-tw/2-4,296); }
    ctx.closePath(); ctx.fill();
    ctx.fillText(label, W/2-tw/2+2, 296);
  } else if(stats.trackingSince){
    ctx.fillStyle=TXT2;
    const label='Tracking since '+stats.trackingSince;
    const tw=ctx.measureText(label).width;
    ctx.fillText(label, W/2-tw/2, 296);
  }

  // Compact "top stores" strip — real tally, small pills between the trend
  // line and the divider.
  if(stats.topStoresList&&stats.topStoresList.length){
    ctx.font='700 10.5px Inter, sans-serif';
    const pillH=22,pillGap=10,padX=12;
    const parts=stats.topStoresList.map(([name])=>{
      const label=name.length>14?name.slice(0,13)+'…':name;
      return {label,w:ctx.measureText(label).width+padX*2+18};
    });
    const totalW=parts.reduce((s,p)=>s+p.w,0)+pillGap*(parts.length-1);
    let px=W/2-totalW/2;
    const py=314;
    parts.forEach(p=>{
      ctx.fillStyle='rgba(255,255,255,0.05)';
      roundRect(ctx,px,py,p.w,pillH,pillH/2); ctx.fill();
      ctx.strokeStyle=BORDER; ctx.lineWidth=1;
      roundRect(ctx,px,py,p.w,pillH,pillH/2); ctx.stroke();
      drawCardIcon(ctx,'store',px+16,py+pillH/2,9,accent);
      ctx.fillStyle=TXT2; ctx.textAlign='left';
      ctx.fillText(p.label,px+26,py+6);
      px+=p.w+pillGap;
    });
  }

  drawBarcodeDivider(ctx,W/2,340,160);

  // Bottom row — three equal stat cards
  const cards=[
    {icon:'package',label:'ORDERS',val:String(stats.total),sub:'All time'},
    {icon:'check',label:'DELIVERY RATE',val:stats.onTimePct!=null?stats.onTimePct+'%':'—',sub:stats.onTimePct===100?'Perfect record':'On-time record'},
    {icon:'store',label:'FAVORITE STORE',val:stats.topStore.length>14?stats.topStore.slice(0,13)+'…':stats.topStore,sub:stats.topCount?stats.topCount+' order'+(stats.topCount===1?'':'s')+' placed':'—'},
  ];
  const gap=20, cardW=(W-96-gap*2)/3, cardH=110, cardY=368;
  ctx.textAlign='left';
  cards.forEach((c,i)=>{
    const x=48+i*(cardW+gap);
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,0.35)'; ctx.shadowBlur=16; ctx.shadowOffsetY=6;
    ctx.fillStyle=PANEL;
    roundRect(ctx,x,cardY,cardW,cardH,14); ctx.fill();
    ctx.restore();
    const sheen=ctx.createLinearGradient(0,cardY,0,cardY+cardH);
    sheen.addColorStop(0,'rgba(255,255,255,0.04)'); sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen; roundRect(ctx,x,cardY,cardW,cardH,14); ctx.fill();
    ctx.strokeStyle=BORDER; ctx.lineWidth=1;
    roundRect(ctx,x,cardY,cardW,cardH,14); ctx.stroke();

    drawCardIcon(ctx,c.icon,x+26,cardY+30,16,accent);
    ctx.font='700 10.5px Inter, sans-serif';
    ctx.fillStyle=TXT2;
    ctx.fillText(c.label, x+22, cardY+54);
    ctx.font='800 23px Inter, sans-serif';
    ctx.fillStyle='#ffffff';
    ctx.fillText(c.val, x+22, cardY+72);
    ctx.font='500 10.5px Inter, sans-serif';
    ctx.fillStyle=TXT2;
    ctx.fillText(c.sub, x+22, cardY+98);
  });

  // Footer
  ctx.strokeStyle=BORDER; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(48,H-56); ctx.lineTo(W-48,H-56); ctx.stroke();
  let wx=48;
  ctx.fillStyle=hexToRgba(accent,0.55);
  [5,9,4,11,6].forEach(h=>{ ctx.fillRect(wx,H-36-h/2,1.6,h); wx+=5; });
  ctx.fillStyle=TXT2;
  ctx.font='500 12px Inter, sans-serif';
  ctx.fillText('Tracked with ShipmentScope  ·  '+new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})+'  ·  shipmentscope.app', wx+10, H-40);

  ctx.strokeStyle=BORDER; ctx.lineWidth=1;
  roundRect(ctx,0.5,0.5,W-1,H-1,22); ctx.stroke();
  ctx.restore();
}
function hexToRgba(hex,alpha){
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}
// Lighten (percent>0) or darken (percent<0) a hex color toward white/black —
// used for the hero-number gradient stops so they follow whichever accent
// theme is selected, instead of a hardcoded gold-only gradient.
function shadeHex(hex,percent){
  const n=parseInt(hex.replace('#',''),16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  if(percent>0){r+=(255-r)*percent;g+=(255-g)*percent;b+=(255-b)*percent;}
  else{r*=(1+percent);g*=(1+percent);b*=(1+percent);}
  return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function downloadCheckoutCard(){
  const canvas=$('card-canvas'); if(!canvas) return;
  const a=document.createElement('a');
  a.download='shipmentscope-checkout-card.png';
  a.href=canvas.toDataURL('image/png');
  a.click();
  showToast('Card downloaded');
}

// ── SETTINGS ─────────────────────────────────────────────────────
function openSettings(){
  $('sm-account-email').textContent=currentUserEmail||'—';
  $('sm-order-count').textContent=orders.length+' orders';
  const budget=localStorage.getItem('po_budget')||'';
  $('monthly-budget').value=budget;
  // Sync toggles with settings
  Object.keys(settings).forEach(k=>{const t=$('tog-'+k);if(t)t.className='toggle'+(settings[k]?' on':'');});
  renderAccentSwatches();
  setDensityControl(localStorage.getItem('ss_density')||'comfortable');
  $('default-tab').value=localStorage.getItem('ss_defaultTab')||'dashboard';
  $('default-sort').value=localStorage.getItem('ss_defaultSort')||'date-desc';
  $('poll-interval').value=localStorage.getItem('ss_pollInterval')||'5';
  $('scan-days').value=localStorage.getItem('ss_scanDays')||'30';
  $('settings-overlay').classList.add('open');
}
function closeSettings(){
  // Save budget
  const b=$('monthly-budget').value;
  if(b)localStorage.setItem('po_budget',b);
  $('settings-overlay').classList.remove('open');
}
function toggleSetting(key){
  settings[key]=!settings[key];saveSettings();
  const t=$('tog-'+key);if(t)t.className='toggle'+(settings[key]?' on':'');
}

// ── DESKTOP NOTIFICATIONS ──────────────────────────────────────────
function toggleDesktopNotifications(){
  if(!('Notification' in window)){showToast('Desktop notifications aren\'t supported in this browser','warn');return;}
  if(!settings['desktop']){
    Notification.requestPermission().then(perm=>{
      if(perm==='granted'){
        settings['desktop']=true;saveSettings();
        $('tog-desktop').className='toggle on';
        notifyDesktop('ShipmentScope alerts are on','You will get updates when synced orders change.',{tag:'shipment-alerts-on'});
      }else{
        showToast('Notification permission was denied in your browser','warn');
      }
    });
  }else{
    settings['desktop']=false;saveSettings();
    $('tog-desktop').className='toggle';
  }
}
function notifyDesktop(title,body,opts={}){
  if(!settings['desktop']||!('Notification' in window)||Notification.permission!=='granted')return;
  try{
    new Notification(title,{
      body,
      icon:'/assets/favicon.png',
      badge:'/assets/favicon.png',
      tag:opts.tag||'shipmentscope-order-update',
      renotify:true,
    });
  }catch(_){}
}
function sendTestNotification(){
  if(!('Notification' in window)){showToast('Desktop notifications are not supported here','warn');return;}
  const fire=()=>notifyDesktop('ShipmentScope test alert','Notifications are working on this browser.',{tag:'shipment-test'});
  if(Notification.permission==='granted'){
    settings['desktop']=true;saveSettings();
    const t=$('tog-desktop');if(t)t.className='toggle on';
    fire();showToast('Test notification sent');
    return;
  }
  Notification.requestPermission().then(perm=>{
    if(perm==='granted'){
      settings['desktop']=true;saveSettings();
      const t=$('tog-desktop');if(t)t.className='toggle on';
      fire();showToast('Desktop notifications enabled');
    }else showToast('Notification permission was denied in your browser','warn');
  });
}
function notificationCopyForOrders(items){
  const counts={ordered:0,preorder:0,shipped:0,delivered:0,cancelled:0};
  items.forEach(o=>{if(counts[o.status]!=null)counts[o.status]++;});
  if(counts.cancelled)return ['Order cancelled',counts.cancelled+' order'+(counts.cancelled>1?'s were':' was')+' cancelled'];
  if(counts.delivered)return ['Order delivered',counts.delivered+' order'+(counts.delivered>1?'s were':' was')+' delivered'];
  if(counts.shipped)return ['Order shipped',counts.shipped+' order'+(counts.shipped>1?'s are':' is')+' on the way'];
  if(counts.preorder)return ['Pre-order update',counts.preorder+' pre-order'+(counts.preorder>1?'s':'')+' updated'];
  return ['New order update',items.length+' order'+(items.length>1?'s':'')+' updated in ShipmentScope'];
}

// ── APPEARANCE: accent color ──────────────────────────────────────
// Each swatch drives a single-hue gradient (deep -> core -> light), not just
// a flat color, so the "Aurora" gradient system (logo, buttons, active nav,
// headline/stat text — see --grad-brand in styles.css) stays one consistent
// hue no matter which accent the user picks, instead of clashing like a
// flat two-tone swap would.
const ACCENT_COLORS=[{name:'Iris',hex:'#7c5cff'},{name:'Ember',hex:'#e46d4c'},{name:'Azure',hex:'#3b82f6'},{name:'Mint',hex:'#269684'}];
function shadeHex(hex,percent){
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16),g=parseInt(h.substring(2,4),16),b=parseInt(h.substring(4,6),16);
  const mix=(c)=>Math.round(percent<0?c*(1+percent):c+(255-c)*percent);
  return '#'+[mix(r),mix(g),mix(b)].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
function applyAccent(hex){
  document.documentElement.style.setProperty('--accent',hex);
  document.documentElement.style.setProperty('--accent-d',hexToRgba(hex,0.13));
  document.documentElement.style.setProperty('--accent-1',shadeHex(hex,-0.35));
  document.documentElement.style.setProperty('--accent-3',shadeHex(hex,0.4));
}
function setAccent(hex){applyAccent(hex);localStorage.setItem('ss_accent',hex);renderAccentSwatches();}
function renderAccentSwatches(){
  const cur=localStorage.getItem('ss_accent')||'#7c5cff';
  const el=$('accent-swatches');if(!el)return;
  el.innerHTML=ACCENT_COLORS.map(c=>'<div class="accent-sw'+(c.hex===cur?' sel':'')+'" style="background:'+c.hex+';" onclick="setAccent(\''+c.hex+'\')" title="'+c.name+'"></div>').join('');
}

// ── APPEARANCE: card density ──────────────────────────────────────
function setDensity(v){
  document.body.classList.toggle('density-compact',v==='compact');
  localStorage.setItem('ss_density',v);
  setDensityControl(v);
}
function setDensityControl(v){
  document.body.classList.toggle('density-compact',v==='compact');
  const el=$('density-control');if(el)[...el.children].forEach(b=>b.classList.toggle('sel',b.dataset.v===v));
}

// ── DEFAULTS: landing tab + sort ──────────────────────────────────
function setDefaultTab(v){localStorage.setItem('ss_defaultTab',v);}
function setDefaultSort(v){
  localStorage.setItem('ss_defaultSort',v);
  const sel=$('sort-sel');if(sel){sel.value=v;safeRun(rOrders);}
}

// ── AUTO-SYNC: real poll interval + configurable scan window ──────
function setPollInterval(mins){
  const m=Math.min(60,Math.max(1,parseInt(mins)||5));
  localStorage.setItem('ss_pollInterval',m);
  $('poll-interval').value=m;
  restartPollTimer();
  safeRun(updateScanMeta);
  showToast('Now checking every '+m+' minute'+(m!==1?'s':''));
}
function restartPollTimer(){
  if(pollTimerId)clearInterval(pollTimerId);
  const m=parseInt(localStorage.getItem('ss_pollInterval'))||5;
  pollTimerId=setInterval(pollNewOrders,m*60*1000);
}
function setScanDays(days){
  const d=Math.min(180,Math.max(1,parseInt(days)||30));
  localStorage.setItem('ss_scanDays',d);
  $('scan-days').value=d;
  safeRun(updateScanMeta);
}
function clearAll(){if(!confirm('Delete ALL '+orders.length+' orders? This cannot be undone.'))return;orders=[];save();rOrders();rStats();closeSettings();showToast('All orders cleared','warn');}

// ── FULL BACKUP / RESTORE (JSON, includes notes/emails/timeline) ──
function downloadBackup(){
  if(!orders.length){showToast('No orders to back up yet','warn');return;}
  const blob=new Blob([JSON.stringify({app:'ShipmentScope',version:3,exportedAt:new Date().toISOString(),orders},null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='shipmentscope-backup-'+todayISO()+'.json';
  document.body.appendChild(a);a.click();a.remove();
  showToast('Backup downloaded — '+orders.length+' orders');
}
function restoreBackup(evt){
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      const incoming=Array.isArray(data)?data:data.orders;
      if(!Array.isArray(incoming))throw new Error('Not a valid ShipmentScope backup file');
      let added=0,updated=0;
      incoming.forEach(d=>{ upsertOrder(d)==='updated'?updated++:added++; });
      save();safeRun(rOrders);safeRun(rStats);
      showToast('Restored: '+added+' added'+(updated?', '+updated+' merged':''));
    }catch(e){showToast('Could not read that file: '+e.message,'error');}
    evt.target.value='';
  };
  reader.readAsText(file);
}
function archiveOldDelivered(){
  const before=orders.length;
  pruneDeliveredOrders();
  const n=before-orders.length;
  if(!n){showToast('No delivered orders older than 4 days','warn');return;}
  save();safeRun(rOrders);safeRun(rStats);
  showToast(n+' delivered order'+(n>1?'s':'')+' deleted');
}

// ── SERVER ────────────────────────────────────────────────────────
function updateBadge(online){
  serverOnline=online;const b=$('srv-badge');
  if(online){b.style.cssText='position:fixed;bottom:16px;right:16px;z-index:999;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;border:1px solid;background:rgba(61,214,140,0.12);border-color:rgba(61,214,140,0.3);color:#3dd68c;';b.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:#3dd68c;display:inline-block;animation:blink 2s infinite;"></span> Sync online';}
  else{b.style.cssText='position:fixed;bottom:16px;right:16px;z-index:999;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;border:1px solid;background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.08);color:#7878a0;';b.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:#7878a0;display:inline-block;"></span> Server offline';}
}
async function checkServer(){try{await fetch(API+'/health',{signal:AbortSignal.timeout(2000)});updateBadge(true);}catch{updateBadge(false);}}
async function pollNewOrders(){
  if(!serverOnline||!settings['autopoll'])return;
  try{
    const res=await fetch(API+'/api/poll');const data=await res.json();
    if(data.ok&&data.orders?.length){
      let count=0;
      const applied=[];
      data.orders.forEach(d=>{
        if(isDuplicate(d))return;
        upsertOrder(d); // merges into an existing order (e.g. a shipped update) instead of always adding a new card
        count++;
        applied.push(d);
      });
      if(count>0){
        save();rOrders();rStats();
        if(settings['new-order'])showToast(''+count+' new order'+(count>1?'s':'')+' arrived!');
        const note=notificationCopyForOrders(applied);
        if(note[0]!=='Order cancelled'||settings['cancel'])notifyDesktop(note[0],note[1]);
      }
    }
  }catch(_){}
}

// ── INIT ──────────────────────────────────────────────────────────
// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────
// "⌘K"/"Ctrl+K" or "/" focuses global search, "n" opens Add order, "Esc" closes any open modal.
// Bare-letter shortcuts are disabled while typing in a field; ⌘K always works (standard convention).
document.addEventListener('keydown',(e)=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette();return;}
  if(e.key==='Escape'){closeCommandPalette();closeM();closeSettings();closeEmail();closeDetail();return;}
  const tag=(document.activeElement||{}).tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(e.key==='/'){e.preventDefault();openCommandPalette();}
  else if(e.key.toLowerCase()==='n'){e.preventDefault();openM();}
});
function focusGlobalSearch(){sw('orders');const s=$('srch');if(s){s.focus();s.select();}}

// ── ACCESSIBILITY: keyboard support for onclick-only divs ──────────
// Most interactive elements here are <div onclick="..."> (order cards,
// filter chips, category picker, accent swatches) rather than <button> —
// rewriting every one to a semantic element is a much bigger change than
// this pass warrants. This retrofits real keyboard equivalence (Tab focus
// + Enter/Space activation) without touching each render function: a
// MutationObserver re-tags anything new as it's rendered. Modal/backdrop
// overlays are excluded — those close-on-click-outside, they aren't
// "buttons" a keyboard user should tab onto.
function enhanceClickableDivs(root){
  (root||document).querySelectorAll('div[onclick]:not([data-a11y]):not(.modal-overlay):not(.sidebar-backdrop)').forEach(el=>{
    el.setAttribute('data-a11y','1');
    if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role'))el.setAttribute('role','button');
  });
}
document.addEventListener('keydown',(e)=>{
  if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches&&e.target.matches('div[onclick][role="button"]')){
    e.preventDefault();e.target.click();
  }
});
enhanceClickableDivs();
new MutationObserver(muts=>{
  for(const m of muts){ if(m.addedNodes&&m.addedNodes.length){ enhanceClickableDivs(); break; } }
}).observe(document.body,{childList:true,subtree:true});

// ── SCROLL-REVEAL for the landing page ──────────────────────────────
// Sections below the hero start hidden (.reveal, opacity:0) and fade+
// slide in once actually scrolled into view, instead of all animating
// at once on page load while off-screen. Fires once per element, then
// stops observing it (a landing page doesn't need to re-animate on
// scroll-up). Reduced-motion users already get near-zero transition
// duration from the global prefers-reduced-motion rule, so no separate
// handling is needed here.
const revealObserver=new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));

// ── ROTATING HERO HEADLINE — cycles a few original phrases, all about
// what ShipmentScope actually tracks (orders/shipments/spend/stores),
// with a crossfade+slide swap. Same "text rotator" mechanic as other
// modern SaaS heroes, own copy throughout.
const HEADLINES=[
  'Track every order.<br>Every store. Automatically.',
  'Every shipment, tracked.<br>Every dollar, accounted for.',
  'From checkout to doorstep —<br>watched automatically.',
  'One inbox in.<br>One dashboard out.',
  'Every store you shop.<br>One place to watch it all.'
];
let _headlineIdx=0;
function rotateHeadline(){
  const el=$('headline-rotate');
  if(!el)return;
  el.classList.add('headline-out');
  setTimeout(()=>{
    _headlineIdx=(_headlineIdx+1)%HEADLINES.length;
    el.innerHTML=HEADLINES[_headlineIdx];
    el.classList.remove('headline-out');
    el.classList.add('headline-in');
    void el.offsetWidth; // flush layout so the "in" start state paints before we transition out of it
    requestAnimationFrame(()=>el.classList.remove('headline-in'));
  },400);
}
setInterval(rotateHeadline,4200);

// ── COMMAND PALETTE (⌘K) ─────────────────────────────────────────
const CMDK_PAGES=[
  {name:'Dashboard',icon:'ti-layout-dashboard',action:()=>sw('dashboard')},
  {name:'Orders',icon:'ti-package',action:()=>sw('orders')},
  {name:'Inventory',icon:'ti-building-warehouse',action:()=>sw('inventory')},
  {name:'Tracking',icon:'ti-truck',action:()=>sw('tracking')},
  {name:'Emails',icon:'ti-mail',action:()=>sw('emails')},
  {name:'Calendar',icon:'ti-calendar',action:()=>sw('calendar')},
  {name:'Sync',icon:'ti-refresh',action:()=>sw('sync')},
  {name:'Insights',icon:'ti-chart-bar',action:()=>sw('insights')},
  {name:'Add order',icon:'ti-plus',action:()=>openM()},
  {name:'Add inventory item',icon:'ti-plus',action:()=>openInvModal()},
  {name:'Create checkout card',icon:'ti-photo',action:()=>openCheckoutCard()},
  {name:'Settings',icon:'ti-settings',action:()=>openSettings()},
];
function openCommandPalette(){
  $('cmdk-overlay').classList.add('open');
  const inp=$('cmdk-input');inp.value='';inp.focus();
  renderCommandResults('');
}
function closeCommandPalette(){$('cmdk-overlay').classList.remove('open');}
function cmdkRunPage(i){CMDK_PAGES[i].action();closeCommandPalette();}
function cmdkOpenOrder(id){closeCommandPalette();openOrderDetail(id);}
function renderCommandResults(q){
  q=(q||'').trim().toLowerCase();
  const el=$('cmdk-results');
  if(!q){
    el.innerHTML='<div class="cmdk-section-lbl">Go to</div>'+CMDK_PAGES.map((p,i)=>
      '<div class="cmdk-item" onclick="cmdkRunPage('+i+')"><div class="cmdk-item-ico" style="background:var(--accent-d);color:var(--accent);"><i class="ti '+p.icon+'"></i></div><div class="cmdk-item-info"><div class="cmdk-item-name">'+p.name+'</div></div></div>'
    ).join('');
    return;
  }
  const matches=orders.filter(o=>
    (o.name||'').toLowerCase().includes(q)||(o.store||'').toLowerCase().includes(q)||
    (o.tracking||'').toLowerCase().includes(q)||(o.orderNum||'').toLowerCase().includes(q)
  ).slice(0,6);
  const invMatches=inventory.filter(x=>
    (x.name||'').toLowerCase().includes(q)||(x.set||'').toLowerCase().includes(q)||(x.store||'').toLowerCase().includes(q)
  ).slice(0,6);
  const pageMatches=CMDK_PAGES.filter(p=>p.name.toLowerCase().includes(q));
  if(!matches.length&&!invMatches.length&&!pageMatches.length){el.innerHTML='<div class="cmdk-empty">No matches for "'+escHtml(q)+'"</div>';return;}
  let html='';
  if(pageMatches.length){
    html+='<div class="cmdk-section-lbl">Go to</div>'+pageMatches.map(p=>{
      const i=CMDK_PAGES.indexOf(p);
      return '<div class="cmdk-item" onclick="cmdkRunPage('+i+')"><div class="cmdk-item-ico" style="background:var(--accent-d);color:var(--accent);"><i class="ti '+p.icon+'"></i></div><div class="cmdk-item-info"><div class="cmdk-item-name">'+p.name+'</div></div></div>';
    }).join('');
  }
  if(matches.length){
    html+='<div class="cmdk-section-lbl">Orders</div>'+matches.map(o=>{
      const cat=CATS[o.cat]||CATS.other;
      return '<div class="cmdk-item" onclick="cmdkOpenOrder(\''+o.id+'\')"><div class="cmdk-item-ico '+cat.c+'">'+cat.e+'</div><div class="cmdk-item-info"><div class="cmdk-item-name">'+escHtml(o.name||'Unnamed order')+'</div><div class="cmdk-item-sub">'+escHtml(o.store||'')+' · '+(SL[o.status]||o.status)+'</div></div></div>';
    }).join('');
  }
  if(invMatches.length){
    html+='<div class="cmdk-section-lbl">Inventory</div>'+invMatches.map(x=>
      '<div class="cmdk-item" onclick="cmdkOpenInv(\''+x.id+'\')"><div class="cmdk-item-ico" style="background:var(--accent-d);color:var(--accent);">'+(INV_CATS[x.cat]||INV_CATS.other).e+'</div><div class="cmdk-item-info"><div class="cmdk-item-name">'+escHtml(x.name||'Untitled')+'</div><div class="cmdk-item-sub">'+escHtml(x.set||x.store||'')+' · '+INV_STATUS_LABEL[invEffStatus(x)]+'</div></div></div>'
    ).join('');
  }
  el.innerHTML=html;
}
function cmdkOpenInv(id){closeCommandPalette();sw('inventory');const x=inventory.find(i=>String(i.id)===String(id));if(x)openInvModal(x.id);}

// ── AUTH: login / signup / logout ─────────────────────────────────
let authMode='login', currentUserEmail='', currentWebhookToken='';
const COMMON_WEAK_PASSWORD_PARTS=['password','passw0rd','qwerty','letmein','welcome','admin','login','pokemon','pokémon','shipmentscope','shipment','scope','123456','111111'];
function signupPasswordChecks(password,email){
  const pw=String(password||'');
  const lower=pw.toLowerCase();
  const emailLocal=String(email||'').split('@')[0].toLowerCase();
  return [
    {text:'At least 12 characters',ok:pw.length>=12},
    {text:'Uppercase and lowercase letters',ok:/[a-z]/.test(pw)&&/[A-Z]/.test(pw)},
    {text:'At least one number',ok:/\d/.test(pw)},
    {text:'At least one symbol',ok:/[^A-Za-z0-9\s]/.test(pw)},
    {text:'No spaces',ok:Boolean(pw)&&!/\s/.test(pw)},
    {text:'Does not include your email name',ok:!emailLocal||emailLocal.length<3||!lower.includes(emailLocal)},
    {text:'Not a common weak password',ok:!COMMON_WEAK_PASSWORD_PARTS.some(part=>lower.includes(part))},
  ];
}
function renderSignupPasswordRules(forceBad=false){
  const box=$('auth-pw-rules');
  if(!box)return;
  const isSignup=authMode==='signup';
  box.style.display=isSignup?'grid':'none';
  const input=$('auth-password');
  if(input)input.autocomplete=isSignup?'new-password':'current-password';
  if(!isSignup){box.innerHTML='';return;}
  const email=$('auth-email')?.value||'',password=$('auth-password')?.value||'';
  const started=Boolean(password);
  box.innerHTML=signupPasswordChecks(password,email).map(rule=>{
    const cls=rule.ok?'ok':((started||forceBad)?'bad':'');
    return '<div class="auth-pw-rule '+cls+'">'+escHtml(rule.text)+'</div>';
  }).join('');
}
function signupPasswordValid(password,email){
  return signupPasswordChecks(password,email).every(rule=>rule.ok);
}
function setAuthMode(mode){
  authMode=mode;
  // Always land on the credential step (not a leftover code step).
  pendingChallenge=null;
  if($('auth-code-step')){$('auth-code-step').style.display='none';$('auth-cred-step').style.display='block';}
  $('auth-tab-login').classList.toggle('on',mode==='login');
  $('auth-tab-signup').classList.toggle('on',mode==='signup');
  $('auth-submit-btn').textContent=mode==='login'?'Log in':'Create account';
  $('auth-hint').style.display=mode==='signup'?'block':'none';
  $('auth-consent-row').style.display=mode==='signup'?'flex':'none';
  if($('auth-consent'))$('auth-consent').checked=false; // re-consent each time signup is opened
  $('auth-error').style.display='none';
  renderSignupPasswordRules();
}
function showLandingScreen(){$('landing-screen').style.display='block';$('auth-screen').style.display='none';document.querySelector('.app').style.display='none';}
function showAuthScreen(){$('landing-screen').style.display='none';$('auth-screen').style.display='flex';document.querySelector('.app').style.display='none';}
function showApp(){$('landing-screen').style.display='none';$('auth-screen').style.display='none';document.querySelector('.app').style.display='grid';}
function goToAuth(mode){setAuthMode(mode);showAuthScreen();}
async function submitAuth(){
  const email=$('auth-email').value.trim(),password=$('auth-password').value;
  const hp_field=($('hp-field')||{}).value||'';
  const errEl=$('auth-error');errEl.style.display='none';
  if(!email||!password){errEl.textContent='Enter your email and password.';errEl.style.display='block';return;}
  if(authMode==='signup'&&!signupPasswordValid(password,email)){renderSignupPasswordRules(true);errEl.textContent='Password does not meet the security requirements yet.';errEl.style.display='block';return;}
  if(authMode==='signup'&&!$('auth-consent').checked){errEl.textContent='Please agree to the Terms & Privacy Policy to create an account.';errEl.style.display='block';return;}
  const btn=$('auth-submit-btn'), prevText=btn.textContent;
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;display:inline-block;"></i> '+prevText;
  try{
    const acceptedTerms=authMode==='signup'&&!!$('auth-consent').checked;
    const res=await fetch(API+'/api/auth/'+authMode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,hp_field,acceptedTerms})});
    const data=await res.json();
    if(!data.ok){errEl.textContent=data.message||'Something went wrong.';errEl.style.display='block';return;}
    // New device (or new signup) → a 6-digit code was emailed; go verify it.
    if(data.needsCode){ pendingChallenge=data.challenge; showCodeStep(data.email); return; }
    // Trusted device → straight in.
    currentUserEmail=data.email;currentWebhookToken=data.webhookToken;
    showApp();
    await initAppAfterLogin();
  }catch(e){errEl.textContent='Server offline — is node server.js running?';errEl.style.display='block';
  }finally{ btn.disabled=false; btn.textContent=prevText; }
}
// ── EMAIL 2FA: code-entry step ────────────────────────────────────
function showCodeStep(email){
  $('auth-cred-step').style.display='none';
  $('auth-code-step').style.display='block';
  $('auth-code-email').textContent=email||'';
  $('auth-error').style.display='none';
  const inp=$('auth-code');inp.value='';setTimeout(()=>inp.focus(),50);
}
function backToCredStep(){
  pendingChallenge=null;
  $('auth-code-step').style.display='none';
  $('auth-cred-step').style.display='block';
  $('auth-error').style.display='none';
}
async function verifyCode(){
  const code=$('auth-code').value.trim();
  const errEl=$('auth-error');errEl.style.display='none';
  if(code.length!==6){errEl.textContent='Enter the 6-digit code.';errEl.style.display='block';return;}
  if(!pendingChallenge){backToCredStep();return;}
  const btn=$('auth-verify-btn'),prev=btn.textContent;
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;display:inline-block;"></i> '+prev;
  try{
    const res=await fetch(API+'/api/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:pendingChallenge,code})});
    const data=await res.json();
    if(!data.ok){
      errEl.textContent=data.message||'Incorrect code.';errEl.style.display='block';
      if(data.expired){pendingChallenge=null;setTimeout(backToCredStep,1500);}
      return;
    }
    currentUserEmail=data.email;currentWebhookToken=data.webhookToken;
    pendingChallenge=null;
    showApp();
    await initAppAfterLogin();
  }catch(e){errEl.textContent='Server offline — try again.';errEl.style.display='block';
  }finally{ btn.disabled=false; btn.textContent=prev; }
}
async function resendCode(){
  if(!pendingChallenge)return;
  const errEl=$('auth-error');errEl.style.display='none';
  const link=$('auth-resend-link');const prev=link.textContent;link.textContent='sending…';
  try{
    const res=await fetch(API+'/api/auth/resend-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:pendingChallenge})});
    const data=await res.json();
    if(data.ok){link.textContent='code resent ✓';}
    else{errEl.textContent=data.message||'Could not resend.';errEl.style.display='block';link.textContent=prev;if(data.expired){pendingChallenge=null;setTimeout(backToCredStep,1500);}}
  }catch(e){link.textContent=prev;}
  setTimeout(()=>{if(link.textContent==='code resent ✓')link.textContent=prev;},4000);
}
async function logout(){
  await fetch(API+'/api/auth/logout',{method:'POST'}).catch(()=>{});
  location.reload();
}
function openDeleteAccount(){
  $('del-acct-password').value='';
  $('del-acct-error').style.display='none';
  $('del-acct-wrap').classList.add('open');
}
function closeDeleteAccount(){ $('del-acct-wrap').classList.remove('open'); }
async function confirmDeleteAccount(){
  const password=$('del-acct-password').value;
  const errEl=$('del-acct-error'); errEl.style.display='none';
  if(!password){ errEl.textContent='Enter your password to confirm.'; errEl.style.display='block'; return; }
  try{
    const res=await fetch(API+'/api/auth/delete-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    const data=await res.json();
    if(!data.ok){ errEl.textContent=data.message||'Could not delete account'; errEl.style.display='block'; return; }
    localStorage.removeItem('po_orders');localStorage.removeItem('sc_cache_owner');
    location.reload();
  }catch(e){ errEl.textContent='Server offline — could not delete account'; errEl.style.display='block'; }
}
async function checkAuthOnLoad(){
  try{
    const res=await fetch(API+'/api/auth/me');
    const data=await res.json();
    if(data.ok){currentUserEmail=data.email;currentWebhookToken=data.webhookToken;showApp();initAppAfterLogin();}
    else showLandingScreen();
  }catch(e){ $('offline-banner').style.display='block'; showLandingScreen(); } // server offline — show landing with a visible banner instead of jumping to auth
}

// Accounts now live server-side (scoped to the logged-in user). If this
// browser still has accounts saved the old, pre-login way, upload them once
// so upgrading to an account doesn't lose anything already connected.
async function loadAccountsFromServer(){
  try{
    const res=await fetch(API+'/api/accounts');
    const data=await res.json();
    imapAccounts=(data.ok&&data.accounts)||[];
    if(!imapAccounts.length){
      let legacy=[];
      try{legacy=JSON.parse(localStorage.getItem('imap_accounts')||'[]');}catch(_){}
      if(!legacy.length){
        const oldCfg=JSON.parse(localStorage.getItem('imap_cfg')||'null');
        if(oldCfg&&oldCfg.email)legacy=[{...oldCfg,provider:oldCfg.host?.includes('gmail')?'gmail':(oldCfg.host?.includes('icloud')||oldCfg.host?.includes('me.com'))?'icloud':'custom'}];
      }
      for(const acct of legacy){
        await fetch(API+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(acct)}).catch(()=>{});
      }
      if(legacy.length){imapAccounts=legacy;localStorage.removeItem('imap_accounts');localStorage.removeItem('imap_cfg');}
    }
  }catch(_){}
  renderAccountList();
  if(imapAccounts.length)$('scan-btn').disabled=false;
}

// SECURITY: localStorage is shared by whoever uses this browser next — it has
// no idea which account is logged in. Without this guard, a second person (or
// a second account you create yourself) logging in on the same browser would
// silently inherit — and then upload to THEIR account — whatever orders/IMAP
// accounts were last cached here. Tag the cache with its owner's email; if a
// different account logs in, wipe the stale cache before anything can read it.
function guardLocalCacheOwnership(){
  const owner=(localStorage.getItem('sc_cache_owner')||'').toLowerCase();
  const me=(currentUserEmail||'').toLowerCase();
  if(owner && owner!==me){
    orders=[];
    imapAccounts=[];
    localStorage.removeItem('po_orders');
    localStorage.removeItem('imap_accounts');
    localStorage.removeItem('imap_cfg');
  }
  localStorage.setItem('sc_cache_owner', me);
}

async function initAppAfterLogin(){
  guardLocalCacheOwnership();
  sanitizeOrders(); // clean any bad price values from older imports so rendering can't crash
  const params=new URLSearchParams(location.search);
  const gmailStatus=params.get('gmail');
  if(gmailStatus){
    history.replaceState(null,'',location.pathname);
    if(gmailStatus==='connected')setTimeout(()=>showToast('Gmail connected with Google'),500);
    if(gmailStatus==='error')setTimeout(()=>showToast('Gmail connection failed: '+(params.get('msg')||'try again'),'error',7000),500);
  }
  // One-time migration: browsers that saved a custom accent before the Iris
  // theme shipped would otherwise stay stuck on the old blue forever. Same
  // deal for the 2026-07-04 Aurora revamp — anyone who'd saved the old flat
  // Iris/Azure tones gets bumped to the new gradient-matched shades.
  const savedAccent=localStorage.getItem('ss_accent');
  if(savedAccent==='#5b9ee6'||savedAccent==='#5266eb'||savedAccent==='#663af3'||savedAccent==='#027dea')localStorage.removeItem('ss_accent');
  applyAccent(localStorage.getItem('ss_accent')||'#7c5cff');
  setDensityControl(localStorage.getItem('ss_density')||'comfortable');
  const defaultSort=localStorage.getItem('ss_defaultSort');
  if(defaultSort&&$('sort-sel'))$('sort-sel').value=defaultSort;
  await loadAccountsFromServer();
  switchEmailGuide('gmail');
  const whEl=$('webhook-url-display');
  if(whEl)whEl.textContent=location.origin+'/webhook/'+currentWebhookToken;
  checkServer();
  loadOrdersFromServer();
  loadInventoryFromServer();
  setInterval(checkServer,10000);
  restartPollTimer();
  sw(localStorage.getItem('ss_defaultTab')||'dashboard');
}

window.addEventListener('load',checkAuthOnLoad);
