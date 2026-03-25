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
      gradient.addColorStop(0, "#050505");
      gradient.addColorStop(0.48, "#0d0d0e");
      gradient.addColorStop(1, "#141416");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const ringA = ctx.createRadialGradient(cx - (radius * 0.35), cy, 0, cx - (radius * 0.35), cy, radius * 0.82);
      ringA.addColorStop(0, "rgba(255, 255, 255, 0.14)");
      ringA.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = ringA;
      ctx.fillRect(0, 0, width, height);

      const ringB = ctx.createRadialGradient(cx + (radius * 0.34), cy, 0, cx + (radius * 0.34), cy, radius * 0.84);
      ringB.addColorStop(0, "rgba(180, 180, 180, 0.12)");
      ringB.addColorStop(1, "rgba(180, 180, 180, 0)");
      ctx.fillStyle = ringB;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#f8f8f8";
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
        const tone = 62 - (12 * Math.cos(angle));

        points.push({ x: px, y: py, angle, tone, node });
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

        ctx.strokeStyle = `hsla(0, 0%, ${point.tone}%, ${0.06 + point.node.alpha})`;
        ctx.lineWidth = 0.38 + (point.node.size * 0.34);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, pair.x, pair.y);
        ctx.stroke();
      }

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const next = points[(i + 1) % points.length];
        ctx.strokeStyle = `hsla(0, 0%, ${point.tone - 8}%, 0.12)`;
        ctx.lineWidth = 0.34;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }

      ctx.shadowColor = "rgba(255, 255, 255, 0.45)";
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
      centerGlow.addColorStop(0, "rgba(255, 255, 255, 0.12)");
      centerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
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
const podiumP1Name = document.getElementById("podiumP1Name");
const podiumP2Name = document.getElementById("podiumP2Name");
const podiumP3Name = document.getElementById("podiumP3Name");
const playerNameInput = document.getElementById("playerNameInput");
const addPlayerBtn = document.getElementById("addPlayerBtn");
const playerSelect = document.getElementById("playerSelect");
const saveTimeBtn = document.getElementById("saveTimeBtn");
const scoreStatus = document.getElementById("scoreStatus");
const wsStatusEl = document.getElementById("wsStatus");
const penaltyCountEl = document.getElementById("penaltyCount");
const penaltyTimeEl = document.getElementById("penaltyTime");
const raceStatusEl = document.getElementById("raceStatus");
const finalResultBox = document.getElementById("finalResultBox");
const resultRawTimeEl = document.getElementById("resultRawTime");
const resultPenaltySummaryEl = document.getElementById("resultPenaltySummary");
const resultFinalTimeEl = document.getElementById("resultFinalTime");

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
    const pickDigit = () => String(Math.floor(Math.random() * 10));
    const particleCount = window.innerWidth < 900 ? 160 : 240;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let frameId = null;
    let lastTs = 0;
    let running = false;
    let energy = 0.35;
    let flash = 0;
    let destroyed = false;

    const particles = Array.from({ length: particleCount }, () => ({
      digit: pickDigit(),
      theta: Math.random() * TAU,
      orbit: Math.random(),
      lane: (Math.random() * 2) - 1,
      size: 11 + (Math.random() * 16),
      speed: (0.00045 + (Math.random() * 0.001)) * (Math.random() < 0.9 ? 1 : -1),
      alpha: 0.16 + (Math.random() * 0.64),
      phase: Math.random() * TAU,
      warp: 0.6 + (Math.random() * 1.4),
    }));

    const drawRoundedRect = (x, y, w, h, radius) => {
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
      energy += (targetEnergy - energy) * 0.08;
      flash = Math.max(0, flash - (dt * 0.0045));

      context.clearRect(0, 0, width, height);

      context.save();
      drawRoundedRect(0.5, 0.5, width - 1, height - 1, Math.min(20, height * 0.24));
      context.clip();

      const mist = context.createRadialGradient(width * 0.22, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.74);
      mist.addColorStop(0, `rgba(255, 255, 255, ${0.06 + (flash * 0.1)})`);
      mist.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = mist;
      context.fillRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.53;
      const radiusX = width * 0.44;
      const radiusY = height * 0.34;
      const speedScale = reduceMotion ? 0.28 : 1;

      context.textAlign = "center";
      context.textBaseline = "middle";

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];
        particle.theta += particle.speed * dt * (0.5 + (energy * 1.2)) * speedScale;

        const swirl = particle.theta + (Math.sin((timeMs * 0.0011 * particle.warp) + particle.phase) * 0.18);
        const depth = (Math.cos(swirl + (particle.phase * 0.7)) + 1) * 0.5;
        const orbit = 0.28 + (particle.orbit * 0.78);
        const spread = 0.58 + (depth * 0.46);

        const x = cx + (Math.cos(swirl) * radiusX * orbit * spread);
        const y = cy
          + (Math.sin((swirl * 1.22) + (particle.phase * 0.32)) * radiusY * (0.42 + (particle.orbit * 0.72)))
          + (particle.lane * height * 0.09 * (1 - depth));

        const alpha = Math.min(1, particle.alpha * (0.2 + (depth * 0.82)) * (0.42 + (energy * 0.7)));
        if (alpha < 0.025) continue;

        const fontSize = particle.size * (0.58 + (depth * 0.9));
        context.globalAlpha = alpha;
        context.fillStyle = depth > 0.72 ? "#ffffff" : depth > 0.42 ? "#d2d2d2" : "#8f8f8f";
        context.font = `${fontSize.toFixed(2)}px "HelveticaNeueCustom", "Helvetica Neue", Arial, sans-serif`;
        context.fillText(particle.digit, x, y);

        if (Math.random() < (0.003 + (energy * 0.008))) {
          particle.digit = pickDigit();
        }
      }

      context.globalAlpha = 1;
      const beam = context.createLinearGradient(0, cy, width, cy);
      beam.addColorStop(0, "rgba(255, 255, 255, 0)");
      beam.addColorStop(0.5, `rgba(255, 255, 255, ${0.08 + (energy * 0.14)})`);
      beam.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.strokeStyle = beam;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(width * 0.08, cy);
      context.lineTo(width * 0.92, cy);
      context.stroke();

      context.restore();
      frameId = requestAnimationFrame(render);
    };

    const setRunning = (nextRunning) => {
      running = Boolean(nextRunning);
      timerDisplayFrame.classList.toggle("is-running", running);
      timerDisplayFrame.classList.toggle("is-paused", !running);
    };

    const reset = () => {
      running = false;
      flash = 1;
      lastTs = 0;

      particles.forEach((particle) => {
        particle.theta = Math.random() * TAU;
        particle.digit = pickDigit();
      });

      timerDisplayFrame.classList.remove("is-running");
      timerDisplayFrame.classList.add("is-paused");
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
    timerEl.textContent = "00:00.00";
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

  const renderScoreboard = () => {
    if (!scoreboardBody) return;
    scoreboardBody.innerHTML = "";

    const ranked = players
      .filter((player) => Number.isFinite(player.bestMs))
      .sort((a, b) => a.bestMs - b.bestMs);

    setPodiumNames(ranked);

    if (ranked.length === 0) {
      const row = document.createElement("tr");
      row.className = "results-row results-row--empty";
      row.innerHTML = `
        <td class="rank-cell"><span class="rank-badge">-</span></td>
        <td class="driver-cell">No score yet</td>
        <td class="time-cell">--:--.--</td>
      `;
      scoreboardBody.appendChild(row);
      return;
    }

    ranked.forEach((player, index) => {
      const row = document.createElement("tr");
      row.className = `results-row ${
        index === 0 ? "results-row--first" : index === 1 ? "results-row--second" : index === 2 ? "results-row--third" : ""
      }`.trim();
      row.innerHTML = `
        <td class="rank-cell"><span class="rank-badge">${index + 1}</span></td>
        <td class="driver-cell">${player.name}</td>
        <td class="time-cell">${formatTime(player.bestMs)}</td>
      `;
      scoreboardBody.appendChild(row);
    });
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
    setRaceStatus("Start command sent. Waiting for backend updates.");

    const sent = sendBackendMessage({ type: "arm" });
    if (!sent) {
      connectBackend();
    }
  });

  stopBtn.addEventListener("click", () => {
    stopFrontendTimer();
    sendBackendMessage({ type: "stop" });
    setRaceStatus("Frontend timer stopped.");
  });

  resetBtn.addEventListener("click", () => {
    resetFrontendTimer();
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

const slots = {
  back: { select: document.getElementById("backSelect"), video: document.getElementById("backVideo"), stream: null },
  front: { select: document.getElementById("frontSelect"), video: document.getElementById("frontVideo"), stream: null },
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
const INTRO_COMMAND_TIMEOUT_MS = 2500;
let frameSocket = null;
let frameReconnectTimeoutId = null;
let framePumpIntervalId = null;
let manualFrameSocketClose = false;
const frameCaptureCanvas = document.createElement("canvas");
const frameCaptureContext = frameCaptureCanvas.getContext("2d", { alpha: false });

const requestPythonIntroPlayback = () => {
  const payloadText = JSON.stringify({ type: "play_intro" });

  if (frameSocket && frameSocket.readyState === WebSocket.OPEN) {
    frameSocket.send(payloadText);
    return;
  }

  let introSocket;
  try {
    introSocket = new WebSocket(frameBackendUrl);
  } catch (error) {
    console.error("Could not create intro socket:", error);
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (introSocket && (
      introSocket.readyState === WebSocket.OPEN ||
      introSocket.readyState === WebSocket.CONNECTING
    )) {
      introSocket.close();
    }
  };

  introSocket.addEventListener("open", () => {
    introSocket.send(payloadText);
    finish();
  });

  introSocket.addEventListener("error", () => {
    finish();
  });

  window.setTimeout(() => {
    finish();
  }, INTRO_COMMAND_TIMEOUT_MS);
};

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
    updateStatus("Playing intro on Python and preparing camera sources...");
    requestPythonIntroPlayback();

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
      startSlot("top"),
    ]);

    const successCount = startResults.filter((result) => result.status === "fulfilled").length;
    refreshProgramFeed();

    if (successCount > 0) {
      startFramePump();
      updateStatus("Sources connected. Choose Prum iPhone 17 Pro or Screen / Window (FaceTime).");
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
  updateStatus("Enable Cameras, then choose Prum iPhone 17 Pro or Screen / Window (FaceTime).");
}

if (sourceSupported && enableCamsBtn && stopCamsBtn) {
  enableCamsBtn.addEventListener("click", () => {
    enableCameras();
  });

  stopCamsBtn.addEventListener("click", () => {
    stopAllCameras();
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
