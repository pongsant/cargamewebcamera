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
    elapsedBefore =
      elapsedBefore + (performance.now() - startTime);
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
