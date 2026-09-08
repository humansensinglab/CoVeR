(function () {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 480, H = 300;
  const M = { l: 52, r: 66, t: 30, b: 46 };      // plot margins
  const PW = W - M.l - M.r, PH = H - M.t - M.b;   // plot area
  const GOLD = "#f5b301";
  const INK = "#3a3742", INK_SOFT = "#8a8794", GRID = "#ecebf2", SPINE = "#d8d7e0";

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function marker(kind, x, y, color, r) {
    r = r || 4.6;
    if (kind === "square") {
      const s = r * 1.7;
      return el("rect", { x: x - s / 2, y: y - s / 2, width: s, height: s, rx: 1.2,
        fill: color, stroke: "#fff", "stroke-width": 1.4 });
    }
    if (kind === "diamond") {
      const s = r * 1.25;
      return el("path", { d: `M${x},${y - s} L${x + s},${y} L${x},${y + s} L${x - s},${y} Z`,
        fill: color, stroke: "#fff", "stroke-width": 1.4 });
    }
    if (kind === "star") {
      const R = r * 2.3, ri = R * 0.44; let d = "";
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + i * Math.PI / 5;
        const rad = i % 2 ? ri : R;
        d += (i ? "L" : "M") + (x + rad * Math.cos(ang)).toFixed(2) + "," + (y + rad * Math.sin(ang)).toFixed(2) + " ";
      }
      d += "Z";
      return el("path", { d, fill: GOLD, stroke: "#fff", "stroke-width": 1.4 });
    }
    return el("circle", { cx: x, cy: y, r: r, fill: color, stroke: "#fff", "stroke-width": 1.4 });
  }

  function render(container, cfg) {
    container.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "anim-chart-svg",
      role: "img", "aria-label": cfg.aria || cfg.title || "chart" }, container);

    const n = cfg.xLabels.length;
    const xAt = (i) => M.l + (n === 1 ? PW / 2 : (i * PW) / (n - 1));
    const yAt = (v) => M.t + (1 - (v - cfg.yMin) / (cfg.yMax - cfg.yMin)) * PH;

    // title
    if (cfg.title) el("text", { x: M.l + PW / 2, y: 16, "text-anchor": "middle",
      fill: INK, "font-size": 14, "font-weight": 600, "font-family": "'Space Grotesk',sans-serif" }, svg)
      .textContent = cfg.title;

    // y grid + labels
    cfg.yTicks.forEach((v) => {
      const y = yAt(v);
      el("line", { x1: M.l, y1: y, x2: M.l + PW, y2: y, stroke: GRID, "stroke-width": 1 }, svg);
      el("text", { x: M.l - 9, y: y + 3.5, "text-anchor": "end", fill: INK_SOFT,
        "font-size": 11, "font-family": "'Inter',sans-serif" }, svg).textContent = v;
    });
    // axes
    el("line", { x1: M.l, y1: M.t, x2: M.l, y2: M.t + PH, stroke: SPINE, "stroke-width": 1 }, svg);
    el("line", { x1: M.l, y1: M.t + PH, x2: M.l + PW, y2: M.t + PH, stroke: SPINE, "stroke-width": 1 }, svg);
    // x labels
    cfg.xLabels.forEach((lab, i) => {
      el("text", { x: xAt(i), y: M.t + PH + 18, "text-anchor": "middle", fill: INK_SOFT,
        "font-size": 11, "font-family": "'Inter',sans-serif" }, svg).textContent = lab;
    });
    // axis titles
    if (cfg.xTitle) el("text", { x: M.l + PW / 2, y: H - 6, "text-anchor": "middle",
      fill: INK, "font-size": 12, "font-family": "'Inter',sans-serif" }, svg).textContent = cfg.xTitle;
    if (cfg.yTitle) {
      const t = el("text", { x: 14, y: M.t + PH / 2, "text-anchor": "middle", fill: INK,
        "font-size": 12, "font-family": "'Inter',sans-serif",
        transform: `rotate(-90 14 ${M.t + PH / 2})` }, svg);
      t.textContent = cfg.yTitle;
    }

    const drawn = cfg.series.map((s) => {
      const poly = el("polyline", { fill: "none", stroke: s.color,
        "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": s.dash ? "5 5" : "none" }, svg);
      const mg = el("g", {}, svg);
      return { poly, mg, s };
    });

    function addMarker(d, i) {
      const s = d.s;
      const isLast = i === n - 1;
      const kind = (isLast && s.starLast) ? "star" : s.marker;
      const mk = marker(kind, xAt(i), yAt(s.data[i]), s.color);
      mk.setAttribute("class", "amk");
      d.mg.appendChild(mk);
      if (isLast && s.endLabel) {
        el("text", { x: xAt(i) + 9, y: yAt(s.data[i]) + 4, fill: s.labelColor || s.color,
          "font-size": 12, "font-weight": 700, "font-family": "'Space Grotesk',sans-serif" }, d.mg)
          .textContent = s.endLabel;
      }
    }
    function step(k) {
      drawn.forEach((d) => {
        const pts = [];
        for (let i = 0; i <= k; i++) pts.push(xAt(i) + "," + yAt(d.s.data[i]));
        d.poly.setAttribute("points", pts.join(" "));
        addMarker(d, k);
      });
    }

    function clearSeries() {
      drawn.forEach((d) => {
        d.poly.setAttribute("points", "");
        while (d.mg.firstChild) d.mg.removeChild(d.mg.firstChild);
      });
    }

    let started = false;
    function cycle() {
      clearSeries();
      let k = 0;
      step(0);
      const timer = setInterval(() => {
        k++;
        if (k >= n) { clearInterval(timer); setTimeout(cycle, 1000); return; }  // pause, then redraw
        step(k);
      }, 500);
    }
    function run() {
      if (started) return; started = true;
      cycle();
    }

    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    }, { threshold: 0.35 });
    io.observe(container);

    if (cfg.legend !== false) {
      const leg = document.createElement("div");
      leg.className = "anim-chart-legend";
      cfg.series.forEach((s) => {
        const item = document.createElement("span");
        item.className = "acl-item";
        item.innerHTML = `<span class="acl-swatch" style="background:${s.color}"></span>${s.name}`;
        leg.appendChild(item);
      });
      container.appendChild(leg);
    }
  }

  // ---- data ---------------------------------------------------------------
  const CHARTS = {
    chartQwenScan: {
      title: "(a) ScanQA",
      xLabels: ["100", "54", "40", "23", "14", "9"], xTitle: "Token retention (%)",
      yMin: 60, yMax: 101, yTicks: [60, 70, 80, 90, 100], yTitle: "Score retained (%)",
      series: [
        { name: "Qwen2.5-VL-7B", color: "#6366f1", marker: "circle", starLast: true,
          data: [100, 99.3, 98.6, 97.6, 96.3, 95.6] },
        { name: "Qwen3-VL-8B", color: "#a78bfa", marker: "square", starLast: true,
          data: [100, 99.6, 98.9, 97.1, 95.4, 93.4] },
      ],
    },
    chartQwenSqa: {
      title: "(b) SQA3D",
      xLabels: ["100", "54", "40", "23", "14", "9"], xTitle: "Token retention (%)",
      yMin: 60, yMax: 101, yTicks: [60, 70, 80, 90, 100], yTitle: "Score retained (%)",
      series: [
        { name: "Qwen2.5-VL-7B", color: "#6366f1", marker: "circle", starLast: true,
          data: [100, 99.1, 98.9, 97.9, 96.6, 95.0] },
        { name: "Qwen3-VL-8B", color: "#a78bfa", marker: "square", starLast: true,
          data: [100, 99.4, 98.6, 97.3, 95.9, 94.1] },
      ],
    },
  };

  function init() {
    Object.keys(CHARTS).forEach((id) => {
      const c = document.getElementById(id);
      if (c) render(c, CHARTS[id]);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();