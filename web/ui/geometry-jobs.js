import { LatestWorker } from '../worker-queue.js';
export const geometryJobs = new LatestWorker(new URL('../drawworker.js', import.meta.url));
export const hardwareHints = () => ({
  cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory,
});

// Watch actual event-loop delay only while jobs run in a visible page. A hidden
// tab's throttled timers are not evidence of CPU overload.
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(), delay = now - lastTick;
  lastTick = now;
  if (geometryJobs.active) {
    geometryJobs.control({ restricted: document.hidden || delay > 350 });
  }
}, 250);
document.addEventListener('visibilitychange', () => {
  lastTick = performance.now();
  geometryJobs.control({ restricted: document.hidden });
});
addEventListener('pagehide', () => geometryJobs.dispose());
