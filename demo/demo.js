/* Interactive qualitative demo for the CoVeR project page.
   Three benchmark scenes (ScanQA / SQA3D / OpenEQA), each with:
     - a reconstructed mesh + the 12 posed input views (hover a camera -> pruned view)
     - three questions CoVeR answers correctly from the pruned token budget, one per category
   Assets live in demo/<key>/  (mesh.bin, cams.json, view{00..11}_pruned.jpg). */
(function () {
  if (typeof THREE === "undefined") return;

  const canvasWrap = document.getElementById("demoCanvasWrap");
  const benchEl = document.getElementById("demoBench");
  const origCanvas = document.getElementById("demoOrigCanvas");
  const infoCanvas = document.getElementById("demoInfoCanvas");
  const shotOrig = document.getElementById("demoShotOrig");
  const shotPruned = document.getElementById("demoShotPruned");
  const badgeOrig = document.getElementById("demoBadgeOrig");
  const badgePruned = document.getElementById("demoBadgePruned");
  const benchSpecEl = document.getElementById("demoBenchSpec");
  const infoHint = document.getElementById("demoInfoHint");
  const loadingEl = document.getElementById("demoLoading");
  const exploreBtn = document.getElementById("demoExplore");
  const qaTabsEl = document.getElementById("qaTabs");
  const qaHeadEl = document.getElementById("qaHead");
  const qaAnsEl = document.getElementById("qaAns");
  const capEl = document.getElementById("demoCap");
  if (!canvasWrap || !benchEl) return;

  // ---- benchmarks -----------------------------------------------------------
  const BENCH = [
    {
      key: "scanqa", label: "ScanQA", scene: "scene0046_00", budget: "23%", tokens: 2012,
      blurb: "spatial scene understanding",
      spec: "spatial scene understanding — objects, colours, counts and how things are arranged in the reconstructed room.",
      qa: [
        { cat: "Color", q: "What color is the tv above the night stand?", pred: "black", gt: ["black"] },
        { cat: "Counting", q: "How many legs does the arm chair have?", pred: "four", gt: ["4", "4 of them"] },
        { cat: "Spatial", q: "What is in front of the desk?", pred: "chair", gt: ["chair"] },
      ],
    },
    {
      key: "sqa3d", label: "SQA3D", scene: "scene0633_00", budget: "26%", tokens: 2274,
      blurb: "situated (egocentric) reasoning",
      spec: "situated reasoning — the model is placed at a viewpoint and must answer from that egocentric position and orientation.",
      qa: [
        {
          cat: "Situational",
          situation: "I am facing a shelf and there is an armchair in my two o'clock direction.",
          q: "What is sitting on the armchair in my 2 o'clock direction?", pred: "pillow", gt: ["pillow"],
        },
        {
          cat: "Comparison",
          situation: "I am checking on my baby, while there is a curtain on my left.",
          q: "Is the lamp in front of me or behind me?", pred: "behind", gt: ["behind"],
        },
        {
          cat: "Capability",
          situation: "I am sitting in an armchair with a lamp behind me.",
          q: "Can I see curtains where I am standing?", pred: "yes", gt: ["yes"],
        },
      ],
    },
    {
      key: "openeqa", label: "OpenEQA", scene: "scene0354_00", budget: "43%", tokens: 3762,
      blurb: "embodied question answering",
      spec: "embodied question answering — open-vocabulary questions an agent asks while exploring, scored by an LLM against the reference answer.",
      fit: 1.18, lift: 0.30,
      qa: [
        { cat: "Object Recognition", q: "What is the white object hanging on the red wall?", pred: "whiteboard", gt: ["whiteboard"] },
        { cat: "Object Localization", q: "Where is trash bin located?", pred: "in corner", gt: ["at corner of glass panel and red wall"] },
        { cat: "Attribute Recognition", q: "What is the color of the wall with the whiteboard?", pred: "red", gt: ["red"] },
        { cat: "Spatial Understanding", q: "What is in front of television?", pred: "chair", gt: ["black chair and red chair"] },
        { cat: "Object State Recognition", q: "Is the door open or closed?", pred: "open", gt: ["open"] },
        { cat: "Functional Reasoning", q: "Where can I write math equations?", pred: "whiteboard", gt: ["on the whiteboard"] },
        { cat: "World Knowledge", q: "Which room do these images come from?", pred: "conference room", gt: ["conference room"] },
      ],
    },
  ];

  let current = BENCH[0];
  let currentCams = null;

  // ---- three.js scaffold (persistent across benchmark switches) ------------
  const width = canvasWrap.clientWidth || 640;
  const height = canvasWrap.clientHeight || 460;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfaf9f5);
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.02, 200);

  let renderer = null, controls = null, glOK = false;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    canvasWrap.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false; // gated behind the Explore button
    controls.enablePan = false;
    glOK = true;
  } catch (e) {
    if (loadingEl) { loadingEl.style.display = "flex"; loadingEl.textContent = "3D view needs WebGL — try a desktop browser."; }
    if (exploreBtn) exploreBtn.style.display = "none";
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6);
  dl.position.set(3, 5, 2);
  scene.add(dl);

  let sceneMesh = null;
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  let pickables = [];

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // Billboarded number label: white digit inside a black circle ringed in the camera colour.
  function makeNumberSprite(num, col) {
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = "#" + col.getHexString();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#111";
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.font = "700 66px 'Space Grotesk', Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(num), S / 2, S / 2 + 4);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
    return sp;
  }

  function parseMesh(bytes) {
    const nVerts = new DataView(bytes.buffer).getUint32(0, true);
    const nFaces = new DataView(bytes.buffer).getUint32(4, true);
    let off = 8;
    const positions = new Float32Array(bytes.buffer.slice(off, off + nVerts * 12)); off += nVerts * 12;
    const colorsU8 = new Uint8Array(bytes.buffer.slice(off, off + nVerts * 3)); off += nVerts * 3;
    const indices = new Uint32Array(bytes.buffer.slice(off, off + nFaces * 12));
    const colors = new Float32Array(colorsU8.length);
    for (let i = 0; i < colorsU8.length; i++) colors[i] = colorsU8[i] / 255;
    return { positions, colors, indices };
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  function addEdge(group, a, b, radius, material) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return;
    const cyl = new THREE.CylinderGeometry(radius, radius, len, 6, 1);
    cyl.translate(0, len / 2, 0);
    const m = new THREE.Mesh(cyl, material);
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    group.add(m);
  }

  function frustumFillGeo(apex, c1, c2, c3, c4) {
    const tris = [apex, c1, c2, apex, c2, c3, apex, c3, c4, apex, c4, c1, c1, c2, c3, c1, c3, c4];
    const pos = new Float32Array(tris.length * 3);
    tris.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function buildScene(meshData, cams) {
    // mesh
    if (sceneMesh) {
      scene.remove(sceneMesh);
      sceneMesh.geometry.dispose();
      sceneMesh.material.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(meshData.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    sceneMesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    );
    scene.add(sceneMesh);

    // cameras
    disposeGroup(markerGroup);
    pickables = [];
    cams.forEach((cam) => {
      const pos = new THREE.Vector3(...cam.pos);
      const fwd = new THREE.Vector3(...cam.fwd).normalize();
      const up = new THREE.Vector3(...cam.up).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const realUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const col = new THREE.Color().setHSL(cam.idx / cams.length, 0.72, 0.5);

      // Numbered marker over the camera (replaces the plain dot).
      const label = makeNumberSprite(cam.idx, col);
      label.position.copy(pos);
      label.scale.set(0.085, 0.085, 0.085);
      markerGroup.add(label);

      const d = 0.16, w = 0.1, h = 0.075, r = 0.009;
      const apex = pos.clone();
      const c1 = pos.clone().addScaledVector(fwd, d).addScaledVector(right, w).addScaledVector(realUp, h);
      const c2 = pos.clone().addScaledVector(fwd, d).addScaledVector(right, -w).addScaledVector(realUp, h);
      const c3 = pos.clone().addScaledVector(fwd, d).addScaledVector(right, -w).addScaledVector(realUp, -h);
      const c4 = pos.clone().addScaledVector(fwd, d).addScaledVector(right, w).addScaledVector(realUp, -h);
      const edgeMat = new THREE.MeshBasicMaterial({ color: col });
      [[apex, c1], [apex, c2], [apex, c3], [apex, c4], [c1, c2], [c2, c3], [c3, c4], [c4, c1]]
        .forEach(([a, b]) => addEdge(markerGroup, a, b, r, edgeMat));
      const fillMat = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false,
      });
      markerGroup.add(new THREE.Mesh(frustumFillGeo(apex, c1, c2, c3, c4), fillMat));

      // Invisible, larger hit target covering the whole camera glyph, so hovering
      // anywhere on the camera (not just the tiny dot) loads that view's tokens.
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 12, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.position.copy(pos).addScaledVector(fwd, 0.08);
      hit.userData.camIdx = cam.idx;
      markerGroup.add(hit);
      pickables.push(hit);
    });

    // frame the scene large in the viewport, from a low 3/4 angle
    const bbox = geo.boundingBox;
    const center = new THREE.Vector3(); bbox.getCenter(center);
    const size = new THREE.Vector3(); bbox.getSize(size);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    // rooms are wide & shallow — fit the floor footprint to the (wide) horizontal
    // FOV and the room height to the vertical FOV, take whichever needs more room
    const floorHalf = 0.5 * Math.hypot(size.x, size.z);
    const vertHalf = 0.5 * size.y + 0.08 * floorHalf;
    const dist = Math.max(
      floorHalf / Math.tan(hFov / 2),
      vertHalf / Math.tan(vFov / 2)
    ) * (current.fit || 1.1);
    // aim below the room centre so the scene sits higher in the frame
    const lift = current.lift != null ? current.lift : 0.22;
    const target = new THREE.Vector3(center.x, center.y - lift * size.y, center.z);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(1, 0.45, 1).normalize().multiplyScalar(dist));
    controls.minDistance = dist * 0.3;
    controls.maxDistance = dist * 2.6;
    controls.update();
  }

  // ---- hovered-camera view: animate original -> pruned (random patches) ----
  const imgCache = {};
  function loadImg(src) {
    if (imgCache[src]) return imgCache[src];
    const p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
    imgCache[src] = p;
    return p;
  }

  let hoverIdx = -1;
  let animToken = 0;
  const GRID = 27; // matches the 27x27 = 729-patch token grid

  function showView(idx) {
    hoverIdx = idx;
    const token = ++animToken;

    // Border + badge in the camera's own colour, so the panel matches the hovered camera.
    if (currentCams && currentCams.length) {
      const col = new THREE.Color().setHSL(idx / currentCams.length, 0.72, 0.5);
      const hex = "#" + col.getHexString();
      if (origCanvas) origCanvas.style.borderColor = hex;
      if (infoCanvas) infoCanvas.style.borderColor = hex;
      [badgeOrig, badgePruned].forEach((bd) => {
        if (!bd) return;
        bd.textContent = idx;
        bd.style.borderColor = hex;
        bd.classList.add("on");
      });
    }

    const base = `demo/${current.key}/view${String(idx).padStart(2, "0")}_`;
    Promise.all([loadImg(base + "original.jpg"), loadImg(base + "pruned.jpg")])
      .then(([orig, pruned]) => {
        if (token !== animToken) return;
        const W = orig.naturalWidth || 480;
        const H = orig.naturalHeight || 360;

        // top: the untouched input view
        origCanvas.width = W; origCanvas.height = H;
        origCanvas.getContext("2d").drawImage(orig, 0, 0, W, H);
        if (shotOrig) shotOrig.hidden = false;

        // bottom: starts as the input view, then patches get pruned away
        const ctx = infoCanvas.getContext("2d");
        infoCanvas.width = W; infoCanvas.height = H;
        if (shotPruned) shotPruned.hidden = false;
        const cw = W / GRID, ch = H / GRID;
        const sw = (pruned.naturalWidth || W) / GRID;
        const sh = (pruned.naturalHeight || H) / GRID;
        ctx.drawImage(orig, 0, 0, W, H);

        const cells = [];
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) cells.push([x, y]);
        for (let i = cells.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [cells[i], cells[j]] = [cells[j], cells[i]];
        }

        const DUR = 780;
        const start = performance.now();
        let n = 0;
        (function step(now) {
          if (token !== animToken) return;
          const t = Math.min(1, (now - start) / DUR);
          const upTo = Math.floor(t * cells.length);
          for (; n < upTo; n++) {
            const [x, y] = cells[n];
            ctx.drawImage(pruned, x * sw, y * sh, sw, sh, Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
          }
          if (t < 1) requestAnimationFrame(step);
          else ctx.drawImage(pruned, 0, 0, W, H);
        })(start);
      })
      .catch(() => {});
  }

  if (glOK) renderer.domElement.addEventListener("pointermove", (e) => {
    if (!currentCams) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(pickables);
    if (hits.length > 0) {
      const idx = hits[0].object.userData.camIdx;
      if (idx !== hoverIdx) showView(idx);
      infoHint.style.display = "none";
      renderer.domElement.style.cursor = "pointer";
    } else {
      renderer.domElement.style.cursor = "grab";
    }
  });

  window.addEventListener("resize", () => {
    if (!glOK) return;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  if (glOK && exploreBtn) {
    exploreBtn.addEventListener("click", () => {
      const on = exploreBtn.classList.toggle("active");
      controls.enableZoom = on;
      controls.enablePan = on;
      exploreBtn.textContent = on ? "Disable zoom" : "Enable zoom";
    });
  }

  if (glOK) (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  // ---- QA panel -----------------------------------------------------------
  function renderQA(bench, i) {
    const it = bench.qa[i];
    qaTabsEl.querySelectorAll(".qa-tab").forEach((t, j) => t.classList.toggle("active", j === i));
    if (qaHeadEl) qaHeadEl.innerHTML =
      `<span class="qa-cat">${bench.label} · ${it.cat}</span>` +
      (it.situation ? `<div class="qa-sit">“${it.situation}”</div>` : "") +
      `<div class="qa-q">${it.q}</div>`;
    if (qaAnsEl) qaAnsEl.innerHTML =
      `<span class="qa-check">✓</span><span class="lab">Answer</span><b>${it.pred}</b>`;
  }

  function buildQATabs(bench) {
    qaTabsEl.innerHTML = "";
    bench.qa.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "qa-tab" + (i === 0 ? " active" : "");
      b.type = "button";
      b.textContent = it.cat;
      b.addEventListener("click", () => renderQA(bench, i));
      qaTabsEl.appendChild(b);
    });
    renderQA(bench, 0);
  }

  // ---- benchmark switching ----------------------------------------------
  const meshCache = {};

  function loadBenchmark(bench) {
    current = bench;
    benchEl.querySelectorAll(".bench-tab").forEach((t) => t.classList.toggle("active", t.dataset.k === bench.key));
    if (benchSpecEl) benchSpecEl.innerHTML = `<b>${bench.label}</b> — ${bench.spec}`;
    if (capEl) {
      capEl.innerHTML =
        `<b>Interactive — ScanNet <code>${bench.scene}</code> · ${bench.label}, ${bench.budget} token budget (${bench.tokens} / 8748).</b> ` +
        `The reconstructed scene with the 12 posed input views CoVeR receives, each marked by its index.`;
    }
    buildQATabs(bench);
    if (!glOK) return;

    if (loadingEl) { loadingEl.style.display = "flex"; loadingEl.textContent = "Loading scene…"; }
    hoverIdx = -1;
    animToken++;
    if (shotOrig) shotOrig.hidden = true;
    if (shotPruned) shotPruned.hidden = true;
    if (badgeOrig) badgeOrig.classList.remove("on");
    if (badgePruned) badgePruned.classList.remove("on");
    [origCanvas, infoCanvas].forEach((cv) => {
      if (!cv) return;
      const c = cv.getContext("2d");
      if (c) c.clearRect(0, 0, cv.width, cv.height);
    });
    if (infoHint) infoHint.style.display = "";

    const dir = `demo/${bench.key}/`;
    const meshP = meshCache[bench.key]
      ? Promise.resolve(meshCache[bench.key])
      : fetch(dir + "mesh.bin").then((r) => r.arrayBuffer()).then((b) => {
          const parsed = parseMesh(new Uint8Array(b));
          meshCache[bench.key] = parsed;
          return parsed;
        });

    Promise.all([meshP, fetch(dir + "cams.json").then((r) => r.json())])
      .then(([meshData, cams]) => {
        if (current.key !== bench.key) return; // superseded by a newer click
        currentCams = cams;
        buildScene(meshData, cams);
        if (loadingEl) loadingEl.style.display = "none";
      })
      .catch((err) => {
        if (loadingEl) { loadingEl.style.display = "flex"; loadingEl.textContent = "Failed to load scene: " + err.message; }
      });
  }

  BENCH.forEach((bench) => {
    const b = document.createElement("button");
    b.className = "bench-tab" + (bench === BENCH[0] ? " active" : "");
    b.type = "button";
    b.dataset.k = bench.key;
    b.innerHTML = `<span class="bench-name">${bench.label}</span><span class="bench-budget">${bench.budget}</span>`;
    b.addEventListener("click", () => { if (current.key !== bench.key) loadBenchmark(bench); });
    benchEl.appendChild(b);
  });

  loadBenchmark(BENCH[0]);
})();