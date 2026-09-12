# Pantry Ledger

A grocery budget + "how long is this lasting" tracker. Static site (no build step, no server) — hosted on GitHub Pages, data stored as JSON in a separate **private** GitHub repo you control.

## Why two repos

- **This repo** (the app code) can be public — it's just HTML/CSS/JS with no secrets in it. GitHub Pages serves it.
- **A second, private repo** holds your actual grocery data (`data.json`), read and written from your browser via the GitHub API. Keeping it private matters because the access token you'll create only needs to reach that one repo, and you don't want your spending history world-readable.

## 1. Create the data repo

1. On GitHub, create a new **private** repository, e.g. `grocery-data`. Leave it empty (no README) — the app creates `data.json` itself on first connect.

## 2. Create a scoped access token

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories** → pick `grocery-data`.
3. Permissions → **Repository permissions → Contents: Read and write**. Leave everything else at "No access."
4. Generate, and copy the token (`github_pat_...`) somewhere safe — GitHub only shows it once.

This token can only touch `grocery-data`'s files — it can't read your other repos, profile, or account settings.

## 3. Deploy this app to GitHub Pages

1. Push this folder's contents to a repo (can be public or private — Pages works either way, though a public repo means anyone can see the *app*, not your data, since the data repo is separate).
2. In that repo: **Settings → Pages → Source → Deploy from a branch**, pick `main` and `/ (root)`.
3. Wait a minute, then visit the URL GitHub gives you.

## 4. Connect

On first load, the app asks for:
- Your GitHub username
- The data repo name (`grocery-data`)
- Branch (`main`)
- File path (`data.json` is fine as-is)
- The token from step 2

This is saved only in that browser's `localStorage`. If you use the app from a different device or browser, you'll need to enter the token there too — nothing syncs automatically except through the shared `data.json`.

## About the "smart" parts

There's no real optimization algorithm on day one, and there shouldn't be — with zero purchase history, any "optimal buy schedule" would just be a guess wearing a formula. Instead:

- **Cold start**: new items get a default shelf life from a static category reference table (produce, dairy, meat, pantry staples, etc.) in `defaults.js`.
- **Once you log 2+ purchases of an item**, the app switches to inferring how long it actually lasts for your household from the gaps between purchases (or, more accurately, from the optional "finished on" date you can log per purchase).
- **The overspend warning** on the Dashboard is a simple run-rate projection: `spent-so-far ÷ days-elapsed × days-in-period`, compared against your budget for that period.
- **Multi-person budget scaling** uses `base × (1 + factor × (people − 1))` rather than straight multiplication, since shared staples don't cost twice as much for two people. The factor is adjustable in Settings (0 = flat budget regardless of household size, 1 = full per-person multiplication).

The longer you use it, the better the "next buy" estimates get, because they're built from your own data, not a guess.

## Files

- `index.html` — page shell, loads fonts + `app.js`
- `style.css` — visual design
- `app.js` — state, rendering, event wiring for all tabs
- `calc.js` — pure functions: period math, budget scaling, run-rate projection, lasting-duration inference
- `github-store.js` — GitHub Contents API read/write + local connection config
- `defaults.js` — cold-start shelf-life reference table by category
