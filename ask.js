// "what's stopping you?" pop-up: asks visitors what's holding them back from ordering.
// Answers go to the "hesitations" table in Supabase. Shows once per visitor, after they've scrolled a while.
(function () {
  var URL = "https://drreubfqwmivmpwpynnt.supabase.co/rest/v1/hesitations";
  var KEY = "sb_publishable_ZIFNEg8XxN_JW6li0MKReA_yjgPEfyj";
  var STORE = "wb-ask";
  var REASONS = [
    ["price", "the price"],
    ["shipping", "shipping cost"],
    ["unsure_look", "not sure how it'll turn out"],
    ["timing", "i need it sooner"],
    ["gift_unsure", "not sure they'd like it"],
    ["browsing", "just browsing"],
    ["other", "something else"]
  ];
  function get() { try { return localStorage.getItem(STORE); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(STORE, v); } catch (e) {} }
  var seen = get(); // null | "closed" | "sent"

  var css = document.createElement("style");
  css.textContent = [
    ".wb-ask-pill{position:fixed;right:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:8px;min-height:52px;padding:0 20px;border:3px solid #2B1C15;border-radius:999px;background:#BFE3FF;color:#2B1C15;font:800 16px/1 'Bricolage Grotesque','Trebuchet MS',sans-serif;box-shadow:4px 4px 0 #2B1C15;cursor:pointer;transition:transform .15s}",
    ".wb-ask-pill:hover{transform:translate(-1px,-1px)}",
    ".wb-ask-pill[hidden],.wb-ask[hidden]{display:none}",
    ".wb-ask{position:fixed;right:16px;bottom:16px;z-index:61;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#F3EADB;color:#2B1C15;border:3px solid #2B1C15;border-radius:24px;box-shadow:6px 6px 0 #2B1C15;padding:20px;font:400 16px/1.45 'Bricolage Grotesque','Trebuchet MS',sans-serif;animation:wbAskIn .25s ease}",
    "@keyframes wbAskIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    ".wb-ask.wb-pop{animation:wbAskPop .5s cubic-bezier(.3,1.6,.5,1)}",
    "@keyframes wbAskPop{0%{opacity:0;transform:translateY(24px) scale(.9) rotate(-2deg)}60%{opacity:1;transform:translateY(-4px) scale(1.02) rotate(1deg)}100%{transform:none}}",
    "@media (prefers-reduced-motion: reduce){.wb-ask,.wb-ask.wb-pop{animation:none}.wb-ask-pill{transition:none}}",
    ".wb-ask h2{margin:0 0 4px;font-size:24px;font-weight:800;letter-spacing:-0.03em;line-height:1.05;padding-right:36px}",
    ".wb-ask .sub{margin:0 0 14px;font-size:14px;color:#5A463A}",
    ".wb-ask .x{position:absolute;top:10px;right:10px;width:40px;height:40px;border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:#2B1C15}",
    ".wb-ask fieldset{border:0;margin:0 0 12px;padding:0}",
    ".wb-ask legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}",
    ".wb-ask .opts{display:flex;flex-wrap:wrap;gap:8px}",
    ".wb-ask .opts input{position:absolute;opacity:0;width:1px;height:1px}",
    ".wb-ask .opts label{display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border:2px solid #2B1C15;border-radius:999px;background:#FFFFFF;font-weight:700;font-size:14px;cursor:pointer}",
    ".wb-ask .opts input:checked+label{background:#2B1C15;color:#BFE3FF}",
    ".wb-ask .opts input:focus-visible+label{outline:3px solid #1F5FA8;outline-offset:2px}",
    ".wb-ask textarea,.wb-ask input[type=email]{width:100%;box-sizing:border-box;background:#FFFFFF;border:2px solid #2B1C15;border-radius:14px;padding:10px 12px;font:inherit;color:#2B1C15;margin:0 0 10px}",
    ".wb-ask textarea{min-height:56px;resize:vertical}",
    ".wb-ask textarea:focus,.wb-ask input:focus{outline:3px solid #1F5FA8;outline-offset:1px}",
    ".wb-ask .send{width:100%;min-height:50px;border:3px solid #2B1C15;border-radius:999px;background:#1F5FA8;color:#FFFFFF;font:800 17px 'Bricolage Grotesque','Trebuchet MS',sans-serif;cursor:pointer;box-shadow:3px 3px 0 #2B1C15}",
    ".wb-ask .send:disabled{opacity:.6;cursor:wait}",
    ".wb-ask .msg{margin:8px 0 0;font-size:14px;font-weight:700}",
    ".wb-ask .msg:empty{display:none}",
    ".wb-ask .fine{margin:10px 0 0;font-size:12px;color:#5A463A}",
    ".wb-ask .fine a{color:#1F5FA8}",
    ".wb-ask .trap{position:absolute;left:-9999px}"
  ].join("\n");
  document.head.appendChild(css);

  var pill = document.createElement("button");
  pill.type = "button"; pill.className = "wb-ask-pill"; pill.hidden = true;
  pill.textContent = "quick question?";
  pill.setAttribute("aria-haspopup", "dialog");

  var box = document.createElement("section");
  box.className = "wb-ask"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-labelledby", "wb-ask-h");
  box.innerHTML =
    '<button type="button" class="x" aria-label="close">×</button>' +
    '<h2 id="wb-ask-h">what’s stopping you?</h2>' +
    '<p class="sub">no judgment. the bish judges enough for all of us. tap any that apply.</p>' +
    '<form novalidate><fieldset><legend>what’s stopping you from ordering?</legend><div class="opts">' +
    REASONS.map(function (r, i) { return '<input type="checkbox" id="wb-r' + i + '" value="' + r[0] + '"><label for="wb-r' + i + '">' + r[1] + '</label>'; }).join("") +
    '</div></fieldset>' +
    '<label for="wb-ask-t" class="sub" style="display:block;margin:0 0 6px;font-weight:700;color:#2B1C15">anything else? (optional)</label>' +
    '<textarea id="wb-ask-t" maxlength="1000" placeholder="what would make you say yes?"></textarea>' +
    '<label for="wb-ask-e" class="sub" style="display:block;margin:0 0 6px;font-weight:700;color:#2B1C15">email, if you’d like a reply (optional)</label>' +
    '<input type="email" id="wb-ask-e" maxlength="254" autocomplete="email" placeholder="you@email.com">' +
    '<div class="trap" aria-hidden="true"><input type="text" tabindex="-1" autocomplete="off" name="website"></div>' +
    '<button type="submit" class="send">send to the bish</button>' +
    '<p class="msg" aria-live="polite"></p>' +
    '<p class="fine">anonymous unless you add your email. <a href="privacy.html">privacy</a></p></form>';

  document.body.appendChild(pill); document.body.appendChild(box);
  var form = box.querySelector("form"), msg = box.querySelector(".msg"), send = box.querySelector(".send");

  function open() { pill.hidden = true; box.hidden = false; var f = box.querySelector(".opts input"); if (f) f.focus(); }
  function close() { box.hidden = true; if (get() !== "sent") { set("closed"); pill.hidden = false; } }
  pill.addEventListener("click", open);
  box.querySelector(".x").addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (form.website && form.website.value) return;
    var picked = Array.prototype.slice.call(form.querySelectorAll(".opts input:checked")).map(function (c) { return c.value; });
    var text = box.querySelector("#wb-ask-t").value.trim(), email = box.querySelector("#wb-ask-e").value.trim();
    if (!picked.length && !text) { msg.textContent = "tap at least one, or write something."; return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "that email doesn’t look right."; return; }
    send.disabled = true; msg.textContent = "sending…";
    fetch(URL, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ reasons: picked, message: text || null, email: email || null, page: location.pathname.split("/").pop() || "index.html" })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      set("sent");
      box.innerHTML = '<button type="button" class="x" aria-label="close">×</button><h2>noted.</h2><p class="sub" style="margin:0">thank you. the bish is taking this very personally. ' + (email ? "we’ll reply soon." : "") + '</p>';
      box.querySelector(".x").addEventListener("click", function () { box.hidden = true; });
      setTimeout(function () { box.hidden = true; }, 4000);
    }).catch(function () {
      msg.textContent = "that didn’t send. try again in a bit.";
      send.disabled = false;
    });
  });

  if (seen === "sent") return;               // already answered: stay quiet
  if (seen === "closed") { pill.hidden = false; return; } // closed before: just the small button

  // First visit: pop up only when someone looks hesitant around the prices.
  var start = Date.now(), shown = false, seenPrices = false, booked = false;
  var pricing = Array.prototype.slice.call(document.querySelectorAll("#offer, #order, .cards"));
  function ready() { return !shown && !booked && Date.now() - start > 10000; }
  function trigger(why) {
    if (!ready()) return;
    shown = true; open();
    box.classList.add("wb-pop");
  }
  // anyone clicking a book / shop link is already ordering: leave them alone
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href*='shop/index.html'], a[href*='cal.com']");
    if (a) booked = true;
  });
  // 1. lingering on the prices for 6 seconds
  var lingerTimer = null;
  if ("IntersectionObserver" in window && pricing.length) {
    var visible = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        // counts as "looking at it" when it fills at least 40% of the screen (sections can be taller than the screen)
        var share = en.intersectionRect.height / Math.min(innerHeight, en.boundingClientRect.height || innerHeight);
        if (en.isIntersecting && share >= 0.4) { visible.add(en.target); seenPrices = true; } else visible.delete(en.target);
      });
      if (visible.size && !lingerTimer) lingerTimer = setTimeout(function () { lingerTimer = null; if (visible.size) trigger("linger"); }, 6000);
      if (!visible.size && lingerTimer) { clearTimeout(lingerTimer); lingerTimer = null; }
    }, { threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
    pricing.forEach(function (el) { io.observe(el); });
  }
  // 2. scrolling back up after seeing the prices
  var lastY = scrollY, upRun = 0;
  addEventListener("scroll", function () {
    var y = scrollY, d = y - lastY; lastY = y;
    if (d < 0) upRun += -d; else if (d > 0) upRun = 0;
    if (seenPrices && upRun > Math.max(500, innerHeight * 0.8)) trigger("scroll-up");
  }, { passive: true });
  // 3. heading for the close / back button (computers)
  document.addEventListener("mouseout", function (e) {
    if (!e.relatedTarget && e.clientY <= 0 && seenPrices) trigger("exit");
  });
})();
