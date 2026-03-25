const START_GATE_KEY = "raceControlStarted";
const exitBtn = document.getElementById("exitBtn");

if (exitBtn) {
  exitBtn.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(START_GATE_KEY);
    } catch (error) {
      // Ignore storage errors and continue to start page.
    }
  });
}

const initTopBarScrollAnimation = () => {
  const topBar = document.querySelector(".top-bar");
  if (!topBar || !document.body.classList.contains("dashboard-mode")) return;

  let lastY = window.scrollY || 0;
  const update = () => {
    const currentY = window.scrollY || 0;
    document.body.classList.toggle("dashboard-scrolled", currentY > 8);
    document.body.classList.toggle("dashboard-scroll-down", currentY > lastY && currentY > 28);
    lastY = currentY;
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
};

initTopBarScrollAnimation();

const getBackendSocketUrl = () => {
  const backendProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const backendHost = window.location.hostname || "localhost";
  return `${backendProtocol}//${backendHost}:8765`;
};

const mount = document.getElementById("bg-canvas");

if (mount) {
  const TAU = Math.PI * 2;
  const canvas = document.createElement("canvas");
  canvas.className = "bg-particle-canvas";
  mount.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (ctx) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = 1;
    let width = 1;
    let height = 1;
    let frameId = null;
    let flowNodes = [];
    let stars = [];

    const createFlowNodes = (count) => (
      Array.from({ length: count }, (_, index) => ({
        baseAngle: (index / count) * TAU,
        phase: Math.random() * TAU,
        speed: 0.00006 + (Math.random() * 0.00012),
        radiusAmp: 0.06 + (Math.random() * 0.18),
        drift: 0.35 + (Math.random() * 1.15),
        bend: 0.25 + (Math.random() * 0.85),
        size: 0.65 + (Math.random() * 1.25),
        alpha: 0.05 + (Math.random() * 0.19),
      }))
    );

    const createStars = (count) => (
      Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 0.5 + (Math.random() * 1.6),
        alpha: 0.05 + (Math.random() * 0.2),
        speed: 0.0006 + (Math.random() * 0.0016),
        phase: Math.random() * TAU,
      }))
    );

    const setup = () => {
      const rect = mount.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      flowNodes = createFlowNodes(width < 900 ? 280 : 460);
      stars = createStars(width < 900 ? 180 : 320);
    };

    const drawBackdrop = (time) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const radius = Math.min(width, height) * 0.58;

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#FFFFFF");
      gradient.addColorStop(1, "#ADFF2F");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const ringA = ctx.createRadialGradient(cx - (radius * 0.35), cy, 0, cx - (radius * 0.35), cy, radius * 0.82);
      ringA.addColorStop(0, "rgba(188, 255, 0, 0.22)");
      ringA.addColorStop(1, "rgba(188, 255, 0, 0)");
      ctx.fillStyle = ringA;
      ctx.fillRect(0, 0, width, height);

      const ringB = ctx.createRadialGradient(cx + (radius * 0.34), cy, 0, cx + (radius * 0.34), cy, radius * 0.84);
      ringB.addColorStop(0, "rgba(255, 255, 255, 0.16)");
      ringB.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = ringB;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#ddff9a";
      for (let i = 0; i < stars.length; i += 1) {
        const star = stars[i];
        const twinkle = 0.3 + (0.7 * (0.5 + (0.5 * Math.sin((time * star.speed) + star.phase))));
        ctx.globalAlpha = star.alpha * twinkle;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
      ctx.globalAlpha = 1;
    };

    const animate = (timeMs) => {
      drawBackdrop(timeMs);

      const cx = width * 0.5;
      const cy = height * 0.52;
      const baseRadius = Math.min(width, height) * 0.36;
      const innerRadius = baseRadius * 0.22;
      const rotation = reduceMotion ? 0 : timeMs * 0.00005;
      const points = [];

      for (let i = 0; i < flowNodes.length; i += 1) {
        const node = flowNodes[i];
        const wobble = reduceMotion ? 0 : Math.sin((timeMs * node.speed) + node.phase) * 0.26 * node.drift;
        const angle = node.baseAngle + rotation + wobble;
        const radius = baseRadius * (0.8 + ((reduceMotion ? 0 : Math.sin((timeMs * node.speed * 1.7) + (node.phase * 1.3))) * node.radiusAmp));
        const px = cx + (Math.cos(angle) * radius);
        const py = cy + (Math.sin(angle) * radius * 0.88);

        points.push({ x: px, y: py, angle, node });
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const pairIndex = (i + Math.floor(points.length * 0.5)) % points.length;
        const pair = points[pairIndex];
        const bend = point.node.bend * innerRadius;

        const c1x = cx + (Math.cos(point.angle + (Math.PI * 0.5)) * bend);
        const c1y = cy + (Math.sin(point.angle + (Math.PI * 0.5)) * bend * 0.8);
        const c2x = cx + (Math.cos(pair.angle - (Math.PI * 0.5)) * bend);
        const c2y = cy + (Math.sin(pair.angle - (Math.PI * 0.5)) * bend * 0.8);

        ctx.strokeStyle = `rgba(173, 255, 47, ${0.06 + point.node.alpha})`;
        ctx.lineWidth = 0.38 + (point.node.size * 0.34);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, pair.x, pair.y);
        ctx.stroke();
      }

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const next = points[(i + 1) % points.length];
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 0.34;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }

      ctx.shadowColor = "rgba(188, 255, 0, 0.45)";
      ctx.shadowBlur = 5;
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const dotAlpha = 0.3 + (0.7 * (0.5 + (0.5 * Math.sin((timeMs * 0.0012) + point.node.phase))));
        ctx.fillStyle = `rgba(255, 255, 255, ${0.26 + (dotAlpha * 0.58)})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 0.7 + point.node.size * 0.55, 0, TAU);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.restore();

      const centerGlow = ctx.createRadialGradient(cx, cy, innerRadius * 0.2, cx, cy, innerRadius * 1.7);
      centerGlow.addColorStop(0, "rgba(188, 255, 0, 0.16)");
      centerGlow.addColorStop(1, "rgba(188, 255, 0, 0)");
      ctx.fillStyle = centerGlow;
      ctx.fillRect(0, 0, width, height);

      if (!reduceMotion) {
        frameId = requestAnimationFrame(animate);
      } else {
        // Keep one static render when reduced motion is requested.
        frameId = null;
      }
    };

    const reset = () => {
      setup();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (reduceMotion) {
        animate(0);
      } else {
        frameId = requestAnimationFrame(animate);
      }
    };

    reset();
    window.addEventListener("resize", reset, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      } else if (!document.hidden && frameId === null) {
        if (reduceMotion) {
          animate(0);
        } else {
          frameId = requestAnimationFrame(animate);
        }
      }
    });
  }
}

const timerEl = document.getElementById("timer");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const scoreboardBody = document.getElementById("scoreboardBody");
const scoreboardModalBody = document.getElementById("scoreboardModalBody");
const podiumP1Name = document.getElementById("podiumP1Name");
const podiumP2Name = document.getElementById("podiumP2Name");
const podiumP3Name = document.getElementById("podiumP3Name");
const playerNameInput = document.getElementById("playerNameInput");
const addPlayerBtn = document.getElementById("addPlayerBtn");
const playerSelect = document.getElementById("playerSelect");
const saveTimeBtn = document.getElementById("saveTimeBtn");
const moreResultsBtn = document.getElementById("moreResultsBtn");
const moreResultsModal = document.getElementById("moreResultsModal");
const closeMoreResultsBtn = document.getElementById("closeMoreResultsBtn");
const scoreStatus = document.getElementById("scoreStatus");
const wsStatusEl = document.getElementById("wsStatus");
const penaltyCountEl = document.getElementById("penaltyCount");
const penaltyTimeEl = document.getElementById("penaltyTime");
const raceStatusEl = document.getElementById("raceStatus");
const finalResultBox = document.getElementById("finalResultBox");
const resultRawTimeEl = document.getElementById("resultRawTime");
const resultPenaltySummaryEl = document.getElementById("resultPenaltySummary");
const resultFinalTimeEl = document.getElementById("resultFinalTime");

const setStartStopButtonsState = (startButton, stopButton, running) => {
  if (!startButton || !stopButton) return;
  const isRunning = Boolean(running);
  startButton.classList.toggle("btn-accent", !isRunning);
  stopButton.classList.toggle("btn-accent", isRunning);
  startButton.classList.toggle("is-active-control", !isRunning);
  stopButton.classList.toggle("is-active-control", isRunning);
};

if (timerEl && startBtn && stopBtn && resetBtn) {
  const backendUrl = getBackendSocketUrl();

  let startTime = 0;
  let elapsedBefore = 0;
  let timerRafId = null;
  let raceSocket = null;
  let reconnectTimeoutId = null;
  let manualSocketClose = false;
  let latestBackendResult = null;
  let latestPenaltyCount = 0;
  let latestPenaltyTime = 0;
  let pendingCommand = null;
  const players = [];
  const PREVIEW_RANK_LIMIT = 8;
  const TIMER_ZERO_TEXT = "00:00.00";
  const timerDisplayFrame = document.getElementById("timerDisplayFrame");
  const timerFxCanvas = document.getElementById("timerFxCanvas");

  const createNoopTimerFx = () => ({
    setRunning: () => {},
    reset: () => {},
    destroy: () => {},
  });

  const createTimerFieldEffect = () => {
    if (!timerDisplayFrame || !timerFxCanvas) return createNoopTimerFx();

    const context = timerFxCanvas.getContext("2d");
    if (!context) return createNoopTimerFx();

    const TAU = Math.PI * 2;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particleCount = window.innerWidth < 900 ? 180 : 280;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let frameId = null;
    let lastTs = 0;
    let running = false;
    let gathered = false;
    let focus = 0;
    let energy = 0.35;
    let flash = 0;
    let destroyed = false;

    const particles = Array.from({ length: particleCount }, () => ({
      progress: Math.random(),
      drift: (Math.random() < 0.5 ? -1 : 1) * (0.0002 + (Math.random() * 0.00036)),
      scatter: Math.random(),
      lane: (Math.random() * 2) - 1,
      size: 1.1 + (Math.random() * 2.4),
      alpha: 0.22 + (Math.random() * 0.68),
      phase: Math.random() * TAU,
      warp: 0.6 + (Math.random() * 1.4),
    }));

    const drawRoundedRectPath = (x, y, w, h, radius) => {
      const r = Math.max(0, Math.min(radius, Math.min(w, h) * 0.5));
      context.beginPath();
      context.moveTo(x + r, y);
      context.lineTo(x + w - r, y);
      context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h - r);
      context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      context.lineTo(x + r, y + h);
      context.quadraticCurveTo(x, y + h, x, y + h - r);
      context.lineTo(x, y + r);
      context.quadraticCurveTo(x, y, x + r, y);
      context.closePath();
    };

    const pointOnRoundedRect = (progress, inset, radius) => {
      const w = Math.max(4, width - (inset * 2));
      const h = Math.max(4, height - (inset * 2));
      const r = Math.max(1, Math.min(radius, Math.min(w, h) * 0.5));
      const straightH = Math.max(0, w - (2 * r));
      const straightV = Math.max(0, h - (2 * r));
      const arcLen = (Math.PI * 0.5) * r;
      const perimeter = (2 * straightH) + (2 * straightV) + (4 * arcLen);
      let cursor = ((progress % 1) + 1) % 1;
      cursor *= perimeter;

      if (cursor <= straightH) {
        return { x: inset + r + cursor, y: inset };
      }
      cursor -= straightH;

      if (cursor <= arcLen) {
        const angle = (-Math.PI * 0.5) + (cursor / r);
        return {
          x: inset + w - r + (Math.cos(angle) * r),
          y: inset + r + (Math.sin(angle) * r),
        };
      }
      cursor -= arcLen;

      if (cursor <= straightV) {
        return { x: inset + w, y: inset + r + cursor };
      }
      cursor -= straightV;

      if (cursor <= arcLen) {
        const angle = cursor / r;
        return {
          x: inset + w - r + (Math.cos(angle) * r),
          y: inset + h - r + (Math.sin(angle) * r),
        };
      }
      cursor -= arcLen;

      if (cursor <= straightH) {
        return { x: inset + w - r - cursor, y: inset + h };
      }
      cursor -= straightH;

      if (cursor <= arcLen) {
        const angle = (Math.PI * 0.5) + (cursor / r);
        return {
          x: inset + r + (Math.cos(angle) * r),
          y: inset + h - r + (Math.sin(angle) * r),
        };
      }
      cursor -= arcLen;

      if (cursor <= straightV) {
        return { x: inset, y: inset + h - r - cursor };
      }

      const angle = Math.PI + ((cursor - straightV) / r);
      return {
        x: inset + r + (Math.cos(angle) * r),
        y: inset + r + (Math.sin(angle) * r),
      };
    };

    const resize = () => {
      const rect = timerDisplayFrame.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      timerFxCanvas.width = Math.floor(width * dpr);
      timerFxCanvas.height = Math.floor(height * dpr);
      timerFxCanvas.style.width = `${width}px`;
      timerFxCanvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (timeMs) => {
      if (destroyed) return;

      const dt = lastTs ? Math.min(32, timeMs - lastTs) : 16;
      lastTs = timeMs;

      const targetEnergy = running ? 1 : 0.34;
      const targetFocus = gathered ? 1 : 0;
      energy += (targetEnergy - energy) * 0.08;
      focus += (targetFocus - focus) * 0.085;
      flash = Math.max(0, flash - (dt * 0.0045));

      context.clearRect(0, 0, width, height);

      const inset = Math.max(6, Math.min(16, height * 0.11));
      const rectWidth = Math.max(8, width - (inset * 2));
      const rectHeight = Math.max(8, height - (inset * 2));
      const cornerRadius = Math.min(16, rectHeight * 0.32, rectWidth * 0.32);

      const activeColor = "229, 57, 53";
      const activeStrength = running ? 1 : 0.56;

      context.strokeStyle = `rgba(${activeColor}, ${(0.16 + (focus * 0.18)) * activeStrength})`;
      context.lineWidth = 1.1 + (focus * 0.35);
      drawRoundedRectPath(inset, inset, rectWidth, rectHeight, cornerRadius);
      context.stroke();

      const pulseBand = context.createLinearGradient(0, height * 0.5, width, height * 0.5);
      pulseBand.addColorStop(0, `rgba(${activeColor}, 0)`);
      pulseBand.addColorStop(0.5, `rgba(${activeColor}, ${(0.16 + (focus * 0.22)) * activeStrength})`);
      pulseBand.addColorStop(1, `rgba(${activeColor}, 0)`);
      context.strokeStyle = pulseBand;
      context.lineWidth = 1.2 + (focus * 0.4);
      drawRoundedRectPath(
        inset + 0.4,
        inset + 0.4,
        Math.max(6, rectWidth - 0.8),
        Math.max(6, rectHeight - 0.8),
        Math.max(2, cornerRadius - 0.4),
      );
      context.stroke();

      const cx = width * 0.5;
      const cy = height * 0.5;
      const speedScale = reduceMotion ? 0.28 : 1;

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];
        particle.progress += particle.drift * dt * (0.54 + (energy * 0.92)) * speedScale;
        particle.progress = ((particle.progress % 1) + 1) % 1;

        const borderPoint = pointOnRoundedRect(
          particle.progress,
          inset + 1.5,
          Math.max(2, cornerRadius - 1.5),
        );

        const nxRaw = borderPoint.x - cx;
        const nyRaw = borderPoint.y - cy;
        const norm = Math.max(0.001, Math.hypot(nxRaw, nyRaw));
        const nx = nxRaw / norm;
        const ny = nyRaw / norm;

        const wave = Math.sin((timeMs * 0.00125 * particle.warp) + particle.phase);
        const farDistance = 14 + (particle.scatter * 36) + ((wave + 1) * 4.8);
        const nearDistance = 1 + (particle.scatter * 3.4);
        const distance = farDistance + ((nearDistance - farDistance) * focus);
        const laneDrift = (1 - focus) * particle.lane * 5.5;

        const x = borderPoint.x + (nx * distance) + (ny * laneDrift);
        const y = borderPoint.y + (ny * distance) - (nx * laneDrift);

        const alpha = Math.min(1, particle.alpha * (0.24 + (focus * 0.86)));
        if (alpha < 0.03) continue;

        const pulse = 0.76 + ((Math.sin((timeMs * 0.0042) + particle.phase) + 1) * 0.24);
        const radius = particle.size * (0.6 + (focus * 0.36)) * pulse;
        context.globalAlpha = alpha;
        context.fillStyle = running ? "#ff2a2a" : "#e53935";
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }

      if (flash > 0.01) {
        context.globalAlpha = Math.min(0.22, flash * 0.28);
        context.strokeStyle = running ? "rgba(255, 42, 42, 0.9)" : "rgba(229, 57, 53, 0.9)";
        context.lineWidth = 2;
        drawRoundedRectPath(
          inset + 1,
          inset + 1,
          Math.max(6, rectWidth - 2),
          Math.max(6, rectHeight - 2),
          Math.max(2, cornerRadius - 1),
        );
        context.stroke();
      }

      context.globalAlpha = 1;
      frameId = requestAnimationFrame(render);
    };

    const setRunning = (nextRunning) => {
      running = Boolean(nextRunning);
      if (running) {
        gathered = true;
        timerDisplayFrame.classList.remove("is-idle");
      }
      timerDisplayFrame.classList.toggle("is-running", running);
      timerDisplayFrame.classList.toggle("is-paused", !running);
    };

    const reset = () => {
      running = false;
      gathered = false;
      focus = 0;
      flash = 1;
      lastTs = 0;

      particles.forEach((particle) => {
        particle.progress = Math.random();
        particle.phase = Math.random() * TAU;
      });

      timerDisplayFrame.classList.remove("is-running");
      timerDisplayFrame.classList.add("is-paused");
      timerDisplayFrame.classList.add("is-idle");
      timerDisplayFrame.classList.remove("is-reset");
      // Trigger reset pulse animation on each reset click.
      void timerDisplayFrame.offsetWidth;
      timerDisplayFrame.classList.add("is-reset");
    };

    const destroy = () => {
      destroyed = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      window.removeEventListener("resize", resize);
    };

    resize();
    setRunning(false);
    frameId = requestAnimationFrame(render);
    window.addEventListener("resize", resize, { passive: true });

    return { setRunning, reset, destroy };
  };

  const timerFxController = createTimerFieldEffect();
  if (timerEl) timerEl.textContent = TIMER_ZERO_TEXT;
  setStartStopButtonsState(startBtn, stopBtn, false);

  const formatTime = (ms) => {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  };

  const formatSeconds = (seconds) => `${Number(seconds || 0).toFixed(2)}s`;

  const update = () => {
    const now = performance.now();
    const elapsed = elapsedBefore + (now - startTime);
    timerEl.textContent = formatTime(elapsed);
    timerRafId = requestAnimationFrame(update);
  };

  const getCurrentElapsed = () => {
    if (timerRafId === null) return elapsedBefore;
    return elapsedBefore + (performance.now() - startTime);
  };

  const startFrontendTimer = () => {
    if (timerRafId !== null) return;
    timerFxController.setRunning(true);
    timerEl.textContent = TIMER_ZERO_TEXT;
    startTime = performance.now();
    timerRafId = requestAnimationFrame(update);
  };

  const stopFrontendTimer = () => {
    if (timerRafId === null) {
      timerFxController.setRunning(false);
      return;
    }
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
    elapsedBefore += performance.now() - startTime;
    timerEl.textContent = formatTime(elapsedBefore);
    timerFxController.setRunning(false);
  };

  const resetFrontendTimer = () => {
    if (timerRafId !== null) {
      cancelAnimationFrame(timerRafId);
      timerRafId = null;
    }
    startTime = 0;
    elapsedBefore = 0;
    timerEl.textContent = TIMER_ZERO_TEXT;
    timerFxController.reset();
  };

  const setScoreStatus = (message) => {
    if (scoreStatus) scoreStatus.textContent = message;
  };

  const setRaceStatus = (message) => {
    if (raceStatusEl) raceStatusEl.textContent = message;
  };

  const setWsStatus = (message) => {
    if (wsStatusEl) wsStatusEl.textContent = message;
  };

  const updatePenaltyUi = (penaltyCount = 0, penaltyTime = 0) => {
    latestPenaltyCount = penaltyCount;
    latestPenaltyTime = penaltyTime;
    if (penaltyCountEl) penaltyCountEl.textContent = String(penaltyCount);
    if (penaltyTimeEl) penaltyTimeEl.textContent = formatSeconds(penaltyTime);
  };

  const hideFinalResult = () => {
    latestBackendResult = null;
    finalResultBox?.classList.add("is-hidden");
    if (resultRawTimeEl) resultRawTimeEl.textContent = "--";
    if (resultPenaltySummaryEl) resultPenaltySummaryEl.textContent = "--";
    if (resultFinalTimeEl) resultFinalTimeEl.textContent = "--";
  };

  const renderFinalResult = (payload) => {
    latestBackendResult = payload;
    if (resultRawTimeEl) resultRawTimeEl.textContent = formatSeconds(payload.rawTime);
    if (resultPenaltySummaryEl) {
      resultPenaltySummaryEl.textContent = `${payload.penaltyCount} × ${Number(payload.penaltySeconds || 0).toFixed(2)}s = ${formatSeconds(payload.penaltyTime)}`;
    }
    if (resultFinalTimeEl) resultFinalTimeEl.textContent = formatSeconds(payload.finalTime);
    finalResultBox?.classList.remove("is-hidden");
  };

  const renderPlayerOptions = () => {
    if (!playerSelect) return;
    playerSelect.innerHTML = "";

    if (players.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No player";
      playerSelect.appendChild(option);
      playerSelect.disabled = true;
      return;
    }

    playerSelect.disabled = false;
    players.forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      playerSelect.appendChild(option);
    });
  };

  const setPodiumNames = (rankedPlayers) => {
    if (podiumP1Name) podiumP1Name.textContent = rankedPlayers[0]?.name || "No Driver";
    if (podiumP2Name) podiumP2Name.textContent = rankedPlayers[1]?.name || "No Driver";
    if (podiumP3Name) podiumP3Name.textContent = rankedPlayers[2]?.name || "No Driver";
  };

  const setMoreModalOpen = (open) => {
    if (!moreResultsModal) return;
    moreResultsModal.classList.toggle("is-hidden", !open);
    moreResultsModal.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("modal-open", open);
  };

  const createEmptyScoreRow = () => {
    const row = document.createElement("tr");
    row.className = "results-row results-row--empty";
    row.innerHTML = `
      <td class="rank-cell"><span class="rank-badge">-</span></td>
      <td class="driver-cell">No score yet</td>
      <td class="time-cell">--:--.--</td>
    `;
    return row;
  };

  const createPlayerScoreRow = (player, index) => {
    const hasScore = Number.isFinite(player.bestMs);
    const row = document.createElement("tr");
    row.className = `results-row ${
      index === 0 ? "results-row--first" : index === 1 ? "results-row--second" : index === 2 ? "results-row--third" : ""
    }`.trim();
    row.innerHTML = `
      <td class="rank-cell"><span class="rank-badge">${index + 1}</span></td>
      <td class="driver-cell">${player.name}</td>
      <td class="time-cell">${hasScore ? formatTime(player.bestMs) : "--:--.--"}</td>
    `;
    if (!hasScore) row.classList.add("results-row--empty");
    return row;
  };

  const getScoredPlayers = () => (
    players
      .filter((player) => Number.isFinite(player.bestMs))
      .sort((a, b) => a.bestMs - b.bestMs)
  );

  const getRankedPlayers = () => {
    const scored = getScoredPlayers();
    const unscored = players
      .filter((player) => !Number.isFinite(player.bestMs))
      .sort((a, b) => a.name.localeCompare(b.name));

    return [...scored, ...unscored];
  };

  const renderScoreboard = () => {
    if (!scoreboardBody) return;
    scoreboardBody.innerHTML = "";
    if (scoreboardModalBody) scoreboardModalBody.innerHTML = "";

    const ranked = getRankedPlayers();
    const scored = getScoredPlayers();
    setPodiumNames(scored);

    if (players.length === 0) {
      scoreboardBody.appendChild(createEmptyScoreRow());
      if (scoreboardModalBody) scoreboardModalBody.appendChild(createEmptyScoreRow());
      if (moreResultsBtn) {
        moreResultsBtn.hidden = false;
        moreResultsBtn.textContent = "More";
      }
      return;
    }

    const preview = ranked.slice(0, PREVIEW_RANK_LIMIT);
    preview.forEach((player, index) => {
      scoreboardBody.appendChild(createPlayerScoreRow(player, index));
    });

    if (scoreboardModalBody) {
      ranked.forEach((player, index) => {
        scoreboardModalBody.appendChild(createPlayerScoreRow(player, index));
      });
    }

    if (moreResultsBtn) {
      const hasMoreRows = ranked.length > PREVIEW_RANK_LIMIT;
      moreResultsBtn.hidden = false;
      moreResultsBtn.textContent = hasMoreRows ? `More (${ranked.length - PREVIEW_RANK_LIMIT})` : "More";
    }
  };

  const addPlayer = () => {
    if (!playerNameInput) return;
    const name = playerNameInput.value.trim();

    if (!name) {
      setScoreStatus("Please enter a player name.");
      return;
    }

    const exists = players.some((player) => player.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setScoreStatus("Player name already exists.");
      return;
    }

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    players.push({ id, name, bestMs: Number.POSITIVE_INFINITY });
    playerNameInput.value = "";

    renderPlayerOptions();
    renderScoreboard();
    playerSelect.value = id;
    setScoreStatus(`Added player: ${name}`);
  };

  const getAuthoritativeMs = () => {
    if (latestBackendResult && Number.isFinite(latestBackendResult.finalMs)) {
      return latestBackendResult.finalMs;
    }
    return getCurrentElapsed();
  };

  const saveTimeForPlayer = () => {
    if (!playerSelect || !playerSelect.value) {
      setScoreStatus("Please add/select a player first.");
      return;
    }

    const player = players.find((item) => item.id === playerSelect.value);
    if (!player) {
      setScoreStatus("Player not found.");
      return;
    }

    const currentMs = getAuthoritativeMs();
    if (currentMs <= 0) {
      setScoreStatus("No result available yet.");
      return;
    }

    if (currentMs < player.bestMs) {
      player.bestMs = currentMs;
      if (latestBackendResult) {
        setScoreStatus(`Saved backend final result for ${player.name}: ${formatSeconds(latestBackendResult.finalTime)}`);
      } else {
        setScoreStatus(`Saved current timer for ${player.name}: ${formatTime(currentMs)}`);
      }
    } else {
      setScoreStatus(`${player.name} time ${formatTime(currentMs)} is slower than best ${formatTime(player.bestMs)}`);
    }

    renderScoreboard();
  };

  const sendBackendMessage = (payload) => {
    if (!raceSocket || raceSocket.readyState !== WebSocket.OPEN) {
      pendingCommand = payload;
      setRaceStatus("Backend socket is not connected yet. Command queued.");
      return false;
    }

    raceSocket.send(JSON.stringify(payload));
    pendingCommand = null;
    return true;
  };

  const applyBackendState = (payload) => {
    updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);

    const state = payload.state || "idle";
    if (state === "idle") {
      setRaceStatus("Backend idle. Press Start to begin a run.");
    } else if (state === "running") {
      setRaceStatus("Race running. Penalties are streamed from Python.");
    } else if (state === "finished") {
      setRaceStatus("Race finished. Final result received from backend.");
      stopFrontendTimer();
      renderFinalResult(payload);
    } else if (state === "stopped") {
      setRaceStatus("Race stopped by operator.");
      stopFrontendTimer();
    } else {
      setRaceStatus("Backend connected and waiting.");
    }
  };

  const handleSocketMessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === "state") {
        applyBackendState(payload);
        return;
      }

      if (payload.type === "penalty_update") {
        updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
        setRaceStatus(`Penalty updated: ${payload.penaltyCount} event(s).`);
        return;
      }

      if (payload.type === "final_result") {
        updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
        stopFrontendTimer();
        renderFinalResult(payload);
        setRaceStatus("Final result received from Python.");
        return;
      }

      if (payload.type === "status") {
        setRaceStatus(payload.message || "Backend status updated.");
        return;
      }

      if (payload.type === "error") {
        setRaceStatus(payload.message || "Backend reported an error.");
      }
    } catch (error) {
      console.error("Invalid backend payload:", error, event.data);
    }
  };

  const scheduleReconnect = () => {
    if (manualSocketClose || reconnectTimeoutId !== null) return;

    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null;
      connectBackend();
    }, 1500);
  };

  const connectBackend = () => {
    if (raceSocket && (raceSocket.readyState === WebSocket.OPEN || raceSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setWsStatus("Connecting…");
    raceSocket = new WebSocket(backendUrl);

    raceSocket.addEventListener("open", () => {
      setWsStatus("Connected");
      setRaceStatus("Backend connected. Ready to start.");
      if (pendingCommand) {
        raceSocket.send(JSON.stringify(pendingCommand));
        pendingCommand = null;
      }
    });

    raceSocket.addEventListener("message", handleSocketMessage);

    raceSocket.addEventListener("close", () => {
      setWsStatus("Disconnected");
      if (!manualSocketClose) {
        setRaceStatus("Backend disconnected. Retrying…");
        scheduleReconnect();
      }
    });

    raceSocket.addEventListener("error", (error) => {
      console.error("Race socket error:", error);
      setWsStatus("Connection error");
      setRaceStatus("Could not talk to Python backend.");
    });
  };

  startBtn.addEventListener("click", () => {
    hideFinalResult();
    updatePenaltyUi(0, 0);
    resetFrontendTimer();
    startFrontendTimer();
    setStartStopButtonsState(startBtn, stopBtn, true);
    setRaceStatus("Start command sent. Waiting for backend updates.");

    const sent = sendBackendMessage({ type: "arm" });
    if (!sent) {
      connectBackend();
    }
  });

  stopBtn.addEventListener("click", () => {
    stopFrontendTimer();
    setStartStopButtonsState(startBtn, stopBtn, false);
    sendBackendMessage({ type: "stop" });
    setRaceStatus("Frontend timer stopped.");
  });

  resetBtn.addEventListener("click", () => {
    resetFrontendTimer();
    setStartStopButtonsState(startBtn, stopBtn, false);
    updatePenaltyUi(0, 0);
    hideFinalResult();
    sendBackendMessage({ type: "reset" });
    setRaceStatus("Run reset.");
  });

  addPlayerBtn?.addEventListener("click", addPlayer);

  playerNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPlayer();
  });

  saveTimeBtn?.addEventListener("click", saveTimeForPlayer);

  moreResultsBtn?.addEventListener("click", () => {
    setMoreModalOpen(true);
  });

  closeMoreResultsBtn?.addEventListener("click", () => {
    setMoreModalOpen(false);
  });

  moreResultsModal?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-close-modal='true']")) {
      setMoreModalOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMoreModalOpen(false);
  });

  window.addEventListener("beforeunload", () => {
    manualSocketClose = true;
    timerFxController.destroy();
    if (reconnectTimeoutId !== null) {
      window.clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (raceSocket && raceSocket.readyState === WebSocket.OPEN) {
      raceSocket.close();
    }
  });

  renderPlayerOptions();
  renderScoreboard();
  hideFinalResult();
  updatePenaltyUi(0, 0);
  connectBackend();
}

const SCREEN_SOURCE_ID = "__screen_share__";
const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");
const frameStreamStatusEl = document.getElementById("frameStreamStatus");
const frontPreviewVideo = document.getElementById("frontVideo") || mainVideo;

const slots = {
  back: { select: document.getElementById("backSelect"), video: document.getElementById("backVideo"), stream: null },
  front: { select: document.getElementById("frontSelect"), video: frontPreviewVideo, stream: null },
  top: { select: document.getElementById("topSelect"), video: document.getElementById("topVideo"), stream: null },
};

const cameraSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof navigator.mediaDevices.enumerateDevices === "function";
const screenShareSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getDisplayMedia === "function";
const sourceSupported = cameraSupported || screenShareSupported;
let localVideoDevices = [];

const frameBackendUrl = getBackendSocketUrl();
const FRAME_STREAM_FPS = 8;
const FRAME_STREAM_QUALITY = 0.6;
const FRAME_STREAM_MAX_WIDTH = 640;
const FRAME_STREAM_RECONNECT_MS = 1500;
let frameSocket = null;
let frameReconnectTimeoutId = null;
let framePumpIntervalId = null;
let manualFrameSocketClose = false;
const frameCaptureCanvas = document.createElement("canvas");
const frameCaptureContext = frameCaptureCanvas.getContext("2d", { alpha: false });

const FRONT_LABEL_HINTS = [
  "iphone",
  "front",
  "continuity",
  "ios",
  "phone",
];

const TOP_LABEL_HINTS = [
  "logitech",
  "webcam",
  "usb",
  "brio",
  "c920",
  "c922",
  "c930",
];

const SLOT_DEVICE_PREFERENCES = {
  front: [
    "prum iphone 17 pro",
    "iphone 17 pro",
    "prum iphone",
    "continuity camera",
    "continuity",
    "iphone",
  ],
  top: [
    "prum iphone 17 pro",
    "iphone 17 pro",
    "prum iphone",
    "continuity camera",
    "continuity",
    "iphone",
    "iphone 14 pro",
  ],
};

const SLOT_DISPLAY_PREFERENCES = {
  front: {
    displayName: "Prum iPhone 17 Pro",
    missingValue: "__missing_front_iphone_17_pro__",
  },
};

const setFrameStreamStatus = (message) => {
  if (frameStreamStatusEl) frameStreamStatusEl.textContent = message;
};

const updateStatus = (message) => {
  if (cameraStatus) cameraStatus.textContent = message;
};

const stopStream = (stream) => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

const setSlotStream = (slotKey, stream) => {
  const slot = slots[slotKey];
  if (!slot) return;
  slot.stream = stream;
  if (slot.video) {
    slot.video.srcObject = stream;
    slot.video.play().catch(() => {});
  }
};

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const selected = slots[programSelect.value];
  mainVideo.srcObject = selected ? selected.stream : null;
  if (selected?.stream) mainVideo.play().catch(() => {});
};

const normalizeDeviceLabel = (label) => (
  (label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
);

const compactDeviceLabel = (label) => normalizeDeviceLabel(label).replace(/\s+/g, "");

const matchesPreferredModel = (slotKey, label) => {
  const normalized = normalizeDeviceLabel(label);
  const compactNormalized = compactDeviceLabel(label);
  if (!normalized) return false;

  const preferredModels = SLOT_DEVICE_PREFERENCES[slotKey] || [];
  return preferredModels.some((modelHint) => {
    const normalizedHint = normalizeDeviceLabel(modelHint);
    const compactHint = compactDeviceLabel(modelHint);
    return normalized.includes(normalizedHint) || compactNormalized.includes(compactHint);
  });
};

const isMissingPreferenceValue = (slotKey, value) => {
  const missingValue = SLOT_DISPLAY_PREFERENCES[slotKey]?.missingValue;
  return Boolean(missingValue) && value === missingValue;
};

const getPreferenceScore = (slotKey, label) => {
  const normalized = normalizeDeviceLabel(label);
  if (!normalized) return 0;

  if (matchesPreferredModel(slotKey, label)) return 100;

  if (slotKey === "front") {
    let score = 0;
    FRONT_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 2;
    });
    if (normalized.includes("14 pro")) score -= 10;
    if (normalized.includes("built in") || normalized.includes("builtin")) score -= 2;
    if (normalized.includes("macbook") || normalized.includes("mac")) score -= 1;
    if (normalized.includes("back") || normalized.includes("rear")) score -= 3;
    return score;
  }

  if (slotKey === "top") {
    let score = 0;
    FRONT_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 2;
    });
    TOP_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 1;
    });
    if (normalized.includes("built in") || normalized.includes("builtin")) score -= 2;
    if (normalized.includes("macbook") || normalized.includes("mac")) score -= 1;
    return score;
  }

  return 0;
};

const listVideoDevices = async () => {
  if (!cameraSupported) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
};

const addScreenShareEndedHandler = (stream) => {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return;

  videoTrack.addEventListener("ended", () => {
    Object.values(slots).forEach((slot) => {
      if (slot.select?.value === SCREEN_SOURCE_ID) {
        stopStream(slot.stream);
        slot.stream = null;
        if (slot.video) slot.video.srcObject = null;
      }
    });
    refreshProgramFeed();
    updateStatus("FaceTime screen share ended. Choose Screen / Window again to resume.");
  }, { once: true });
};

const fillSelectOptions = (select, devices, slotKey) => {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";

  const displayPreference = SLOT_DISPLAY_PREFERENCES[slotKey];
  const preferredDevice = displayPreference
    ? devices.find((device) => matchesPreferredModel(slotKey, device.label))
    : null;

  if (displayPreference && !preferredDevice) {
    const missingOption = document.createElement("option");
    missingOption.value = displayPreference.missingValue;
    missingOption.textContent = `${displayPreference.displayName} (connect this phone)`;
    select.appendChild(missingOption);
  }

  if (screenShareSupported) {
    const screenOption = document.createElement("option");
    screenOption.value = SCREEN_SOURCE_ID;
    screenOption.textContent = "Screen / Window (FaceTime)";
    select.appendChild(screenOption);
  }

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    if (displayPreference && preferredDevice && preferredDevice.deviceId === device.deviceId) {
      option.textContent = displayPreference.displayName;
    } else {
      option.textContent = device.label || `Camera ${index + 1}`;
    }
    select.appendChild(option);
  });

  if (devices.length === 0 && !screenShareSupported) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No source found";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  if (previous && Array.from(select.options).some((option) => option.value === previous && !option.disabled)) {
    select.value = previous;
  }
};

const findBestOptionIndex = (select, slotKey) => {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < select.options.length; i += 1) {
    const option = select.options[i];
    const value = option.value;
    if (
      !value ||
      value === SCREEN_SOURCE_ID ||
      isMissingPreferenceValue(slotKey, value) ||
      option.disabled
    ) continue;

    const score = getPreferenceScore(slotKey, option.textContent);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
};

const applyDefaultSelections = () => {
  const keys = ["front", "top", "back"];

  keys.forEach((key) => {
    const select = slots[key].select;
    if (!select || !select.options.length || !select.options[0].value) return;

    const currentValue = select.value;
    if (
      currentValue &&
      Array.from(select.options).some((option) => option.value === currentValue && !option.disabled)
    ) {
      return;
    }

    let chosenIndex = findBestOptionIndex(select, key);

    if (chosenIndex === -1) {
      for (let i = 0; i < select.options.length; i += 1) {
        const value = select.options[i].value;
        if (
          !value ||
          value === SCREEN_SOURCE_ID ||
          isMissingPreferenceValue(key, value) ||
          select.options[i].disabled
        ) continue;
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex === -1) {
      for (let i = 0; i < select.options.length; i += 1) {
        const value = select.options[i].value;
        if (!value || select.options[i].disabled) continue;
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex === -1) chosenIndex = 0;

    select.value = select.options[chosenIndex].value;
  });
};

const refreshSourceOptions = () => {
  fillSelectOptions(slots.back.select, localVideoDevices, "back");
  fillSelectOptions(slots.front.select, localVideoDevices, "front");
  fillSelectOptions(slots.top.select, localVideoDevices, "top");
  applyDefaultSelections();
};

const getMatchingSourceSlot = (slotKey, sourceValue) => Object.entries(slots).find(([key, current]) => (
  key !== slotKey &&
  current.select &&
  current.select.value === sourceValue &&
  current.stream
));

const findPreferredDeviceId = (slotKey) => {
  const directMatch = localVideoDevices.find((device) => matchesPreferredModel(slotKey, device.label));
  if (directMatch) return directMatch.deviceId;

  const fallback = localVideoDevices
    .filter((device) => getPreferenceScore(slotKey, device.label) > 0)
    .sort((a, b) => getPreferenceScore(slotKey, b.label) - getPreferenceScore(slotKey, a.label))[0];
  return fallback?.deviceId || "";
};

const startScreenShareSlot = (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || slot.select.value !== SCREEN_SOURCE_ID) {
    return Promise.resolve();
  }

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = getMatchingSourceSlot(slotKey, SCREEN_SOURCE_ID);
  if (sameSourceSlot) {
    setSlotStream(slotKey, sameSourceSlot[1].stream.clone());
    return Promise.resolve();
  }

  if (!screenShareSupported) {
    return Promise.reject(new Error("Screen sharing is not supported in this browser."));
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  }).then((stream) => {
    addScreenShareEndedHandler(stream);
    setSlotStream(slotKey, stream);
  });
};

const startSlot = async (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || !slot.select.value) return;

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = getMatchingSourceSlot(slotKey, slot.select.value);
  if (sameSourceSlot) {
    setSlotStream(slotKey, sameSourceSlot[1].stream.clone());
    return;
  }

  if (slot.select.value === SCREEN_SOURCE_ID) {
    await startScreenShareSlot(slotKey);
    return;
  }

  const resolvedDeviceId = isMissingPreferenceValue(slotKey, slot.select.value)
    ? findPreferredDeviceId(slotKey)
    : slot.select.value;

  if (!resolvedDeviceId) {
    throw new Error(`${SLOT_DISPLAY_PREFERENCES[slotKey]?.displayName || "Preferred camera"} is not available yet.`);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: resolvedDeviceId } },
    audio: false,
  });

  setSlotStream(slotKey, stream);
};

const scheduleFrameReconnect = () => {
  if (manualFrameSocketClose || framePumpIntervalId === null || frameReconnectTimeoutId !== null) return;

  setFrameStreamStatus("Reconnecting…");
  frameReconnectTimeoutId = window.setTimeout(() => {
    frameReconnectTimeoutId = null;
    connectFrameSocket();
  }, FRAME_STREAM_RECONNECT_MS);
};

const connectFrameSocket = () => {
  if (frameSocket && (frameSocket.readyState === WebSocket.OPEN || frameSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  frameSocket = new WebSocket(frameBackendUrl);

  frameSocket.addEventListener("open", () => {
    setFrameStreamStatus("Connected");
  });

  frameSocket.addEventListener("error", (error) => {
    setFrameStreamStatus("Error");
    console.error("Frame socket error:", error);
  });

  frameSocket.addEventListener("close", () => {
    frameSocket = null;
    if (manualFrameSocketClose) {
      setFrameStreamStatus("Stopped");
      return;
    }
    scheduleFrameReconnect();
  });
};

const stopFramePump = () => {
  if (framePumpIntervalId !== null) {
    window.clearInterval(framePumpIntervalId);
    framePumpIntervalId = null;
  }
};

const closeFrameSocket = () => {
  manualFrameSocketClose = true;
  stopFramePump();

  if (frameReconnectTimeoutId !== null) {
    window.clearTimeout(frameReconnectTimeoutId);
    frameReconnectTimeoutId = null;
  }

  if (frameSocket && (frameSocket.readyState === WebSocket.OPEN || frameSocket.readyState === WebSocket.CONNECTING)) {
    frameSocket.close();
  }
  frameSocket = null;
  setFrameStreamStatus("Stopped");
};

const getBackendFrameSource = () => {
  if (slots.front.stream && slots.front.video) return slots.front;

  if (programSelect) {
    const selectedSlot = slots[programSelect.value];
    if (selectedSlot && selectedSlot.stream && selectedSlot.video) return selectedSlot;
  }

  return Object.values(slots).find((slot) => slot.stream && slot.video) || null;
};

const sendFrameToBackend = () => {
  if (!frameCaptureContext) return;
  if (!frameSocket || frameSocket.readyState !== WebSocket.OPEN) return;

  const sourceSlot = getBackendFrameSource();
  if (!sourceSlot || !sourceSlot.video) return;

  const sourceVideo = sourceSlot.video;
  if (
    sourceVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    sourceVideo.videoWidth < 2 ||
    sourceVideo.videoHeight < 2
  ) return;

  let targetWidth = sourceVideo.videoWidth;
  let targetHeight = sourceVideo.videoHeight;

  if (targetWidth > FRAME_STREAM_MAX_WIDTH) {
    const scale = FRAME_STREAM_MAX_WIDTH / targetWidth;
    targetWidth = FRAME_STREAM_MAX_WIDTH;
    targetHeight = Math.max(2, Math.round(targetHeight * scale));
  }

  if (frameCaptureCanvas.width !== targetWidth || frameCaptureCanvas.height !== targetHeight) {
    frameCaptureCanvas.width = targetWidth;
    frameCaptureCanvas.height = targetHeight;
  }

  frameCaptureContext.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
  const dataUrl = frameCaptureCanvas.toDataURL("image/jpeg", FRAME_STREAM_QUALITY);
  const imageData = dataUrl.split(",", 2)[1];
  if (!imageData) return;
  const sourceLabel = sourceSlot.select?.selectedOptions?.[0]?.textContent?.trim()
    || (sourceSlot === slots.front ? "Prum iPhone 17 Pro" : "Camera Source");

  frameSocket.send(JSON.stringify({
    type: "frame",
    image: imageData,
    width: targetWidth,
    height: targetHeight,
    source: sourceSlot === slots.front ? "front" : (programSelect?.value || "auto"),
    sourceLabel,
    timestamp: Date.now(),
  }));
};

const startFramePump = () => {
  manualFrameSocketClose = false;
  setFrameStreamStatus("Connecting…");
  connectFrameSocket();

  if (framePumpIntervalId !== null) return;
  framePumpIntervalId = window.setInterval(sendFrameToBackend, Math.round(1000 / FRAME_STREAM_FPS));
};

const stopAllCameras = () => {
  Object.values(slots).forEach((slot) => {
    stopStream(slot.stream);
    slot.stream = null;
    if (slot.video) slot.video.srcObject = null;
  });

  if (mainVideo) mainVideo.srcObject = null;
  closeFrameSocket();
  updateStatus("Cameras stopped.");
};

const enableCameras = async () => {
  if (!sourceSupported) {
    updateStatus("Camera and screen-share APIs are not supported in this browser.");
    return;
  }

  try {
    updateStatus("Preparing camera sources...");

    if (cameraSupported) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stopStream(tempStream);
      } catch (permissionError) {
        // Continue with available sources such as screen share.
      }
    }

    localVideoDevices = await listVideoDevices();
    refreshSourceOptions();

    const startResults = await Promise.allSettled([
      startSlot("front"),
    ]);

    const successCount = startResults.filter((result) => result.status === "fulfilled").length;
    refreshProgramFeed();

    if (successCount > 0) {
      startFramePump();
      updateStatus("Prum iPhone 17 Pro connected. Main screen is live.");
    } else if (screenShareSupported) {
      stopFramePump();
      updateStatus("No camera started yet. Choose Screen / Window (FaceTime) to show your FaceTime call.");
    } else {
      stopFramePump();
      updateStatus("No camera sources available. Check browser permissions and connected devices.");
    }
  } catch (error) {
    closeFrameSocket();
    updateStatus("Cannot initialize sources. Check browser permissions and reload.");
    console.error(error);
  }
};

setFrameStreamStatus("Waiting…");
if (cameraStatus) {
  updateStatus("");
}

if (sourceSupported && enableCamsBtn && stopCamsBtn) {
  setStartStopButtonsState(enableCamsBtn, stopCamsBtn, false);

  enableCamsBtn.addEventListener("click", () => {
    setStartStopButtonsState(enableCamsBtn, stopCamsBtn, true);
    enableCameras();
  });

  stopCamsBtn.addEventListener("click", () => {
    stopAllCameras();
    setStartStopButtonsState(enableCamsBtn, stopCamsBtn, false);
  });

  Object.entries(slots).forEach(([slotKey, slot]) => {
    if (!slot.select) return;

    slot.select.addEventListener("change", () => {
      if (slot.select.value === SCREEN_SOURCE_ID) {
        updateStatus("Choose your FaceTime window in the share prompt.");
        startScreenShareSlot(slotKey)
          .then(() => {
            refreshProgramFeed();
            startFramePump();
            updateStatus("FaceTime screen share connected. Python detection feed updated.");
          })
          .catch((error) => {
            updateStatus("Screen share was canceled or blocked.");
            console.error(error);
          });
        return;
      }

      (async () => {
        try {
          await startSlot(slotKey);
          refreshProgramFeed();
          startFramePump();
          updateStatus("Camera source updated. Python detection feed updated.");
        } catch (error) {
          updateStatus(error.message || "Failed to switch camera source.");
          console.error(error);
        }
      })();
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", () => {
      refreshProgramFeed();
    });
  }

  window.addEventListener("beforeunload", () => {
    closeFrameSocket();
  });
} else if (cameraStatus) {
  updateStatus("Camera controls are unavailable in this browser.");
}
