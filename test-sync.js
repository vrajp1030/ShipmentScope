// PokéOrders — sync accuracy test harness
// Run with: node test-sync.js
// Feeds realistic Pokémon order emails through the SAME classifyEmail() the live
// sync uses, and scores recall (real orders caught), precision (junk dropped),
// and field accuracy (price / tracking / store read correctly).

const { classifyEmail, computeEmailId } = require('./server.js');

// ── TEST CORPUS ──────────────────────────────────────────────────
// shouldKeep:true  → a real order email; must be detected
// shouldKeep:false → junk/marketing; must be dropped
// expect{...}      → field values that must match when kept
const CASES = [
  // ---- Pokémon Center ----
  { from:'Pokémon Center <orders@em.pokemoncenter.com>',
    subject:'Your Pokémon Center order is confirmed',
    body:'Thank you for your order! Order number: PC10293847. Items: Surging Sparks Elite Trainer Box. Subtotal: $49.99 Shipping: $0.00 Tax: $4.12 Order total: $54.11',
    expect:{ status:'ordered', store:'Pokemon Center', price:54.11, orderNum:'PC10293847' }, shouldKeep:true },

  { from:'Pokémon Center <ship@em.pokemoncenter.com>',
    subject:'Your Pokémon Center order has shipped',
    body:'Good news — your order has shipped! Tracking number: 1Z999AA10123456784. Carrier: UPS. Order #PC10293847.',
    expect:{ status:'shipped', store:'Pokemon Center', tracking:'1Z999AA10123456784', carrier:'UPS' }, shouldKeep:true },

  { from:'Pokémon Center <noreply@em.pokemoncenter.com>',
    subject:'Your package was delivered',
    body:'Your order has been delivered. We hope you enjoy your Pokémon TCG products! Order #PC10293847.',
    expect:{ status:'delivered', store:'Pokemon Center' }, shouldKeep:true },

  // ---- Target ----
  { from:'Target <orders@oe.target.com>',
    subject:'Thanks for your Target order',
    body:'Thanks for your order. Order #102-5567788. Prismatic Evolutions Booster Bundle. Total: $26.49',
    expect:{ status:'ordered', store:'Target', price:26.49 }, shouldKeep:true },

  { from:'Target <shipment@oe.target.com>',
    subject:'Your Target order is on its way',
    body:'Shipment confirmation. Your package is on the way. Tracking: 9400111899223818562347 via USPS.',
    expect:{ status:'shipped', store:'Target', tracking:'9400111899223818562347' }, shouldKeep:true },

  // ---- Amazon ----
  { from:'Amazon.com <auto-confirm@amazon.com>',
    subject:'Your Amazon.com order of "Pokemon Scarlet & Violet Booster Box"',
    body:'Order Confirmation. Order #114-3344556-7788990. Order Total: $107.94. Arriving: Tuesday, July 8.',
    expect:{ status:'ordered', store:'Amazon', price:107.94 }, shouldKeep:true },

  { from:'Amazon Shipment <shipment-tracking@amazon.com>',
    subject:'Shipped: "Pokemon Scarlet & Violet Booster Box"',
    body:'Your package has shipped. Tracking ID: TBA305544221100. Arriving Tuesday.',
    expect:{ status:'shipped', store:'Amazon' }, shouldKeep:true },

  // ---- TCGplayer ----
  { from:'TCGplayer <orders@tcgplayer.com>',
    subject:'TCGplayer Order Confirmation',
    body:'Thank you for your purchase. Order Number: 8B4C-2F19A. Charizard ex Special Illustration Rare. Order total: $289.99',
    expect:{ status:'ordered', store:'TCGPlayer', price:289.99, orderNum:'8B4C-2F19A' }, shouldKeep:true },

  { from:'TCGplayer <noreply@tcgplayer.com>',
    subject:'Your TCGplayer order has shipped',
    body:'Your order has shipped! USPS Tracking number 9405511899223344556677. Thanks for shopping.',
    expect:{ status:'shipped', store:'TCGPlayer', tracking:'9405511899223344556677' }, shouldKeep:true },

  // ---- eBay (purchase + seller shipment) ----
  { from:'eBay <ebay@ebay.com>',
    subject:'Order confirmed: Pokemon Base Set Booster Pack',
    body:'You purchased an item. Order total: $74.50. Order number: 12-11223-44556.',
    expect:{ status:'ordered', store:'eBay', price:74.50 }, shouldKeep:true },

  { from:'eBay <shipping@ebay.com>',
    subject:'Your item has been shipped',
    body:'The seller has shipped your item. Tracking number: 1Z34W5670398765432. Estimated delivery soon.',
    expect:{ status:'shipped', store:'eBay', tracking:'1Z34W5670398765432' }, shouldKeep:true },

  // ---- Whatnot ----
  { from:'Whatnot <orders@whatnot.com>',
    subject:'Order confirmed from your live show',
    body:'Thanks for your purchase on Whatnot! Order placed. Pikachu VMAX slab. Total: $42.00',
    expect:{ status:'ordered', store:'Whatnot', price:42.00 }, shouldKeep:true },

  // ---- Mercari ----
  { from:'Mercari <no-reply@mercari.com>',
    subject:'Purchase confirmed',
    body:'Thanks for your purchase. Your item will ship soon. Total charged: $33.25.',
    expect:{ status:'ordered', store:'Mercari', price:33.25 }, shouldKeep:true },

  // ---- Unknown Shopify TCG shops (the real-world reseller case) ----
  { from:'Dave & Adams <orders@email.dacardworld.com>',
    subject:'Order #DA88123 confirmed',
    body:'Thank you for your order! Surging Sparks Booster Box x2. Order total: $179.98',
    expect:{ status:'ordered', store:'Dacardworld', price:179.98 }, shouldKeep:true },

  { from:'Collector\'s Cache <hello@shop.collectorscache.com>',
    subject:'We received your order',
    body:'Order received. Moonbreon alt art. Grand total: $410.00. We will email you when it ships.',
    expect:{ status:'ordered', store:'Collectorscache', price:410.00 }, shouldKeep:true },

  { from:'Collector\'s Cache <noreply@shop.collectorscache.com>',
    subject:'Your order is on the way',
    body:'Your order has shipped. Tracking number: 9361289691234567890123. Carrier USPS.',
    expect:{ status:'shipped', store:'Collectorscache', tracking:'9361289691234567890123' }, shouldKeep:true },

  // ---- Pre-orders ----
  { from:'PokeStop Shop <orders@pokestopshop.com>',
    subject:'Pre-order confirmed: Destined Rivals ETB',
    body:'Your pre-order has been placed. Pre-order confirmed. Releases 2026-05-30. Total: $59.99',
    expect:{ status:'preorder', store:'Pokestopshop', price:59.99 }, shouldKeep:true },

  // ---- Cancellations / refunds ----
  { from:'TCGplayer <orders@tcgplayer.com>',
    subject:'Your order has been cancelled',
    body:'Your order has been cancelled and a refund issued. Refund amount: $289.99. Order #8B4C-2F19A.',
    expect:{ status:'cancelled', store:'TCGPlayer' }, shouldKeep:true },

  { from:'Pokémon Center <orders@em.pokemoncenter.com>',
    subject:'Refund confirmation for your order',
    body:'Your refund has been processed. Payment refunded: $54.11 to your card. Order #PC10293847.',
    expect:{ status:'cancelled', store:'Pokemon Center' }, shouldKeep:true },

  // ---- Tricky field-extraction cases ----
  { from:'Card Shop <orders@cardhaven.com>',
    subject:'Order confirmation',
    body:'Get $5 off your next order! Subtotal: $80.00 Tax: $6.40 Order total: $86.40. Order #CH-55512.',
    expect:{ status:'ordered', store:'Cardhaven', price:86.40 }, shouldKeep:true },   // must NOT read $5 or $80

  { from:'Card Shop <orders@cardhaven.com>',
    subject:'Your order #CH-55512 has shipped',
    body:'Your order has shipped. Order number CH-55512. FedEx tracking number 770212345678.',
    expect:{ status:'shipped', store:'Cardhaven', tracking:'770212345678' }, shouldKeep:true }, // FedEx near keyword

  // ---- HARD: comma thousands, international currency, sender quirks ----
  { from:'PWCC <orders@pwccmarketplace.com>',
    subject:'Order confirmation',
    body:'Thank you for your order. PSA 10 Base Set Charizard. Order total: $1,299.00. Order #PWCC-99812.',
    expect:{ status:'ordered', store:'Pwccmarketplace', price:1299.00 }, shouldKeep:true },

  { from:'Chu TCG UK <orders@chutcg.co.uk>',
    subject:'Your order is confirmed',
    body:'Thank you for your order. Order total: £149.99. Order #UK-2231.',
    expect:{ status:'ordered', store:'Chutcg', price:149.99 }, shouldKeep:true },

  { from:'Karten Shop <bestellung@kartenshop.de>',
    subject:'Order confirmation',
    body:'Thank you for your purchase. Order total: 79,90 EUR. Order #DE-5567.',
    expect:{ status:'ordered', store:'Kartenshop', price:79.90 }, shouldKeep:true },

  { from:'noreply@notifications.tcgfish.com',
    subject:'Order received',
    body:'We received your order. Order total: $64.00. Order #TF-7781.',
    expect:{ status:'ordered', store:'Tcgfish', price:64.00 }, shouldKeep:true },

  // status priority: shipped wording must win over "thank you for your order"
  { from:'PokeStop <ship@pokestopshop.com>',
    subject:'Your order update',
    body:'Thank you for your order! Update: your order has shipped. Tracking number 1Z999AA10987654321.',
    expect:{ status:'shipped', store:'Pokestopshop', tracking:'1Z999AA10987654321' }, shouldKeep:true },

  // delivered must win over order language
  { from:'Amazon <ship@amazon.com>',
    subject:'Delivered: your package',
    body:'Your order has been delivered. Thank you for your order.',
    expect:{ status:'delivered', store:'Amazon' }, shouldKeep:true },

  // ---- NEGATIVE cases — must be DROPPED ----
  { from:'TCGplayer <deals@tcgplayer.com>',
    subject:'Free shipping this weekend',
    body:'Enjoy free shipping on all orders over $50 this weekend. No code needed.',
    shouldKeep:false },

  { from:'Pokémon Center <help@em.pokemoncenter.com>',
    subject:'How was your experience?',
    body:'Tell us how we did. Rate your recent experience with us.',
    shouldKeep:false },

  { from:'Pokémon Center <news@em.pokemoncenter.com>',
    subject:'New Pokémon products just dropped!',
    body:'Check out the latest releases. Order now before they sell out! Shop the newest TCG sets.',
    shouldKeep:false }, // marketing, no real order language... but contains "order now" + "shop" — a precision trap

  { from:'TCGplayer <deals@tcgplayer.com>',
    subject:'Weekend sale — up to 40% off singles',
    body:'Huge weekend deals on singles and sealed. Save big this weekend only.',
    shouldKeep:false }, // pure marketing

  { from:'Reddit <noreply@reddit.com>',
    subject:'Someone replied to your comment in r/PokemonTCG',
    body:'u/trainer replied: nice pull on that Charizard! Reply or view thread.',
    shouldKeep:false }, // social, not an order

  { from:'DoorDash <no-reply@doordash.com>',
    subject:'Your DoorDash order has been delivered',
    body:'Your order from Taco Bell was delivered. Total: $18.42.',
    shouldKeep:false },

  { from:'Instacart <orders@instacart.com>',
    subject:'Your grocery order receipt',
    body:'Your shopper delivered your groceries. Order total: $74.13.',
    shouldKeep:false },

  { from:'Delta Air Lines <receipts@delta.com>',
    subject:'Your trip receipt and confirmation',
    body:'Flight confirmation. Your trip is booked. Total paid: $311.20.',
    shouldKeep:false },

  { from:'Spotify <no-reply@spotify.com>',
    subject:'Your receipt from Spotify',
    body:'Your subscription renewed. Total: $10.99.',
    shouldKeep:false },

  // ---- Regression: "tracking number" in an ORDER CONFIRMATION must not read as shipped ----
  // The confirmation only promises a tracking number will follow; there's no ship verb,
  // so this must classify as 'ordered', not 'shipped' (weak-signal guard in detectStatus).
  { from:'TCGplayer <orders@tcgplayer.com>',
    subject:'Thank you for your order',
    body:'Thanks for your purchase! Order #TCG556677. A tracking number will be emailed to you once your order ships. Total: $88.40',
    expect:{ status:'ordered', store:'TCGPlayer', price:88.40, orderNum:'TCG556677' }, shouldKeep:true },

  // Companion: a real ship notice with a tracking number AND a ship verb still reads as shipped.
  { from:'TCGplayer <ship@tcgplayer.com>',
    subject:'Your order has shipped',
    body:'Your order has shipped! Tracking number: 9400111899223818500011 via USPS. Order #TCG556677.',
    expect:{ status:'shipped', store:'TCGPlayer', tracking:'9400111899223818500011', carrier:'USPS' }, shouldKeep:true },
];

// ── RUNNER ───────────────────────────────────────────────────────
function approxEq(a,b){ return Math.abs((a||0)-(b||0)) < 0.005; }

function run() {
  let recallHit=0, recallTotal=0, precisionWrong=0, precisionTotal=0;
  const fieldFails=[], recallFails=[], precisionFails=[];

  for(const c of CASES){
    const info = classifyEmail(c.subject, c.from, c.body);
    if(c.shouldKeep){
      recallTotal++;
      if(!info){ recallFails.push(c.subject); continue; }
      recallHit++;
      const e=c.expect||{};
      const checks=[];
      if(e.status   && info.status!==e.status)             checks.push(`status ${info.status}≠${e.status}`);
      if(e.store    && info.store!==e.store)               checks.push(`store "${info.store}"≠"${e.store}"`);
      if(e.price!=null && !approxEq(info.price,e.price))   checks.push(`price ${info.price}≠${e.price}`);
      if(e.orderNum && info.orderNum!==e.orderNum)         checks.push(`orderNum "${info.orderNum}"≠"${e.orderNum}"`);
      if(e.tracking && info.tracking!==e.tracking)         checks.push(`tracking "${info.tracking}"≠"${e.tracking}"`);
      if(e.carrier  && info.carrier!==e.carrier)           checks.push(`carrier "${info.carrier}"≠"${e.carrier}"`);
      if(checks.length) fieldFails.push({ subject:c.subject, problems:checks });
    } else {
      precisionTotal++;
      if(info){ precisionWrong++; precisionFails.push({subject:c.subject, gotStatus:info.status}); }
    }
  }

  const fieldChecked = recallHit;
  const fieldOk = recallHit - fieldFails.length;
  console.log('\n══════════════ SYNC TEST RESULTS ══════════════');
  console.log(`RECALL   (real orders caught)   : ${recallHit}/${recallTotal}`);
  console.log(`PRECISION(junk correctly dropped): ${precisionTotal-precisionWrong}/${precisionTotal}`);
  console.log(`FIELDS   (price/track/store right): ${fieldOk}/${fieldChecked}`);

  if(recallFails.length){
    console.log('\n✗ MISSED real orders (recall failures):');
    recallFails.forEach(s=>console.log('   - '+s));
  }
  if(precisionFails.length){
    console.log('\n✗ KEPT junk (precision failures):');
    precisionFails.forEach(f=>console.log(`   - [${f.gotStatus}] ${f.subject}`));
  }
  if(fieldFails.length){
    console.log('\n✗ WRONG fields:');
    fieldFails.forEach(f=>console.log(`   - ${f.subject}\n       ${f.problems.join(' | ')}`));
  }
  const perfect = !recallFails.length && !precisionFails.length && !fieldFails.length;
  console.log('\n'+(perfect?'✅ ALL CHECKS PASSED':'⚠  SEE FAILURES ABOVE')+'\n');
  return perfect;
}

// ── REGRESSION TEST: the exact "10 same-day Pokémon Center orders vanished" bug ──
// Real-world cause: 10 separate real orders arrive same-day using an IDENTICAL
// subject template ("Thank you for your Pokémon Center order!") with no order
// number in the body. The old dedup key was store+status+SUBJECT+date, which
// made all 10 collide into 1. computeEmailId must give each one a distinct ID
// (via Message-ID, or a content hash of the full body when Message-ID is missing)
// so a scan never silently drops 9 of the 10.
function runEmailIdRegressionTest(){
  const subject = 'Thank you for your Pokémon Center order!';
  const from = 'Pokémon Center <orders@em.pokemoncenter.com>';
  const date = '2026-06-30';
  const ids = new Set();
  let ok = true;

  // Case A: each email has a real, distinct Message-ID (the normal case).
  for(let i=0;i<10;i++){
    const id = computeEmailId('<msg-'+i+'@pokemoncenter.com>', from, subject, date, 'Order #'+i+' body text differs per order.');
    ids.add(id);
  }
  if(ids.size!==10){ ok=false; console.log('✗ Message-ID case: expected 10 unique ids, got '+ids.size); }

  // Case B: no Message-ID at all (rare), but each email's actual body content
  // differs (different item/price per order) — the content hash must still tell them apart.
  ids.clear();
  for(let i=0;i<10;i++){
    const body = 'Surging Sparks Elite Trainer Box x'+(i+1)+'. Order total: $'+(49.99+i)+'.';
    const id = computeEmailId(null, from, subject, date, body);
    ids.add(id);
  }
  if(ids.size!==10){ ok=false; console.log('✗ No-Message-ID case: expected 10 unique ids (different bodies), got '+ids.size); }

  // Case C: truly the SAME email (identical everything) should collapse to ONE id —
  // that's the legitimate "re-fetched the same message twice" case dedup should catch.
  const dupA = computeEmailId(null, from, subject, date, 'identical body');
  const dupB = computeEmailId(null, from, subject, date, 'identical body');
  if(dupA!==dupB){ ok=false; console.log('✗ Same email should produce the same id, but got different ids'); }

  console.log('\n══════════ EMAIL-ID DEDUP REGRESSION ══════════');
  console.log(ok ? '✅ 10 same-day, same-subject orders each get a distinct id (bug fixed)' : '⚠  SEE FAILURES ABOVE');
  return ok;
}

const allOk = run() && runEmailIdRegressionTest();
process.exit(allOk?0:1);
