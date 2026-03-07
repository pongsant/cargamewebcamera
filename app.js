import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const mount = document.getElementById("bg-canvas");

if (mount) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 20, 42);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const segments = window.innerWidth < 900 ? 110 : 150;
  const terrainGeometry = new THREE.PlaneGeometry(150, 150, segments, segments);
  terrainGeometry.rotateX(-Math.PI * 0.48);

  const terrainMaterial = new THREE.MeshBasicMaterial({
    color: 0x111111,
    wireframe: true,
    transparent: true,
    opacity: 0.2,
  });

  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.position.set(0, -8, 0);
  scene.add(terrain);

  const terrainBack = terrain.clone();
  terrainBack.material = terrainMaterial.clone();
  terrainBack.material.opacity = 0.08;
  terrainBack.position.set(0, -11, -10);
  terrainBack.scale.set(1.06, 1.06, 1.06);
  scene.add(terrainBack);

  const positions = terrainGeometry.attributes.position;
  const source = new Float32Array(positions.array);
  const sourceBack = new Float32Array(positions.array);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function animate(t) {
    const time = t * 0.00018;

    if (!reduceMotion) {
      const arr = positions.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = source[i];
        const z = source[i + 2];
        const waveA = Math.sin((x * 0.24) + (time * 3.4)) * 2.3;
        const waveB = Math.cos((z * 0.18) - (time * 2.6)) * 1.9;
        const waveC = Math.sin(((x + z) * 0.14) + (time * 1.9)) * 1.35;
        arr[i + 1] = source[i + 1] + waveA + waveB + waveC;
      }
      positions.needsUpdate = true;

      const backArr = terrainBack.geometry.attributes.position.array;
      for (let i = 0; i < backArr.length; i += 3) {
        const x = sourceBack[i];
        const z = sourceBack[i + 2];
        const waveA = Math.sin((x * 0.2) + (time * 2.7) + 1.2) * 1.7;
        const waveB = Math.cos((z * 0.16) - (time * 2.0) + 0.8) * 1.25;
        backArr[i + 1] = sourceBack[i + 1] + waveA + waveB;
      }
      terrainBack.geometry.attributes.position.needsUpdate = true;

      camera.position.x = Math.sin(time * 0.62) * 3.5;
      camera.position.y = 20 + Math.sin(time * 0.48) * 1.8;
      camera.position.z = 42 + Math.cos(time * 0.36) * 1.4;
      camera.lookAt(0, -4, 0);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  });
}

const timerEl = document.getElementById("timer");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");

if (timerEl && startBtn && stopBtn && resetBtn) {
  let startTime = 0;
  let elapsedBefore = 0;
  let rafId = null;

  const formatTime = (ms) => {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  };

  const update = () => {
    const now = performance.now();
    const elapsed = elapsedBefore + (now - startTime);
    timerEl.textContent = formatTime(elapsed);
    rafId = requestAnimationFrame(update);
  };

  startBtn.addEventListener("click", () => {
    if (rafId !== null) return;
    startTime = performance.now();
    rafId = requestAnimationFrame(update);
  });

  stopBtn.addEventListener("click", () => {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    elapsedBefore += performance.now() - startTime;
    timerEl.textContent = formatTime(elapsedBefore);
  });

  resetBtn.addEventListener("click", () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    startTime = 0;
    elapsedBefore = 0;
    timerEl.textContent = "00:00.00";
  });
}

const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");

const slots = {
  back: {
    select: document.getElementById("backSelect"),
    video: document.getElementById("backVideo"),
    stream: null,
  },
  front: {
    select: document.getElementById("frontSelect"),
    video: document.getElementById("frontVideo"),
    stream: null,
  },
  top: {
    select: document.getElementById("topSelect"),
    video: document.getElementById("topVideo"),
    stream: null,
  },
};

const cameraSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof navigator.mediaDevices.enumerateDevices === "function";

const updateStatus = (message) => {
  if (cameraStatus) cameraStatus.textContent = message;
};

const stopStream = (stream) => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const slotKey = programSelect.value;
  const selectedSlot = slots[slotKey];
  mainVideo.srcObject = selectedSlot ? selectedSlot.stream : null;
};

const listVideoDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
};

const fillSelectOptions = (select, devices) => {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    select.appendChild(option);
  });

  if (devices.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No camera found";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  if (previous && devices.some((device) => device.deviceId === previous)) {
    select.value = previous;
  }
};

const applyDefaultSelections = () => {
  const keys = ["back", "front", "top"];
  const used = new Set();

  keys.forEach((key) => {
    const select = slots[key].select;
    if (!select || !select.options.length || !select.options[0].value) return;

    let chosenIndex = 0;
    while (
      chosenIndex < select.options.length &&
      used.has(select.options[chosenIndex].value)
    ) {
      chosenIndex += 1;
    }
    if (chosenIndex >= select.options.length) chosenIndex = 0;
    select.value = select.options[chosenIndex].value;
    used.add(select.value);
  });
};

const startSlot = async (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || !slot.select.value) return;

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = Object.entries(slots).find(([key, current]) => {
    return (
      key !== slotKey &&
      current.select &&
      current.select.value === slot.select.value &&
      current.stream
    );
  });

  if (sameSourceSlot) {
    slot.stream = sameSourceSlot[1].stream.clone();
    slot.video.srcObject = slot.stream;
    slot.video.play().catch(() => {});
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: slot.select.value } },
    audio: false,
  });

  slot.stream = stream;
  slot.video.srcObject = stream;
  slot.video.play().catch(() => {});
};

const stopAllCameras = () => {
  Object.values(slots).forEach((slot) => {
    stopStream(slot.stream);
    slot.stream = null;
    if (slot.video) slot.video.srcObject = null;
  });
  if (mainVideo) mainVideo.srcObject = null;
  updateStatus("Cameras stopped.");
};

const enableCameras = async () => {
  if (!cameraSupported) {
    updateStatus("Camera API is not supported in this browser.");
    return;
  }

  try {
    updateStatus("Requesting camera permission...");
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    stopStream(tempStream);

    const devices = await listVideoDevices();
    fillSelectOptions(slots.back.select, devices);
    fillSelectOptions(slots.front.select, devices);
    fillSelectOptions(slots.top.select, devices);

    applyDefaultSelections();

    await startSlot("back");
    await startSlot("front");
    await startSlot("top");
    refreshProgramFeed();
    updateStatus("Cameras connected.");
  } catch (error) {
    updateStatus("Cannot access cameras. Allow camera permission and reload.");
    console.error(error);
  }
};

if (cameraSupported && enableCamsBtn && stopCamsBtn) {
  enableCamsBtn.addEventListener("click", () => {
    enableCameras();
  });

  stopCamsBtn.addEventListener("click", () => {
    stopAllCameras();
  });

  Object.entries(slots).forEach(([slotKey, slot]) => {
    if (!slot.select) return;
    slot.select.addEventListener("change", async () => {
      try {
        await startSlot(slotKey);
        refreshProgramFeed();
        updateStatus("Camera source updated.");
      } catch (error) {
        updateStatus("Failed to switch camera source.");
        console.error(error);
      }
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", refreshProgramFeed);
  }
} else if (cameraStatus) {
  updateStatus("Camera controls are unavailable in this browser.");
}
