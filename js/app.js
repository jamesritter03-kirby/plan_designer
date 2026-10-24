/* Shed Planner — client-side app (no dependencies, GitHub Pages friendly) */
(function () {
  "use strict";

  const FT_PER_M = 3.280839895;
  const IN_PER_M = 39.3700787;
  const APP_VERSION = "1.3.0";
  const STORE_KEY = "shedPlanner.designs.v1";
  const SEEN_KEY = "shedPlanner.seen.v1";
  const THEME_KEY = "shedPlanner.theme.v1";

  /* ---------- State ---------- */
  const state = {
    id: null,
    name: "",
    purpose: "storage",
    units: "imperial",
    roofType: "gable",
    roofCovering: "asphalt",
    pitch: 4,
    overhang: 12, // inches
    width: 8, // ft
    depth: 10, // ft
    wallHeight: 7, // ft
    spacing: 16, // inches O.C.
    lumber: "2x4",
    // openings: each has its own size, wall and position
    doors: [{ type: "single", wall: "front", pos: "center", w: 3, h: 6.5 }],
    windows: [{ wall: "left", pos: "center", w: 2, h: 2 }],
    photos: {}, // build-step photos keyed by step title (data URLs)
    address: "",
    lat: null,
    lon: null,
    zip: "",
    camYaw: -0.6, // 3D orbit angles (radians)
    camPitch: 0.5,
    view: "front",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- Unit helpers (canonical = imperial) ---------- */
  const dispLen = (ft) => (state.units === "metric" ? ft / FT_PER_M : ft);
  const toFt = (v) => (state.units === "metric" ? v * FT_PER_M : v);
  const dispSmall = (inch) => (state.units === "metric" ? inch * 2.54 : inch); // cm vs in
  const toInches = (v) => (state.units === "metric" ? v / 2.54 : v);
  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

  function fmtLen(ft) {
    if (ft <= 0) return "—";
    if (state.units === "metric") {
      return round(ft / FT_PER_M, 2).toFixed(2) + " m";
    }
    const totalIn = ft * 12;
    let feet = Math.floor(totalIn / 12 + 1e-6);
    let inch = totalIn - feet * 12;
    // round to nearest 1/8"
    let eighths = Math.round(inch * 8);
    if (eighths === 96) { feet += 1; eighths = 0; }
    const whole = Math.floor(eighths / 8);
    const frac = eighths % 8;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const k = frac ? gcd(frac, 8) : 1;
    const fracStr = frac ? `${frac / k}/${8 / k}` : "";
    let inchPart = "";
    if (whole) inchPart += whole;
    if (fracStr) inchPart += (whole ? " " : "") + fracStr;
    let out = "";
    if (feet) out += `${feet}'`;
    if (inchPart) out += `${feet ? " " : ""}${inchPart}"`;
    if (!feet && !inchPart) out = `0"`;
    return out;
  }

  function fmtTotal(ft) {
    if (state.units === "metric") return round(ft / FT_PER_M, 1).toFixed(1) + " m";
    return Math.ceil(ft) + " ft";
  }

  const fmtAng = (deg) => round(deg, 1).toFixed(1) + "°";

  /* ---------- Roof geometry ---------- */
  function geometry() {
    const W = state.width, D = state.depth, H = state.wallHeight;
    const oh = state.overhang / 12; // ft
    const p = state.pitch;
    const theta = Math.atan(p / 12); // radians
    const thetaDeg = (theta * 180) / Math.PI;
    const g = { type: state.roofType, thetaDeg, rafters: [] };

    if (state.roofType === "gable") {
      const run = W / 2;
      const rise = run * (p / 12);
      const bodyLen = run / Math.cos(theta);
      const fullLen = (run + oh) / Math.cos(theta);
      g.peakHeight = H + rise;
      g.rafters.push({
        name: "Common rafter",
        qty: raftersPerSide() * 2,
        length: fullLen,
        plumb: thetaDeg,
        seat: 90 - thetaDeg,
        note: "Plumb cut both relevant ends; birdsmouth seat at wall.",
      });
    } else if (state.roofType === "lean-to") {
      const run = W;
      const rise = run * (p / 12);
      const fullLen = (run + 2 * oh) / Math.cos(theta);
      g.peakHeight = H + rise;
      g.rafters.push({
        name: "Sloped rafter",
        qty: raftersPerSide(),
        length: fullLen,
        plumb: thetaDeg,
        seat: 90 - thetaDeg,
        note: "Plumb cut both ends; birdsmouth over each wall.",
      });
    } else if (state.roofType === "flat") {
      const run = W;
      const rise = run * (Math.max(p, 0.25) / 12);
      const fullLen = run + 2 * oh;
      g.peakHeight = H + rise;
      g.rafters.push({
        name: "Flat roof joist",
        qty: raftersPerSide(),
        length: fullLen,
        plumb: 90,
        seat: 0,
        note: "Square cuts. Build with a slight slope for drainage.",
      });
    } else if (state.roofType === "saltbox") {
      const shortRun = W * 0.4, longRun = W * 0.6;
      const rise = shortRun * (p / 12); // ridge height set by steep (short) side
      const shortAng = (Math.atan(rise / shortRun) * 180) / Math.PI;
      const longAng = (Math.atan(rise / longRun) * 180) / Math.PI;
      g.peakHeight = H + rise;
      g.rafters.push({
        name: "Short-side rafter (steep)",
        qty: raftersPerSide(),
        length: (Math.hypot(shortRun, rise) + oh / Math.cos((shortAng * Math.PI) / 180)),
        plumb: shortAng,
        seat: 90 - shortAng,
        note: "Steep front slope.",
      });
      g.rafters.push({
        name: "Long-side rafter (shallow)",
        qty: raftersPerSide(),
        length: (Math.hypot(longRun, rise) + oh / Math.cos((longAng * Math.PI) / 180)),
        plumb: longAng,
        seat: 90 - longAng,
        note: "Shallow back slope.",
      });
      g.thetaDeg = shortAng;
    } else if (state.roofType === "gambrel") {
      // Semicircle method: 4 chords of a 45° arc, radius R = W/2
      const R = W / 2;
      const chord = 2 * R * Math.sin(Math.PI / 8); // 22.5°
      g.peakHeight = H + R;
      const trusses = raftersPerSide();
      g.rafters.push({
        name: "Lower rafter (steep)",
        qty: trusses * 2,
        length: chord + oh / Math.cos((67.5 * Math.PI) / 180),
        plumb: 67.5,
        seat: 22.5,
        note: "Eave end: birdsmouth. Knee end: 67.5° plumb.",
      });
      g.rafters.push({
        name: "Upper rafter (shallow)",
        qty: trusses * 2,
        length: chord,
        plumb: 22.5,
        seat: 67.5,
        note: "Knee-to-ridge. Knee angle 112.5° total joint.",
      });
      g.kneeHeight = H + R * Math.sin(Math.PI / 4);
      g.thetaDeg = 67.5;
    }
    return g;
  }

  function raftersPerSide() {
    return Math.floor((state.depth * 12) / state.spacing) + 1;
  }
  function studsForWall(lenFt) {
    return Math.floor((lenFt * 12) / state.spacing) + 1;
  }

  /* ---------- Materials ---------- */
  function materials() {
    const W = state.width, D = state.depth, H = state.wallHeight;
    const perim = 2 * (W + D);
    const g = geometry();
    const groups = [];

    // Floor
    const floorJoists = Math.floor((D * 12) / state.spacing) + 1;
    const skids = Math.max(2, Math.floor((W * 12) / 24) + 1);
    const floorSheets = Math.ceil((W * D) / 32);
    groups.push({
      title: "Floor",
      items: [
        { label: `Skids — pressure-treated 4×4`, sub: `run front-to-back`, qty: `${skids} × ${fmtLen(D)}` },
        { label: `Floor joists — 2×6`, sub: `${state.spacing}" O.C.`, qty: `${floorJoists} × ${fmtLen(W)}` },
        { label: `Rim / band joists — 2×6`, sub: `perimeter of floor`, qty: `2 × ${fmtLen(D)}` },
        { label: `Floor decking — ¾" plywood`, sub: `4×8 sheets`, qty: `${floorSheets} sheets` },
      ],
    });

    // Walls
    const doorCount = state.doors.length, winCount = state.windows.length;
    const bigDoor = state.doors.some((d) => d.type === "overhead" || d.w > 5);
    const studs =
      studsForWall(W) * 2 + studsForWall(D) * 2 +
      3 /*extra corner studs*/ +
      doorCount * 4 /*door framing*/ +
      winCount * 6;
    groups.push({
      title: "Walls",
      items: [
        { label: `Bottom plate — PT ${state.lumber}`, sub: `wall perimeter`, qty: fmtTotal(perim) },
        { label: `Top plate (doubled) — ${state.lumber}`, sub: `2× perimeter`, qty: fmtTotal(perim * 2) },
        { label: `Studs — ${state.lumber}`, sub: `${state.spacing}" O.C. + corners & openings`, qty: `${studs} × ${fmtLen(H)}` },
        ...(doorCount > 0
          ? [{ label: `Door headers — 2×6 (×2 each)`, sub: `${doorCount} opening(s)${bigDoor ? " — size wide/overhead to 2×10/LVL" : ""}`, qty: `${doorCount * 2} pcs` }]
          : []),
        ...(winCount > 0
          ? [{ label: `Window headers — 2×6 (×2 each)`, sub: `${winCount} window(s)`, qty: `${winCount * 2} pcs` }]
          : []),
        { label: `Wall sheathing — 7⁄16" OSB`, sub: `4×8 sheets`, qty: `${Math.ceil((perim * H) / 32)} sheets` },
      ],
    });

    // Roof
    const roofItems = [];
    g.rafters.forEach((r) => {
      roofItems.push({ label: `${r.name} — ${state.lumber}`, sub: r.note, qty: `${r.qty} × ${fmtLen(r.length)}` });
    });
    if (state.roofType === "gable" || state.roofType === "saltbox") {
      roofItems.push({ label: `Ridge board — 2×8`, sub: `runs the full depth`, qty: `1 × ${fmtLen(D)}` });
      roofItems.push({ label: `Collar ties — ${state.lumber}`, sub: `tie opposing rafters`, qty: `${raftersPerSide()} × ${fmtLen(W / 2)}` });
    }
    if (state.roofType === "gambrel") {
      roofItems.push({ label: `Gusset plates — ½" ply`, sub: `both knees + peak, both sides`, qty: `${raftersPerSide() * 6} pcs` });
    }
    const roofArea = roofSheathingArea(g);
    roofItems.push({ label: `Roof sheathing — 7⁄16" OSB`, sub: `4×8 sheets`, qty: `${Math.ceil(roofArea / 32)} sheets` });
    roofItems.push({ label: `Fascia — 1×6`, sub: `along both eaves`, qty: `2 × ${fmtLen(D + state.overhang / 6)}` });
    groups.push({ title: "Roof", items: roofItems });

    // Closers / misc
    groups.push({
      title: "Weatherproofing & hardware",
      items: [
        { label: `Roofing — ${roofCover().label.toLowerCase()}`, sub: `cover roof area`, qty: `≈ ${Math.ceil(roofArea)} sq ft` },
        { label: `Roofing felt / underlayment`, sub: `under roofing`, qty: `≈ ${Math.ceil(roofArea)} sq ft` },
        { label: `House wrap`, sub: `walls`, qty: `≈ ${Math.ceil(perim * H)} sq ft` },
        ...state.doors.map((d) => ({ label: `Door — ${DOOR_LABELS[d.type]}`, sub: `${fmtLen(d.w)} × ${fmtLen(d.h)} · ${d.wall} wall, ${d.pos}`, qty: `1` })),
        ...state.windows.map((w) => ({ label: `Window`, sub: `${fmtLen(w.w)} × ${fmtLen(w.h)} · ${w.wall} wall, ${w.pos}`, qty: `1` })),
        { label: `Framing nails / screws, joist hangers, hurricane ties`, sub: `assorted`, qty: `as needed` },
      ],
    });

    return { groups, g, perim, roofArea };
  }

  function roofSheathingArea(g) {
    const D = state.depth;
    const oh = state.overhang / 12;
    const coverDepth = D + 2 * oh;
    if (state.roofType === "flat") return state.width * coverDepth;
    let planeWidthTotal = 0;
    g.rafters.forEach((r) => (planeWidthTotal += r.length));
    // one of each listed rafter represents one plane width
    return planeWidthTotal * coverDepth;
  }

  // Rough per-store unit prices (USD). Lumber per linear ft; sheets each; areas per sq ft.
  const PRICES = {
    "Lowe's": { "2x4": 0.72, "2x6": 1.18, "2x8": 1.75, "4x4": 2.7, "1x6": 1.85, plyDeck: 52, osb: 23, roofing: 1.7, felt: 0.18, wrap: 0.28, door: 170, window: 130, hardware: 70 },
    "Home Depot": { "2x4": 0.7, "2x6": 1.15, "2x8": 1.72, "4x4": 2.65, "1x6": 1.8, plyDeck: 50, osb: 22, roofing: 1.65, felt: 0.17, wrap: 0.27, door: 165, window: 125, hardware: 68 },
    "McCoy's": { "2x4": 0.66, "2x6": 1.08, "2x8": 1.62, "4x4": 2.5, "1x6": 1.72, plyDeck: 48, osb: 21, roofing: 1.6, felt: 0.16, wrap: 0.26, door: 160, window: 120, hardware: 65 },
  };

  // Roof covering options: price multiplier on the base roofing cost + display label.
  const ROOF_COVER = {
    asphalt: { label: "Asphalt shingles", mult: 1.0 },
    metal: { label: "Metal panels", mult: 1.9 },
    wood: { label: "Wood shingles / shakes", mult: 2.4 },
    corrugated: { label: "Corrugated / polycarbonate", mult: 1.5 },
    rolled: { label: "Rolled roofing", mult: 0.7 },
    rubber: { label: "EPDM rubber", mult: 1.6 },
  };
  function roofCover() {
    return ROOF_COVER[state.roofCovering] || ROOF_COVER.asphalt;
  }

  function estimate(g, perim, roofArea) {
    const mult = zipMultiplier(state.zip).mult;
    const coverMult = roofCover().mult;
    const W = state.width, D = state.depth, H = state.wallHeight, oh = state.overhang / 12;
    const lum = state.lumber;
    const floorJoists = Math.floor((D * 12) / state.spacing) + 1;
    const skids = Math.max(2, Math.floor((W * 12) / 24) + 1);
    const studs = studsForWall(W) * 2 + studsForWall(D) * 2 + 3 + state.doors.length * 4 + state.windows.length * 6;
    const ft = { "2x4": 0, "2x6": 0, "2x8": 0, "4x4": 0, "1x6": 0 };
    ft["4x4"] += skids * D;
    ft["2x6"] += floorJoists * W + 2 * D;
    ft[lum] += perim + 2 * perim + studs * H;
    ft["2x6"] += state.doors.reduce((a, d) => a + (d.w + 0.5) * 2, 0) + state.windows.reduce((a, w) => a + (w.w + 0.5) * 2, 0);
    g.rafters.forEach((r) => (ft[lum] += r.qty * r.length));
    if (state.roofType === "gable" || state.roofType === "saltbox") {
      ft["2x8"] += D;
      ft[lum] += raftersPerSide() * (W / 2);
    }
    ft["1x6"] += 2 * (D + oh * 2);
    const plyDeck = Math.ceil((W * D) / 32);
    const osb = Math.ceil((perim * H) / 32) + Math.ceil(roofArea / 32);
    const wallArea = perim * H;
    return Object.keys(PRICES).map((store) => {
      const p = PRICES[store];
      let t = 0;
      for (const s in ft) t += ft[s] * p[s];
      t += plyDeck * p.plyDeck + osb * p.osb;
      t += roofArea * p.roofing * coverMult + roofArea * p.felt + wallArea * p.wrap;
      t += state.doors.length * p.door + state.windows.length * p.window + p.hardware;
      return { store, total: Math.round(t * mult) };
    });
  }

  // Rough regional cost multiplier from US ZIP leading digit (materials + freight).
  function zipMultiplier(zip) {
    if (!/^\d{5}$/.test(zip || "")) return { mult: 1, label: "US average" };
    const d = zip[0];
    const map = { "0": 1.18, "1": 1.12, "2": 1.05, "3": 0.98, "4": 0.97, "5": 1.0, "6": 0.96, "7": 0.95, "8": 1.06, "9": 1.15 };
    const region = {
      "0": "Northeast", "1": "Northeast", "2": "Mid-Atlantic", "3": "Southeast", "4": "Midwest",
      "5": "Upper Midwest", "6": "Central Plains", "7": "South Central", "8": "Mountain West", "9": "West Coast",
    };
    return { mult: map[d] || 1, label: region[d] || "US" };
  }

  // Render the static map (also prints) from resolved coordinates.
  function renderMap() {
    const box = $("#mapBox");
    if (!box) return;
    if (state.lat == null || state.lon == null) {
      box.innerHTML = state.address
        ? `<p class="map-hint">Tap “Find on map” to locate “${escapeHtml(state.address)}”.</p>`
        : `<p class="map-hint">Enter an address to show a map and local pricing.</p>`;
      return;
    }
    const lat = state.lat, lon = state.lon;
    const img = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=16&size=600x300&markers=${lat},${lon},red-pushpin`;
    const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    box.innerHTML =
      `<img class="map-img" src="${img}" alt="Map of build location" loading="lazy" />` +
      `<p class="map-addr">📍 ${escapeHtml(state.address)}</p>` +
      `<a class="map-link" href="${osm}" target="_blank" rel="noopener">View on OpenStreetMap ↗</a>`;
  }

  // Geocode the address with OpenStreetMap Nominatim (keyless) → lat/lon + ZIP.
  async function geocode() {
    const q = ($("#addrInput").value || "").trim();
    state.address = q;
    if (!q) { state.lat = state.lon = null; renderMap(); return; }
    const btn = $("#findAddr");
    if (btn) { btn.disabled = true; btn.textContent = "Searching…"; }
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (!data.length) { toast("Address not found"); renderMap(); return; }
      const hit = data[0];
      state.lat = parseFloat(hit.lat);
      state.lon = parseFloat(hit.lon);
      state.address = hit.display_name || q;
      const pc = hit.address && hit.address.postcode ? String(hit.address.postcode).match(/\d{5}/) : null;
      if (pc) {
        state.zip = pc[0];
        const zi = $("#zipInput"); if (zi) zi.value = state.zip;
      }
      $("#addrInput").value = state.address;
      renderMap();
      renderShopping();
    } catch (err) {
      console.warn("Geocode failed:", err);
      toast("Could not reach map service");
      renderMap();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "📍 Find on map"; }
    }
  }

  /* ---------- Cut sheet ---------- */
  function cutSheet() {
    const g = geometry();
    const groups = [];
    const rafterRows = g.rafters.map((r) => ({
      label: r.name,
      sub: r.note,
      qty: `${r.qty} pcs @ ${fmtLen(r.length)}`,
      angles: [
        { k: "Plumb", v: fmtAng(r.plumb) },
        { k: "Seat", v: fmtAng(r.seat) },
      ],
    }));
    groups.push({ title: "Rafters & roof members", rows: rafterRows });

    // Wall / floor square-cut members
    const W = state.width, D = state.depth, H = state.wallHeight;
    groups.push({
      title: "Studs & plates (square 90° cuts)",
      rows: [
        { label: "Wall studs", sub: `cut to length`, qty: `many @ ${fmtLen(H - 0.375)}`, angles: [{ k: "Both ends", v: "90°" }] },
        { label: "Floor joists", sub: `span the width`, qty: `@ ${fmtLen(W)}`, angles: [{ k: "Both ends", v: "90°" }] },
        { label: "Plates", sub: `cut to wall lengths`, qty: `${fmtLen(W)} & ${fmtLen(D)}`, angles: [{ k: "Both ends", v: "90°" }] },
      ],
    });

    if (state.roofType === "gable" || state.roofType === "lean-to" || state.roofType === "saltbox") {
      groups.push({
        title: "How to mark the angles",
        rows: [
          { label: "Plumb cut (ridge/top)", sub: "Set speed square / miter saw to this angle off vertical reference", qty: "", angles: [{ k: "Angle", v: fmtAng(g.thetaDeg) }] },
          { label: "Birdsmouth seat cut", sub: "Horizontal notch that sits on the top plate", qty: "", angles: [{ k: "Angle", v: fmtAng(90 - g.thetaDeg) }] },
        ],
      });
    }
    if (state.roofType === "gambrel") {
      groups.push({
        title: "Gambrel joint angles",
        rows: [
          { label: "Lower rafter at eave", sub: "birdsmouth seat", qty: "", angles: [{ k: "Seat", v: "22.5°" }] },
          { label: "Knee joint", sub: "lower meets upper rafter", qty: "", angles: [{ k: "Each cut", v: "22.5°" }] },
          { label: "Peak joint", sub: "upper rafters meet", qty: "", angles: [{ k: "Each cut", v: "67.5°" }] },
        ],
      });
    }
    return { groups, g };
  }

  /* ---------- SVG preview ---------- */
  function renderPreview() {
    const stage = $("#preview");
    const light = document.documentElement.getAttribute("data-theme") === "light";
    C.dim = light ? "#51607a" : "#9fb2ce";
    C.gap = light ? "#f4f7fb" : "#0d1524";
    C.stud = light ? "#caa96b" : "#e0cda4";
    const g = geometry();
    const svg = state.view === "front" ? frontElevation(g) : state.view === "side" ? sideElevation(g) : state.view === "top" ? topView(g) : threeDView(g);
    stage.innerHTML = svg;
    stage.classList.toggle("rotatable", state.view === "3d");
    const roofNames = { gable: "Gable", "lean-to": "Lean-to", saltbox: "Saltbox", gambrel: "Gambrel", flat: "Flat" };
    $("#preview-caption").textContent =
      `${roofNames[state.roofType]} · ${fmtLen(state.width)} W × ${fmtLen(state.depth)} D · ` +
      `walls ${fmtLen(state.wallHeight)} · peak ${fmtLen(g.peakHeight)}`;
    renderPrintViews(g);
  }

  // Print-only: render all three elevations together, always in legible light colors.
  function renderPrintViews(g) {
    const host = $("#printViews");
    if (!host) return;
    const savedDim = C.dim, savedGap = C.gap, savedStud = C.stud;
    C.dim = "#51607a"; C.gap = "#f4f7fb"; C.stud = "#caa96b";
    const views = [
      ["Front elevation", frontElevation(g)],
      ["Side elevation (left)", sideElevation(g)],
      ["Top (plan) view", topView(g)],
    ];
    C.dim = savedDim; C.gap = savedGap; C.stud = savedStud;
    host.innerHTML = views
      .map(([label, svg]) => `<div class="view-box"><div class="view-label">${label}</div>${svg}</div>`)
      .join("");
  }

  function svgWrap(inner, vw, vh) {
    return `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`;
  }
  const C = { wall: "#c9b28a", wall2: "#a98f63", line: "#1b2a3a", roof: "#4ea1d3", dim: "#9fb2ce", door: "#2c4066", stud: "#e0cda4", gap: "#0d1524" };

  const DOOR_LABELS = { single: "single swing", double: "double", barn: "barn / sliding", overhead: "overhead roll-up" };
  // Place openings along a wall of length L (ft) by their left/center/right anchor.
  function layoutWall(L, items) {
    const pad = 0.3;
    const buckets = { left: [], center: [], right: [] };
    items.forEach((it) => (buckets[it.pos] || buckets.center).push(it));
    const placed = [];
    const place = (list, anchor) => {
      if (!list.length) return;
      let widths = list.map((it) => it.w);
      let total = widths.reduce((a, b) => a + b, 0) + pad * (list.length - 1);
      if (total > L - pad) {
        const f = (L - pad * (list.length + 1)) / widths.reduce((a, b) => a + b, 0);
        widths = widths.map((w) => Math.max(0.5, w * Math.max(0.2, f)));
        total = widths.reduce((a, b) => a + b, 0) + pad * (list.length - 1);
      }
      let start = anchor === "left" ? pad : anchor === "right" ? L - pad - total : (L - total) / 2;
      start = Math.max(0, Math.min(start, L - total));
      let cursor = start;
      list.forEach((it, i) => {
        placed.push({ ...it, left: cursor, w: widths[i] });
        cursor += widths[i] + pad;
      });
    };
    place(buckets.left, "left");
    place(buckets.center, "center");
    place(buckets.right, "right");
    return placed;
  }
  function wallOpenings(wall) {
    return [
      ...state.doors.filter((d) => d.wall === wall).map((d) => ({ ...d, kind: "door" })),
      ...state.windows.filter((w) => w.wall === wall).map((w) => ({ ...w, kind: "win" })),
    ];
  }

  function drawFrontDoor(type, leftFt, wFt, hFt, sx, sy) {
    const x = sx(leftFt), w = sx(leftFt + wFt) - sx(leftFt), yTop = sy(hFt), yBot = sy(0), h = yBot - yTop;
    let s = "";
    if (type === "overhead") {
      s += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="#9fb3c4" stroke="${C.line}" stroke-width="1.5"/>`;
      for (let i = 1; i < 4; i++) {
        const yy = yTop + (h * i) / 4;
        s += `<line x1="${x}" y1="${yy}" x2="${x + w}" y2="${yy}" stroke="${C.line}" stroke-width="1" opacity="0.7"/>`;
      }
      return s;
    }
    if (type === "barn") {
      s += `<line x1="${x - 6}" y1="${yTop - 4}" x2="${x + w + 6}" y2="${yTop - 4}" stroke="${C.line}" stroke-width="2"/>`;
      s += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${C.door}" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<line x1="${x}" y1="${yTop}" x2="${x + w}" y2="${yBot}" stroke="${C.dim}" stroke-width="1.1" opacity="0.6"/>`;
      s += `<line x1="${x + w}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="${C.dim}" stroke-width="1.1" opacity="0.6"/>`;
      return s;
    }
    if (type === "double") {
      s += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${C.door}" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<line x1="${x + w / 2}" y1="${yTop}" x2="${x + w / 2}" y2="${yBot}" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<circle cx="${x + w / 2 - 4}" cy="${(yTop + yBot) / 2}" r="2.2" fill="${C.dim}"/>`;
      s += `<circle cx="${x + w / 2 + 4}" cy="${(yTop + yBot) / 2}" r="2.2" fill="${C.dim}"/>`;
      return s;
    }
    s += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${C.door}" stroke="${C.line}" stroke-width="1.5"/>`;
    s += `<circle cx="${x + w - 8}" cy="${(yTop + yBot) / 2}" r="2.5" fill="${C.dim}"/>`;
    return s;
  }
  function drawFrontWindow(cxFt, wFt, hFt, sx, sy) {
    const ww = sx(cxFt + wFt / 2) - sx(cxFt - wFt / 2);
    const wh = sy(0) - sy(hFt);
    const wx = sx(cxFt) - ww / 2;
    const wy = sy(state.wallHeight * 0.5 + hFt / 2);
    let s = `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="#bcd6e8" stroke="${C.line}" stroke-width="1.5"/>`;
    s += `<line x1="${wx + ww / 2}" y1="${wy}" x2="${wx + ww / 2}" y2="${wy + wh}" stroke="${C.line}" stroke-width="1"/>`;
    s += `<line x1="${wx}" y1="${wy + wh / 2}" x2="${wx + ww}" y2="${wy + wh / 2}" stroke="${C.line}" stroke-width="1"/>`;
    return s;
  }
  // Draw front/side-wall openings laid out along a wall of length L using local sx/sy.
  function drawElevationOpenings(wall, L, Hmax, sx, sy) {
    let s = "";
    layoutWall(L, wallOpenings(wall)).forEach((op) => {
      if (op.kind === "door") s += drawFrontDoor(op.type, op.left, Math.min(op.w, L), Math.min(op.h, Hmax * 0.95), sx, sy);
      else s += drawFrontWindow(op.left + op.w / 2, Math.min(op.w, L * 0.45), Math.min(op.h, Hmax * 0.6), sx, sy);
    });
    return s;
  }

  // Canonical plan door: wall along local x (centered), interior toward -y.
  function planDoorCanonical(type, w) {
    let s = `<rect x="${-w / 2}" y="-3" width="${w}" height="6" fill="${C.gap}" stroke="none"/>`;
    if (type === "overhead") {
      for (let i = 0; i < 3; i++) {
        const xx = -w / 2 + (w * (i + 0.5)) / 3;
        s += `<line x1="${xx}" y1="0" x2="${xx}" y2="-14" stroke="${C.door}" stroke-width="1.3" stroke-dasharray="3 3" opacity="0.85"/>`;
      }
      return s;
    }
    if (type === "barn") {
      s += `<line x1="${-w / 2 - 4}" y1="-5" x2="${w / 2 + w * 0.9 + 4}" y2="-5" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<rect x="${w / 2}" y="-7" width="${w * 0.9}" height="4" fill="${C.door}" stroke="${C.line}" stroke-width="1"/>`;
      return s;
    }
    if (type === "double") {
      s += `<path d="M ${-w / 2} 0 A ${w / 2} ${w / 2} 0 0 1 0 ${-w / 2}" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
      s += `<path d="M ${w / 2} 0 A ${w / 2} ${w / 2} 0 0 0 0 ${-w / 2}" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
      s += `<line x1="${-w / 2}" y1="0" x2="${-w / 2}" y2="${-w / 2}" stroke="${C.door}" stroke-width="1.6"/>`;
      s += `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${-w / 2}" stroke="${C.door}" stroke-width="1.6"/>`;
      return s;
    }
    s += `<path d="M ${-w / 2} 0 A ${w} ${w} 0 0 1 ${w / 2} 0" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
    s += `<line x1="${-w / 2}" y1="0" x2="${-w / 2}" y2="${-w}" stroke="${C.door}" stroke-width="2"/>`;
    return s;
  }
  function wallTransform(wall, centerFt, sx, sy, W, D) {
    if (wall === "front") return { px: sx(centerFt), py: sy(D), rot: 0 };
    if (wall === "back") return { px: sx(centerFt), py: sy(0), rot: 180 };
    if (wall === "left") return { px: sx(0), py: sy(centerFt), rot: 90 };
    return { px: sx(W), py: sy(centerFt), rot: -90 };
  }
  // Draw all openings on every wall for the plan (top) view.
  function drawPlanOpenings(sx, sy, W, D, scale) {
    let s = "";
    ["front", "back", "left", "right"].forEach((wall) => {
      const L = wall === "front" || wall === "back" ? W : D;
      layoutWall(L, wallOpenings(wall)).forEach((op) => {
        const center = op.left + op.w / 2;
        const t = wallTransform(wall, center, sx, sy, W, D);
        const wPx = op.w * scale;
        const inner = op.kind === "door"
          ? planDoorCanonical(op.type, wPx)
          : `<rect x="${-wPx / 2}" y="-2.5" width="${wPx}" height="5" fill="#bcd6e8" stroke="${C.line}" stroke-width="1"/>`;
        s += `<g transform="translate(${t.px} ${t.py}) rotate(${t.rot})">${inner}</g>`;
      });
    });
    return s;
  }

  function frontElevation(g) {
    const vw = 320, vh = 220, pad = 34;
    const maxW = state.width, maxH = g.peakHeight;
    const scale = Math.min((vw - pad * 2) / maxW, (vh - pad * 2) / maxH);
    const x0 = (vw - maxW * scale) / 2;
    const yBase = vh - pad;
    const sx = (ft) => x0 + ft * scale;
    const sy = (ft) => yBase - ft * scale;
    const W = state.width, H = state.wallHeight;
    let s = "";
    // wall box
    s += `<rect x="${sx(0)}" y="${sy(H)}" width="${W * scale}" height="${H * scale}" fill="${C.wall}" stroke="${C.line}" stroke-width="2"/>`;
    // roof shape (front shows gable triangle etc.)
    s += roofFrontPath(g, sx, sy);
    // openings on the front wall
    s += drawElevationOpenings("front", W, H, sx, sy);
    // dimensions
    s += dimLineH(sx(0), sx(W), yBase + 16, fmtLen(W), scale);
    s += dimLineV(x0 - 16, sy(0), sy(g.peakHeight), fmtLen(g.peakHeight));
    return svgWrap(s, vw, vh);
  }

  function roofFrontPath(g, sx, sy) {
    const W = state.width, H = state.wallHeight, oh = state.overhang / 12;
    const peak = g.peakHeight;
    const st = `fill="${C.roof}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"`;
    if (state.roofType === "gable") {
      return `<polygon points="${sx(-oh)},${sy(H)} ${sx(W / 2)},${sy(peak)} ${sx(W + oh)},${sy(H)}" ${st}/>`;
    }
    if (state.roofType === "lean-to") {
      return `<polygon points="${sx(-oh)},${sy(H)} ${sx(-oh)},${sy(peak)} ${sx(W + oh)},${sy(H + (peak - H) * 0)} ${sx(W + oh)},${sy(H)}" fill="${C.roof}" stroke="${C.line}" stroke-width="2"/>` +
        `<polygon points="${sx(-oh)},${sy(peak)} ${sx(W + oh)},${sy(H)} ${sx(W + oh)},${sy(H - 0.2)} ${sx(-oh)},${sy(peak - 0.2)}" fill="${C.wall2}"/>`;
    }
    if (state.roofType === "saltbox") {
      const ridgeX = W * 0.4;
      return `<polygon points="${sx(-oh)},${sy(H)} ${sx(ridgeX)},${sy(peak)} ${sx(W + oh)},${sy(H)}" ${st}/>`;
    }
    if (state.roofType === "gambrel") {
      const R = W / 2, knee = g.kneeHeight;
      const kx = W / 2 - R * Math.cos(Math.PI / 4);
      const kx2 = W / 2 + R * Math.cos(Math.PI / 4);
      return `<polygon points="${sx(-oh)},${sy(H)} ${sx(kx)},${sy(knee)} ${sx(W / 2)},${sy(peak)} ${sx(kx2)},${sy(knee)} ${sx(W + oh)},${sy(H)}" ${st}/>`;
    }
    // flat
    return `<polygon points="${sx(-oh)},${sy(H + 0.3)} ${sx(W + oh)},${sy(H)} ${sx(W + oh)},${sy(H - 0.1)} ${sx(-oh)},${sy(H + 0.2)}" ${st}/>`;
  }

  function sideElevation(g) {
    const vw = 320, vh = 220, pad = 34;
    const oh = state.overhang / 12;
    const maxExtent = state.depth + 2 * oh, maxH = g.peakHeight;
    const scale = Math.min((vw - pad * 2) / maxExtent, (vh - pad * 2) / maxH);
    const x0 = (vw - state.depth * scale) / 2;
    const yBase = vh - pad;
    const sx = (ft) => x0 + ft * scale;
    const sy = (ft) => yBase - ft * scale;
    const D = state.depth, H = state.wallHeight;
    const top = g.peakHeight;
    let s = "";
    // ground line with hatching
    s += `<line x1="${sx(-oh) - 8}" y1="${sy(0)}" x2="${sx(D + oh) + 8}" y2="${sy(0)}" stroke="${C.dim}" stroke-width="1.5"/>`;
    for (let gx = sx(-oh) - 6; gx < sx(D + oh) + 8; gx += 7) {
      s += `<line x1="${gx}" y1="${sy(0)}" x2="${gx - 5}" y2="${sy(0) + 6}" stroke="${C.dim}" stroke-width="1" opacity="0.6"/>`;
    }
    // side wall
    s += `<rect x="${sx(0)}" y="${sy(H)}" width="${D * scale}" height="${H * scale}" fill="${C.wall}" stroke="${C.line}" stroke-width="2"/>`;
    // vertical siding boards
    for (let i = 1; i * 1.333 < D; i++) {
      const bx = sx(i * 1.333);
      s += `<line x1="${bx}" y1="${sy(H)}" x2="${bx}" y2="${sy(0)}" stroke="${C.wall2}" stroke-width="1" opacity="0.7"/>`;
    }
    // roof band with eaves projecting past the wall + fascia
    s += `<polygon points="${sx(-oh)},${sy(H)} ${sx(-oh)},${sy(top)} ${sx(D + oh)},${sy(top)} ${sx(D + oh)},${sy(H)}" fill="${C.roof}" stroke="${C.line}" stroke-width="2"/>`;
    // ridge line
    s += `<line x1="${sx(-oh)}" y1="${sy(top)}" x2="${sx(D + oh)}" y2="${sy(top)}" stroke="${C.line}" stroke-width="1.5" opacity="0.8"/>`;
    // eave / fascia line
    s += `<line x1="${sx(-oh)}" y1="${sy(H)}" x2="${sx(D + oh)}" y2="${sy(H)}" stroke="${C.line}" stroke-width="2"/>`;
    // rafter tails under the eaves
    const n = raftersPerSide();
    for (let i = 0; i < n; i++) {
      const fx = sx((D / (n - 1 || 1)) * i);
      s += `<line x1="${fx}" y1="${sy(H)}" x2="${fx}" y2="${sy(H) - 5}" stroke="${C.line}" stroke-width="1" opacity="0.45"/>`;
    }
    // openings on the left side wall (each its own size), laid out along the depth
    s += drawElevationOpenings("left", D, H, sx, sy);
    s += dimLineH(sx(0), sx(D), yBase + 16, fmtLen(D), scale);
    s += dimLineV(sx(-oh) - 14, sy(0), sy(top), fmtLen(top));
    s += `<text x="${sx(D / 2)}" y="${sy(top) + 13}" fill="#04121c" font-size="9" text-anchor="middle">ridge · ${n} rafters @ ${state.spacing}" O.C.</text>`;
    return svgWrap(s, vw, vh);
  }

  function topView(g) {
    const vw = 320, vh = 240, pad = 36;
    const maxW = state.width, maxD = state.depth;
    const scale = Math.min((vw - pad * 2) / maxW, (vh - pad * 2) / maxD);
    const x0 = (vw - maxW * scale) / 2;
    const y0 = (vh - maxD * scale) / 2;
    const sx = (ft) => x0 + ft * scale;
    const sy = (ft) => y0 + ft * scale; // depth increases downward
    const W = state.width, D = state.depth;
    let s = "";
    s += `<rect x="${sx(0)}" y="${sy(0)}" width="${W * scale}" height="${D * scale}" fill="${C.wall}" stroke="${C.line}" stroke-width="2"/>`;
    // floor joists run across the width, spaced along depth
    const nj = Math.floor((D * 12) / state.spacing) + 1;
    for (let i = 0; i < nj; i++) {
      const fy = sy((D / (nj - 1 || 1)) * i);
      s += `<line x1="${sx(0)}" y1="${fy}" x2="${sx(W)}" y2="${fy}" stroke="${C.stud}" stroke-width="1" opacity="0.7"/>`;
    }
    // skids run front-to-back, spaced across width (dashed)
    const nsk = Math.max(2, Math.floor((W * 12) / 24) + 1);
    for (let i = 0; i < nsk; i++) {
      const fx = sx((W / (nsk - 1 || 1)) * i);
      s += `<line x1="${fx}" y1="${sy(0)}" x2="${fx}" y2="${sy(D)}" stroke="${C.line}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.55"/>`;
    }
    s += `<rect x="${sx(0)}" y="${sy(0)}" width="${W * scale}" height="${D * scale}" fill="none" stroke="${C.line}" stroke-width="2.5"/>`;
    // dashed roof-overhang (eaves) outline around the walls
    const oh = state.overhang / 12;
    s += `<rect x="${sx(-oh)}" y="${sy(-oh)}" width="${(W + 2 * oh) * scale}" height="${(D + 2 * oh) * scale}" fill="none" stroke="${C.roof}" stroke-width="1.3" stroke-dasharray="5 4" opacity="0.8"/>`;
    // all openings on their walls (doors with swing/slide/roll-up marks, windows as edge rects)
    s += drawPlanOpenings(sx, sy, W, D, scale);
    s += dimLineH(sx(0), sx(W), sy(0) - 14, fmtLen(W), scale);
    s += dimLineV(sx(0) - 14, sy(0), sy(D), fmtLen(D));
    s += `<text x="${sx(W / 2)}" y="${sy(D / 2)}" fill="${C.line}" font-size="10" text-anchor="middle" opacity="0.7">${nj} joists @ ${state.spacing}" O.C.</text>`;
    return svgWrap(s, vw, vh);
  }

  // Front-wall profile (X,Z) used by the 3D view, varies by roof type.
  function frontProfile(g) {
    const W = state.width, H = state.wallHeight, peak = g.peakHeight;
    if (state.roofType === "gable") return [{ x: 0, z: 0 }, { x: 0, z: H }, { x: W / 2, z: peak }, { x: W, z: H }, { x: W, z: 0 }];
    if (state.roofType === "lean-to") return [{ x: 0, z: 0 }, { x: 0, z: peak }, { x: W, z: H }, { x: W, z: 0 }];
    if (state.roofType === "saltbox") return [{ x: 0, z: 0 }, { x: 0, z: H }, { x: W * 0.4, z: peak }, { x: W, z: H }, { x: W, z: 0 }];
    if (state.roofType === "gambrel") {
      const R = W / 2, knee = g.kneeHeight, kx1 = W / 2 - R * Math.cos(Math.PI / 4), kx2 = W / 2 + R * Math.cos(Math.PI / 4);
      return [{ x: 0, z: 0 }, { x: 0, z: H }, { x: kx1, z: knee }, { x: W / 2, z: peak }, { x: kx2, z: knee }, { x: W, z: H }, { x: W, z: 0 }];
    }
    return [{ x: 0, z: 0 }, { x: 0, z: H }, { x: W, z: peak }, { x: W, z: 0 }]; // flat (slight slope)
  }

  function threeDView(g) {
    const vw = 320, vh = 240, pad = 30;
    const W = state.width, D = state.depth, H = state.wallHeight;
    const prof = frontProfile(g);
    const cx = W / 2, cy = D / 2;
    const cosY = Math.cos(state.camYaw), sinY = Math.sin(state.camYaw);
    const cosP = Math.cos(state.camPitch), sinP = Math.sin(state.camPitch);
    // orbit camera: yaw about the vertical axis, pitch = elevation
    const proj = (X, Y, Z) => {
      const x = X - cx, y = Y - cy, z = Z;
      const Xr = x * cosY - y * sinY;
      const Yr = x * sinY + y * cosY;
      return { x: Xr, y: Yr * sinP - z * cosP, depth: Yr * cosP + z * sinP };
    };
    const corners = [];
    prof.forEach((p) => { corners.push(proj(p.x, 0, p.z)); corners.push(proj(p.x, D, p.z)); });
    const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
    const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
    const scale = Math.min((vw - pad * 2) / (maxX - minX || 1), (vh - pad * 2) / (maxY - minY || 1));
    const ox = pad - minX * scale, oy = pad - minY * scale;
    const S = (v) => { const q = proj(v[0], v[1], v[2]); return `${(ox + q.x * scale).toFixed(1)},${(oy + q.y * scale).toFixed(1)}`; };
    const poly = (verts, fill) => `<polygon points="${verts.map(S).join(" ")}" fill="${fill}" stroke="${C.line}" stroke-width="1.4" stroke-linejoin="round"/>`;
    const faces = [];
    const addFace = (verts, fill) => {
      const c = verts.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]).map((n) => n / verts.length);
      faces.push({ verts, fill, key: proj(c[0], c[1], c[2]).depth }); // larger depth = farther
    };
    addFace(prof.map((p) => [p.x, 0, p.z]), C.wall); // front gable cap
    addFace(prof.map((p) => [p.x, D, p.z]), C.wall2); // back cap
    for (let i = 0; i < prof.length; i++) {
      const p0 = prof[i], p1 = prof[(i + 1) % prof.length];
      if (p0.z === 0 && p1.z === 0) continue; // skip floor
      const vertical = Math.abs(p0.x - p1.x) < 1e-6;
      const fill = vertical ? C.wall2 : (p0.x + p1.x) / 2 > W / 2 ? "#3d87b4" : C.roof;
      addFace([[p0.x, 0, p0.z], [p1.x, 0, p1.z], [p1.x, D, p1.z], [p0.x, D, p0.z]], fill);
    }
    faces.sort((a, b) => b.key - a.key); // draw far faces first
    let s = faces.map((f) => poly(f.verts, f.fill)).join("");
    // front-wall openings, only when the front face points toward the camera
    if (cosY > 0.02) {
      layoutWall(W, wallOpenings("front")).forEach((op) => {
        const dh = op.kind === "door" ? Math.min(op.h, H * 0.95) : Math.min(op.h, H * 0.6);
        const z0 = op.kind === "door" ? 0 : H * 0.5 - dh / 2;
        const fill = op.kind === "door" ? C.door : "#bcd6e8";
        s += poly([[op.left, 0, z0], [op.left + op.w, 0, z0], [op.left + op.w, 0, z0 + dh], [op.left, 0, z0 + dh]], fill);
      });
    }
    s += `<text x="${vw / 2}" y="${vh - 6}" fill="${C.dim}" font-size="9" text-anchor="middle">drag to rotate · ${fmtLen(W)} × ${fmtLen(D)} × peak ${fmtLen(g.peakHeight)}</text>`;
    return svgWrap(s, vw, vh);
  }

  function dimLineH(x1, x2, y, label, scale) {
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.dim}" stroke-width="1"/>` +
      `<line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}" stroke="${C.dim}" stroke-width="1"/>` +
      `<line x1="${x2}" y1="${y - 4}" x2="${x2}" y2="${y + 4}" stroke="${C.dim}" stroke-width="1"/>` +
      `<text x="${(x1 + x2) / 2}" y="${y + 13}" fill="${C.dim}" font-size="10" text-anchor="middle">${label}</text>`;
  }
  function dimLineV(x, y1, y2, label) {
    return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C.dim}" stroke-width="1"/>` +
      `<line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="${C.dim}" stroke-width="1"/>` +
      `<line x1="${x - 4}" y1="${y2}" x2="${x + 4}" y2="${y2}" stroke="${C.dim}" stroke-width="1"/>` +
      `<text x="${x - 6}" y="${(y1 + y2) / 2}" fill="${C.dim}" font-size="10" text-anchor="middle" transform="rotate(-90 ${x - 6} ${(y1 + y2) / 2})">${label}</text>`;
  }

  /* ---------- Render lists ---------- */
  function renderShopping() {
    const { groups, g, perim, roofArea } = materials();
    const totalBoards = groups.reduce((a, gr) => a + gr.items.length, 0);
    const region = zipMultiplier(state.zip);
    const est = estimate(g, perim, roofArea);
    const regionSub = /^\d{5}$/.test(state.zip) ? `ZIP ${state.zip} · ${region.label}` : "US average — add ZIP/address for local pricing";
    groups.unshift({
      title: "Cost estimate (materials only)",
      items: est.map((r) => ({ label: r.store, sub: regionSub, qty: "$" + r.total.toLocaleString() })),
    });
    const cheapest = Math.min(...est.map((r) => r.total));
    $("#shopSummary").innerHTML =
      chip(fmtLen(state.width) + "×" + fmtLen(state.depth), "footprint") +
      chip(Math.ceil(roofArea) + (state.units === "metric" ? "" : " ft²"), "roof area") +
      chip("$" + cheapest.toLocaleString(), "est. from");
    const zipNote = $("#zipNote");
    if (zipNote) zipNote.textContent = regionSub;
    $("#shoppingList").innerHTML = groups.map(groupHtml).join("");
  }

  function renderCuts() {
    const { groups, g } = cutSheet();
    const total = g.rafters.reduce((a, r) => a + r.qty, 0);
    $("#cutSummary").innerHTML =
      chip(total, "rafters") +
      chip(fmtAng(g.thetaDeg), "main angle") +
      chip(fmtLen(g.peakHeight), "peak height");
    $("#cutSheet").innerHTML = groups
      .map((gr) => {
        const rows = gr.rows
          .map((r) => {
            const ang = (r.angles || []).map((a) => `<span class="angle">${a.k}: ${a.v}</span>`).join(" ");
            return `<div class="row"><div class="label">${r.label}${r.sub ? `<small>${r.sub}</small>` : ""}</div>` +
              `<div style="text-align:right">${r.qty ? `<div class="qty">${r.qty}</div>` : ""}${ang}</div></div>`;
          })
          .join("");
        return `<div class="group"><h3>${gr.title}</h3>${rows}</div>`;
      })
      .join("");
  }

  const chip = (b, s) => `<div class="chip"><b>${b}</b><span>${s}</span></div>`;
  function groupHtml(gr) {
    const rows = gr.items
      .map(
        (it) =>
          `<div class="row"><div class="label">${it.label}${it.sub ? `<small>${it.sub}</small>` : ""}</div><div class="qty">${it.qty}</div></div>`
      )
      .join("");
    return `<div class="group"><h3>${gr.title}<span class="count">${gr.items.length} item${gr.items.length === 1 ? "" : "s"}</span></h3>${rows}</div>`;
  }

  /* ---------- Build steps ---------- */
  function buildSteps() {
    const g = geometry();
    const W = state.width, D = state.depth, H = state.wallHeight;
    const rafterTxt = g.rafters
      .map((r) => `${r.qty} × ${r.name.toLowerCase()} @ ${fmtLen(r.length)} (plumb ${fmtAng(r.plumb)}, seat ${fmtAng(r.seat)})`)
      .join("; ");
    const steps = [];

    steps.push({
      tag: "Foundation",
      title: "Prepare a level base",
      body: `Clear and level a ${fmtLen(W)} × ${fmtLen(D)} area. Set the pressure-treated 4×4 skids on gravel or concrete blocks, spaced evenly across the width and checked level in both directions.`,
    });
    steps.push({
      tag: "Floor",
      title: "Build the floor frame",
      body: `Build a ${fmtLen(W)} × ${fmtLen(D)} box from 2×6 rim joists, then fill in floor joists ${state.spacing}" on center. Square the frame (equal diagonals) and fasten to the skids.`,
    });
    steps.push({
      tag: "Floor",
      title: "Deck the floor",
      body: `Fasten ¾" plywood over the joists with the sheets running perpendicular to the joists. Stagger the seams and leave a small gap between sheets.`,
    });
    steps.push({
      tag: "Walls",
      title: "Frame the four walls",
      body: `Build each wall flat on the deck: bottom plate + top plate with ${state.lumber} studs ${state.spacing}" O.C. Frame ${state.doors.length} door opening(s)${state.windows.length > 0 ? ` and ${state.windows.length} window opening(s)` : ""} with king + jack studs and headers on the correct walls.`,
    });
    steps.push({
      tag: "Walls",
      title: "Raise, plumb & brace the walls",
      body: `Stand each wall, nail the bottom plate to the floor, plumb with a level and brace temporarily. Tie the corners together and add the second (doubled) top plate, overlapping at the corners.`,
    });

    if (state.roofType === "gable" || state.roofType === "saltbox") {
      steps.push({
        tag: "Roof",
        title: "Set the ridge & cut rafters",
        body: `Cut the rafters: ${rafterTxt}. Set the ridge board at ${fmtLen(g.peakHeight - H)} above the top plate, then install opposing rafters in pairs, seating each birdsmouth on the top plate.`,
      });
      steps.push({
        tag: "Roof",
        title: "Tie the rafters",
        body: `Add collar ties across each rafter pair in the upper third to keep the walls from spreading.`,
      });
    } else if (state.roofType === "lean-to") {
      steps.push({
        tag: "Roof",
        title: "Install the sloped rafters",
        body: `Cut the rafters: ${rafterTxt}. The back wall is taller than the front by ${fmtLen(g.peakHeight - H)}; set rafters ${state.spacing}" O.C. with a birdsmouth over each wall.`,
      });
    } else if (state.roofType === "gambrel") {
      steps.push({
        tag: "Roof",
        title: "Assemble the gambrel trusses",
        body: `Build each barn truss on the ground from 4 rafters joined with plywood gussets: ${rafterTxt}. Lower slope 67.5°, upper slope 22.5°. Raise and set them ${state.spacing}" O.C.`,
      });
    } else {
      steps.push({
        tag: "Roof",
        title: "Install the roof joists",
        body: `Set the flat-roof joists ${state.spacing}" O.C. across the walls. Build in a slight slope toward the back/low side for drainage.`,
      });
    }

    steps.push({
      tag: "Roof",
      title: "Sheathe the roof",
      body: `Cover the rafters with 7⁄16" OSB, seams staggered, then add drip edge and underlayment (felt).`,
    });
    steps.push({
      tag: "Shell",
      title: "Sheathe & wrap the walls",
      body: `Sheathe the walls with OSB, then staple house wrap over it, overlapping shingle-style from the bottom up.`,
    });
    steps.push({
      tag: "Finish",
      title: "Roofing",
      body: `Install ${roofCover().label.toLowerCase()} from the eave up, following the manufacturer's overlap and fastener pattern.`,
    });
    steps.push({
      tag: "Finish",
      title: "Doors, windows & trim",
      body: `Install the openings: ${state.doors.map((d) => `${DOOR_LABELS[d.type]} door ${fmtLen(d.w)}×${fmtLen(d.h)} (${d.wall})`).join(", ") || "no doors"}${state.windows.length > 0 ? `; windows ${state.windows.map((w) => `${fmtLen(w.w)}×${fmtLen(w.h)} (${w.wall})`).join(", ")}` : ""}. Flash and caulk each opening, then add corner and trim boards and fascia.`,
    });
    steps.push({
      tag: "Finish",
      title: "Paint & final checks",
      body: `Prime and paint or stain all exterior wood. Confirm the door swings freely, add any ramp or shelving, and you're done.`,
    });

    return steps;
  }

  function renderSteps() {
    const steps = buildSteps();
    const roofStep = steps.filter((s) => s.tag === "Roof").length;
    const withPhotos = steps.filter((s) => state.photos[s.title]).length;
    $("#stepsSummary").innerHTML =
      chip(steps.length, "steps") +
      chip(withPhotos, "photos") +
      chip({ gable: "Gable", "lean-to": "Lean-to", saltbox: "Saltbox", gambrel: "Gambrel", flat: "Flat" }[state.roofType], "roof");
    $("#buildSteps").innerHTML = steps
      .map((s, i) => {
        const key = encodeURIComponent(s.title);
        const photo = state.photos[s.title];
        const photoHtml = photo
          ? `<div class="step-photo"><img src="${photo}" alt="Photo for ${escapeHtml(s.title)}"><button type="button" class="step-photo-del" data-key="${key}" aria-label="Remove photo">✕</button></div>`
          : `<label class="step-photo-add"><input type="file" accept="image/*" data-key="${key}" hidden>📷 Add photo</label>`;
        return `<li class="step"><span class="step-num">${i + 1}</span><div class="step-body"><div class="step-head"><b>${s.title}</b><span class="step-tag">${s.tag}</span></div><p>${s.body}</p>${photoHtml}</div></li>`;
      })
      .join("");
  }

  function resizeImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  }
  async function onStepPhoto(e) {
    const inp = e.target.closest('input[type="file"]');
    if (!inp || !inp.files || !inp.files[0]) return;
    try {
      const dataUrl = await resizeImage(inp.files[0], 1000, 0.7);
      state.photos[decodeURIComponent(inp.dataset.key)] = dataUrl;
      renderSteps();
      saveCurrent();
    } catch {
      toast("Could not read that image");
    }
  }
  function onStepPhotoDelete(e) {
    const btn = e.target.closest(".step-photo-del");
    if (!btn) return;
    delete state.photos[decodeURIComponent(btn.dataset.key)];
    renderSteps();
    saveCurrent();
  }

  /* ---------- Sync form <-> state ---------- */
  function renderAll() {
    renderPreview();
    renderShopping();
    renderCuts();
    renderSteps();
  }

  function formToState() {
    state.roofType = $("#roofType").value;
    state.roofCovering = $("#roofCovering").value;
    state.pitch = parseFloat($("#pitch").value);
    state.overhang = toInches(parseFloat($("#overhang").value) || 0);
    state.width = toFt(parseFloat($("#width").value) || 0);
    state.depth = toFt(parseFloat($("#depth").value) || 0);
    state.wallHeight = toFt(parseFloat($("#wallHeight").value) || 0);
    state.spacing = parseInt($("#spacing").value, 10);
    state.lumber = $("#lumber").value;
    readOpenings();
    $("#pitchOut").textContent = `${state.pitch} / 12`;
    togglePitchField();
    renderAll();
  }

  const OPENING_DEFAULT_DOOR = { type: "single", wall: "front", pos: "center", w: 3, h: 6.5 };
  const OPENING_DEFAULT_WIN = { wall: "left", pos: "center", w: 2, h: 2 };

  function normalizeOpenings() {
    if (!Array.isArray(state.doors)) state.doors = [{ ...OPENING_DEFAULT_DOOR }];
    if (!Array.isArray(state.windows) || state.windows.some((w) => typeof w !== "object" || w === null)) {
      state.windows = [{ ...OPENING_DEFAULT_WIN }];
    }
    // migrate bare {w,h} windows (older saves) to full objects
    state.windows = state.windows.map((w) => ({ wall: w.wall || "left", pos: w.pos || "center", w: w.w ?? 2, h: w.h ?? 2 }));
    if (!state.photos || typeof state.photos !== "object") state.photos = {};
    if (typeof state.address !== "string") state.address = "";
    if (typeof state.zip !== "string") state.zip = "";
    if (typeof state.camYaw !== "number") state.camYaw = -0.6;
    if (typeof state.camPitch !== "number") state.camPitch = 0.5;
    if (typeof state.roofCovering !== "string") state.roofCovering = "asphalt";
  }

  function readOpenings() {
    state.doors = $$("#doorList .op-card").map((card) => ({
      type: card.querySelector('[data-f="type"]').value,
      wall: card.querySelector('[data-f="wall"]').value,
      pos: card.querySelector('[data-f="pos"]').value,
      w: toFt(parseFloat(card.querySelector('[data-f="w"]').value) || 0),
      h: toFt(parseFloat(card.querySelector('[data-f="h"]').value) || 0),
    }));
    state.windows = $$("#windowList .op-card").map((card) => ({
      wall: card.querySelector('[data-f="wall"]').value,
      pos: card.querySelector('[data-f="pos"]').value,
      w: toFt(parseFloat(card.querySelector('[data-f="w"]').value) || 0),
      h: toFt(parseFloat(card.querySelector('[data-f="h"]').value) || 0),
    }));
  }

  const WALL_OPTS = [["front", "Front"], ["back", "Back"], ["left", "Left"], ["right", "Right"]];
  const POS_OPTS = [["left", "Left"], ["center", "Center"], ["right", "Right"]];
  const DOOR_TYPE_OPTS = [["single", "Single swing"], ["double", "Double doors"], ["barn", "Barn / sliding"], ["overhead", "Overhead / roll-up"]];
  const opt = (opts, val) => opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("");

  function renderOpenings() {
    const u = state.units === "metric" ? "m" : "ft";
    const sizeInputs = (o) =>
      `<label class="op-f"><span>W (${u})</span><input class="op-in" data-f="w" type="number" value="${round(dispLen(o.w), 2)}" min="0.5" step="0.5" inputmode="decimal"></label>` +
      `<label class="op-f"><span>H (${u})</span><input class="op-in" data-f="h" type="number" value="${round(dispLen(o.h), 2)}" min="0.5" step="0.5" inputmode="decimal"></label>`;
    const dl = $("#doorList");
    if (dl) {
      dl.innerHTML = state.doors
        .map(
          (d, i) =>
            `<div class="op-card" data-kind="door" data-i="${i}"><div class="op-head"><b>Door ${i + 1}</b><button type="button" class="op-del" data-kind="door" data-i="${i}" aria-label="Remove door">✕</button></div>` +
            `<div class="op-grid"><label class="op-f op-wide"><span>Type</span><select class="op-in" data-f="type">${opt(DOOR_TYPE_OPTS, d.type)}</select></label>` +
            `<label class="op-f"><span>Wall</span><select class="op-in" data-f="wall">${opt(WALL_OPTS, d.wall)}</select></label>` +
            `<label class="op-f"><span>Position</span><select class="op-in" data-f="pos">${opt(POS_OPTS, d.pos)}</select></label>` +
            `${sizeInputs(d)}</div></div>`
        )
        .join("") || `<p class="win-empty">No doors. Tap “Add door”.</p>`;
    }
    const wl = $("#windowList");
    if (wl) {
      wl.innerHTML = state.windows
        .map(
          (w, i) =>
            `<div class="op-card" data-kind="window" data-i="${i}"><div class="op-head"><b>Window ${i + 1}</b><button type="button" class="op-del" data-kind="window" data-i="${i}" aria-label="Remove window">✕</button></div>` +
            `<div class="op-grid"><label class="op-f"><span>Wall</span><select class="op-in" data-f="wall">${opt(WALL_OPTS, w.wall)}</select></label>` +
            `<label class="op-f"><span>Position</span><select class="op-in" data-f="pos">${opt(POS_OPTS, w.pos)}</select></label>` +
            `${sizeInputs(w)}</div></div>`
        )
        .join("") || `<p class="win-empty">No windows. Tap “Add window”.</p>`;
    }
  }

  function stateToForm() {
    normalizeOpenings();
    $("#roofType").value = state.roofType;
    if ($("#roofCovering")) $("#roofCovering").value = state.roofCovering || "asphalt";
    $("#pitch").value = state.pitch;
    $("#pitchOut").textContent = `${state.pitch} / 12`;
    $("#overhang").value = round(dispSmall(state.overhang), state.units === "metric" ? 1 : 0);
    $("#width").value = round(dispLen(state.width), 2);
    $("#depth").value = round(dispLen(state.depth), 2);
    $("#wallHeight").value = round(dispLen(state.wallHeight), 2);
    $("#spacing").value = state.spacing;
    $("#lumber").value = state.lumber;
    if ($("#addrInput")) $("#addrInput").value = state.address || "";
    if ($("#zipInput")) $("#zipInput").value = state.zip || "";
    renderOpenings();
    renderMap();
    togglePitchField();
  }

  function togglePitchField() {
    const hide = state.roofType === "flat" || state.roofType === "gambrel";
    $("#pitchField").style.display = hide ? "none" : "";
  }

  function setUnitLabels() {
    $$(".u-len").forEach((e) => (e.textContent = state.units === "metric" ? "m" : "ft"));
    $$(".u-small").forEach((e) => (e.textContent = state.units === "metric" ? "cm" : "in"));
  }

  function applyUnit(unit) {
    state.units = unit;
    $$(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === unit));
    setUnitLabels();
    stateToForm();
    renderAll();
  }

  /* ---------- Tabs & views ---------- */
  function initTabs() {
    $$(".tab").forEach((t) =>
      t.addEventListener("click", () => {
        $$(".tab").forEach((x) => x.classList.remove("active"));
        $$(".tab-panel").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        $("#tab-" + t.dataset.tab).classList.add("active");
      })
    );
    $$(".view-btn").forEach((v) =>
      v.addEventListener("click", () => {
        $$(".view-btn").forEach((x) => x.classList.remove("active"));
        v.classList.add("active");
        state.view = v.dataset.view;
        renderPreview();
      })
    );
    $$(".unit-btn").forEach((b) => b.addEventListener("click", () => applyUnit(b.dataset.unit)));
  }

  /* ---------- Saved designs ---------- */
  function loadDesigns() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function persistDesigns(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      toast("Storage full — try fewer/smaller photos");
      return false;
    }
  }
  function saveCurrent() {
    const list = loadDesigns();
    if (!state.name) state.name = defaultName();
    const snapshot = { ...state, view: undefined };
    const now = new Date().toISOString();
    if (state.id) {
      const i = list.findIndex((d) => d.id === state.id);
      if (i >= 0) {
        list[i] = { id: state.id, name: state.name, savedAt: now, state: snapshot };
      } else {
        list.unshift({ id: state.id, name: state.name, savedAt: now, state: snapshot });
      }
    } else {
      state.id = "d" + Date.now();
      list.unshift({ id: state.id, name: state.name, savedAt: now, state: snapshot });
    }
    if (persistDesigns(list)) toast("Saved “" + state.name + "”");
  }
  function defaultName() {
    const names = { gable: "Gable", "lean-to": "Lean-to", saltbox: "Saltbox", gambrel: "Gambrel", flat: "Flat" };
    return `${names[state.roofType]} ${fmtLen(state.width)}×${fmtLen(state.depth)}`;
  }
  function openDesigns() {
    renderDesignsList();
    openOverlay("#designs");
  }
  function renderDesignsList() {
    const list = loadDesigns();
    const el = $("#designsList");
    if (!list.length) {
      el.innerHTML = `<p class="designs-empty">No saved designs yet.<br>Tap “New design” to start the wizard.</p>`;
      return;
    }
    el.innerHTML = list
      .map((d) => {
        const date = new Date(d.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return `<div class="design-item" data-id="${d.id}">
          <div class="meta"><b>${escapeHtml(d.name)}</b><small>${date}</small></div>
          <button class="load" data-act="load">Open</button>
          <button class="del" data-act="del">🗑</button>
        </div>`;
      })
      .join("");
    el.querySelectorAll(".design-item").forEach((item) => {
      const id = item.dataset.id;
      item.querySelector('[data-act="load"]').addEventListener("click", () => loadDesign(id));
      item.querySelector('[data-act="del"]').addEventListener("click", () => deleteDesign(id));
    });
  }
  function loadDesign(id) {
    const d = loadDesigns().find((x) => x.id === id);
    if (!d) return;
    Object.assign(state, d.state, { id: d.id, name: d.name, view: "front" });
    $$(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === state.units));
    setUnitLabels();
    stateToForm();
    renderAll();
    closeOverlay("#designs");
    toast("Opened “" + d.name + "”");
  }
  function deleteDesign(id) {
    const list = loadDesigns().filter((x) => x.id !== id);
    persistDesigns(list);
    if (state.id === id) state.id = null;
    renderDesignsList();
  }
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Overlays ---------- */
  function openOverlay(sel) {
    const o = $(sel);
    o.classList.add("open");
    o.setAttribute("aria-hidden", "false");
  }
  function closeOverlay(sel) {
    const o = $(sel);
    o.classList.remove("open");
    o.setAttribute("aria-hidden", "true");
  }

  /* ---------- Wizard ---------- */
  const wiz = { step: 0, max: 4, draft: {} };
  function startWizard(fresh) {
    if (fresh) {
      Object.assign(state, {
        id: null, name: "", purpose: "storage", roofType: "gable", pitch: 4, overhang: 12,
        width: 8, depth: 10, wallHeight: 7, spacing: 16, lumber: "2x4",
        doors: [{ type: "single", wall: "front", pos: "center", w: 3, h: 6.5 }],
        windows: [{ wall: "left", pos: "center", w: 2, h: 2 }],
        photos: {},
      });
    }
    wiz.step = 0;
    wiz.draft = {
      units: state.units, purpose: state.purpose, roofType: state.roofType,
      spacing: String(state.spacing), lumber: state.lumber, pitch: state.pitch,
    };
    $("#wizName").value = state.name || "";
    // seed size inputs in current display unit
    $("#wizWidth").value = round(dispLen(state.width), 2);
    $("#wizDepth").value = round(dispLen(state.depth), 2);
    $("#wizWallHeight").value = round(dispLen(state.wallHeight), 2);
    $("#wizPitch").value = state.pitch;
    $("#wizPitchOut").textContent = `${state.pitch} / 12`;
    syncWizardChoices();
    showWizStep(0);
    openOverlay("#wizard");
  }

  function syncWizardChoices() {
    setChoice("units", wiz.draft.units);
    setChoice("purpose", wiz.draft.purpose);
    setChoice("roofType", wiz.draft.roofType);
    setChoice("spacing", wiz.draft.spacing);
    setChoice("lumber", wiz.draft.lumber);
  }
  function setChoice(group, value) {
    $$(`[data-choice="${group}"] .choice, [data-choice="${group}"] .roof-card`).forEach((b) =>
      b.classList.toggle("active", b.dataset.value === String(value))
    );
  }

  function showWizStep(n) {
    wiz.step = n;
    $$(".wiz-step").forEach((s) => s.classList.toggle("active", +s.dataset.step === n));
    $("#wizBar").style.width = ((n + 1) / wiz.max) * 100 + "%";
    $("#wizBack").style.visibility = n === 0 ? "hidden" : "visible";
    $("#wizNext").textContent = n === wiz.max - 1 ? "Finish ✓" : "Next";
    $("#wizDots").innerHTML = Array.from({ length: wiz.max }, (_, i) => `<i class="${i === n ? "on" : ""}"></i>`).join("");
    // unit labels inside wizard size step
    setUnitLabels();
  }

  function wizReadUnit() {
    // units may change mid-wizard; convert size inputs live isn't needed since we read at finish
    return wiz.draft.units;
  }

  function finishWizard() {
    try {
      const u = wiz.draft.units;
      const toFtU = (v) => (u === "metric" ? v * FT_PER_M : v);
      state.units = u;
      state.name = $("#wizName").value.trim();
      state.purpose = wiz.draft.purpose;
      state.roofType = wiz.draft.roofType;
      state.spacing = parseInt(wiz.draft.spacing, 10);
      state.lumber = wiz.draft.lumber;
      state.pitch = parseFloat($("#wizPitch").value);
      state.width = toFtU(parseFloat($("#wizWidth").value) || 8);
      state.depth = toFtU(parseFloat($("#wizDepth").value) || 10);
      state.wallHeight = toFtU(parseFloat($("#wizWallHeight").value) || 7);
      if (!state.name) state.name = defaultName();
      state.id = null; // new design
      $$(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === state.units));
      setUnitLabels();
      stateToForm();
      renderAll();
      saveCurrent();
    } catch (err) {
      console.error("Wizard finish error:", err);
    } finally {
      // Always leave the wizard, even if a render/save step hiccuped.
      localStorage.setItem(SEEN_KEY, "1");
      closeOverlay("#wizard");
    }
  }

  function initWizard() {
    $("#wizPitch").addEventListener("input", (e) => ($("#wizPitchOut").textContent = `${e.target.value} / 12`));
    // choice buttons
    $$("[data-choice]").forEach((grp) => {
      const key = grp.dataset.choice;
      grp.querySelectorAll(".choice, .roof-card").forEach((btn) =>
        btn.addEventListener("click", () => {
          wiz.draft[key] = btn.dataset.value;
          setChoice(key, btn.dataset.value);
          if (key === "units") setUnitLabels2(btn.dataset.value);
        })
      );
    });
    $("#wizBack").addEventListener("click", () => showWizStep(Math.max(0, wiz.step - 1)));
    $("#wizNext").addEventListener("click", () => {
      if (wiz.step === wiz.max - 1) finishWizard();
      else showWizStep(Math.min(wiz.max - 1, wiz.step + 1));
    });
  }
  // temporary unit label switch while in wizard (before commit)
  function setUnitLabels2(unit) {
    $$(".u-len").forEach((e) => (e.textContent = unit === "metric" ? "m" : "ft"));
    $$(".u-small").forEach((e) => (e.textContent = unit === "metric" ? "cm" : "in"));
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    let t = $(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = $("#themeBtn");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#1b2a3a");
    localStorage.setItem(THEME_KEY, theme);
    if ($("#preview") && $("#preview").childElementCount) renderPreview();
  }
  function initTheme() {
    let theme = localStorage.getItem(THEME_KEY);
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    applyTheme(theme);
    $("#themeBtn").addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
    });
  }

  /* ---------- 3D orbit drag ---------- */
  function initOrbit() {
    const stage = $("#preview");
    if (!stage) return;
    let dragging = false, lastX = 0, lastY = 0;
    const down = (e) => {
      if (state.view !== "3d") return;
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      lastX = p.clientX; lastY = p.clientY;
      stage.classList.add("grabbing");
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      state.camYaw += (p.clientX - lastX) * 0.01;
      state.camPitch = Math.max(0.1, Math.min(1.45, state.camPitch - (p.clientY - lastY) * 0.01));
      lastX = p.clientX; lastY = p.clientY;
      renderPreview();
      e.preventDefault();
    };
    const up = () => { dragging = false; stage.classList.remove("grabbing"); };
    stage.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    stage.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  }

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    initTabs();
    initWizard();
    $("#shed-form").addEventListener("input", formToState);
    $("#shed-form").addEventListener("change", formToState);
    $("#addDoor").addEventListener("click", () => {
      state.doors.push({ ...OPENING_DEFAULT_DOOR });
      renderOpenings();
      renderAll();
    });
    $("#addWindow").addEventListener("click", () => {
      state.windows.push({ ...OPENING_DEFAULT_WIN });
      renderOpenings();
      renderAll();
    });
    const onDelete = (e) => {
      const btn = e.target.closest(".op-del");
      if (!btn) return;
      const i = +btn.dataset.i;
      (btn.dataset.kind === "door" ? state.doors : state.windows).splice(i, 1);
      renderOpenings();
      renderAll();
    };
    $("#doorList").addEventListener("click", onDelete);
    $("#windowList").addEventListener("click", onDelete);
    $("#buildSteps").addEventListener("change", onStepPhoto);
    $("#buildSteps").addEventListener("click", onStepPhotoDelete);
    const findBtn = $("#findAddr");
    if (findBtn) findBtn.addEventListener("click", geocode);
    const addrInput = $("#addrInput");
    if (addrInput) {
      addrInput.addEventListener("change", (e) => { state.address = e.target.value; });
      addrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); geocode(); } });
    }
    const zipInput = $("#zipInput");
    if (zipInput) zipInput.addEventListener("input", (e) => {
      state.zip = (e.target.value || "").replace(/\D/g, "").slice(0, 5);
      e.target.value = state.zip;
      renderShopping();
    });
    initOrbit();
    const vEl = $("#appVersion");
    if (vEl) vEl.textContent = "v" + APP_VERSION;
    $("#printBtn").addEventListener("click", () => window.print());
    $("#saveBtn").addEventListener("click", saveCurrent);
    $("#designsBtn").addEventListener("click", openDesigns);
    $("#designsClose").addEventListener("click", () => closeOverlay("#designs"));
    $("#newDesignBtn").addEventListener("click", () => {
      closeOverlay("#designs");
      startWizard(true);
    });
    $$(".overlay").forEach((o) =>
      o.addEventListener("click", (e) => {
        if (e.target === o) closeOverlay("#" + o.id);
      })
    );

    stateToForm();
    setUnitLabels();
    renderAll();

    if (!localStorage.getItem(SEEN_KEY)) {
      startWizard(true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
