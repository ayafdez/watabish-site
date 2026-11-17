/**
 * Watabish checkout — Cloudflare Worker (free plan is plenty).
 *
 * DEPLOYS AUTOMATICALLY: Cloudflare Workers Builds is connected to this repo, and
 * wrangler.jsonc (repo root) tells it to deploy this file as "watabish-checkout"
 * on every push to main. Edit prices here and in shop/index.html together.
 * (The _checkout folder starts with "_" so GitHub Pages doesn't publish it.)
 *
 * The commission page sends its cart here. This worker re-checks and re-prices
 * everything from its own copy of the rules (never trusting the browser), then
 * creates a Stripe Checkout Session and returns its URL.
 *
 * Secret: STRIPE_SECRET_KEY = a Stripe restricted key (rk_live_… / rk_test_…)
 * with Checkout Sessions set to Write. Secrets live in Cloudflare and survive deploys.
 *
 * Chikadee Hunt cards: allow_promotion_codes is on, so customers can type
 * their card code on the Stripe page. Make the hunt coupon "$49 off, once"
 * (not 100% off), so it covers one standard portrait and does not zero out a
 * whole multi-portrait order or gift cards. To limit the coupon to portraits only,
 * create one Stripe Product per portrait type, paste their IDs into PRODUCT_IDS
 * below, and restrict the coupon to those products.
 *
 * Every "error" this worker returns is shown to the customer on the page,
 * so keep them short, lowercase and friendly.
 */

// ---- Keep these in sync with SHOP in shop/index.html ----
const CURRENCY = "cad";
const SHOP_PATH = "/shop/index.html"; // your host needs the full file name
const SIZES = {
  std: { label: "Hand-painted pet portrait", price: 49 },
  signed: { label: "Bish-signed pet portrait", price: 99 },
};
const EXTRA_PET_PRICE = 30;
const MAX_PETS = 2;

// Local pick-up is free, and only for these postal code starts (Sault Ste. Marie).
// Same list as SHOP.shipping.pickupPostal on the page.
const PICKUP_POSTAL = ["P6A", "P6B", "P6C"];

// Shipping priced from the address: base + additional × (portraits − 1)
const SHIPPING = {
  pickup: true,
  canada: [
    { name: "Ontario",          letters: "KLMNP", base: 28, additional: 2 },
    { name: "Quebec",           letters: "GHJ",   base: 30, additional: 3 },
    { name: "Manitoba",         letters: "R",     base: 30, additional: 3 },
    { name: "Saskatchewan",     letters: "S",     base: 32, additional: 4 },
    { name: "Alberta",          letters: "T",     base: 32, additional: 4 },
    { name: "British Columbia", letters: "V",     base: 34, additional: 5 },
    { name: "Atlantic Canada",  letters: "ABCE",  base: 32, additional: 4 },
    { name: "the Territories",  letters: "XY",    base: 45, additional: 8 },
  ],
  us: { base: 39, additional: 8 },
  international: {
    base: 85, additional: 38,
    countries: { AU: "Australia", AT: "Austria", BE: "Belgium", DK: "Denmark", FI: "Finland", FR: "France",
      DE: "Germany", IE: "Ireland", IT: "Italy", JP: "Japan", NL: "Netherlands", NZ: "New Zealand",
      NO: "Norway", PT: "Portugal", ES: "Spain", SE: "Sweden", CH: "Switzerland", GB: "United Kingdom" },
  },
  freeOver: null,
  freeIn: ["CA", "US"],
};

// Painting weeks: must be a Monday at least this many days away (in the studio's time zone).
// The page offers the first Monday at least 7 days away (slots.leadWeeks = 2).
const MIN_DAYS_AHEAD = 7;
const STUDIO_TIME_ZONE = "America/Toronto";
const CLOSED_WEEKS = []; // e.g. ["2026-12-21", "2026-12-28"]

const GIFT_MIN = 25, GIFT_MAX = 1000;
const MAX_PORTRAITS = 12;
// Optional: Stripe product IDs per portrait type (prod_...) so hunt coupons can be limited to portraits
const PRODUCT_IDS = { std: "", signed: "" };
// -----------------------------------------------------------

const ALLOWED_ORIGINS = ["https://watabish.com", "https://www.watabish.com", "http://watabish.com", "http://www.watabish.com"];

// Customer-facing messages
const MSG = {
  badRequest: "something went wrong with your order. please try again.",
  empty: "your order is empty. add a portrait or a gift card.",
  tooMany: `that's a lot of portraits! please keep it to ${MAX_PORTRAITS} per order.`,
  email: "please enter a valid email.",
  portrait: "one of your portraits didn't come through. please check it and try again.",
  giftAmount: `gift cards can be $${GIFT_MIN} to $${GIFT_MAX}.`,
  giftEmail: "please check the gift card recipient's email.",
  week: "that painting week isn't available anymore. pick another one.",
  pickupArea: "pick-up is only for sault ste. marie addresses. choose ship it instead.",
  pickupOff: "pick-up isn't available right now. choose ship it instead.",
  delivery: "please choose ship it or pick-up.",
  address: "please enter your street address and city.",
  postal: "that postal code doesn't look right.",
  zip: "that zip code doesn't look right.",
  country: "sorry, we don't ship there yet.",
  stripe: "we couldn't open checkout right now. please try again in a minute.",
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const reply = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return reply({ error: "method not allowed." }, 405);

    let order;
    try { order = await request.json(); } catch { return reply({ error: MSG.badRequest }, 400); }
    if (!order || typeof order !== "object") return reply({ error: MSG.badRequest }, 400);

    const fail = msg => reply({ error: msg }, 400);
    const portraits = Array.isArray(order.portraits) ? order.portraits : [];
    const gifts = Array.isArray(order.gifts) ? order.gifts : [];
    const cust = order.customer || {};
    if (!portraits.length && !gifts.length) return fail(MSG.empty);
    if (portraits.length > MAX_PORTRAITS) return fail(MSG.tooMany);
    if (!/^\S+@\S+\.\S+$/.test(cust.email || "")) return fail(MSG.email);

    const params = new URLSearchParams();
    let i = 0;
    const addLine = (name, amount, description, productId) => {
      const p = `line_items[${i}]`;
      params.append(`${p}[quantity]`, "1");
      params.append(`${p}[price_data][currency]`, CURRENCY);
      params.append(`${p}[price_data][unit_amount]`, String(Math.round(amount * 100)));
      if (productId) {
        params.append(`${p}[price_data][product]`, productId);
      } else {
        params.append(`${p}[price_data][product_data][name]`, name);
        if (description) params.append(`${p}[price_data][product_data][description]`, description);
      }
      i++;
    };

    // Portraits
    let portraitSum = 0;
    for (const p of portraits) {
      const size = SIZES[p && p.size];
      const pets = Math.floor(Number(p && p.pets));
      if (!size || !(pets >= 1 && pets <= MAX_PETS)) return fail(MSG.portrait);
      const price = size.price + (pets - 1) * EXTRA_PET_PRICE;
      portraitSum += price;
      addLine(size.label, price, `${pets} pet${pets > 1 ? "s" : ""}`, PRODUCT_IDS[p.size]);
    }

    // Gift cards
    for (const g of gifts) {
      const amt = Math.round(Number(g && g.amount));
      if (!(amt >= GIFT_MIN && amt <= GIFT_MAX)) return fail(MSG.giftAmount);
      if (!/^\S+@\S+\.\S+$/.test((g && g.email) || "")) return fail(MSG.giftEmail);
      addLine("Watabish gift card", amt, `For ${String(g.name || "").slice(0, 60)} (emailed)`);
    }

    // Week + shipping (checked and priced here, never trusted from the browser)
    if (portraits.length) {
      const week = String(order.week || "");
      if (!weekIsOpen(week)) return fail(MSG.week);

      const a = order.shipping || {};
      const q = quoteShipping(a, portraits.length, portraitSum);
      if (q.error) return fail(q.error);

      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]", q.label);
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(Math.round(q.cost * 100)));
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", CURRENCY);

      if (a.method === "ship") {
        // The address the customer typed on your page is attached to the payment,
        // so Stripe doesn't ask again and the price can't drift from the address.
        const clip = (v, n = 200) => String(v || "").trim().slice(0, n);
        const sh = "payment_intent_data[shipping]";
        params.append(`${sh}[name]`, clip(cust.name) || "Customer");
        params.append(`${sh}[address][line1]`, clip(a.line1));
        if (a.line2) params.append(`${sh}[address][line2]`, clip(a.line2));
        params.append(`${sh}[address][city]`, clip(a.city));
        if (a.region) params.append(`${sh}[address][state]`, clip(a.region, 50));
        if (a.postal) params.append(`${sh}[address][postal_code]`, clip(a.postal, 20).toUpperCase());
        params.append(`${sh}[address][country]`, a.country);
      }
      params.append("metadata[start_week]", week);
      params.append("metadata[delivery]", q.label);
      // Pick-up has no shipping address, so keep the postal code they gave
      if (a.method === "pickup") params.append("metadata[pickup_postal]", String(a.postal || "").toUpperCase().replace(/\s+/g, ""));

      // Big orders are spread over several painting weeks. Record the split for your
      // booked list, but only if it adds up and every week in it is a real open week.
      const plan = Array.isArray(order.weekPlan) ? order.weekPlan : [];
      const planOk = plan.length > 1 && plan.length <= MAX_PORTRAITS
        && plan[0] && plan[0].week === week
        && plan.every((p, k) => p && weekIsOpen(String(p.week)) && Number.isInteger(p.count) && p.count >= 1
          && (k === 0 || String(p.week) > String(plan[k - 1].week)))
        && plan.reduce((sum, p) => sum + p.count, 0) === portraits.length;
      if (planOk) params.append("metadata[painting_weeks]", plan.map(p => `${p.week} ×${p.count}`).join(", "));
    }

    // Order details for your records (Stripe metadata values max 500 chars)
    params.append("mode", "payment");
    params.append("customer_email", cust.email);
    params.append("allow_promotion_codes", "true");
    // Send customers back to the same address they ordered from
    const site = (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]) + SHOP_PATH;
    params.append("success_url", `${site}?paid=1`);
    params.append("cancel_url", site);
    params.append("metadata[name]", String(cust.name || "").slice(0, 200));
    if (cust.ig) params.append("metadata[instagram]", String(cust.ig).slice(0, 100));
    if (cust.notes) params.append("metadata[notes]", String(cust.notes).slice(0, 500));
    params.append("metadata[portraits]", portraits.map(p => `${p.size}/${p.pets}`).join(", ").slice(0, 500));
    if (gifts.length) {
      params.append("metadata[gift_cards]",
        gifts.map(g => `$${Math.round(g.amount)} → ${g.name} <${g.email}>${g.message ? `: ${g.message}` : ""}`).join(" | ").slice(0, 500));
    }

    // Stripe keeps Checkout metadata on the session only, not on the payment you see in
    // the Dashboard. Copy every detail onto the payment too, so it shows under the
    // payment's Metadata section.
    for (const [key, value] of [...params.entries()]) {
      const m = /^metadata\[(.+)\]$/.exec(key);
      if (m) params.append(`payment_intent_data[metadata][${m[1]}]`, value);
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const session = await res.json();
    if (!res.ok) {
      // The real reason goes to the worker's logs in Cloudflare; the customer gets a friendly line.
      console.error("Stripe error:", session.error?.message || res.status);
      return reply({ error: MSG.stripe }, 502);
    }
    return reply({ url: session.url });
  },
};

// A painting week is open if it's a real Monday, at least MIN_DAYS_AHEAD days
// from today in the studio's time zone, and not in CLOSED_WEEKS.
function weekIsOpen(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const when = new Date(Date.UTC(y, mo - 1, d));
  if (when.getUTCFullYear() !== y || when.getUTCMonth() !== mo - 1 || when.getUTCDate() !== d) return false; // e.g. 2026-02-31
  if (when.getUTCDay() !== 1) return false; // not a Monday
  if (CLOSED_WEEKS.includes(week)) return false;
  const daysAway = (when.getTime() - studioToday()) / 86400000;
  return daysAway >= MIN_DAYS_AHEAD;
}

// Today's date in the studio's time zone, as midnight UTC (so date maths is whole days)
function studioToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

// Same rules as quoteShipping() in index.html
function quoteShipping(a, n, portraitSum) {
  if (a.method === "pickup") {
    if (!SHIPPING.pickup) return { error: MSG.pickupOff };
    const pc = String(a.postal || "").toUpperCase().replace(/\s+/g, "");
    if (a.country !== "CA" || !PICKUP_POSTAL.some(prefix => pc.startsWith(prefix))) return { error: MSG.pickupArea };
    return { cost: 0, label: "Local pickup" };
  }
  if (a.method !== "ship") return { error: MSG.delivery };
  if (!String(a.line1 || "").trim() || !String(a.city || "").trim()) return { error: MSG.address };
  let rate, name;
  if (a.country === "CA") {
    const pc = String(a.postal || "").toUpperCase().replace(/\s+/g, "");
    if (!/^[ABCEGHJ-NPRSTVXY]\d[A-Z]\d[A-Z]\d$/.test(pc)) return { error: MSG.postal };
    rate = SHIPPING.canada.find(r => r.letters.includes(pc[0])); name = rate.name;
  } else if (a.country === "US") {
    if (!/^\d{5}(-\d{4})?$/.test(String(a.postal || "").trim())) return { error: MSG.zip };
    rate = SHIPPING.us; name = "the United States";
  } else if (SHIPPING.international.countries[a.country]) {
    rate = SHIPPING.international; name = SHIPPING.international.countries[a.country];
  } else return { error: MSG.country };
  let cost = rate.base + rate.additional * (n - 1);
  if (SHIPPING.freeOver != null && portraitSum >= SHIPPING.freeOver && SHIPPING.freeIn.includes(a.country)) cost = 0;
  return { cost, label: `Shipping to ${name}` };
}
