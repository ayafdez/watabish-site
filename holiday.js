/* =====================================================================
   HOLIDAY CUT-OFFS — the site switches itself by date (Toronto time).
   Edit these dates each year; nothing else needs to change.
   - usLastOrder / caLastOrder: last day someone can claim a painting week
     that still arrives by Christmas (the week of Nov 23 / Dec 7 must be at
     least 7 days away, so it's the Monday one week before).
   - giftUntil: after this day the banner disappears.
   Test any date by adding ?holiday_date=2026-12-02 to a page's address.
   ===================================================================== */
const HOLIDAY = {
  usLastOrder: "2026-11-16",
  caLastOrder: "2026-11-30",
  caLastWeek: "dec 7",
  usLastWeek: "nov 23",
  giftUntil: "2026-12-24",
};

(() => {
  const override = new URLSearchParams(location.search).get("holiday_date");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(override || "") ? override
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  const phase = today <= HOLIDAY.usLastOrder ? "both"
    : today <= HOLIDAY.caLastOrder ? "canada"
    : today <= HOLIDAY.giftUntil ? "gift" : "off";
  document.documentElement.dataset.holiday = phase;
  if (phase === "off") return;

  // Links are written relative to the page they're on
  const inShop = /\/shop\//.test(location.pathname);
  const shop = inShop ? "index.html" : "shop/index.html";
  const giftUrl = `${shop}?gift=1`;
  const caLeft = days(today, HOLIDAY.caLastOrder);
  const caWhen = caLeft === 0 ? "today's the last day" : caLeft === 1 ? "1 day left" : `${caLeft} days left`;
  const a = (href, text) => `<a href="${href}">${text}</a>`;

  const MSG = {
    both: {
      home: `christmas cut-offs: <b>US orders close tonight.</b> canada: ${caWhen} (by nov 30). ${a(shop, "claim a painting week →")}`,
      us:   `<b>last call: today's the last day to order for christmas in the US.</b> claim the week of ${HOLIDAY.usLastWeek}. ${a(`${shop}?portrait=std`, "book now →")}`,
      shop: `christmas cut-offs: <b>US orders close tonight</b> (week of ${HOLIDAY.usLastWeek}). canada: ${caWhen}, pick a week up to ${HOLIDAY.caLastWeek}.`,
    },
    canada: {
      home: `<b>canada: ${caWhen} to order a portrait for christmas.</b> in the US? too late for paint, perfect for a ${a(giftUrl, "gift card →")}`,
      us:   `<b>too late to paint one by christmas</b> (customs is slow, the bish is slower). send a gift card instead: emailed to them, they pick the pet. ${a(giftUrl, "send a gift card →")}`,
      shop: `<b>canada: ${caWhen} for christmas</b>, pick a week up to ${HOLIDAY.caLastWeek}. in the US? ${a(giftUrl, "a gift card")} is the move.`,
    },
    gift: {
      home: `<b>too late for paint by christmas. not too late for a gift card:</b> emailed to them, they pick the pet. ${a(giftUrl, "send one →")}`,
      us:   `<b>too late for paint by christmas. not too late for a gift card:</b> emailed to them, they pick the pet. ${a(giftUrl, "send one →")}`,
      shop: `<b>christmas painting weeks are done.</b> a gift card still makes it: emailed to them, they pick the pet. ${a(giftUrl, "send one →")}`,
    },
  };

  document.querySelectorAll("[data-holiday-bar]").forEach(el => {
    const html = MSG[phase][el.dataset.holidayBar];
    if (!html) return;
    el.innerHTML = html;
    el.hidden = false;
  });

  // Once nobody can get a portrait by Christmas, gift buttons sell gift cards
  if (phase === "gift") {
    document.querySelectorAll("[data-holiday-gift]").forEach(el => {
      el.href = giftUrl;
      if (el.dataset.holidayGift) el.textContent = el.dataset.holidayGift;
    });
  }
  if (phase !== "both") {
    document.querySelectorAll("[data-holiday-us-gift]").forEach(el => {
      el.href = giftUrl;
      if (el.dataset.holidayUsGift) el.textContent = el.dataset.holidayUsGift;
    });
  }
})();
