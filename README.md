# 🪵 Shed Planner

A phone-friendly web app for planning wooden sheds. Enter your dimensions with a
live graphical preview and instantly get a **shopping list** and a **cut sheet
with cut angles**. Runs entirely in the browser — no server, no accounts — so it
hosts free on **GitHub Pages**.

Optimized for mobile (tested against the iPhone 16 Pro Max viewport, 440 × 956 pt)
and works on desktop too.

## Features

- **Opening wizard** — asks general questions (name, purpose, units, size,
  framing) and a **visual roof-style picker**.
- **Roof styles**: Gable, Lean-to, Saltbox, Gambrel (barn), Flat.
- **Live preview** — front and side elevations that redraw as you type, with
  dimension lines and rafter/stud spacing.
- **Shopping list** — floor, walls, roof, weatherproofing & hardware, with
  quantities and lengths.
- **Cut sheet with angles** — rafter lengths plus plumb/seat/knee/peak angles for
  each roof style.
- **Save & load designs** — stored locally in your browser (`localStorage`).
- **Units** — Imperial (ft/in) or Metric (m/cm), toggle anytime.
- **Print / Save as PDF** — clean print layout.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a GitHub repo and push these files:
   ```bash
   git add .
   git commit -m "Shed Planner app"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) publishes the site on
   every push to `main`. Your app will be live at
   `https://<you>.github.io/<repo>/`.

> Prefer no Actions? You can instead pick **Source: Deploy from a branch →
> `main` / root**. The app is plain static files, so either works.

## Project structure

```
index.html        # markup: wizard, tabs, preview, lists
css/styles.css    # mobile-first styling + print styles
js/app.js         # geometry, materials, cut angles, wizard, save/load
.github/workflows/deploy.yml
```

## Notes & disclaimer

Estimates cover standard framing only. Add ~10% for waste plus fasteners,
hardware, roofing, trim and paint. Cut angles are theoretical — always cut a test
piece first, and verify everything against your local building codes.
