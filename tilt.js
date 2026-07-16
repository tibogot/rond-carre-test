import Matter from "matter-js";
import GUI from "lil-gui";

const { Engine, World, Bodies, Body, Runner, Events } = Matter;

const WALL_THICKNESS = 180;
const OPTICAL_CIRCLE_SCALE = Math.sqrt(4 / Math.PI);

const DESKTOP = {
  shapeSize: 88,
  shapeCount: 12,
  circleSegments: 48,
};

const MOBILE = {
  shapeSize: 64,
  shapeCount: 8,
  circleSegments: 36,
};

const params = {
  shapeSize: DESKTOP.shapeSize,
  shapeCount: DESKTOP.shapeCount,
  circleRatio: 0.5,
  opticalCircleScale: OPTICAL_CIRCLE_SCALE,
  circleSegments: DESKTOP.circleSegments,
  color: "#ffd600",
  baseGravity: 0.85,
  tiltStrength: 1.8,
  tiltSmooth: 0.18,
  tiltSensitivity: 18,
  restitution: 0.55,
  friction: 0.05,
  frictionAir: 0.008,
  density: 0.002,
  antiAlign: true,
  antiAlignTorque: 0.004,
  useMouseTilt: true,
};

const canvas = document.getElementById("physics-canvas");
const ctx = canvas.getContext("2d");
const enableBtn = document.getElementById("tilt-enable");
const hintEl = document.getElementById("tilt-hint");
const statusEl = document.getElementById("tilt-status");

let width = 0;
let height = 0;
let dpr = 1;
let isMobile = false;

const shapes = [];
const tilt = { x: 0, y: 1, targetX: 0, targetY: 1 };
let tiltEnabled = false;
let usingDeviceTilt = false;
let sensorMode = "none"; // orientation | motion | none
let lastSensorAt = 0;
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const preferMotion = /Android/i.test(navigator.userAgent);
const calib = {
  ready: false,
  beta: 0,
  gamma: 0,
  ax: 0,
  ay: 0,
};

const engine = Engine.create({
  gravity: { x: 0, y: params.baseGravity, scale: 0.001 },
});
const world = engine.world;

let floor = null;
let leftWall = null;
let rightWall = null;
let ceiling = null;

function detectMobile() {
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1000)
  );
}

function applyDeviceDefaults(force = false) {
  const nextMobile = detectMobile();
  if (!force && nextMobile === isMobile) return false;
  isMobile = nextMobile;

  const preset = isMobile ? MOBILE : DESKTOP;
  params.shapeSize = preset.shapeSize;
  params.shapeCount = preset.shapeCount;
  params.circleSegments = preset.circleSegments;
  return true;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.75 : 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildBounds();
}

function rebuildBounds() {
  const walls = [floor, leftWall, rightWall, ceiling].filter(Boolean);
  if (walls.length) World.remove(world, walls);

  // Closed box so shapes can roll around the full screen
  floor = Bodies.rectangle(
    width / 2,
    height + WALL_THICKNESS / 2 - 2,
    width + WALL_THICKNESS * 2,
    WALL_THICKNESS,
    { isStatic: true, friction: 0.2, restitution: 0.35 }
  );
  ceiling = Bodies.rectangle(
    width / 2,
    -WALL_THICKNESS / 2 + 2,
    width + WALL_THICKNESS * 2,
    WALL_THICKNESS,
    { isStatic: true, friction: 0.2, restitution: 0.35 }
  );
  leftWall = Bodies.rectangle(
    -WALL_THICKNESS / 2 + 2,
    height / 2,
    WALL_THICKNESS,
    height * 2,
    { isStatic: true, friction: 0.2, restitution: 0.35 }
  );
  rightWall = Bodies.rectangle(
    width + WALL_THICKNESS / 2 - 2,
    height / 2,
    WALL_THICKNESS,
    height * 2,
    { isStatic: true, friction: 0.2, restitution: 0.35 }
  );

  World.add(world, [floor, ceiling, leftWall, rightWall]);
}

function sizeForKind(kind) {
  return kind === "circle"
    ? params.shapeSize * params.opticalCircleScale
    : params.shapeSize;
}

function spawnShape(x, y) {
  const kind = Math.random() < params.circleRatio ? "circle" : "square";
  const size = sizeForKind(kind);
  const options = {
    restitution: params.restitution,
    friction: params.friction,
    frictionAir: params.frictionAir,
    density: params.density,
  };

  let body;
  if (kind === "circle") {
    body = Bodies.circle(x, y, size / 2, options, params.circleSegments);
  } else {
    body = Bodies.rectangle(x, y, size, size, options);
    Body.setAngle(body, Math.random() * Math.PI * 2);
  }

  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 1.5,
    y: (Math.random() - 0.5) * 1.5,
  });

  World.add(world, body);
  shapes.push({ body, kind, size });
}

function clearShapes() {
  shapes.splice(0).forEach(({ body }) => World.remove(world, body));
}

function seedShapes() {
  clearShapes();

  // Spread in the open center so there's room to move
  for (let i = 0; i < params.shapeCount; i++) {
    const margin = sizeForKind("circle") + 24;
    const x = margin + Math.random() * Math.max(1, width - margin * 2);
    const y =
      height * 0.28 + Math.random() * Math.max(1, height * 0.35 - margin);
    spawnShape(x, y);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function setTiltTargetsFromOrientation(beta, gamma) {
  // Relative to pose at activation — small leans from how you hold the phone
  const b = beta ?? 0;
  const g = gamma ?? 0;

  if (!calib.ready) {
    calib.beta = b;
    calib.gamma = g;
    calib.ready = true;
  }

  const db = b - calib.beta;
  const dg = g - calib.gamma;
  const sens = params.tiltSensitivity;

  tilt.targetX = clamp(-dg / sens, -1.6, 1.6);
  // Keep screen-"down" as baseline, then add forward/back lean
  tilt.targetY = clamp(1 + db / sens, -1.6, 1.6);
  lastSensorAt = performance.now();
}

function setTiltTargetsFromMotion(ax, ay) {
  // accelerationIncludingGravity — axis signs differ on iOS vs Android
  if (!calib.ready) {
    calib.ax = ax;
    calib.ay = ay;
    calib.ready = true;
  }

  const g = 9.81;
  // Android: +Y ≈ upright, X flipped to match lean direction
  // iOS:    Y is inverted vs Android for the same physical tilt
  let x = isIOS ? ax / g : -(ax / g);
  let y = isIOS ? -(ay / g) : ay / g;

  if (Math.hypot(ax / g, ay / g) < 0.15) {
    const dx = (ax - calib.ax) / g;
    const dy = (ay - calib.ay) / g;
    x = isIOS ? dx : -dx;
    y = isIOS ? 1 - dy : 1 + dy;
  }

  tilt.targetX = clamp(x * 1.15, -1.6, 1.6);
  tilt.targetY = clamp(y * 1.15, -1.6, 1.6);
  lastSensorAt = performance.now();
}

function setTiltTargetsFromPointer(clientX, clientY) {
  if (!params.useMouseTilt || usingDeviceTilt) return;
  const nx = (clientX / width) * 2 - 1;
  const ny = (clientY / height) * 2 - 1;
  tilt.targetX = clamp(nx * 1.2, -1.5, 1.5);
  tilt.targetY = clamp(ny * 1.2, -1.5, 1.5);
}

function updateGravity() {
  const s = params.tiltSmooth;
  tilt.x += (tilt.targetX - tilt.x) * s;
  tilt.y += (tilt.targetY - tilt.y) * s;

  if (usingDeviceTilt) {
    engine.gravity.x = tilt.x * params.tiltStrength;
    engine.gravity.y = tilt.y * params.tiltStrength;
    if (Math.hypot(engine.gravity.x, engine.gravity.y) < 0.2) {
      engine.gravity.y = params.baseGravity;
    }
  } else if (params.useMouseTilt) {
    engine.gravity.x = tilt.x * params.tiltStrength;
    engine.gravity.y =
      tilt.y * params.tiltStrength + params.baseGravity * 0.15;
  } else {
    engine.gravity.x = 0;
    engine.gravity.y = params.baseGravity;
  }
}

function applyAntiAlign() {
  if (!params.antiAlign) return;

  for (const shape of shapes) {
    if (shape.kind !== "square") continue;
    const { body } = shape;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > 0.8 || Math.abs(body.angularVelocity) > 0.1) continue;

    const quarter = Math.PI / 2;
    let a = body.angle % quarter;
    if (a < 0) a += quarter;
    const toFlat = Math.min(a, quarter - a);
    if (toFlat > 0.22) continue;

    const dir = a < Math.PI / 4 ? 1 : -1;
    Body.setAngularVelocity(
      body,
      body.angularVelocity + dir * params.antiAlignTorque
    );
  }
}

function drawShapes() {
  for (const shape of shapes) {
    const { body, kind, size } = shape;
    ctx.fillStyle = params.color;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    ctx.lineWidth = 1.5;

    if (kind === "circle") {
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }

    const verts = body.vertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawTiltIndicator() {
  if (!tiltEnabled && !usingDeviceTilt) return;

  const cx = width / 2;
  const cy = height / 2;
  const len = 36;
  const gx = engine.gravity.x;
  const gy = engine.gravity.y;
  const mag = Math.hypot(gx, gy) || 1;
  const nx = (gx / mag) * len;
  const ny = (gy / mag) * len;

  ctx.beginPath();
  ctx.strokeStyle = "rgba(17, 17, 17, 0.18)";
  ctx.lineWidth = 2;
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + nx, cy + ny);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = "rgba(17, 17, 17, 0.22)";
  ctx.arc(cx + nx, cy + ny, 4, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, width, height);
  drawTiltIndicator();
  drawShapes();
}

Events.on(engine, "beforeUpdate", () => {
  updateGravity();
  applyAntiAlign();
});

const runner = Runner.create();
Runner.run(runner, engine);

(function loop() {
  render();
  requestAnimationFrame(loop);
})();

function setStatus(text, active = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text;
  statusEl.dataset.active = active ? "true" : "false";
}

function onDeviceOrientation(e) {
  if (!usingDeviceTilt || preferMotion) return;
  if (e.beta == null && e.gamma == null) return;
  sensorMode = "orientation";
  setTiltTargetsFromOrientation(e.beta, e.gamma);
}

function onDeviceOrientationAbsolute(e) {
  if (!usingDeviceTilt || preferMotion) return;
  if (e.beta == null && e.gamma == null) return;
  sensorMode = "orientation";
  setTiltTargetsFromOrientation(e.beta, e.gamma);
}

function onDeviceMotion(e) {
  if (!usingDeviceTilt) return;
  const acc = e.accelerationIncludingGravity;
  if (!acc || (acc.x == null && acc.y == null)) return;

  // Android: accelerometer is the reliable source
  if (preferMotion) {
    sensorMode = "motion";
    setTiltTargetsFromMotion(acc.x || 0, acc.y || 0);
    return;
  }

  // iOS: orientation wins (motion Y is inverted vs Android and was
  // sending shapes to the top). Motion is only a fallback.
  if (sensorMode === "orientation") return;

  sensorMode = "motion";
  setTiltTargetsFromMotion(acc.x || 0, acc.y || 0);
}

function attachSensors() {
  window.addEventListener("deviceorientation", onDeviceOrientation);
  window.addEventListener(
    "deviceorientationabsolute",
    onDeviceOrientationAbsolute
  );
  window.addEventListener("devicemotion", onDeviceMotion);
}

async function enableTilt() {
  try {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        setStatus("Permission refusée — réessaie");
        return;
      }
    }

    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (_) {
        // iOS only; ignore on Android
      }
    }

    calib.ready = false;
    sensorMode = "none";
    lastSensorAt = 0;
    usingDeviceTilt = true;
    tiltEnabled = true;
    attachSensors();

    // Start with a calm downward gravity until first sensor sample
    tilt.targetX = 0;
    tilt.targetY = 1;
    tilt.x = 0;
    tilt.y = 1;

    enableBtn.hidden = true;
    hintEl.hidden = true;
    setStatus("Tilt actif — penche le téléphone", true);

    // If nothing arrives, tell the user (common when sensors are blocked)
    setTimeout(() => {
      if (usingDeviceTilt && performance.now() - lastSensorAt > 1500) {
        setStatus(
          "Pas de capteur — autorise le mouvement dans Chrome (icône cadenas)",
          false
        );
      }
    }, 1600);
  } catch (err) {
    setStatus("Tilt indisponible sur cet appareil");
    console.warn(err);
  }
}

enableBtn.addEventListener("click", enableTilt);

// Desktop / fallback: move pointer to lean gravity
canvas.addEventListener(
  "pointermove",
  (e) => {
    setTiltTargetsFromPointer(e.clientX, e.clientY);
    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener(
  "pointerdown",
  (e) => {
    canvas.setPointerCapture(e.pointerId);
    setTiltTargetsFromPointer(e.clientX, e.clientY);
    e.preventDefault();
  },
  { passive: false }
);

// If orientation exists and no iOS prompt needed, auto-hint
function initTiltUi() {
  const needsPermission =
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function";

  const hasOrientation = "DeviceOrientationEvent" in window;

  if (!hasOrientation) {
    enableBtn.hidden = true;
    hintEl.textContent =
      "Ouvre cette page sur mobile, ou déplace le curseur pour simuler le tilt";
    setStatus("Mode curseur (desktop)");
    tiltEnabled = true;
    return;
  }

  if (!needsPermission && isMobile) {
    // Android-like: can listen after interaction; still use the button for clarity
    hintEl.textContent = "Appuie pour activer le tilt, puis incline le téléphone";
  } else if (!isMobile) {
    hintEl.textContent =
      "Sur mobile: active le tilt. Sur desktop: déplace le curseur pour simuler.";
  }
}

let resizeTimer = null;
function onViewportChange() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    applyDeviceDefaults();
    resize();
    seedShapes();
  }, 150);
}

window.addEventListener("resize", onViewportChange);
window.visualViewport?.addEventListener("resize", onViewportChange);

function setupGUI() {
  const showDev =
    new URLSearchParams(window.location.search).has("dev") || !isMobile;
  if (!showDev) return;

  const gui = new GUI({ title: "Tilt Controls" });
  if (isMobile) gui.close();

  const shapesFolder = gui.addFolder("Shapes");
  shapesFolder
    .add(params, "shapeSize", 30, 160, 1)
    .name("Size")
    .onFinishChange(seedShapes);
  shapesFolder
    .add(params, "shapeCount", 3, 24, 1)
    .name("Count")
    .onFinishChange(seedShapes);
  shapesFolder
    .add(params, "circleRatio", 0, 1, 0.05)
    .name("Circle ratio")
    .onFinishChange(seedShapes);
  shapesFolder.addColor(params, "color").name("Color");

  const tiltFolder = gui.addFolder("Tilt");
  tiltFolder.add(params, "tiltStrength", 0.2, 4, 0.05).name("Tilt strength");
  tiltFolder.add(params, "tiltSensitivity", 8, 40, 1).name("Sensitivity");
  tiltFolder.add(params, "tiltSmooth", 0.02, 0.4, 0.01).name("Smoothing");
  tiltFolder.add(params, "baseGravity", 0, 2, 0.05).name("Base gravity");
  tiltFolder.add(params, "useMouseTilt").name("Mouse tilt (desktop)");
  tiltFolder
    .add(
      {
        recalibrate: () => {
          calib.ready = false;
          setStatus("Recalibré — penche depuis cette position", true);
        },
      },
      "recalibrate"
    )
    .name("Recalibrate");

  const physicsFolder = gui.addFolder("Physics");
  physicsFolder.add(params, "restitution", 0, 1, 0.01).name("Bounce");
  physicsFolder.add(params, "friction", 0, 1, 0.01).name("Friction");
  physicsFolder.add(params, "frictionAir", 0, 0.05, 0.001).name("Air");
  physicsFolder.add(params, "antiAlign").name("Anti-align");

  gui.add({ respawn: seedShapes }, "respawn").name("Respawn");

  shapesFolder.open();
  tiltFolder.open();
}

applyDeviceDefaults(true);
resize();
seedShapes();
initTiltUi();
setupGUI();
