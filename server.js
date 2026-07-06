// ShipmentScope — Local IMAP Sync Server v3
const http = require('http');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// Minimal .env loader (no dependency): populate process.env from a .env file
// in this folder for any keys not already set in the real environment. Lets
// you keep ENCRYPTION_KEY, SMTP_USER/PASS, NODE_ENV, etc. in a gitignored
// .env on the server instead of exporting them by hand.
(function loadDotEnv(){
  try{
    const p=path.join(__dirname,'.env');
    if(!fs.existsSync(p))return;
    for(const line of fs.readFileSync(p,'utf8').split('\n')){
      const m=line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if(!m)continue;
      let v=m[2];
      if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
      if(process.env[m[1]]===undefined && v!=='') process.env[m[1]]=v;
    }
  }catch(_){}
})();

const PORT = 3876;

// A single unexpected throw outside a route's own try/catch used to kill the
// whole process (everyone's sessions with it, since sessions are in-memory).
// Log and keep serving instead — routes are already defensively try/catch'd,
// so this is a last-resort net, not a substitute for that.
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });
process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });

// ── WHITELISTED STORES ───────────────────────────────────────────
const ALLOWED_STORES = [
  { name: 'Pokemon Center',   domains: ['pokemoncenter.com','em.pokemon.com','pokemon.com','email.pokemon.com'] },
  { name: 'Target',           domains: ['target.com','emails.target.com'] },
  { name: 'Amazon',           domains: ['amazon.com','amazon.co.uk','marketplace.amazon.com','shipment-tracking.amazon.com'] },
  { name: 'TikTok Shop',      domains: ['tiktok.com','tiktokshop.com','shop.tiktok.com'] },
  { name: 'Mattel Creations', domains: ['mattel.com','mattelcreations.com','creations.mattel.com'] },
  { name: 'Bandai',           domains: ['bandai.com','bandainamco.com','premiumbandai.com','p-bandai.com','bandaiamerica.com','premium-bandai.com'] },
  { name: 'TCGPlayer',        domains: ['tcgplayer.com'] },
  { name: 'eBay',             domains: ['ebay.com'] },
  { name: 'Whatnot',          domains: ['whatnot.com'] },
  { name: 'Mercari',          domains: ['mercari.com'] },
];

// ── FOOD / RESTAURANT / GROCERY EXCLUSION ────────────────────────
// Meal, restaurant and grocery receipts match every "order/receipt/delivered"
// keyword but aren't merchandise — this tracker is for resellable goods, so
// they're dropped before classification. Domain match on the sender does the
// heavy lifting; the subject phrases catch restaurant POS/ordering platforms
// that send from their own domains.
const EXCLUDED_FOOD_DOMAINS = [
  // delivery platforms
  'doordash.com','ubereats.com','uber.com','grubhub.com','seamless.com','postmates.com',
  'instacart.com','gopuff.com','favor.com','trycaviar.com','slicelife.com','deliveroo.com',
  'skipthedishes.com','toasttab.com','olo.com','chownow.com','ezcater.com','ritual.co',
  'eatstreet.com','waitrapp.com','delivery.com','foodpanda.com','just-eat.com','menulog.com',
  // restaurants & fast food
  'mcdonalds.com','chipotle.com','dominos.com','pizzahut.com','papajohns.com','littlecaesars.com',
  'wendys.com','tacobell.com','burgerking.com','kfc.com','chick-fil-a.com','cfahome.com',
  'starbucks.com','dunkin.com','subway.com','panerabread.com','sweetgreen.com','wingstop.com',
  'fiveguys.com','shakeshack.com','raisingcanes.com','popeyes.com','sonicdrivein.com',
  'jimmyjohns.com','jerseymikes.com','zaxbys.com','whataburger.com','culvers.com',
  'dairyqueen.com','buffalowildwings.com','applebees.com','olivegarden.com','ihop.com','dennys.com',
  'pandaexpress.com','qdoba.com','moes.com','nandos.com','pret.com','jersey-mikes.com',
  // groceries & meal kits
  'kroger.com','safeway.com','albertsons.com','publix.com','wegmans.com','heb.com','aldi.us',
  'shipt.com','freshdirect.com','hellofresh.com','blueapron.com','homechef.com','factor75.com',
  'wholefoodsmarket.com','wholefoods.com','traderjoes.com','sprouts.com','meijer.com',
];
const FOOD_SUBJECT_HINTS = [
  'your dasher','your driver is','your shopper','your courier','is being prepared',
  'enjoy your meal','your meal','your food','order is ready for pickup','your table',
  'meal kit','your groceries','grocery order','restaurant order','pizza order',
  'pickup order is ready','ready for pickup at','your delivery from',
];
function isFoodEmail(subject, fromAddr) {
  const f = (fromAddr||'').toLowerCase();
  if (EXCLUDED_FOOD_DOMAINS.some(d => f.includes(d))) return true;
  const s = (subject||'').toLowerCase();
  return FOOD_SUBJECT_HINTS.some(k => s.includes(k));
}

const NON_MERCH_DOMAINS = [
  'airbnb.com','vrbo.com','booking.com','hotels.com','expedia.com','priceline.com','kayak.com',
  'delta.com','united.com','aa.com','southwest.com','jetblue.com','spirit.com',
  'lyftmail.com','lyft.com','uber.com','ticketmaster.com','eventbrite.com','stubhub.com',
  'fandango.com','amctheatres.com','regmovies.com','netflix.com','hulu.com','spotify.com',
  'discord.com','zoom.us','dropbox.com','notion.so','github.com',
];
const NON_MERCH_HINTS = [
  'reservation confirmed','booking confirmed','flight confirmation','boarding pass','hotel booking',
  'your trip','your ride','ride receipt','your ticket','event ticket','appointment confirmed',
  'subscription renewed','subscription receipt','monthly invoice','your bill is ready','statement is ready',
  'utility bill','membership renewed','plan renewal','service appointment','parking receipt',
];
const MERCHANDISE_HINTS = [
  'tracking number','tracking id','carrier','package','shipment','has shipped','is on the way',
  'out for delivery','delivered to your','left at door','order total','grand total',
  'order number','order #','sku','item','items','product','products','quantity','qty',
  'ship to','shipping address','pre-order','preorder','purchase confirmed',
];
function hasMerchandiseSignal(subject, fromAddr, body) {
  const text = ((subject||'')+' '+(body||'')).toLowerCase();
  if(getAllowedStore(fromAddr, body)) return true;
  if(MERCHANDISE_HINTS.some(k => text.includes(k))) return true;
  return /\b(?:ups|usps|fedex|dhl)\b/.test(text) || /\b1z[a-z0-9]{16}\b/i.test(text) || /\b9[2-4]\d{20}\b/.test(text);
}
function isNonMerchandiseEmail(subject, fromAddr, body) {
  const f = (fromAddr||'').toLowerCase();
  if(NON_MERCH_DOMAINS.some(d => f.includes(d))) return true;
  const text = ((subject||'')+' '+(body||'')).toLowerCase();
  return NON_MERCH_HINTS.some(k => text.includes(k));
}

const KEYWORDS = {
  ordered:   ['order confirmed','order confirmation','order is confirmed','order received','we received your order','thank you for your order','thank you for your purchase','thanks for your order','thanks for your purchase','thank you for shopping','order placed','purchase confirmed','payment received','receipt for','order acknowledgement','order summary','order #','order number','order no.'],
  shipped:   ['has shipped','your order has shipped','on its way','tracking number','out for delivery','dispatched','package shipped','shipment confirmation','your shipment','your package is on the way','shipped!'],
  delivered: ['has been delivered','was delivered','successfully delivered','package delivered','order delivered','left at door','delivered to your'],
  cancelled: ['order cancelled','order has been cancelled','cancellation confirmed','has been canceled','order canceled','refund issued','your refund','refund confirmation','order refunded','payment refunded'],
  preorder:  ['pre-order confirmed','preorder confirmed','pre-order placed','preorder placed','pre-order received'],
};

// ── CARRIER DETECTION ────────────────────────────────────────────
function detectCarrier(tracking) {
  if(!tracking) return null;
  const t=encodeURIComponent(tracking);
  if(/^1Z[A-Z0-9]{16}$/.test(tracking)) return {name:'UPS',url:'https://www.ups.com/track?tracknum='+t};
  if(/^9[2-4]\d{20}$/.test(tracking)||/^\d{22}$/.test(tracking)) return {name:'USPS',url:'https://tools.usps.com/go/TrackConfirmAction?tLabels='+t};
  if(/^\d{12,15}$/.test(tracking)) return {name:'FedEx',url:'https://www.fedex.com/apps/fedextrack/?tracknumbers='+t};
  if(/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tracking)) return {name:'DHL',url:'https://www.dhl.com/en/express/tracking.html?AWB='+t};
  return {name:'Track',url:'https://parcelsapp.com/en/tracking/'+t};
}

// ── EXPECTED DELIVERY ────────────────────────────────────────────
function extractExpectedDelivery(body) {
  const text = body.toLowerCase();
  const patterns = [
    /(?:expected|estimated|arriving|arrive[sd]?|delivery|delivers?)\s*(?:by|on|:)?\s*([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4})/i,
    /(?:get it by|arrives by|delivers by|deliver by)\s+([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /(\w+(?:day)?),\s+([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2}))?/i,
  ];
  for(const pat of patterns){
    const m = body.match(pat);
    if(m && m[1]){
      try{
        const d = new Date(m[1].replace(/(st|nd|rd|th)/i,''));
        if(!isNaN(d.getTime()) && d > new Date()) return d.toISOString().split('T')[0];
      }catch(_){}
    }
  }
  // Estimate: shipped = +5 days, ordered = +7 days
  return null;
}

function estimateDelivery(status, date) {
  if(!date) return null;
  const d = new Date(date+'T00:00:00');
  const days = status==='shipped' ? 5 : status==='ordered' ? 7 : null;
  if(!days) return null;
  d.setDate(d.getDate()+days);
  return d.toISOString().split('T')[0];
}

function getAllowedStore(fromAddr, bodyText) {
  const f = (fromAddr||'').toLowerCase();
  const b = (bodyText||'').toLowerCase().slice(0,3000);
  for(const store of ALLOWED_STORES){
    for(const domain of store.domains){
      if(f.includes(domain)||b.includes(domain)) return store.name;
    }
  }
  return null;
}

// Turn any sender address into a readable store name, e.g.
// "Orders <no-reply@email.shop.example.com>" → "Example"
function storeNameFromEmail(fromAddr) {
  const m = (fromAddr||'').match(/[\w.+-]+@([\w.-]+)/);
  if(!m) return 'Other';
  let domain = m[1].toLowerCase();
  // strip common sending sub-domains so we land on the real brand
  domain = domain.replace(/^(?:email|em|mail|e|info|news|newsletter|no-?reply|noreply|order|orders|shop|store|t|m|click|send|mailer|notification|notifications|reply|hello|hi|do-?not-?reply)\./,'');
  const parts = domain.split('.');
  let name = parts.length>=2 ? parts[parts.length-2] : parts[0];
  // handle 2-part TLDs like co.uk / com.au
  if(['co','com','org','net','gov','ac'].includes(name) && parts.length>=3) name = parts[parts.length-3];
  if(!name) return 'Other';
  return name.charAt(0).toUpperCase()+name.slice(1);
}

// Shipping-notification relays send "your order shipped" emails on behalf of
// many stores (e.g. Pokémon Center ships via Narvar). The real store name is in
// the email's display name, not the domain — so for these we use the display name.
const RELAY_DOMAINS = ['narvar.com','route.com','shipstation.com','aftership.com',
  'shipup.co','convey.com','shippo.com','parcellab.com','shipbob.com'];

// Pull a clean brand name from the "From" display name, ignoring generic labels.
function displayName(fromAddr) {
  const m = (fromAddr||'').match(/^\s*"?([^"<]+?)"?\s*</);
  let name = m ? m[1].trim() : '';
  if(/^(?:orders?|shipping|ship(?:ment)?|tracking|no-?reply|noreply|notifications?|info|news|hello|hi|support|team|store|sales|service|do-?not-?reply|account|customer\s*care)$/i.test(name)) name = '';
  return name;
}

// Always returns a store name — known brands get their proper name, relays use
// the display name, everything else is derived from the sender domain. Never null.
function getStoreName(fromAddr, bodyText) {
  const known = getAllowedStore(fromAddr, bodyText);
  if(known) return known;
  const f = (fromAddr||'').toLowerCase();
  if(RELAY_DOMAINS.some(d=>f.includes(d))){
    const disp = displayName(fromAddr);
    if(disp) return disp;
  }
  return storeNameFromEmail(fromAddr);
}

// A few "shipped" keywords are weak on their own — "tracking number" in
// particular appears in plenty of order CONFIRMATIONS ("a tracking number will
// follow once your order ships"). Those only count as shipped when an actual
// ship/dispatch verb co-occurs, otherwise they fall through to later buckets
// (so the email is read as an order, not misflagged shipped).
const WEAK_SHIPPED = ['tracking number'];
const SHIP_VERB = /\b(shipp?ed|dispatch(?:ed)?|on its way|out for delivery|has left|label created|in transit)\b/;
function detectStatus(subject, body) {
  const text = (subject+' '+body).toLowerCase();
  const order = ['delivered','cancelled','shipped','preorder','ordered'];
  for(const status of order){
    for(const word of KEYWORDS[status]){
      if(!text.includes(word)) continue;
      if(status==='shipped' && WEAK_SHIPPED.includes(word) && !SHIP_VERB.test(text)) continue; // weak signal, no ship verb → not shipped
      return status;
    }
  }
  return null;
}

// Best-effort product photo pulled straight out of the order confirmation
// email — most retailers embed one. We just hotlink the retailer's own image
// URL (same one the email already shows), never download/store the image
// ourselves. Deliberately conservative: skip anything that isn't a plain
// absolute http(s) URL, and skip obvious chrome (logos, icons, tracking
// pixels, social badges) so we don't end up showing a store's logo instead
// of the actual product.
const IMG_SKIP_PATTERN = /logo|icon|sprite|pixel|spacer|tracking|badge|social|facebook|twitter|instagram|pinterest|banner|header|footer|button|arrow|star-rating|divider/i;
function extractProductImage(html) {
  if (!html) return '';
  const candidates = [];
  const imgTagRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgTagRe.exec(html))) {
    const tag = m[0];
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1].trim();
    // Only plain absolute http(s) URLs — no data:, cid:, javascript:, or
    // anything containing characters that could break out of an attribute.
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(src)) continue;
    if (src.length > 500) continue;
    if (IMG_SKIP_PATTERN.test(src)) continue;
    const widthMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const heightMatch = tag.match(/\bheight=["']?(\d+)/i);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;
    // Explicit tiny dimensions (tracking pixels, spacer gifs) — skip.
    if ((width && width < 80) || (height && height < 80)) continue;
    candidates.push({ src, area: width && height ? width * height : 0 });
  }
  if (!candidates.length) return '';
  // Prefer the largest declared image; if none declare size, take the first
  // real candidate (skip common first-in-email chrome like a masthead logo).
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0].src;
}

// The single source of truth for "is this email an order, and what's in it?".
// Returns null if the email isn't an order/ship/delivery/cancel message.
// Both the live sync loop AND the test harness call this, so tests reflect reality.
function classifyEmail(subject, fromAddr, body) {
  if(isFoodEmail(subject, fromAddr)) return null; // meals/groceries aren't merchandise
  if(isNonMerchandiseEmail(subject, fromAddr, body)) return null; // travel, tickets, subscriptions, services
  const status = detectStatus(subject, body);
  if(!status) return null;
  if(!hasMerchandiseSignal(subject, fromAddr, body)) return null;
  const store    = getStoreName(fromAddr, body);
  const price    = extractPrice(subject, body);
  const orderNum = extractOrderNum(subject, body);
  const tracking = extractTracking(body);
  const carrier  = detectCarrier(tracking);
  const cat      = detectCategory(subject, body);
  return {
    status, store, price, orderNum, tracking,
    carrier: carrier?.name || '',
    trackingUrl: carrier?.url || '',
    cat,
  };
}

// A stable per-email fingerprint. Prefers the real Message-ID header (unique by
// definition); falls back to a content hash only for the rare email missing one.
function computeEmailId(messageId, fromAddr, subject, date, body) {
  if(messageId) return messageId;
  return crypto.createHash('md5').update((fromAddr||'')+'|'+(subject||'')+'|'+(date||'')+'|'+(body||'').slice(0,200)).digest('hex');
}

// Turn a captured money string into a number, handling:
//   $1,299.00 (comma thousands) → 1299     79,90 (euro decimal comma) → 79.90
function parseMoney(raw) {
  if(!raw) return 0;
  let s = raw.replace(/[£€$\s]/g,'');
  s = s.replace(/,(\d{3})(?=[.,]|$)/g, '$1'); // strip thousands commas: 1,299 → 1299
  s = s.replace(/,(\d{2})$/, '.$1');          // euro decimal comma:   79,90 → 79.90
  s = s.replace(/,/g, '');                    // drop any leftover commas
  return parseFloat(s) || 0;
}

function extractPrice(subject, body) {
  const text = subject+' '+body;
  // Only trust amounts that are explicitly labelled as an order/grand/payment total.
  // We deliberately DO NOT fall back to "the first $ in the email" — that grabs
  // coupon lines like "$5 off your next order" instead of the real total.
  // \btotal also avoids matching "subtotal" (which excludes tax/shipping).
  // The number group allows thousands separators and an optional £/€/$ symbol.
  const num = '([£€$]?\\s*\\d[\\d.,]*\\d|[£€$]?\\s*\\d)';
  const patterns = [
    new RegExp('grand\\s*total[:\\s]+'+num, 'i'),
    new RegExp('order\\s*total[:\\s]+'+num, 'i'),
    new RegExp('(?:amount|total)\\s*(?:paid|charged|due)[:\\s]+'+num, 'i'),
    new RegExp('\\btotal[:\\s]+'+num, 'i'),
  ];
  for(const pat of patterns){
    const m = text.match(pat);
    if(m&&m[1]){
      const val = parseMoney(m[1]);
      if(val>0&&val<999999) return val;
    }
  }
  return 0;
}

function extractOrderNum(subject, body) {
  const text = subject+' '+body;
  const patterns = [
    /order\s*(?:number|#|no\.?|id)\s*[:#]?\s*([A-Z0-9\-]{4,24})/i,
    /confirmation\s*(?:number|#|code|id)\s*[:#]?\s*([A-Z0-9\-]{4,24})/i,
    /#\s*([A-Z0-9\-]{6,20})\b/i,
  ];
  for(const pat of patterns){
    const m = text.match(pat);
    if(m&&m[1]) return m[1].slice(0,24);
  }
  return '';
}

function extractTracking(body) {
  // Highly specific carrier formats — safe to match anywhere in the email.
  const strict = [
    /\b(1Z[A-Z0-9]{16})\b/,        // UPS
    /\b(9[2-4]\d{20})\b/,          // USPS (22-digit)
    /\b([A-Z]{2}\d{9}[A-Z]{2})\b/, // DHL / international
  ];
  for(const pat of strict){
    const m = body.match(pat);
    if(m) return m[1];
  }
  // FedEx (12/15-digit) looks like an order number or phone number, so only
  // accept a plain number when it sits right next to a "tracking" label.
  const near = body.match(/track(?:ing)?\s*(?:number|no\.?|#)?\s*[:#]?\s*([0-9]{12,22})\b/i);
  if(near&&near[1]) return near[1];
  return '';
}

function detectCategory(subject, body) {
  const text = (subject+' '+body).toLowerCase();
  if(text.match(/psa|bgs|cgc|graded|slab|grade \d/)) return 'graded';
  if(text.match(/booster box|etb|elite trainer|blister|booster pack|tin|bundle|collection box/)) return 'packs';
  if(text.match(/single|holo|alt art|secret rare|full art|rainbow rare|illustration rare/)) return 'cards';
  if(text.match(/figure|plush|statue|funko|model kit/)) return 'figures';
  if(text.match(/binder|sleeve|top loader|deck box|portfolio|playmat/)) return 'accessories';
  return 'other';
}

// ── PERSISTENT ORDER STORAGE (survives restarts & browser clears) ─
// Legacy single-user file — kept only so the very first account created can
// inherit whatever was already tracked before this multi-user update shipped.
const ORDERS_FILE = path.join(__dirname, 'orders.json');

function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) || [];
    }
  } catch (e) { console.log('Could not read orders.json:', e.message); }
  return [];
}

// ══════════════════════════════════════════════════════════════════
// MULTI-USER ACCOUNTS — every signed-up user gets their own orders and
// their own connected IMAP accounts, fully isolated from everyone else's.
// ══════════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ORDERS_DIR = path.join(DATA_DIR, 'orders');
const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');
const INVENTORY_DIR = path.join(DATA_DIR, 'inventory');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); }
ensureDir(DATA_DIR); ensureDir(ORDERS_DIR); ensureDir(ACCOUNTS_DIR); ensureDir(INVENTORY_DIR);

// ── Password hashing (Node's built-in scrypt — no extra dependency needed) ──
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check,'hex'), b = Buffer.from(hash,'hex');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

const COMMON_WEAK_PASSWORD_PARTS = [
  'password','passw0rd','qwerty','letmein','welcome','admin','login',
  'pokemon','pokémon','shipmentscope','shipment','scope','123456','111111'
];
function passwordRuleResults(password, email='') {
  const pw = String(password||'');
  const lower = pw.toLowerCase();
  const emailLocal = String(email||'').split('@')[0].toLowerCase();
  return [
    { ok: pw.length >= 12, message: 'Password must be at least 12 characters.' },
    { ok: pw.length <= 128, message: 'Password must be 128 characters or fewer.' },
    { ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), message: 'Password must include uppercase and lowercase letters.' },
    { ok: /\d/.test(pw), message: 'Password must include at least one number.' },
    { ok: /[^A-Za-z0-9\s]/.test(pw), message: 'Password must include at least one symbol.' },
    { ok: !/\s/.test(pw), message: 'Password cannot contain spaces.' },
    { ok: !emailLocal || emailLocal.length < 3 || !lower.includes(emailLocal), message: 'Password cannot include your email name.' },
    { ok: !COMMON_WEAK_PASSWORD_PARTS.some(part => lower.includes(part)), message: 'Password is too easy to guess.' },
  ];
}
function validateSignupPassword(password, email='') {
  const failed = passwordRuleResults(password, email).filter(r => !r.ok);
  return { ok: failed.length === 0, message: failed[0]?.message || '' };
}

// ── Encryption for stored IMAP passwords (AES-256-GCM) ──
// Uses ENCRYPTION_KEY env var if set (recommended for any real deployment);
// otherwise generates and persists a local key file so local/dev use still
// gets real encryption at rest without extra setup.
const KEY_FILE = path.join(DATA_DIR, '.encryption_key');
function getEncryptionKey(){
  if(process.env.ENCRYPTION_KEY) return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  if(fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE,'utf8'),'hex');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'));
  return key;
}
const ENC_KEY = getEncryptionKey();
function encrypt(text){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text||''),'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
function decrypt(b64){
  try{
    const buf = Buffer.from(b64,'base64');
    const iv=buf.subarray(0,12), tag=buf.subarray(12,28), enc=buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }catch(_){ return ''; }
}

// ── Users ──
function loadUsers(){ try{ if(fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE,'utf8'))||[]; }catch(_){} return []; }
function saveUsers(users){ fs.writeFileSync(USERS_FILE, JSON.stringify(users,null,2)); }
function findUserByEmail(email){ return loadUsers().find(u=>u.email.toLowerCase()===String(email||'').toLowerCase()); }
function findUserById(id){ return loadUsers().find(u=>u.id===id); }

// ── RATE LIMITING (in-memory, per-IP + per-email) ──────────────────
// Protects login/signup from brute-force password guessing and mass fake
// account creation. If deployed behind a trusted reverse proxy/load balancer,
// you'd want to read X-Forwarded-For instead of the raw socket address — kept
// simple here since a direct Node deploy (e.g. the Lightsail setup) is the norm.
const rateBuckets = new Map(); // key -> {count, windowStart}
function isRateLimited(key, maxAttempts, windowMs){
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if(!bucket || now-bucket.windowStart > windowMs){ rateBuckets.set(key,{count:1,windowStart:now}); return false; }
  bucket.count++;
  return bucket.count > maxAttempts;
}
function clientIp(req){ return req.socket.remoteAddress || 'unknown'; }
setInterval(()=>{ // sweep old buckets so this map can't grow forever
  const now=Date.now();
  for(const [k,v] of rateBuckets){ if(now-v.windowStart > 60*60*1000) rateBuckets.delete(k); }
}, 15*60*1000);

// ── Sessions (in-memory, cookie-based — a restart just logs everyone out) ──
const sessions = new Map();
const SESSION_TTL = 30*24*60*60*1000; // 30 days
// Sessions persist to disk so a server restart doesn't log everyone out
// (they used to live only in memory). Load on boot, prune expired, rewrite.
function loadSessions(){
  try{
    if(fs.existsSync(SESSIONS_FILE)){
      const obj=JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8'))||{};
      const now=Date.now();
      for(const [token,sess] of Object.entries(obj)){
        if(sess&&sess.expires>now) sessions.set(token,sess);
      }
    }
  }catch(e){ console.log('Could not load sessions:', e.message); }
}
let _sessionsWriteTimer=null;
function persistSessions(){
  // Debounced so a burst of logins doesn't hammer the disk.
  if(_sessionsWriteTimer) return;
  _sessionsWriteTimer=setTimeout(()=>{
    _sessionsWriteTimer=null;
    try{ fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); }
    catch(e){ console.log('Could not persist sessions:', e.message); }
  }, 500);
}
loadSessions();
function createSession(userId){
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expires: Date.now()+SESSION_TTL });
  persistSessions();
  return token;
}
function parseCookies(str){
  const out={};
  (str||'').split(';').forEach(p=>{
    const i=p.indexOf('=');
    if(i>-1) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
function getSessionUserId(req){
  const token = parseCookies(req.headers.cookie)['sc_session'];
  if(!token) return null;
  const sess = sessions.get(token);
  if(!sess || sess.expires < Date.now()){ sessions.delete(token); persistSessions(); return null; }
  return sess.userId;
}

// ── Per-user order storage ──
function ordersFileFor(userId){ return path.join(ORDERS_DIR, userId+'.json'); }
const DELIVERED_RETENTION_DAYS = 4;
function deliveredDateForOrder(o){
  const hist = Array.isArray(o?.history) ? o.history : [];
  for(let i=hist.length-1;i>=0;i--){
    if(hist[i]?.status==='delivered' && hist[i].date) return hist[i].date;
  }
  return o?.status==='delivered' ? o.date : null;
}
function shouldAutoDeleteDelivered(o){
  const deliveredAt = deliveredDateForOrder(o);
  if(!deliveredAt) return false;
  const d = new Date(deliveredAt+'T00:00:00');
  if(isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0,0,0,0);
  cutoff.setDate(cutoff.getDate()-DELIVERED_RETENTION_DAYS);
  return d <= cutoff;
}
function pruneDeliveredOrders(orders){
  return (orders||[]).filter(o=>!shouldAutoDeleteDelivered(o));
}
function loadOrdersFor(userId){
  try{
    const f=ordersFileFor(userId);
    if(fs.existsSync(f)){
      const raw=JSON.parse(fs.readFileSync(f,'utf8'))||[];
      const pruned=pruneDeliveredOrders(raw);
      if(pruned.length!==raw.length) saveOrdersFor(userId, pruned);
      return pruned;
    }
  }catch(_){}
  return [];
}
function saveOrdersFor(userId, orders){
  try{ fs.writeFileSync(ordersFileFor(userId), JSON.stringify(pruneDeliveredOrders(orders),null,2)); return true; }
  catch(e){ console.log('Could not save orders for user:', e.message); return false; }
}

// ── Per-user inventory storage (mirrors orders storage above) ──
function inventoryFileFor(userId){ return path.join(INVENTORY_DIR, userId+'.json'); }
function loadInventoryFor(userId){
  try{ const f=inventoryFileFor(userId); if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8'))||[]; }catch(_){}
  return [];
}
function saveInventoryFor(userId, items){
  try{ fs.writeFileSync(inventoryFileFor(userId), JSON.stringify(items,null,2)); return true; }
  catch(e){ console.log('Could not save inventory for user:', e.message); return false; }
}

// ── Per-user IMAP account storage (passwords encrypted at rest) ──
function accountsFileFor(userId){ return path.join(ACCOUNTS_DIR, userId+'.json'); }
function loadAccountsFor(userId){
  try{
    const f=accountsFileFor(userId);
    if(fs.existsSync(f)) return (JSON.parse(fs.readFileSync(f,'utf8'))||[]).map(a=>({
      ...a,
      password: a.password ? decrypt(a.password) : '',
      oauthRefreshToken: a.oauthRefreshToken ? decrypt(a.oauthRefreshToken) : '',
    }));
  }catch(_){}
  return [];
}
function saveAccountsFor(userId, accounts){
  const enc = accounts.map(a=>({
    ...a,
    password: a.password ? encrypt(a.password) : '',
    oauthRefreshToken: a.oauthRefreshToken ? encrypt(a.oauthRefreshToken) : '',
  }));
  fs.writeFileSync(accountsFileFor(userId), JSON.stringify(enc,null,2));
}
function publicAccount(a){
  return {email:a.email, provider:a.provider||'custom', host:a.host||'', port:a.port||'993'};
}
function loadAllAccountsWithOwners(){
  // Used by the auto-poll loop — every user's accounts, tagged with who owns them.
  return loadUsers().flatMap(u => loadAccountsFor(u.id).map(a => ({...a, __userId: u.id})));
}

// ── Developer stats (aggregate only — never exposes any user's personal data) ──
function computeAdminStats(){
  const users = loadUsers();
  let totalOrders=0, totalValue=0, totalAccounts=0;
  const statusBreakdown = {ordered:0, shipped:0, delivered:0, cancelled:0, preorder:0};
  const now = Date.now();
  let signups7d=0, signups30d=0, active7d=0;
  for(const u of users){
    const orders = loadOrdersFor(u.id);
    totalOrders += orders.length;
    for(const o of orders){
      if(o.status!=='cancelled') totalValue += (o.price||0);
      if(statusBreakdown[o.status]!=null) statusBreakdown[o.status]++;
    }
    totalAccounts += loadAccountsFor(u.id).length;
    const createdAt = new Date(u.createdAt).getTime();
    if(now-createdAt < 7*24*60*60*1000) signups7d++;
    if(now-createdAt < 30*24*60*60*1000) signups30d++;
    if(u.lastLoginAt && now-new Date(u.lastLoginAt).getTime() < 7*24*60*60*1000) active7d++;
  }
  return {
    totalUsers: users.length, totalOrders,
    totalValue: Math.round(totalValue*100)/100,
    totalAccounts, statusBreakdown, signups7d, signups30d, active7d,
    avgOrdersPerUser: users.length ? Math.round((totalOrders/users.length)*10)/10 : 0,
  };
}

// Per-user buffer of newly-found orders (fixes a real bug: this used to be ONE
// shared array, so any signed-in user's poll would return everyone else's new
// orders too — a real cross-user data leak in the old single-user design).
const newOrdersBuffers = {}; // userId -> order[]
function pushToUserBuffer(userId, found){
  if(!found.length) return;
  const buf = (newOrdersBuffers[userId] = newOrdersBuffers[userId] || []);
  buf.push(...found);
  if(buf.length>50) newOrdersBuffers[userId] = buf.slice(-50);
}

const googleOAuthStates = new Map(); // state -> {userId, expires}
function requestOrigin(req){
  const proto = req.headers['x-forwarded-proto'] || (isSecureRequest(req) ? 'https' : 'http');
  return proto+'://'+req.headers.host;
}
function googleRedirectUri(req){
  return process.env.GOOGLE_REDIRECT_URI || (requestOrigin(req)+'/api/oauth/google/callback');
}
function googleOAuthConfigured(){
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function googleOAuthSetupMessage(req){
  return 'Google sign-in for Gmail is not configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and this redirect URI to .env: '+googleRedirectUri(req);
}
async function exchangeGoogleCode(code, req){
  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: googleRedirectUri(req),
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params.toString(),
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}
async function refreshGoogleAccessToken(refreshToken){
  if(!refreshToken) throw new Error('Missing Google refresh token');
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params.toString(),
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data.error_description || data.error || 'Google token refresh failed');
  return data.access_token;
}
async function fetchGoogleEmail(accessToken){
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {headers:{Authorization:'Bearer '+accessToken}});
  const data = await r.json();
  if(!r.ok || !data.email) throw new Error(data.error?.message || 'Could not read Gmail account email');
  return data.email;
}

async function syncImap(config, sinceDate, scanDays) {
  const { host, port, email, password } = config;
  const auth = { user: email };
  if(config.provider==='gmail-oauth' || config.oauthRefreshToken){
    if(!googleOAuthConfigured()) throw new Error('Gmail OAuth is not configured on this server');
    auth.accessToken = await refreshGoogleAccessToken(config.oauthRefreshToken);
  }else{
    auth.pass = password;
  }
  const client = new ImapFlow({
    host, port: parseInt(port)||993, secure: true,
    auth,
    logger: false,
  });

  const results = [];
  const seen = new Set(); // dedupe within this one scan (cross-scan dedup is done client-side)
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = sinceDate || new Date();
      const days = Math.min(180, Math.max(1, parseInt(scanDays)||30));
      if(!sinceDate) since.setDate(since.getDate()-days); // configurable scan window (Settings → Sync)

      const messages = await client.search({
        since,
        or: [
          {subject:'order'},{subject:'shipped'},{subject:'delivered'},
          {subject:'cancelled'},{subject:'canceled'},{subject:'confirmation'},
          {subject:'tracking'},{subject:'receipt'},{subject:'refund'},
          {subject:'shipment'},{subject:'preorder'},{subject:'pre-order'},
          {subject:'purchase'},{subject:'dispatched'},{subject:'on its way'},
          {subject:'delivery'},{subject:'invoice'},{subject:'payment'},
          {subject:'sold'},{subject:'arriving'},{subject:'out for delivery'},
        ],
      });

      console.log(`Found ${messages.length} candidate messages`);
      let skipped = 0;
      // ── DIAGNOSTICS: count where emails get dropped so we can fix the right gate ──
      const diag = { noStatus: 0, food: 0, dup: 0, kept: 0, noStatusSamples: [] };

      for await(const msg of client.fetch(messages.slice(-1200),{envelope:true,source:true})){
        try{
          const parsed   = await simpleParser(msg.source);
          const subject  = parsed.subject||'';
          const fromAddr = parsed.from?.text||'';
          const bodyText = parsed.text||(parsed.html||'').replace(/<[^>]*>/g,' ')||'';
          const htmlBody = parsed.html||'';

          // Food/restaurant/grocery receipts are never merchandise — drop first
          // so the "not an order" diagnostics don't fill up with meal receipts.
          if(isFoodEmail(subject, fromAddr)){ skipped++; diag.food++; continue; }

          // An email is an "order" if it looks like an order/ship/delivery/cancel
          // message — regardless of which store it's from. Same logic the tests use.
          const info = classifyEmail(subject, fromAddr, bodyText);
          if(!info){
            skipped++; diag.noStatus++;
            if(diag.noStatusSamples.length<20) diag.noStatusSamples.push(`${fromAddr}  ::  ${subject.slice(0,70)}`);
            continue;
          }
          const date     = parsed.date ? parsed.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
          const expectedDelivery = extractExpectedDelivery(bodyText) || estimateDelivery(info.status, date);

          // Every real email has its own unique Message-ID — that's the one thing
          // that safely proves "this is literally the same email" (e.g. re-fetched
          // by IMAP). We pass it to the client too (as emailId) so future re-scans
          // never merge same-day orders again. Deliberately NOT deduping by
          // subject+date: stores often send many same-day orders using an
          // identical subject template with no order number in the body — keying
          // on subject text there would wrongly merge distinct real orders into 1
          // (this was the exact cause of orders silently disappearing on scan).
          const emailId = computeEmailId(parsed.messageId, fromAddr, subject, date, bodyText);
          if(seen.has(emailId)){skipped++;diag.dup++;continue;}
          seen.add(emailId);
          diag.kept++;

          results.push({
            emailId,
            name:      subject.replace(/^(re:|fwd:|fw:)\s*/i,'').trim().slice(0,100),
            store: info.store, price: info.price, date, status: info.status,
            cat: info.cat, orderNum: info.orderNum, tracking: info.tracking,
            carrier:   info.carrier,
            trackingUrl: info.trackingUrl,
            expectedDelivery,
            source:    fromAddr,
            image:     extractProductImage(htmlBody),
            emailHtml: htmlBody.slice(0,50000),
            emailText: bodyText.slice(0,10000),
          });
        }catch(_){}
      }
      console.log(`Imported: ${results.length} | Skipped: ${skipped}`);
      console.log('\n══════════ SYNC DIAGNOSTICS ══════════');
      console.log(`Candidate emails fetched : ${Math.min(messages.length,1200)}`);
      console.log(`✓ Kept as orders         : ${diag.kept}`);
      console.log(`✗ Dropped — not an order/ship/delivery email : ${diag.noStatus}`);
      console.log(`✗ Dropped — food/restaurant/grocery receipt  : ${diag.food}`);
      console.log(`✗ Dropped — duplicate in this scan           : ${diag.dup}`);
      if(diag.noStatusSamples.length){
        console.log('\n— Examples dropped because no order/ship/delivery wording was detected —');
        console.log('  (if you see real orders here, tell Claude and the rules get widened)');
        diag.noStatusSamples.forEach(s=>console.log('   '+s));
      }
      console.log('══════════════════════════════════════\n');
    }finally{ lock.release(); }
    await client.logout();
  }catch(err){
    throw new Error('IMAP connection failed: '+err.message);
  }
  return results;
}

// ── AUTO POLL every 5 minutes ────────────────────────────────────
// Reads every user's persisted, encrypted accounts from disk each tick — so
// polling resumes correctly after a server restart, and each account's new
// orders land only in ITS OWNER's buffer (see pushToUserBuffer above).
function startAutoPoll() {
  setInterval(async () => {
    const accounts = loadAllAccountsWithOwners();
    if(!accounts.length) return;
    const since = new Date();
    since.setMinutes(since.getMinutes()-6); // last 6 mins
    for(const acct of accounts){
      try {
        console.log(`\n⏱ Auto-polling ${acct.email}...`);
        const found = await syncImap(acct, since);
        if(found.length){
          console.log(`🆕 ${found.length} new order(s) found for ${acct.email}!`);
          pushToUserBuffer(acct.__userId, found);
        }
      }catch(e){ console.log(`Poll error for ${acct.email}:`,e.message); }
    }
  }, 5*60*1000); // every 5 minutes
}

// ── HTTP SERVER ──────────────────────────────────────────────────
// Wildcard is safe here: no Access-Control-Allow-Credentials header is ever
// sent, so browsers refuse to attach the session cookie to any cross-origin
// request regardless of this origin value (fetch/XHR spec, not app logic) —
// and SameSite=Lax on the cookie blocks it a second way besides.
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};

// Baseline hardening headers applied to EVERY response (see the res.writeHead
// patch below) — CSP allows 'unsafe-inline' for script/style because the
// frontend is a single HTML file with inline <script>/<style> by design; the
// real protections here are frame-ancestors/object-src/base-uri, which stop
// clickjacking and injected-tag attacks without requiring a frontend rewrite.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
function isSecureRequest(req){
  return req.headers['x-forwarded-proto']==='https' || process.env.NODE_ENV==='production';
}
function sessionCookie(token, maxAgeSeconds, req){
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `sc_session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

// ── EMAIL 2FA + TRUSTED DEVICES ──────────────────────────────────────
// Codes are emailed on signup and on login from an unrecognized device; once
// verified, that browser gets a 30-day "trusted device" cookie so it isn't
// asked again. Sending uses Gmail SMTP by default (set SMTP_USER + SMTP_PASS
// to a Gmail address + app password). If SMTP isn't configured, codes are
// printed to the server console so the flow still works in local dev.
let nodemailer=null; try{ nodemailer=require('nodemailer'); }catch(_){}
let _mailTransport=null, _mailTransportTried=false;
function getMailTransport(){
  if(_mailTransportTried) return _mailTransport;
  _mailTransportTried=true;
  if(nodemailer && process.env.SMTP_USER && process.env.SMTP_PASS){
    const port=parseInt(process.env.SMTP_PORT)||465;
    _mailTransport=nodemailer.createTransport({
      host: process.env.SMTP_HOST||'smtp.gmail.com', port, secure: port===465,
      auth:{ user:process.env.SMTP_USER, pass:process.env.SMTP_PASS },
    });
  }
  return _mailTransport;
}
async function sendMail(to, subject, html){
  const t=getMailTransport();
  if(!t){ console.log(`\n[MAIL DEV MODE — set SMTP_USER/SMTP_PASS to send for real]\n  To: ${to}\n  ${subject}\n  ${html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}\n`); return true; }
  const from=process.env.SMTP_FROM || ('ShipmentScope <'+process.env.SMTP_USER+'>');
  const text = html.replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/\s+/g,' ')
    .trim();
  await t.sendMail({from,to,subject,text,html});
  return true;
}
function twoFactorEmailHtml(code, purpose){
  const action = purpose==='signup' ? 'finish creating your account' : 'sign in';
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#18142f;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your ShipmentScope verification code is ${code}. It expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e2ff;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(52,38,123,.12);">
          <tr>
            <td style="padding:24px 28px 18px;background:linear-gradient(135deg,#24124f,#5b21b6 55%,#8b5cf6);">
              <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#d9d1ff;font-weight:700;">ShipmentScope</div>
              <div style="font-size:24px;line-height:1.25;color:#ffffff;font-weight:800;margin-top:8px;">Verify your sign-in</div>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 26px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#332f4d;">Enter this code to ${action}. For your security, the code expires in 10 minutes.</p>
              <div style="background:#f2efff;border:1px solid #ded7ff;border-radius:14px;padding:20px 12px;text-align:center;margin:20px 0 18px;">
                <div style="font-size:34px;line-height:1;letter-spacing:10px;color:#5b21b6;font-weight:900;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${code}</div>
              </div>
              <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#6f6a85;">Never share this code. ShipmentScope support will never ask you for it.</p>
              <div style="border-top:1px solid #eeeafc;padding-top:18px;margin-top:18px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8a859d;">If you did not request this code, you can safely ignore this email. No changes will be made to your account.</p>
              </div>
            </td>
          </tr>
        </table>
        <div style="max-width:520px;margin:14px auto 0;text-align:center;font-size:11px;line-height:1.5;color:#9a94b4;">ShipmentScope account security</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
function make2faCode(){ return String(crypto.randomInt(100000, 1000000)); }
function hash2faCode(code){ return crypto.createHash('sha256').update(String(code)).digest('hex'); }

// Short-lived pending auth challenges (in-memory; a 10-min code is fine to lose
// on restart — the user just requests a new one).
const pendingAuth = new Map(); // challengeToken -> {email, purpose, codeHash, expires, attempts, data}
const CODE_TTL = 10*60*1000;
function createChallenge(purpose, email, data){
  const token=crypto.randomBytes(24).toString('hex');
  const code=make2faCode();
  pendingAuth.set(token, {email, purpose, codeHash:hash2faCode(code), expires:Date.now()+CODE_TTL, attempts:0, data});
  return {token, code};
}
setInterval(()=>{ const now=Date.now(); for(const [k,v] of pendingAuth) if(v.expires<now) pendingAuth.delete(k); }, 60*1000);

// Trusted-device tokens live (hashed) on the user record so they survive
// restarts; the raw token is an HttpOnly cookie on the browser.
const DEVICE_TTL = 30*24*60*60*1000;
function deviceCookie(token, maxAgeSeconds, req){
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `sc_device=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}
function isTrustedDevice(user, req){
  const token=parseCookies(req.headers.cookie)['sc_device'];
  if(!token || !Array.isArray(user.trustedDevices)) return false;
  const h=hash2faCode(token), now=Date.now();
  return user.trustedDevices.some(d=>d.tokenHash===h && d.expires>now);
}
// Mutates the user object (caller must saveUsers) and returns the raw token.
function addTrustedDevice(user){
  const token=crypto.randomBytes(24).toString('hex');
  user.trustedDevices=(user.trustedDevices||[]).filter(d=>d.expires>Date.now());
  user.trustedDevices.push({tokenHash:hash2faCode(token), expires:Date.now()+DEVICE_TTL, addedAt:new Date().toISOString()});
  if(user.trustedDevices.length>20) user.trustedDevices=user.trustedDevices.slice(-20);
  return token;
}

function sendJSON(res, data, status=200){
  const body = Buffer.from(JSON.stringify(data));
  const headers = {'Content-Type':'application/json', ...CORS};
  // res.req is Node's own back-reference from ServerResponse to its request —
  // lets every existing sendJSON(res, data, status) call site gzip without
  // being rewritten to also pass req through.
  const acceptEncoding = (res.req && res.req.headers['accept-encoding']) || '';
  if(/gzip/.test(acceptEncoding) && body.length > 512){
    const gz = zlib.gzipSync(body);
    res.writeHead(status, {...headers, 'Content-Encoding':'gzip', 'Vary':'Accept-Encoding'});
    res.end(gz);
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}

// Caps request bodies at 15MB (generous for an orders backup with embedded
// email HTML/text) so a huge/slow POST can't be used to exhaust memory.
const MAX_BODY_BYTES = 15 * 1024 * 1024;
function readBody(req){
  return new Promise((resolve, reject)=>{
    let chunks=[], total=0, done=false;
    req.on('data', c=>{
      if(done) return;
      total += c.length;
      if(total > MAX_BODY_BYTES){
        done = true;
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', ()=>{ if(!done) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// ── TRACKING PROXY (avoids CORS) ────────────────────────────────
async function fetchTracking(trackingNum, carrier) {
  // Return tracking URL — browser will open it
  const c = detectCarrier(trackingNum);
  return { url: c?.url||null, carrier: c?.name||'Unknown', tracking: trackingNum };
}

// ── OPTIONAL PASSWORD GATES (HTTP Basic Auth) ─────────────────────
// Off by default — matches today's local, single-user behavior exactly.
// Before deploying anywhere public, set a SITE_PASSWORD environment
// variable; every request then requires HTTP Basic Auth with that
// password (any username works). Without it set, nothing changes.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
function checkBasicAuth(req, password) {
  if (!password) return true;
  if (isRateLimited('basicauth:'+clientIp(req), 20, 15*60*1000)) return false;
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}
function isAuthorized(req) { return checkBasicAuth(req, SITE_PASSWORD); }

// Developer stats page (/admin) — a SEPARATE password from SITE_PASSWORD, so
// you can share the app's main SITE_PASSWORD with beta testers without also
// handing out access to aggregate usage stats. Disabled unless you set it.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
function isAdminAuthorized(req) { return !!ADMIN_PASSWORD && checkBasicAuth(req, ADMIN_PASSWORD); }

const server = http.createServer(async (req, res) => {
  res.req = req; // Node normally sets this itself once headers flush; set it early so sendJSON's gzip check can read req.headers before then.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (status, headers) => {
    const extra = isSecureRequest(req) ? {...SECURITY_HEADERS, 'Strict-Transport-Security':'max-age=63072000; includeSubDomains'} : SECURITY_HEADERS;
    return origWriteHead(status, {...extra, ...headers});
  };

  if(req.method==='OPTIONS'){res.writeHead(204,CORS);res.end();return;}

  if(!isAuthorized(req)){
    res.writeHead(401, {'WWW-Authenticate':'Basic realm="ShipmentScope"', 'Content-Type':'text/plain'});
    res.end('Authentication required.');
    return;
  }

  if(req.method==='GET'&&req.url==='/robots.txt'){
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
    res.end('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n');
    return;
  }

  // Privacy policy — a real, standalone page (not the SPA), content accurate to
  // how this app actually stores/handles data. Linked from the landing page footer.
  if(req.method==='GET'&&req.url==='/privacy'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — ShipmentScope</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Outfit:wght@400..600&display=swap" rel="stylesheet">
<style>
body{background:#05060f;color:#d8ecf8;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;max-width:720px;margin:0 auto;padding:60px 24px 100px;line-height:1.7;}
a{color:#b6d9fc;}
h1{font-family:'Outfit',-apple-system,sans-serif;font-size:32px;font-weight:500;letter-spacing:normal;margin-bottom:6px;}
.updated{color:#81899b;font-size:13px;margin-bottom:40px;}
h2{font-family:'Outfit',-apple-system,sans-serif;font-size:18px;font-weight:500;margin:32px 0 10px;color:#d8ecf8;}
p,li{font-size:14px;color:#c7d3ea;}
ul{padding-left:20px;margin-top:6px;}
li{margin-bottom:6px;}
.back{display:inline-block;margin-bottom:30px;color:#81899b;font-size:13px;text-decoration:none;}
.back:hover{color:#c7d3ea;}
</style></head><body>
<a class="back" href="/">← Back to ShipmentScope</a>
<h1>Privacy Policy</h1>
<div class="updated">Last updated: July 2, 2026</div>

<h2>What we do</h2>
<p>ShipmentScope helps you track online orders by connecting to your email account. We scan your inbox for order confirmation and shipping emails from supported retailers and display that information in one dashboard.</p>

<h2>Data we access</h2>
<ul>
<li><strong>Email access (IMAP)</strong> — When you connect an email account, we use an app-specific password to search for order-related messages from supported retailers (Pokémon Center, Target, Amazon, TikTok Shop, Mattel Creations, Bandai, TCGPlayer, eBay, Whatnot, Mercari, and any custom store you configure). We do not read, store, or process any other emails in your inbox.</li>
<li><strong>Order data</strong> — Item name, store, price, date, status, tracking number, category, and any notes you add, extracted automatically from retailer emails or entered manually by you.</li>
<li><strong>Account credentials</strong> — Your ShipmentScope login email and password. Your password is hashed (scrypt) and never stored or transmitted in plain text.</li>
</ul>

<h2>Data storage</h2>
<p>Your orders and connected email account details are stored on our server, scoped to your account only — no other user can see them. Email account passwords are encrypted at rest (AES-256-GCM) before being stored, and are only decrypted in memory when actively syncing your inbox. Your browser also keeps a local cache of your orders for faster loading, tied to your account so it can't leak to someone else signing in on the same browser. Data transmitted between your browser and our server is encrypted in transit.</p>

<h2>Data sharing</h2>
<p>We do not sell, rent, or share your personal data or order information with any third party. Nothing you connect is used for advertising.</p>

<h2>Data deletion</h2>
<p>You can permanently delete your account at any time from Settings → Account. This immediately erases your orders, connected email accounts, and account record, and signs you out everywhere.</p>

<h2>Security</h2>
<p>Login passwords are hashed with scrypt and compared using timing-safe checks. Email passwords are encrypted at rest and used only to connect directly to your provider's mail server — never sent anywhere else. Sign-in sessions use an HttpOnly cookie that JavaScript can't read. Login and signup attempts are rate-limited to protect against automated password guessing.</p>

<h2>Hosting</h2>
<p>ShipmentScope is hosted on Amazon Web Services (AWS).</p>

<h2>Changes to this policy</h2>
<p>If this policy changes, we'll update the "Last updated" date above.</p>

<h2>Contact</h2>
<p>For questions about this policy, contact us at <a href="mailto:vrajp1030@gmail.com">vrajp1030@gmail.com</a>.</p>
</body></html>`);
    return;
  }

  // Terms of Service — a real, standalone page (not the SPA), mirroring the
  // /privacy pattern above. Linked from the landing page footer.
  if(req.method==='GET'&&req.url==='/terms'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — ShipmentScope</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Outfit:wght@400..600&display=swap" rel="stylesheet">
<style>
body{background:#05060f;color:#d8ecf8;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;max-width:720px;margin:0 auto;padding:60px 24px 100px;line-height:1.7;}
a{color:#b6d9fc;}
h1{font-family:'Outfit',-apple-system,sans-serif;font-size:32px;font-weight:500;letter-spacing:normal;margin-bottom:6px;}
.updated{color:#81899b;font-size:13px;margin-bottom:40px;}
h2{font-family:'Outfit',-apple-system,sans-serif;font-size:18px;font-weight:500;margin:32px 0 10px;color:#d8ecf8;}
p,li{font-size:14px;color:#c7d3ea;}
ul{padding-left:20px;margin-top:6px;}
li{margin-bottom:6px;}
.back{display:inline-block;margin-bottom:30px;color:#81899b;font-size:13px;text-decoration:none;}
.back:hover{color:#c7d3ea;}
</style></head><body>
<a class="back" href="/">← Back to ShipmentScope</a>
<h1>Terms of Service</h1>
<div class="updated">Last updated: July 5, 2026</div>

<h2>The service</h2>
<p>ShipmentScope is currently a free, beta service that helps you track online orders by connecting to your email account and scanning it for order-related messages. It is provided "as is," without warranty of any kind — features, availability, and pricing may change as the product develops.</p>

<h2>Your account</h2>
<p>You're responsible for keeping your login credentials secure and for the accuracy of any information you enter. You must be old enough to form a binding contract in your jurisdiction to create an account. One account is for one person's own use — don't share your login.</p>

<h2>Acceptable use</h2>
<ul>
<li>Only connect email accounts you own or have explicit permission to access.</li>
<li>Don't use the service to attempt unauthorized access to any system, or to interfere with its normal operation.</li>
<li>Don't use automated tools to scrape or abuse the service beyond normal personal use.</li>
</ul>

<h2>How email scanning works</h2>
<p>When you connect an email account, ShipmentScope searches your inbox for messages whose subject line matches order, shipping, tracking, or receipt-related keywords, then extracts order details from ones that look like a real order. See the <a href="/privacy">Privacy Policy</a> for details on what's stored and how.</p>

<h2>No warranty</h2>
<p>ShipmentScope does not guarantee that order or tracking information will always be complete, accurate, or up to date — it depends on what your retailers actually send by email. It also does not guarantee uptime or availability, and may go offline or change at any time.</p>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, ShipmentScope and its operator are not liable for any lost profits, missed purchases or deliveries, lost or corrupted data, or any indirect, incidental, special, or consequential damages arising from your use of — or inability to use — the service. The service is provided on a beta, "as is" and "as available" basis, without warranties of any kind.</p>

<h2>Ownership &amp; restrictions</h2>
<p>ShipmentScope — including its software, design, and branding — belongs to its operator. You may not copy, modify, reverse-engineer, scrape, resell, redistribute, or create derivative works from the service, except where such restrictions are prohibited by law.</p>

<h2>Not affiliated</h2>
<p>ShipmentScope is an independent service. It is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or any shipping carrier (including UPS, USPS, FedEx, DHL, or Amazon). All third-party product names, logos, and trademarks are the property of their respective owners and are used for identification only.</p>

<h2>Termination</h2>
<p>You can delete your account at any time from Settings → Account, which permanently erases your data. We may suspend or terminate accounts that violate these terms.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of the State of Delaware, United States, without regard to its conflict-of-laws rules, and any disputes will be handled in the courts located there.</p>

<h2>Changes to these terms</h2>
<p>If these terms change, we'll update the "Last updated" date above.</p>

<h2>Contact</h2>
<p>For questions about these terms, contact us at <a href="mailto:vrajp1030@gmail.com">vrajp1030@gmail.com</a>.</p>
</body></html>`);
    return;
  }

  // Static brand/product assets (logo, landing page imagery). Filename-only,
  // no subdirectories — blocks path traversal by construction.
  if(req.method==='GET'&&req.url.startsWith('/assets/')){
    const name=req.url.slice('/assets/'.length);
    const ext=path.extname(name).toLowerCase();
    const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
    if(!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name)||!types[ext]){res.writeHead(404);res.end('Not found');return;}
    const p=path.join(__dirname,'assets',name);
    if(fs.existsSync(p)){res.writeHead(200,{'Content-Type':types[ext],'Cache-Control':'public, max-age=86400'});fs.createReadStream(p).pipe(res);}
    else{res.writeHead(404);res.end('Not found');}
    return;
  }

  // Frontend CSS/JS, split out of the single HTML file for maintainability.
  // No cache-busting filename/version scheme exists yet, so no-cache (not
  // a long max-age) — always revalidate rather than risk a stale asset
  // surviving a deploy.
  if(req.method==='GET'&&(req.url==='/styles.css'||req.url==='/app.js')){
    const isCss=req.url==='/styles.css';
    const p=path.join(__dirname,isCss?'styles.css':'app.js');
    if(!fs.existsSync(p)){res.writeHead(404);res.end('Not found');return;}
    const contentType=isCss?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
    const acceptsGzip=/gzip/.test(req.headers['accept-encoding']||'');
    if(acceptsGzip){
      res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache','Content-Encoding':'gzip','Vary':'Accept-Encoding'});
      fs.createReadStream(p).pipe(zlib.createGzip()).pipe(res);
    } else {
      res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache'});
      fs.createReadStream(p).pipe(res);
    }
    return;
  }

  // Serve app — always, regardless of login state. The client-side JS decides
  // whether to show the login screen or the dashboard (calls /api/auth/me).
  if(req.method==='GET'&&req.url==='/'){
    const p=path.join(__dirname,'PokéOrders.html');
    if(fs.existsSync(p)){
      const acceptsGzip = /gzip/.test(req.headers['accept-encoding']||'');
      if(acceptsGzip){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Encoding':'gzip','Vary':'Accept-Encoding'});
        fs.createReadStream(p).pipe(zlib.createGzip()).pipe(res);
      } else {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        fs.createReadStream(p).pipe(res);
      }
    }
    else{res.writeHead(404);res.end('PokéOrders.html not found');}
    return;
  }

  // ── DEVELOPER STATS (/admin) ───────────────────────────────────────
  // A separate password from SITE_PASSWORD — set ADMIN_PASSWORD to enable.
  // Disabled entirely (404) if you never set it, so it's not a visible target.
  if(req.method==='GET'&&req.url==='/admin'){
    if(!ADMIN_PASSWORD){res.writeHead(404);res.end('Not found');return;}
    if(!isAdminAuthorized(req)){
      res.writeHead(401,{'WWW-Authenticate':'Basic realm="ShipmentScope Admin"','Content-Type':'text/plain'});
      res.end('Authentication required.');
      return;
    }
    const p=path.join(__dirname,'admin.html');
    if(fs.existsSync(p)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(p).pipe(res);}
    else{res.writeHead(404);res.end('admin.html not found');}
    return;
  }
  if(req.method==='GET'&&req.url==='/api/admin/stats'){
    if(!ADMIN_PASSWORD){sendJSON(res,{ok:false,message:'Admin panel disabled'},404);return;}
    if(!isAdminAuthorized(req)){sendJSON(res,{ok:false,message:'Not authorized'},401);return;}
    sendJSON(res,{ok:true,stats:computeAdminStats()});
    return;
  }

  // ── AUTH ─────────────────────────────────────────────────────────
  if(req.method==='POST'&&req.url==='/api/auth/signup'){
    try{
      if(isRateLimited('signup:'+clientIp(req), 5, 60*60*1000)){sendJSON(res,{ok:false,message:'Too many signup attempts from this connection. Try again later.'},429);return;}
      const {email,password,hp_field,acceptedTerms}=JSON.parse(await readBody(req));
      // Honeypot: a hidden form field real users never fill in. Bots that
      // auto-fill every field trip this — pretend success without creating
      // anything, so the bot doesn't learn to look for a different signal.
      if(hp_field){sendJSON(res,{ok:true,email,webhookToken:''});return;}
      if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){sendJSON(res,{ok:false,message:'Enter a valid email address'},400);return;}
      const pwCheck = validateSignupPassword(password, email);
      if(!pwCheck.ok){sendJSON(res,{ok:false,message:pwCheck.message},400);return;}
      const users=loadUsers();
      if(users.some(u=>u.email.toLowerCase()===email.toLowerCase())){sendJSON(res,{ok:false,message:'An account with that email already exists'},409);return;}
      // Don't create the account yet — email a 6-digit code first and stash the
      // would-be account fields in a short-lived challenge. verify-code creates it.
      const {salt,hash}=hashPassword(password);
      const {token:challenge,code}=createChallenge('signup', email, {email,salt,hash,acceptedTerms:!!acceptedTerms});
      sendMail(email,'Your ShipmentScope verification code',twoFactorEmailHtml(code,'signup')).catch(e=>console.log('2FA email failed:',e.message));
      sendJSON(res,{ok:true,needsCode:true,challenge,email});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  if(req.method==='POST'&&req.url==='/api/auth/login'){
    try{
      const {email,password}=JSON.parse(await readBody(req));
      // Two rate limits: per-IP (stops one attacker spraying many emails) and
      // per-email (stops a distributed attack targeting one specific account).
      if(isRateLimited('login-ip:'+clientIp(req), 15, 15*60*1000)){sendJSON(res,{ok:false,message:'Too many login attempts. Try again in a few minutes.'},429);return;}
      if(email&&isRateLimited('login-email:'+email.toLowerCase(), 8, 15*60*1000)){sendJSON(res,{ok:false,message:'Too many attempts for this account. Try again in a few minutes.'},429);return;}
      const user=findUserByEmail(email);
      if(!user||!verifyPassword(password,user.salt,user.hash)){sendJSON(res,{ok:false,message:'Incorrect email or password'},401);return;}
      // A remembered device (verified within the last 30 days) skips the code.
      if(isTrustedDevice(user, req)){
        const token=createSession(user.id);
        const users=loadUsers();
        const idx=users.findIndex(u=>u.id===user.id);
        if(idx>-1){users[idx].lastLoginAt=new Date().toISOString();saveUsers(users);}
        res.setHeader('Set-Cookie',sessionCookie(token, 30*24*60*60, req));
        sendJSON(res,{ok:true,email:user.email,webhookToken:user.webhookToken});
        return;
      }
      // New/unknown device → email a code and require verification.
      const {token:challenge,code}=createChallenge('login', email, {userId:user.id});
      sendMail(user.email,'Your ShipmentScope verification code',twoFactorEmailHtml(code,'login')).catch(e=>console.log('2FA email failed:',e.message));
      sendJSON(res,{ok:true,needsCode:true,challenge,email:user.email});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Verify a 6-digit code, then finish signup/login and remember this device.
  if(req.method==='POST'&&req.url==='/api/auth/verify-code'){
    try{
      if(isRateLimited('verify-ip:'+clientIp(req), 30, 15*60*1000)){sendJSON(res,{ok:false,message:'Too many attempts. Try again in a few minutes.'},429);return;}
      const {challenge,code}=JSON.parse(await readBody(req));
      const p=pendingAuth.get(challenge);
      if(!p || p.expires<Date.now()){ pendingAuth.delete(challenge); sendJSON(res,{ok:false,expired:true,message:'That code expired. Request a new one.'},400); return; }
      p.attempts++;
      if(p.attempts>5){ pendingAuth.delete(challenge); sendJSON(res,{ok:false,expired:true,message:'Too many incorrect codes. Start over.'},429); return; }
      if(hash2faCode(String(code||''))!==p.codeHash){ sendJSON(res,{ok:false,message:'Incorrect code. '+(6-p.attempts)+' attempt'+(6-p.attempts===1?'':'s')+' left.'}); return; }
      pendingAuth.delete(challenge);
      const nowIso=new Date().toISOString();
      let user, deviceToken;
      if(p.purpose==='signup'){
        const users=loadUsers();
        if(users.some(u=>u.email.toLowerCase()===p.data.email.toLowerCase())){ sendJSON(res,{ok:false,message:'An account with that email already exists'},409); return; }
        const isFirstUser=users.length===0;
        user={id:crypto.randomUUID(),email:p.data.email,salt:p.data.salt,hash:p.data.hash,webhookToken:crypto.randomBytes(16).toString('hex'),createdAt:nowIso,lastLoginAt:nowIso,acceptedTermsAt:p.data.acceptedTerms?nowIso:null,termsVersion:'2026-07-05',trustedDevices:[]};
        deviceToken=addTrustedDevice(user);
        users.push(user);saveUsers(users);
        if(isFirstUser){ const legacyOrders=loadOrders(); if(legacyOrders.length) saveOrdersFor(user.id, legacyOrders); }
      }else{
        const users=loadUsers();
        const idx=users.findIndex(u=>u.id===p.data.userId);
        if(idx<0){ sendJSON(res,{ok:false,message:'Account not found'},404); return; }
        user=users[idx];
        deviceToken=addTrustedDevice(user);
        user.lastLoginAt=nowIso;
        saveUsers(users);
      }
      const sessToken=createSession(user.id);
      res.setHeader('Set-Cookie',[sessionCookie(sessToken, 30*24*60*60, req), deviceCookie(deviceToken, 30*24*60*60, req)]);
      sendJSON(res,{ok:true,email:user.email,webhookToken:user.webhookToken});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Resend the code for an in-progress challenge.
  if(req.method==='POST'&&req.url==='/api/auth/resend-code'){
    try{
      const {challenge}=JSON.parse(await readBody(req));
      const p=pendingAuth.get(challenge);
      if(!p){ sendJSON(res,{ok:false,expired:true,message:'That session expired. Start over.'},400); return; }
      if(isRateLimited('resend:'+p.email.toLowerCase(), 4, 15*60*1000)){ sendJSON(res,{ok:false,message:'Too many code requests. Wait a few minutes.'},429); return; }
      const code=make2faCode();
      p.codeHash=hash2faCode(code); p.expires=Date.now()+CODE_TTL; p.attempts=0;
      sendMail(p.email,'Your ShipmentScope verification code',twoFactorEmailHtml(code,p.purpose)).catch(e=>console.log('2FA email failed:',e.message));
      sendJSON(res,{ok:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  if(req.method==='POST'&&req.url==='/api/auth/logout'){
    const token=parseCookies(req.headers.cookie)['sc_session'];
    if(token){ sessions.delete(token); persistSessions(); }
    res.setHeader('Set-Cookie',sessionCookie('', 0, req));
    sendJSON(res,{ok:true});
    return;
  }

  if(req.method==='GET'&&req.url==='/api/auth/me'){
    const userId=getSessionUserId(req);
    const user=userId&&findUserById(userId);
    if(!user){sendJSON(res,{ok:false},401);return;}
    sendJSON(res,{ok:true,email:user.email,webhookToken:user.webhookToken});
    return;
  }

  // Per-user webhook endpoint: /webhook/<yourWebhookToken> (find yours in
  // Settings → Sync). Lives BEFORE the session-cookie gate below on purpose —
  // external services (Shopify etc.) can't send a login cookie; the token in
  // the URL itself is how this route proves who it belongs to.
  if(req.method==='POST'&&req.url.startsWith('/webhook/')){
    try{
      const token=req.url.split('/webhook/')[1];
      const owner=loadUsers().find(u=>u.webhookToken===token);
      if(!owner){sendJSON(res,{ok:false,message:'Unknown webhook token'},404);return;}
      const body=JSON.parse(await readBody(req));
      console.log('📨 Webhook received for',owner.email,':',JSON.stringify(body).slice(0,200));
      const order={
        name: body.line_items?.[0]?.title||body.name||body.subject||'Webhook order',
        store: body.shop_domain||body.store||'Store',
        price: parseFloat(body.total_price||body.amount||0),
        date: new Date().toISOString().split('T')[0],
        status: body.fulfillment_status==='fulfilled'?'shipped':body.financial_status==='refunded'?'cancelled':'ordered',
        cat: 'other',
        orderNum: String(body.order_number||body.id||''),
        tracking: body.fulfillments?.[0]?.tracking_number||'',
        source: 'webhook',
        image: (v=>/^https?:\/\/[^\s"'<>]+$/i.test(v||'')&&v.length<=500?v:'')(body.line_items?.[0]?.image?.src||body.image_url||body.image||''),
        emailHtml:'',emailText:'',
      };
      order.carrier = detectCarrier(order.tracking)?.name||'';
      order.trackingUrl = detectCarrier(order.tracking)?.url||'';
      order.expectedDelivery = estimateDelivery(order.status, order.date);
      pushToUserBuffer(owner.id, [order]);
      sendJSON(res,{ok:true,received:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Lightweight, unauthenticated heartbeat — just "is the server up".
  if(req.method==='GET'&&req.url==='/health'){
    sendJSON(res,{ok:true});
    return;
  }

  // Everything below here is private, per-user data — require a real session.
  const userId=getSessionUserId(req);
  if(!userId){sendJSON(res,{ok:false,message:'Not logged in'},401);return;}

  if(req.method==='GET'&&req.url==='/api/oauth/google/start'){
    if(!googleOAuthConfigured()){
      res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'});
      res.end(googleOAuthSetupMessage(req));
      return;
    }
    const state=crypto.randomBytes(18).toString('hex');
    googleOAuthStates.set(state,{userId,expires:Date.now()+10*60*1000});
    const params=new URLSearchParams({
      client_id:process.env.GOOGLE_CLIENT_ID,
      redirect_uri:googleRedirectUri(req),
      response_type:'code',
      scope:'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email',
      access_type:'offline',
      prompt:'consent',
      include_granted_scopes:'true',
      state,
    });
    res.writeHead(302,{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString()});
    res.end();
    return;
  }

  if(req.method==='GET'&&req.url.startsWith('/api/oauth/google/callback')){
    try{
      const u=new URL(req.url, requestOrigin(req));
      const state=u.searchParams.get('state')||'';
      const stateData=googleOAuthStates.get(state);
      googleOAuthStates.delete(state);
      if(!stateData || stateData.expires<Date.now() || stateData.userId!==userId) throw new Error('Google connection expired. Please try again.');
      const code=u.searchParams.get('code');
      const oauthError=u.searchParams.get('error');
      if(oauthError) throw new Error(oauthError);
      if(!code) throw new Error('Missing Google authorization code');
      const tokens=await exchangeGoogleCode(code, req);
      if(!tokens.refresh_token) throw new Error('Google did not return a refresh token. Try connecting again and approve offline access.');
      const email=await fetchGoogleEmail(tokens.access_token);
      const accounts=loadAccountsFor(userId).filter(a=>a.email.toLowerCase()!==email.toLowerCase());
      accounts.push({email,provider:'gmail-oauth',host:'imap.gmail.com',port:'993',password:'',oauthRefreshToken:tokens.refresh_token});
      saveAccountsFor(userId,accounts);
      res.writeHead(302,{Location:'/?gmail=connected'});
      res.end();
    }catch(e){
      res.writeHead(302,{Location:'/?gmail=error&msg='+encodeURIComponent(e.message)});
      res.end();
    }
    return;
  }

  // Test an IMAP connection (does not save anything)
  if(req.method==='POST'&&req.url==='/api/test'){
    try{
      const cfg=JSON.parse(await readBody(req));
      const c=new ImapFlow({host:cfg.host,port:parseInt(cfg.port)||993,secure:true,auth:{user:cfg.email,pass:cfg.password},logger:false});
      await c.connect();await c.logout();
      sendJSON(res,{ok:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Full sync — also (re)saves this account for the signed-in user's auto-poll
  if(req.method==='POST'&&req.url==='/api/sync'){
    try{
      const incoming=JSON.parse(await readBody(req));
      const savedAccounts=loadAccountsFor(userId);
      const saved=savedAccounts.find(a=>a.email.toLowerCase()===String(incoming.email||'').toLowerCase());
      const cfg={...(saved||{}),...incoming};
      if(saved && saved.password && !incoming.password) cfg.password=saved.password;
      if(saved && saved.oauthRefreshToken && !incoming.oauthRefreshToken) cfg.oauthRefreshToken=saved.oauthRefreshToken;
      if(!cfg.email) throw new Error('Missing email account');
      const accounts=savedAccounts.filter(a=>a.email.toLowerCase()!==cfg.email.toLowerCase());
      accounts.push({email:cfg.email,password:cfg.password||'',oauthRefreshToken:cfg.oauthRefreshToken||'',host:cfg.host,port:cfg.port,provider:cfg.provider||'custom'});
      saveAccountsFor(userId, accounts);
      console.log(`\nSyncing ${cfg.email}... (scanning last ${cfg.scanDays||30} days)`);
      const orders=await syncImap(cfg, null, cfg.scanDays);
      sendJSON(res,{ok:true,orders});
    }catch(e){console.error(e.message);sendJSON(res,{ok:false,message:e.message},500);}
    return;
  }

  // Disconnect an account — stop auto-polling it (this user's accounts only)
  if(req.method==='POST'&&req.url==='/api/disconnect'){
    try{
      const {email}=JSON.parse(await readBody(req));
      saveAccountsFor(userId, loadAccountsFor(userId).filter(a=>a.email.toLowerCase()!==String(email||'').toLowerCase()));
      sendJSON(res,{ok:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // List / add / remove this user's connected IMAP accounts (server-side
  // source of truth now, so accounts follow the user across devices/browsers).
  if(req.method==='GET'&&req.url==='/api/accounts'){
    sendJSON(res,{ok:true,accounts:loadAccountsFor(userId).map(publicAccount)});
    return;
  }
  if(req.method==='POST'&&req.url==='/api/accounts'){
    try{
      const acct=JSON.parse(await readBody(req));
      const accounts=loadAccountsFor(userId).filter(a=>a.email.toLowerCase()!==acct.email.toLowerCase());
      accounts.push(acct);
      saveAccountsFor(userId, accounts);
      sendJSON(res,{ok:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Permanently delete your own account and everything in it (orders, connected
  // email accounts). Requires re-entering your password — this can't be undone.
  if(req.method==='POST'&&req.url==='/api/auth/delete-account'){
    try{
      const {password}=JSON.parse(await readBody(req));
      const user=findUserById(userId);
      if(!user||!verifyPassword(password,user.salt,user.hash)){sendJSON(res,{ok:false,message:'Incorrect password'},401);return;}
      saveUsers(loadUsers().filter(u=>u.id!==userId));
      try{fs.unlinkSync(ordersFileFor(userId));}catch(_){}
      try{fs.unlinkSync(accountsFileFor(userId));}catch(_){}
      try{fs.unlinkSync(inventoryFileFor(userId));}catch(_){}
      delete newOrdersBuffers[userId];
      for(const [tok,sess] of sessions){ if(sess.userId===userId) sessions.delete(tok); }
      persistSessions();
      res.setHeader('Set-Cookie',sessionCookie('', 0, req));
      sendJSON(res,{ok:true});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Poll for new orders (app calls this every 30s) — this user's buffer ONLY.
  if(req.method==='GET'&&req.url==='/api/poll'){
    const orders=newOrdersBuffers[userId]||[];
    newOrdersBuffers[userId]=[];
    sendJSON(res,{ok:true,orders});
    return;
  }

  // Load this user's saved orders (app calls this on startup)
  if(req.method==='GET'&&req.url==='/api/orders'){
    sendJSON(res,{ok:true,orders:loadOrdersFor(userId)});
    return;
  }

  // Save this user's full order list (app calls this whenever it changes)
  if(req.method==='POST'&&req.url==='/api/orders'){
    try{
      const body=JSON.parse(await readBody(req));
      const orders=Array.isArray(body)?body:(body.orders||[]);
      const ok=saveOrdersFor(userId, orders);
      sendJSON(res,{ok,count:orders.length});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Inventory — same shape as orders: GET loads, POST saves the full list.
  if(req.method==='GET'&&req.url==='/api/inventory'){
    sendJSON(res,{ok:true,inventory:loadInventoryFor(userId)});
    return;
  }
  if(req.method==='POST'&&req.url==='/api/inventory'){
    try{
      const body=JSON.parse(await readBody(req));
      const items=Array.isArray(body)?body:(body.inventory||[]);
      const ok=saveInventoryFor(userId, items);
      sendJSON(res,{ok,count:items.length});
    }catch(e){sendJSON(res,{ok:false,message:e.message},400);}
    return;
  }

  // Tracking info
  if(req.method==='GET'&&req.url.startsWith('/api/track/')){
    const tracking=decodeURIComponent(req.url.split('/api/track/')[1]||'');
    const info=await fetchTracking(tracking);
    sendJSON(res,{ok:true,...info});
    return;
  }

  res.writeHead(404);res.end('Not found');
});

// Only start the server when run directly (node server.js).
// When required by a test file, just expose the functions instead.
if(require.main === module){
  server.listen(PORT,'127.0.0.1',()=>{
    console.log(`\n  ⚪  ShipmentScope v3 running → http://localhost:${PORT}`);
    console.log(`  📡  Webhook endpoint → http://localhost:${PORT}/webhook`);
    console.log(`  ⏱   Auto-polling every 5 minutes`);
    if(getMailTransport()) console.log(`  ✉️   Email 2FA: sending via ${process.env.SMTP_HOST||'smtp.gmail.com'}\n`);
    else console.warn(`  ⚠️   Email 2FA: SMTP not configured — codes will only PRINT TO THIS CONSOLE.\n       Real users can't receive codes until you set SMTP_USER + SMTP_PASS (see .env.example).\n`);
    startAutoPoll();
  });
}

module.exports = {
  extractPrice, extractTracking, detectStatus,
  getStoreName, storeNameFromEmail, getAllowedStore,
  extractOrderNum, extractExpectedDelivery, estimateDelivery,
  detectCarrier, detectCategory, classifyEmail, computeEmailId,
  isFoodEmail, validateSignupPassword,
};
