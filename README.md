# watabish

The website for watabish.com: hand-painted pet headshots and bespoke cat products, inspired by Watabish, a lynx point cat with an attitude problem.

Everything is in `index.html`. Open it in a browser to preview.

## Still to fill in
Search `index.html` for `[` to find placeholders: tip link, socials, email, meet-up area, slots per week, laser fund numbers, and photos.

## Hosting on GitHub Pages
Settings → Pages → Source: "Deploy from a branch" → `main` / root → Save.
Then add a custom domain (`watabish.com`) on the same page and follow GitHub's DNS instructions at your domain registrar.

## Cat map (`/map`)
A neighbourhood map where people post cats they meet: **hotspots** (cats or dogs who live at a shop, café or public place you can visit; exact location, posted only with the owner's okay), **spotted**, **needs help** or **maybe lost**. Dogs can be posted too, but only as **maybe lost**. A lost cat or dog can be marked **back home** by whoever posted it (or its Guardian), which takes it off the map. A **Guardian** is a neighbour who looks after a particular cat. Animals that need help, might be lost or were found deceased have a **who's been called** checklist, so neighbours know which groups have already been contacted. In Sault Ste. Marie it lists the Humane Society, TAAG and (for dogs) Maddy's Mighty Mutts; elsewhere it shows general options. To add a group, edit the `ORGS` list near the top of the script in `map/index.html`. **Found deceased** reports (cats or dogs, e.g. hit by a car) are hidden unless that filter is chosen, keep any photo blurred until tapped, and leave the map after 30 days. Everything is in `map/index.html`, and it uses the same Supabase project and sign-in as `/play`.

### One-time Supabase setup
1. **SQL Editor** → paste all of `supabase/map.sql` → **Run**. It only adds new `map_*` tables, functions and a `cat-photos` storage bucket; `/play` is untouched. Safe to run again: **whenever this file changes, run the whole thing again** to pick up the changes. Existing cats and comments are kept.
2. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins**. This lets people comment without an account. (Leave it off if you'd rather require accounts; the page tells people to sign in.)
3. **Authentication → URL Configuration → Redirect URLs** → add `https://watabish.com/map/` so the link in the sign-in email can return to the map.

### How privacy works
- Exact locations never leave the database. The map shows a point moved 30–80 m for spotted cats, and an area 120–260 m off for cats that need help or might be lost.
- Photos are resized to 1280 px in the browser before upload, which also removes the GPS and other info stored inside them.
- The browser can't read the tables directly; all access goes through the `map_*` functions.

### Moderation
- Anything reported by 3 different people is hidden automatically. Reports are in the `map_reports` table.
- To hide or restore something yourself: **Table Editor** → `map_cats`, `map_comments` or `map_sightings` → set `hidden` to true/false.
- Spam limits: 30 posts and 10 new cats per person per day; 8 comments per 10 minutes (3 for anonymous).

### Map tiles
The map uses OpenStreetMap's free tiles, which are fine for a small site but have no guarantees. If it gets busy, change `TILES` at the top of the script in `map/index.html` to a tile provider's URL.
