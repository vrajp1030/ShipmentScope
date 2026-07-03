// ── CONSTANTS ────────────────────────────────────────────────────
const CATS={packs:{e:'<i class="ti ti-box-seam"></i>',c:'ci-packs'},cards:{e:'<i class="ti ti-cards"></i>',c:'ci-cards'},graded:{e:'<i class="ti ti-award"></i>',c:'ci-graded'},figures:{e:'<i class="ti ti-chess-king"></i>',c:'ci-figures'},accessories:{e:'<i class="ti ti-briefcase"></i>',c:'ci-accessories'},other:{e:'<i class="ti ti-package"></i>',c:'ci-other'}};
const SL={ordered:'Ordered',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled',preorder:'Pre-order'};
const SP={ordered:'p-ordered',shipped:'p-shipped',delivered:'p-delivered',cancelled:'p-cancelled',preorder:'p-preorder'};
const CAT_COLORS={packs:'#6eb3f7',cards:'#c084fc',graded:'#ffb830',figures:'#3dd68c',accessories:'#ff7f5c',other:'#7878a0'};
const SC={ordered:'#6eb3f7',shipped:'#ffb830',delivered:'#3dd68c',cancelled:'#ff5f57',preorder:'#c084fc'};
const STORE_ICO_DEFAULT='<i class="ti ti-building-store"></i>';
const API=location.origin;

// ── STATE ────────────────────────────────────────────────────────
let orders=JSON.parse(localStorage.getItem('po_orders')||'[]');
let settings=JSON.parse(localStorage.getItem('po_settings')||'{"new-order":true,"cancel":true,"dup":true,"delivery":true,"autopoll":true,"desktop":false}');
let nid=Math.max(0,...orders.map(o=>o.id||0))+1;
let fil='all',timeFil='all',catFil='all',efil='all',selCat='other',showArchived=false;
let serverOnline=false;
let cY=new Date().getFullYear(),cM=new Date().getMonth(),cSel=new Date().getDate();
let charts=[],currentEmailId=null,pollTimerId=null;

const $=id=>document.getElementById(id);
function save(){
  // 1) browser cache (works offline)  2) durable file on the computer via the server
  localStorage.setItem('po_orders',JSON.stringify(orders));
  try{
    fetch(API+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(orders)}).catch(()=>{});
  }catch(_){}
}
// Pull the saved order file from the server on startup so orders never "disappear"
let ordersLoading=false;
async function loadOrdersFromServer(){
  if(!orders.length){ ordersLoading=true; rOrders(); }
  try{
    const res=await fetch(API+'/api/orders');
    const data=await res.json();
    if(data.ok&&Array.isArray(data.orders)&&data.orders.length>=orders.length){
      orders=data.orders;
      sanitizeOrders();
      localStorage.setItem('po_orders',JSON.stringify(orders));
      nid=Math.max(0,...orders.map(o=>o.id||0))+1;
      rOrders();rStats();
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
function sanitizeOrders(){orders.forEach(o=>{const n=typeof o.price==='number'?o.price:parseFloat(o.price);o.price=isFinite(n)?n:0;});}

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
    if(window.confetti)confetti({particleCount:90,spread:75,origin:{y:0.3},colors:['#663af3','#a78bfa','#d8ecf8','#4fbf8b']});
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
  orders:{title:'Dashboard',sub:'Track and manage your Pokémon orders across every store'},
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
  safeRun(rStats); // header metric tiles are always visible regardless of active tab
  if(tab==='orders')safeRun(rOrders);
  if(tab==='emails')safeRun(rEmails);
  if(tab==='tracking')safeRun(rTracking);
  if(tab==='calendar')safeRun(rCal);
  if(tab==='insights')safeRun(rInsights);
}
// "Dashboard" and "Orders" currently point at the same pane (data-tab="orders"),
// so sw()'s own querySelector can't tell them apart — this corrects the
// highlight to whichever of the two was actually clicked.
function setActiveNav(el){document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on'));el.classList.add('on');}
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
  const rangeOpt=$('ss-range-opt-3m'),rangeEl=$('ss-range'),totalEl=$('ss-total'),trendEl=$('ss-trend');
  if(rangeOpt)rangeOpt.textContent=monthDates[0].toLocaleDateString('en-US',{month:'short'})+' – '+monthDates[2].toLocaleDateString('en-US',{month:'short',year:'numeric'});
  const showAllTime=rangeEl&&rangeEl.value==='all';
  if(showAllTime){
    const allTimeTotal=orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.price||0),0);
    if(totalEl)totalEl.textContent='$'+Math.round(allTimeTotal).toLocaleString();
    if(trendEl){trendEl.textContent='';trendEl.className='ss-trend';}
  }else{
    if(totalEl)totalEl.textContent='$'+Math.round(periodTotal).toLocaleString();
    if(trendEl){
      if(!prevPeriodTotal&&!periodTotal){trendEl.textContent='';trendEl.className='ss-trend';}
      else if(!prevPeriodTotal){trendEl.textContent='New';trendEl.className='ss-trend up';}
      else{
        const pct=Math.round(((periodTotal-prevPeriodTotal)/prevPeriodTotal)*100);
        trendEl.textContent=(pct>0?'▲ ':pct<0?'▼ ':'– ')+Math.abs(pct)+'%';
        trendEl.className='ss-trend '+(pct>0?'up':pct<0?'down':'flat');
      }
    }
  }

  // Cancellation banner
  const cxList=orders.filter(o=>o.status==='cancelled');
  const z=$('cx-zone');
  if(cxList.length&&settings['cancel']){
    const names=cxList.slice(0,3).map(o=>'<strong style="cursor:pointer;text-decoration:underline dotted;" onclick="openEmail(\''+o.id+'\')">'+(o.name||'Order').slice(0,40)+'</strong>').join('<br>');
    z.innerHTML='<div class="cx-banner"><i class="ti ti-alert-triangle"></i><div class="cx-txt">'+cxList.length+' cancelled order'+(cxList.length>1?'s':'')+':<br>'+names+(cxList.length>3?'<br>+' +(cxList.length-3)+' more':'')+'</div><button class="cx-close" onclick="this.parentElement.parentElement.innerHTML=\'\'" aria-label="Dismiss"><i class="ti ti-x"></i></button></div>';
  }else z.innerHTML='';


  renderKpiBars();

  if(document.getElementById('pane-orders')?.classList.contains('on'))safeRun(rDashboardSide);
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

// ── DASHBOARD SIDE PANEL (Insights preview + Recent activity) ────
function rDashboardSide(){
  const miniEl=$('dash-insights-mini'),actEl=$('dash-activity'),lblEl=$('dash-period-lbl');
  if(!miniEl||!actEl)return;

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

  // Top store by order count (real tally, not fabricated)
  const storeCounts={};
  orders.forEach(o=>{if(o.store)storeCounts[o.store]=(storeCounts[o.store]||0)+1;});
  const topStoreEntry=Object.entries(storeCounts).sort((a,b)=>b[1]-a[1])[0];
  const topStore=topStoreEntry?topStoreEntry[0]:null;

  // Fastest carrier by average ordered→delivered days, from real history
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

  lblEl.textContent='';
  miniEl.innerHTML=[
    ['ti-clock-hour-4','var(--blue)','Avg. delivery time',avgDays!=null?avgDays+' days':'–'],
    ['ti-circle-check','var(--green)','On-time delivery',onTimePct!=null?onTimePct+'%':'–'],
    ['ti-alert-triangle','var(--amber)','Delay rate',delayRate+'%'],
    ['ti-package','var(--purple)','Total orders',orders.length],
    ['ti-building-store','var(--teal)','Top store',topStore?(topStore.length>16?topStore.slice(0,15)+'…':topStore):'–'],
    ['ti-bolt','var(--coral)','Fastest carrier',fastestCarrier||'–'],
  ].map(([ico,color,lbl,val])=>
    '<div class="insight-mini"><div class="insight-mini-ico" style="background:'+color+'22;color:'+color+';"><i class="ti '+ico+'"></i></div><div class="insight-mini-info"><div class="insight-mini-lbl">'+lbl+'</div></div><div class="insight-mini-val">'+val+'</div></div>'
  ).join('');

  actEl.innerHTML=renderActivityList(getRecentActivity(6));
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
        : '<div class="empty-s" style="grid-column:1/-1;"><i class="ti ti-package"></i><p>No orders yet</p><p style="font-size:13px;color:var(--txt3);margin-top:6px;">Open Sync to scan your inbox, or use Add order.</p><div style="display:flex;gap:10px;justify-content:center;margin-top:16px;"><button class="empty-cta primary" onclick="sw(\'sync\')"><i class="ti ti-refresh"></i>Sync emails</button><button class="empty-cta secondary" onclick="openM()"><i class="ti ti-plus"></i>Add order</button></div></div>')
      : '<div class="empty-s" style="grid-column:1/-1;"><i class="ti ti-filter"></i><p>No orders match these filters</p><p style="font-size:12px;color:var(--txt3);margin-top:6px;">You have '+orders.length+' order'+(orders.length!==1?'s':'')+' total — try <span style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="clearFilters()">clearing the filters</span>.</p></div>';
    return;
  }

  // Crash-proof: one bad order can never blank the whole list.
  el.innerHTML=filtered.map(o=>{ try{ return orderCardHTML(o); }catch(e){ console.error('card render error',o,e); return ''; } }).join('')+
    '<div class="list-end" style="grid-column:1/-1;">You\'ve reached the end! 🚀</div>';
}

function carrierClass(c){c=(c||'').toLowerCase();if(c.includes('ups'))return'c-ups';if(c.includes('fedex'))return'c-fedex';if(c.includes('usps'))return'c-usps';if(c.includes('dhl'))return'c-dhl';return'';}
function orderCardHTML(o){
  const cat=CATS[o.cat]||CATS.other;
  const hasEmail=!!(o.emailHtml||o.emailText);
  const hasNote=!!(o.notes&&o.notes.trim());
  const delBar=deliveryProgress(o);
  const trackHtml=o.trackingUrl?'<a class="track-link '+carrierClass(o.carrier)+'" href="'+o.trackingUrl+'" target="_blank" onclick="event.stopPropagation()"><i class="ti ti-truck" style="font-size:11px;"></i>'+escHtml(o.carrier||'Track')+'</a>':'';
  const oicoInner=isSafeImageUrl(o.image)?'<img src="'+escAttr(o.image)+'" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\''+cat.e.replace(/'/g,"\\'")+'\';"/>':cat.e;
  return'<div class="ocard'+(o.status==='cancelled'?' cx':'')+'" onclick="openOrderDetail(\''+o.id+'\')">'+
    '<div class="ocard-top">'+
      '<div class="oico '+cat.c+'">'+oicoInner+'</div>'+
      '<div class="ocard-info">'+
        '<div class="oname">'+escHtml(o.name||'Unnamed order')+'</div>'+
        '<div class="ometa">'+
          '<span>'+escHtml(o.store||'')+'</span>'+
          (o.date?'<span>'+fd(o.date)+'</span>':'')+
          (o.orderNum?'<span>#'+escHtml(o.orderNum)+'</span>':'')+
          (hasEmail?'<span style="color:var(--accent)"><i class="ti ti-mail" style="font-size:11px;"></i> email</span>':'')+
          (hasNote?'<span style="color:var(--amber)"><i class="ti ti-note" style="font-size:11px;"></i> note</span>':'')+
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
        trackHtml+
        (hasEmail?'<button class="oact-btn" onclick="openEmail(\''+o.id+'\')"><i class="ti ti-mail" style="font-size:11px;"></i>View email</button>':'')+
        '<button class="oact-btn" onclick="quickArchive('+o.id+')"><i class="ti ti-archive" style="font-size:11px;"></i>Archive</button>'+
        '<button class="oact-btn danger" onclick="dO('+o.id+')"><i class="ti ti-trash" style="font-size:11px;"></i>Delete</button>'+
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

// ── DUPLICATE CHECK ──────────────────────────────────────────────
function checkDup(){
  if(!settings['dup'])return;
  const name=($('mn').value||'').toLowerCase().trim();
  if(name.length<4){$('dup-warn').style.display='none';return;}
  const dup=orders.find(o=>(o.name||'').toLowerCase().includes(name)||name.includes((o.name||'').toLowerCase().trim().slice(0,10)));
  $('dup-warn').style.display=dup?'block':'none';
}

// True only if we ALREADY have this order at the same-or-newer stage — i.e. the
// email adds nothing. A newer stage (e.g. a cancellation for an order we have as
// "ordered") is NOT a duplicate; it's an update, so it stays importable.
function isDuplicate(order){
  const num=(order.orderNum||'').trim().toLowerCase();
  if(num){
    const ex=orders.find(o=>(o.orderNum||'').trim().toLowerCase()===num && (o.store||'').toLowerCase()===(order.store||'').toLowerCase());
    if(ex) return statusRank(order.status)<=statusRank(ex.status);
    return false;
  }
  // No order number: every email has a unique emailId (from the server), so use
  // THAT to detect "I already imported this exact email" — never subject+date,
  // which falsely merges distinct same-day orders that share a subject template.
  if(order.emailId) return orders.some(o=>o.emailId===order.emailId);
  return orders.some(o=>!(o.orderNum||'').trim() && !o.emailId && o.name===order.name && o.date===order.date && o.status===order.status);
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
function rCal(){
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mo=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date+'T00:00:00');return d.getFullYear()===cY&&d.getMonth()===cM;});
  $('cm-lbl').textContent=MONTHS[cM]+' '+cY;
  $('cm-sub').textContent=mo.length?mo.length+' order'+(mo.length>1?'s':'')+' this month':'No orders this month';
  const first=new Date(cY,cM,1).getDay(),days=new Date(cY,cM+1,0).getDate(),prev=new Date(cY,cM,0).getDate();
  const today=new Date(),ods=new Set(mo.map(o=>parseInt(o.date.split('-')[2])));
  let html='';
  for(let i=0;i<first;i++)html+='<div class="cal-cell om">'+(prev-first+i+1)+'</div>';
  for(let d=1;d<=days;d++){
    const isT=today.getFullYear()===cY&&today.getMonth()===cM&&today.getDate()===d;
    const isS=cSel===d&&!isT;
    html+='<div class="cal-cell'+(isT?' today':'')+(isS?' sel':'')+(ods.has(d)?' has-o':'')+'" onclick="selDay('+d+')">'+d+'</div>';
  }
  const rem=(first+days)%7;if(rem>0)for(let i=1;i<=7-rem;i++)html+='<div class="cal-cell om">'+i+'</div>';
  $('cgrid').innerHTML=html;rCalDay();
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
function cPrev(){cM--;if(cM<0){cM=11;cY--;}cSel=1;rCal();}
function cNext(){cM++;if(cM>11){cM=0;cY++;}cSel=1;rCal();}
function cToday(){const t=new Date();cY=t.getFullYear();cM=t.getMonth();cSel=t.getDate();rCal();}

// ── SYNC: multiple IMAP accounts ──────────────────────────────────
let imapAccounts=[];
const PROVIDER_PRESETS={
  icloud:{host:'imap.mail.me.com',port:'993',placeholder:'you@icloud.com',note:'Get an app-specific password at appleid.apple.com → Sign-In & Security → App-Specific Passwords.'},
  gmail:{host:'imap.gmail.com',port:'993',placeholder:'you@gmail.com',note:'Get an app password at myaccount.google.com → Security → 2-Step Verification → App passwords. Also turn on IMAP in Gmail settings.'},
  outlook:{host:'outlook.office365.com',port:'993',placeholder:'you@outlook.com',note:'Use an app password if 2-step verification is on: account.microsoft.com → Security.'},
  custom:{host:'',port:'993',placeholder:'you@example.com',note:"Enter your mail provider's IMAP server and port."},
};
function applyProviderPreset(){
  const p=PROVIDER_PRESETS[$('im-provider').value];
  $('im-host').value=p.host;$('im-port').value=p.port;
  $('im-note').textContent=p.note;$('im-email').placeholder=p.placeholder;
}
function showAddAccountForm(){
  $('im-email').value='';$('im-pass').value='';$('im-provider').value='icloud';
  applyProviderPreset();
  $('imap-fw').style.display='block';
}
function providerIcon(provider){
  if(provider==='gmail')return'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4Z" fill="#EA4335"/><path d="M20 4L12 13L4 4" stroke="#fff" stroke-width="2"/></svg>';
  if(provider==='icloud')return'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 18H7A5 5 0 1 1 7.1 8H7A7 7 0 1 0 17 18Z" fill="#5b9ee6"/></svg>';
  return'<i class="ti ti-mail" style="font-size:18px;color:var(--txt2);"></i>';
}
function providerLabel(provider){return provider==='gmail'?'Gmail':provider==='icloud'?'iCloud Mail':provider==='outlook'?'Outlook':'Custom IMAP';}
function renderAccountList(){
  const el=$('account-list');if(!el)return;
  if(!imapAccounts.length){el.innerHTML='<div style="font-size:14px;color:var(--txt3);padding:8px 0;">No accounts connected yet — click below to add one.</div>';return;}
  el.innerHTML=imapAccounts.map(a=>
    '<div class="srow"><div class="sico" style="background:var(--bg3);">'+providerIcon(a.provider)+'</div>'+
    '<div class="sinfo"><h4>'+escHtml(a.email)+'</h4><p>'+providerLabel(a.provider)+' · Connected</p></div>'+
    '<button class="sbtn" onclick="disconnectAccount(\''+a.email.replace(/'/g,"\\'")+'\')">Disconnect</button></div>'
  ).join('');
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
  if(!confirm('Disconnect '+email+'? This stops syncing this account — your already-imported orders are kept.'))return;
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
  $('det-zone').innerHTML='<div style="color:var(--txt3);font-size:13px;padding:14px 0;font-weight:600;display:flex;align-items:center;gap:8px;"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite;display:inline-block;font-size:19px;"></i> Scanning '+imapAccounts.length+' account'+(imapAccounts.length>1?'s':'')+' — may take a minute…</div>';
  const allFound=[];const errors=[];
  for(const acct of imapAccounts){
    try{
      const cfg={...acct,scanDays};
      const res=await fetch(API+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
      const data=await res.json();
      if(!data.ok)throw new Error(data.message);
      allFound.push(...(data.orders||[]));
    }catch(err){errors.push(acct.email+': '+err.message);}
  }
  const found=allFound;
  // Mark duplicates
  const marked=found.map(f=>({...f,isDup:isDuplicate(f)}));
  const newOnes=marked.filter(f=>!f.isDup);
  const dups=marked.filter(f=>f.isDup);
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
        '<button class="di-add" id="det-btn-'+i+'" onclick="impD('+i+')">Import</button>'+
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

// Find the existing order this email belongs to (same order number + store).
function findExisting(d){
  const num=(d.orderNum||'').trim().toLowerCase();
  if(num) return orders.find(o=>(o.orderNum||'').trim().toLowerCase()===num && (o.store||'').toLowerCase()===(d.store||'').toLowerCase());
  // No order number: only treat it as the SAME order if it's the exact same email
  // (matching emailId) being re-scanned — never merge by name+date+store alone,
  // since distinct same-day orders often share an identical subject template
  // (that bug used to silently swallow separate real orders into one card).
  if(d.emailId) return orders.find(o=>o.emailId===d.emailId);
  return orders.find(o=>!(o.orderNum||'').trim() && !o.emailId && o.name===d.name && o.date===d.date && o.store===d.store);
}

function todayISO(){return new Date().toISOString().split('T')[0];}

// Add a new order, OR if we already track this order number, update it in place
// (advance the status, fill in tracking/price, attach the newer email).
function upsertOrder(d){
  const ex=findExisting(d);
  if(ex){
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
const DEFAULT_INSIGHT_WIDGETS=['monthly-chart','category-chart'];
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
async function rInsights(){
  const t=orders.length;
  if(!t){$('ins-inner').innerHTML='<div class="empty-s"><i class="ti ti-chart-bar"></i><p>Add orders to see insights</p></div>';return;}
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
  const monthlyColors=['#663af3','#9c8cec','#4fbf8b'];
  const monthlyData=[2,1,0].map((i,idx)=>{
    const d=new Date(nowD.getFullYear(),nowD.getMonth()-i,1);
    return {label:d.toLocaleDateString('en-US',{month:'long'}),year:d.getFullYear(),total:Math.round(mSpend(d.getMonth(),d.getFullYear())),color:monthlyColors[idx]};
  });
  const monthRangeLbl=monthlyData.map(d=>d.label).join(' · ');
  const monthYearLbl=monthlyData[0].year===monthlyData[2].year?String(monthlyData[0].year):monthlyData[0].year+'–'+monthlyData[2].year;
  const thisMonthSpend=mSpend(nowD.getMonth(),nowD.getFullYear());

  const ctx={t,fmt,spend,cxSpend,avg,dlRate,byCat,catSpend,storeSpend,byStore,byStatus,topCat,topStores,monthlyData,monthRangeLbl,monthYearLbl,thisMonthSpend};

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
function openM(){
  $('mn').value='';$('ms').value='';$('mp').value='';$('md').value=new Date().toISOString().slice(0,10);
  $('mo').value='';$('mt').value='';$('med').value='';$('mst').value='ordered';$('dup-warn').style.display='none';
  document.querySelectorAll('.cchip').forEach(el=>el.classList.remove('sel'));
  document.querySelector('[data-c="other"]').classList.add('sel');selCat='other';
  $('mwrap').classList.add('open');
}
function closeM(){$('mwrap').classList.remove('open');}
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
  const o={id:nid++,name,store:$('ms').value.trim()||'Unknown',price:parseFloat($('mp').value.replace(/[^0-9.]/g,''))||0,date:$('md').value,status:$('mst').value,cat:selCat,orderNum:$('mo').value.trim(),tracking,expectedDelivery:$('med').value,carrier:carrierInfo?carrierInfo.name:'',trackingUrl:carrierInfo?carrierInfo.url:'',emailHtml:'',emailText:'',notes:'',archived:false,history:[{status:$('mst').value,date:$('md').value||todayISO()}]};
  if(settings['dup']&&isDuplicate(o)){if(!confirm('This looks like a duplicate. Add anyway?'))return;}
  orders.push(o);save();closeM();rOrders();rStats();showToast('Order added');
}

// ── CHECKOUT CARD GENERATOR ─────────────────────────────────────────
// Dark-first themes — a low-alpha accent wash over a near-black base, never
// a loud saturated gradient. Accent drives the hero number, glow and badge.
const CARD_THEMES=[
  {accent:'#D4A63A'},
  {accent:'#4F8EF7'},
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

  // Rolling month-over-month spend trend — never hardcoded, and never shown
  // unless there's a real prior-month baseline to compare against.
  // (monthSpend is defined once, near the sidebar stats code above.)
  const now=new Date();
  const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
  const thisMonth=monthSpend(now.getMonth(),now.getFullYear());
  const prevMonth=monthSpend(prev.getMonth(),prev.getFullYear());
  const trendPct=prevMonth>0?Math.round(((thisMonth-prevMonth)/prevMonth)*100):null;

  const dated=orders.filter(o=>o.date&&o.status!=='cancelled').sort((a,b)=>a.date<b.date?-1:1);
  const trackingSince=dated.length?new Date(dated[0].date+'T00:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'}):null;

  return { spend, total:orders.length, onTimePct, topStore, topCount, trendPct, trackingSince };
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
  const accent=(cardBgMode==='image')?'#D4A63A':CARD_THEMES[cardBgIndex].accent;
  const BASE='#121214', PANEL='#18181B', BORDER='rgba(255,255,255,0.08)', TXT2='rgba(255,255,255,0.65)';

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

  ctx.save();
  ctx.shadowColor=hexToRgba(accent,0.4);
  ctx.shadowBlur=28;
  const heroGrad=ctx.createLinearGradient(0,172,0,300);
  heroGrad.addColorStop(0,'#f4e2b8');
  heroGrad.addColorStop(0.45,accent);
  heroGrad.addColorStop(1,accent==='#E8E8EA'?'#b9b9bd':'#9c7420');
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
  ctx.fillText('Tracked with ShipmentScope  ·  '+new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'}), wx+10, H-40);

  ctx.strokeStyle=BORDER; ctx.lineWidth=1;
  roundRect(ctx,0.5,0.5,W-1,H-1,22); ctx.stroke();
  ctx.restore();
}
function hexToRgba(hex,alpha){
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
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
  $('default-tab').value=localStorage.getItem('ss_defaultTab')||'orders';
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
        new Notification('ShipmentScope',{body:'Desktop notifications are on.'});
      }else{
        showToast('Notification permission was denied in your browser','warn');
      }
    });
  }else{
    settings['desktop']=false;saveSettings();
    $('tog-desktop').className='toggle';
  }
}
function notifyDesktop(title,body){
  if(!settings['desktop']||!('Notification' in window)||Notification.permission!=='granted')return;
  try{new Notification(title,{body});}catch(_){}
}

// ── APPEARANCE: accent color ──────────────────────────────────────
const ACCENT_COLORS=[{name:'Iris',hex:'#663af3'},{name:'Ember',hex:'#e46d4c'},{name:'Azure',hex:'#027dea'},{name:'Mint',hex:'#269684'}];
function applyAccent(hex){
  document.documentElement.style.setProperty('--accent',hex);
  document.documentElement.style.setProperty('--accent-d',hexToRgba(hex,0.13));
}
function setAccent(hex){applyAccent(hex);localStorage.setItem('ss_accent',hex);renderAccentSwatches();}
function renderAccentSwatches(){
  const cur=localStorage.getItem('ss_accent')||'#663af3';
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
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-60);
  let n=0;
  orders.forEach(o=>{
    if(!o.archived&&o.status==='delivered'&&o.date&&new Date(o.date+'T00:00:00')<cutoff){o.archived=true;n++;}
  });
  if(!n){showToast('No delivered orders older than 60 days','warn');return;}
  save();safeRun(rOrders);safeRun(rStats);
  showToast(n+' order'+(n>1?'s':'')+' archived');
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
      let count=0,cancelledCount=0;
      data.orders.forEach(d=>{
        if(isDuplicate(d))return;
        upsertOrder(d); // merges into an existing order (e.g. a shipped update) instead of always adding a new card
        count++;
        if(d.status==='cancelled')cancelledCount++;
      });
      if(count>0){
        save();rOrders();rStats();
        if(settings['new-order'])showToast(''+count+' new order'+(count>1?'s':'')+' arrived!');
        if(cancelledCount&&settings['cancel']) notifyDesktop('Order cancelled',cancelledCount+' order'+(cancelledCount>1?'s were':' was')+' cancelled');
        else notifyDesktop('New order update',count+' order'+(count>1?'s':'')+' updated in ShipmentScope');
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

// ── COMMAND PALETTE (⌘K) ─────────────────────────────────────────
const CMDK_PAGES=[
  {name:'Orders',icon:'ti-package',action:()=>sw('orders')},
  {name:'Tracking',icon:'ti-truck',action:()=>sw('tracking')},
  {name:'Emails',icon:'ti-mail',action:()=>sw('emails')},
  {name:'Calendar',icon:'ti-calendar',action:()=>sw('calendar')},
  {name:'Sync',icon:'ti-refresh',action:()=>sw('sync')},
  {name:'Insights',icon:'ti-chart-bar',action:()=>sw('insights')},
  {name:'Add order',icon:'ti-plus',action:()=>openM()},
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
  ).slice(0,8);
  const pageMatches=CMDK_PAGES.filter(p=>p.name.toLowerCase().includes(q));
  if(!matches.length&&!pageMatches.length){el.innerHTML='<div class="cmdk-empty">No matches for "'+escHtml(q)+'"</div>';return;}
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
  el.innerHTML=html;
}

// ── AUTH: login / signup / logout ─────────────────────────────────
let authMode='login', currentUserEmail='', currentWebhookToken='';
function setAuthMode(mode){
  authMode=mode;
  $('auth-tab-login').classList.toggle('on',mode==='login');
  $('auth-tab-signup').classList.toggle('on',mode==='signup');
  $('auth-submit-btn').textContent=mode==='login'?'Log in':'Create account';
  $('auth-hint').style.display=mode==='signup'?'block':'none';
  $('auth-legal-hint').style.display=mode==='signup'?'block':'none';
  $('auth-error').style.display='none';
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
  const btn=$('auth-submit-btn'), prevText=btn.textContent;
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;display:inline-block;"></i> '+prevText;
  try{
    const res=await fetch(API+'/api/auth/'+authMode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,hp_field})});
    const data=await res.json();
    if(!data.ok){errEl.textContent=data.message||'Something went wrong.';errEl.style.display='block';return;}
    currentUserEmail=data.email;currentWebhookToken=data.webhookToken;
    showApp();
    await initAppAfterLogin();
  }catch(e){errEl.textContent='Server offline — is node server.js running?';errEl.style.display='block';
  }finally{ btn.disabled=false; btn.textContent=prevText; }
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
  // One-time migration: browsers that saved a custom accent before the Iris
  // theme shipped would otherwise stay stuck on the old blue forever.
  const savedAccent=localStorage.getItem('ss_accent');
  if(savedAccent==='#5b9ee6'||savedAccent==='#5266eb')localStorage.removeItem('ss_accent');
  applyAccent(localStorage.getItem('ss_accent')||'#663af3');
  setDensityControl(localStorage.getItem('ss_density')||'comfortable');
  const defaultSort=localStorage.getItem('ss_defaultSort');
  if(defaultSort&&$('sort-sel'))$('sort-sel').value=defaultSort;
  await loadAccountsFromServer();
  const whEl=$('webhook-url-display');
  if(whEl)whEl.textContent=location.origin+'/webhook/'+currentWebhookToken;
  checkServer();
  loadOrdersFromServer();
  setInterval(checkServer,10000);
  restartPollTimer();
  sw(localStorage.getItem('ss_defaultTab')||'orders');
}

window.addEventListener('load',checkAuthOnLoad);
