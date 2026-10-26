// coming-soon email sign-up: saves the email to the "waitlist" table in Supabase
(function () {
  var form = document.getElementById("waitlist");
  if (!form) return;
  var URL = "https://drreubfqwmivmpwpynnt.supabase.co/rest/v1/waitlist";
  var KEY = "sb_publishable_ZIFNEg8XxN_JW6li0MKReA_yjgPEfyj";
  var msg = document.getElementById("wl-msg"), btn = form.querySelector("button");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (form.website && form.website.value) return; // bots fill the hidden field
    var email = (form.email.value || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "that doesn't look like an email."; return; }
    btn.disabled = true; msg.textContent = "adding you…";
    fetch(URL, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ email: email, list: "cat-furniture" })
    }).then(function (r) {
      if (r.ok) { msg.textContent = "you're on the list. the bish has been notified (he doesn't care)."; form.email.value = ""; }
      else if (r.status === 409) msg.textContent = "you're already on the list. iconic.";
      else msg.textContent = "couldn't add you right now. try again in a bit.";
    }).catch(function () { msg.textContent = "couldn't add you right now. check your connection."; })
      .then(function () { btn.disabled = false; });
  });
})();
