/* Shed Planner — client-side app (no dependencies, GitHub Pages friendly) */
(function () {
  "use strict";

  const FT_PER_M = 3.280839895;
  const IN_PER_M = 39.3700787;
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
    pitch: 4,
    overhang: 12, // inches
    width: 8, // ft
    depth: 10, // ft
    wallHeight: 7, // ft
    spacing: 16, // inches O.C.
    lumber: "2x4",
    doorWidth: 3, // ft
    doorHeight: 6.5, // ft
    doorPos: "center",
    doorType: "single",
    doorCount: 1,
    windows: 1,
    winWidth: 2, // ft (legacy default, migrated into windowList)
    winHeight: 2, // ft
    windowList: [{ w: 2, h: 2 }],
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
    const winCount = state.windowList.length;
    const studs =
      studsForWall(W) * 2 + studsForWall(D) * 2 +
      3 /*extra corner studs*/ +
      state.doorCount * 4 /*door framing*/ +
      winCount * 6;
    groups.push({
      title: "Walls",
      items: [
        { label: `Bottom plate — PT ${state.lumber}`, sub: `wall perimeter`, qty: fmtTotal(perim) },
        { label: `Top plate (doubled) — ${state.lumber}`, sub: `2× perimeter`, qty: fmtTotal(perim * 2) },
        { label: `Studs — ${state.lumber}`, sub: `${state.spacing}" O.C. + corners & openings`, qty: `${studs} × ${fmtLen(H)}` },
        { label: `Door headers — 2×6 (×2 each)`, sub: `${state.doorCount} ${DOOR_LABELS[state.doorType]} opening(s)${state.doorType === "overhead" || effDoorWidth() > 5 ? " — size up to 2×10/LVL" : ""}`, qty: `${state.doorCount * 2} pcs` },
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
        { label: `Roofing — shingles or metal`, sub: `cover roof area`, qty: `≈ ${Math.ceil(roofArea)} sq ft` },
        { label: `Roofing felt / underlayment`, sub: `under roofing`, qty: `≈ ${Math.ceil(roofArea)} sq ft` },
        { label: `House wrap`, sub: `walls`, qty: `≈ ${Math.ceil(perim * H)} sq ft` },
        { label: `${state.doorCount} × ${DOOR_LABELS[state.doorType]} door`, sub: `${fmtLen(effDoorWidth())} × ${fmtLen(state.doorHeight)} each${state.doorCount <= 1 ? ", " + state.doorPos : ""}`, qty: `${state.doorCount}` },
        { label: `Windows`, sub: state.windowList.map((w) => `${fmtLen(w.w)}×${fmtLen(w.h)}`).join(", ") || "none", qty: `${state.windowList.length}` },
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
    const svg = state.view === "front" ? frontElevation(g) : state.view === "side" ? sideElevation(g) : topView(g);
    stage.innerHTML = svg;
    const roofNames = { gable: "Gable", "lean-to": "Lean-to", saltbox: "Saltbox", gambrel: "Gambrel", flat: "Flat" };
    $("#preview-caption").textContent =
      `${roofNames[state.roofType]} · ${fmtLen(state.width)} W × ${fmtLen(state.depth)} D · ` +
      `walls ${fmtLen(state.wallHeight)} · peak ${fmtLen(g.peakHeight)}`;
  }

  function svgWrap(inner, vw, vh) {
    return `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`;
  }
  const C = { wall: "#c9b28a", wall2: "#a98f63", line: "#1b2a3a", roof: "#4ea1d3", dim: "#9fb2ce", door: "#2c4066", stud: "#e0cda4", gap: "#0d1524" };

  const DOOR_LABELS = { single: "single swing", double: "double", barn: "barn / sliding", overhead: "overhead roll-up" };

  function effDoorWidth() {
    const W = state.width, n = state.doorCount;
    const cap = (W - (n + 1) * 0.3) / n;
    return Math.max(0.5, Math.min(state.doorWidth, cap > 0 ? cap : W / (n + 1)));
  }
  function doorLayout() {
    const W = state.width, n = state.doorCount, dw = effDoorWidth();
    const out = [];
    if (n <= 1) {
      const margin = Math.min(0.5, W * 0.06);
      const left = state.doorPos === "left" ? margin : state.doorPos === "right" ? W - margin - dw : W / 2 - dw / 2;
      out.push({ left, w: dw });
    } else {
      const gap = (W - n * dw) / (n + 1);
      for (let i = 0; i < n; i++) out.push({ left: gap * (i + 1) + dw * i, w: dw });
    }
    return out;
  }
  function freeSegments(W, doors, pad) {
    const occ = doors.map((d) => [Math.max(0, d.left - pad), Math.min(W, d.left + d.w + pad)]).sort((a, b) => a[0] - b[0]);
    const segs = [];
    let cursor = 0;
    for (const [a, b] of occ) {
      if (a > cursor) segs.push({ a: cursor, b: a, cursor });
      cursor = Math.max(cursor, b);
    }
    if (cursor < W) segs.push({ a: cursor, b: W, cursor });
    return segs;
  }
  function placeFrontWindows(W, doors, winList) {
    const pad = 0.25;
    const segs = freeSegments(W, doors, 0.15);
    segs.forEach((s) => (s.cursor = s.a));
    const placed = [];
    winList.forEach((win) => {
      if (!segs.length) return;
      const seg = segs.reduce((m, s) => (s.b - s.cursor > m.b - m.cursor ? s : m), segs[0]);
      const room = seg.b - seg.cursor - pad;
      if (room < 0.6) return;
      const wW = Math.min(win.w, room, W * 0.45);
      const cx = seg.cursor + pad / 2 + wW / 2;
      placed.push({ cx, w: wW, h: win.h });
      seg.cursor = cx + wW / 2 + pad / 2;
    });
    return placed;
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
    const knob = state.doorPos === "right" && state.doorCount <= 1 ? x + 8 : x + w - 8;
    s += `<circle cx="${knob}" cy="${(yTop + yBot) / 2}" r="2.5" fill="${C.dim}"/>`;
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
  function drawPlanDoor(type, leftFt, wFt, sx, sy, D) {
    const x1 = sx(leftFt), x2 = sx(leftFt + wFt), yb = sy(D), w = x2 - x1;
    let s = `<rect x="${x1}" y="${yb - 3}" width="${w}" height="6" fill="${C.gap}" stroke="none"/>`;
    if (type === "overhead") {
      for (let i = 0; i < 3; i++) {
        const xx = x1 + (w * (i + 0.5)) / 3;
        s += `<line x1="${xx}" y1="${yb}" x2="${xx}" y2="${yb - 14}" stroke="${C.door}" stroke-width="1.3" stroke-dasharray="3 3" opacity="0.85"/>`;
      }
      return s;
    }
    if (type === "barn") {
      s += `<line x1="${x1 - 4}" y1="${yb - 5}" x2="${x2 + w * 0.9 + 4}" y2="${yb - 5}" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<rect x="${x2}" y="${yb - 7}" width="${w * 0.9}" height="4" fill="${C.door}" stroke="${C.line}" stroke-width="1"/>`;
      return s;
    }
    if (type === "double") {
      const mid = sx(leftFt + wFt / 2);
      s += `<path d="M ${x1} ${yb} A ${w / 2} ${w / 2} 0 0 1 ${mid} ${yb - w / 2}" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
      s += `<path d="M ${x2} ${yb} A ${w / 2} ${w / 2} 0 0 0 ${mid} ${yb - w / 2}" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
      s += `<line x1="${x1}" y1="${yb}" x2="${x1}" y2="${yb - w / 2}" stroke="${C.door}" stroke-width="1.6"/>`;
      s += `<line x1="${x2}" y1="${yb}" x2="${x2}" y2="${yb - w / 2}" stroke="${C.door}" stroke-width="1.6"/>`;
      return s;
    }
    const hingeLeft = !(state.doorPos === "right" && state.doorCount <= 1);
    const hx = hingeLeft ? x1 : x2;
    s += `<path d="M ${x1} ${yb} A ${w} ${w} 0 0 1 ${x2} ${yb}" fill="none" stroke="${C.door}" stroke-width="1.3" opacity="0.8"/>`;
    s += `<line x1="${hx}" y1="${yb}" x2="${hx}" y2="${yb - w}" stroke="${C.door}" stroke-width="2"/>`;
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
    // doors (type + count) on the front wall
    const doors = doorLayout();
    const dh = Math.min(state.doorHeight, H * 0.95);
    doors.forEach((d) => (s += drawFrontDoor(state.doorType, d.left, d.w, dh, sx, sy)));
    // windows — each its own size, packed into free wall space
    const wins = placeFrontWindows(W, doors, state.windowList);
    wins.forEach((win) => (s += drawFrontWindow(win.cx, win.w, Math.min(win.h, H * 0.6), sx, sy)));
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
    // windows on the side wall (each its own size), spread along the depth
    const sideWins = state.windowList.slice(0, 3);
    sideWins.forEach((win, i) => {
      const ww = Math.min(win.w, D * 0.3) * scale;
      const wh = Math.min(win.h, H * 0.6) * scale;
      const frac = sideWins.length === 1 ? 0.5 : 0.25 + (0.5 * i) / (sideWins.length - 1);
      const wx = sx(D * frac) - ww / 2;
      const wyy = sy(H * 0.5 + win.h / 2);
      s += `<rect x="${wx}" y="${wyy}" width="${ww}" height="${wh}" fill="#bcd6e8" stroke="${C.line}" stroke-width="1.5"/>`;
      s += `<line x1="${wx + ww / 2}" y1="${wyy}" x2="${wx + ww / 2}" y2="${wyy + wh}" stroke="${C.line}" stroke-width="1"/>`;
      s += `<line x1="${wx}" y1="${wyy + wh / 2}" x2="${wx + ww}" y2="${wyy + wh / 2}" stroke="${C.line}" stroke-width="1"/>`;
    });
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
    // doors on the front wall (type + count)
    const planDoors = doorLayout();
    planDoors.forEach((d) => (s += drawPlanDoor(state.doorType, d.left, d.w, sx, sy, D)));
    if (state.doorType === "single" || state.doorType === "double") {
      const dcx = planDoors[0].left + planDoors[0].w / 2;
      s += `<text x="${sx(dcx)}" y="${sy(D) + 26}" fill="${C.dim}" font-size="9" text-anchor="middle">${state.doorCount} door${state.doorCount > 1 ? "s" : ""}</text>`;
    }
    // windows on the side walls (each its own size)
    state.windowList.slice(0, 4).forEach((win, i) => {
      const onLeft = i % 2 === 0;
      const group = Math.floor(i / 2);
      const groups = Math.max(1, Math.ceil(Math.min(state.windowList.length, 4) / 2));
      const frac = 0.3 + 0.4 * (groups <= 1 ? 0 : group / (groups - 1));
      const wy = sy(D * Math.min(0.8, frac));
      const side = onLeft ? sx(0) : sx(W);
      const wlen = Math.min(win.w, D * 0.4) * scale;
      s += `<rect x="${side - 3}" y="${wy - wlen / 2}" width="6" height="${wlen}" fill="#bcd6e8" stroke="${C.line}" stroke-width="1"/>`;
    });
    s += dimLineH(sx(0), sx(W), sy(0) - 14, fmtLen(W), scale);
    s += dimLineV(sx(0) - 14, sy(0), sy(D), fmtLen(D));
    s += `<text x="${sx(W / 2)}" y="${sy(D / 2)}" fill="${C.line}" font-size="10" text-anchor="middle" opacity="0.7">${nj} joists @ ${state.spacing}" O.C.</text>`;
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
    const { groups, perim, roofArea } = materials();
    const totalBoards = groups.reduce((a, gr) => a + gr.items.length, 0);
    $("#shopSummary").innerHTML =
      chip(fmtLen(state.width) + "×" + fmtLen(state.depth), "footprint") +
      chip(Math.ceil(roofArea) + (state.units === "metric" ? "" : " ft²"), "roof area") +
      chip(totalBoards, "line items");
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
    return `<div class="group"><h3>${gr.title}<span class="count">${gr.items.length}</span></h3>${rows}</div>`;
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
      body: `Build each wall flat on the deck: bottom plate + top plate with ${state.lumber} studs ${state.spacing}" O.C. Frame ${state.doorCount} ${DOOR_LABELS[state.doorType]} door opening(s) at ${fmtLen(effDoorWidth())} wide (king + jack studs, header)${state.windowList.length > 0 ? ` and ${state.windowList.length} window opening(s)` : ""}.`,
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
      body: `Install shingles or metal roofing from the eave up, following the manufacturer's overlap and fastener pattern.`,
    });
    steps.push({
      tag: "Finish",
      title: "Doors, windows & trim",
      body: `Hang ${state.doorCount} ${DOOR_LABELS[state.doorType]} door(s) at ${fmtLen(effDoorWidth())} × ${fmtLen(state.doorHeight)}${state.windowList.length > 0 ? `, then install ${state.windowList.length} window(s) (${state.windowList.map((w) => `${fmtLen(w.w)}×${fmtLen(w.h)}`).join(", ")})` : ""}. Flash and caulk each opening, then add corner and trim boards and fascia.`,
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
    $("#stepsSummary").innerHTML =
      chip(steps.length, "steps") +
      chip(roofStep, "roof steps") +
      chip({ gable: "Gable", "lean-to": "Lean-to", saltbox: "Saltbox", gambrel: "Gambrel", flat: "Flat" }[state.roofType], "roof");
    $("#buildSteps").innerHTML = steps
      .map(
        (s, i) =>
          `<li class="step"><span class="step-num">${i + 1}</span><div class="step-body"><div class="step-head"><b>${s.title}</b><span class="step-tag">${s.tag}</span></div><p>${s.body}</p></div></li>`
      )
      .join("");
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
    state.pitch = parseFloat($("#pitch").value);
    state.overhang = toInches(parseFloat($("#overhang").value) || 0);
    state.width = toFt(parseFloat($("#width").value) || 0);
    state.depth = toFt(parseFloat($("#depth").value) || 0);
    state.wallHeight = toFt(parseFloat($("#wallHeight").value) || 0);
    state.spacing = parseInt($("#spacing").value, 10);
    state.lumber = $("#lumber").value;
    state.doorWidth = toFt(parseFloat($("#doorWidth").value) || 0);
    state.doorHeight = toFt(parseFloat($("#doorHeight").value) || 0);
    state.doorPos = $("#doorPos").value;
    state.doorType = $("#doorType").value;
    state.doorCount = Math.max(1, parseInt($("#doorCount").value, 10) || 1);
    const wantCount = Math.max(0, parseInt($("#windows").value, 10) || 0);
    if (wantCount !== state.windowList.length) {
      resizeWindowList(wantCount);
      renderWindowInputs();
    } else {
      $$("#windowSizes .win-w").forEach((inp) => {
        const i = +inp.dataset.i;
        if (state.windowList[i]) state.windowList[i].w = toFt(parseFloat(inp.value) || 0);
      });
      $$("#windowSizes .win-h").forEach((inp) => {
        const i = +inp.dataset.i;
        if (state.windowList[i]) state.windowList[i].h = toFt(parseFloat(inp.value) || 0);
      });
    }
    state.windows = state.windowList.length;
    $("#pitchOut").textContent = `${state.pitch} / 12`;
    togglePitchField();
    renderAll();
  }

  function resizeWindowList(n) {
    while (state.windowList.length < n) state.windowList.push({ w: 2, h: 2 });
    if (state.windowList.length > n) state.windowList.length = n;
  }

  function normalizeWindows() {
    if (!Array.isArray(state.windowList)) {
      const n = state.windows || 0;
      const w = state.winWidth || 2, h = state.winHeight || 2;
      state.windowList = Array.from({ length: n }, () => ({ w, h }));
    }
    state.windows = state.windowList.length;
  }

  function renderWindowInputs() {
    const host = $("#windowSizes");
    if (!host) return;
    const u = state.units === "metric" ? "m" : "ft";
    host.innerHTML = state.windowList
      .map(
        (win, i) =>
          `<div class="win-row"><span class="win-row-label">Win ${i + 1}</span>` +
          `<label><small>W (${u})</small><input type="number" class="win-w" data-i="${i}" value="${round(dispLen(win.w), 2)}" min="0.5" step="0.5" inputmode="decimal"></label>` +
          `<label><small>H (${u})</small><input type="number" class="win-h" data-i="${i}" value="${round(dispLen(win.h), 2)}" min="0.5" step="0.5" inputmode="decimal"></label></div>`
      )
      .join("") || `<p class="win-empty">No windows.</p>`;
  }

  function stateToForm() {
    normalizeWindows();
    $("#roofType").value = state.roofType;
    $("#pitch").value = state.pitch;
    $("#pitchOut").textContent = `${state.pitch} / 12`;
    $("#overhang").value = round(dispSmall(state.overhang), state.units === "metric" ? 1 : 0);
    $("#width").value = round(dispLen(state.width), 2);
    $("#depth").value = round(dispLen(state.depth), 2);
    $("#wallHeight").value = round(dispLen(state.wallHeight), 2);
    $("#spacing").value = state.spacing;
    $("#lumber").value = state.lumber;
    $("#doorWidth").value = round(dispLen(state.doorWidth), 2);
    $("#doorHeight").value = round(dispLen(state.doorHeight), 2);
    $("#doorPos").value = state.doorPos || "center";
    $("#doorType").value = state.doorType || "single";
    $("#doorCount").value = state.doorCount || 1;
    $("#windows").value = state.windowList.length;
    renderWindowInputs();
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
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
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
    persistDesigns(list);
    toast("Saved “" + state.name + "”");
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
        doorWidth: 3, doorHeight: 6.5, windows: 1,
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
    localStorage.setItem(SEEN_KEY, "1");
    closeOverlay("#wizard");
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

  /* ---------- Init ---------- */
  function init() {
    initTheme();
    initTabs();
    initWizard();
    $("#shed-form").addEventListener("input", formToState);
    $("#shed-form").addEventListener("change", formToState);
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
