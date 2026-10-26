import { LatestWorker } from "../worker-queue.js";
export const geometryQueue = new LatestWorker(
  new URL("../drawworker.js", import.meta.url),
);
const tasks = new Map();
export const drawError = () => [...tasks.values()].some((t) => t.error);
export function reportTask(key, busy, error = null) {
  tasks.set(key, { busy, error });
  const field = document.getElementById("draw-status");
  if (!field) return;
  const active = [...tasks.values()].some((t) => t.busy),
    failed = drawError();
  field.hidden = !active && !failed;
  document.getElementById("draw-message").textContent = failed
    ? "Could not calculate hand-placed supports. Please retry."
    : "Calculating hand-placed supports…";
  document.getElementById("draw-retry").hidden = !failed;
}

export const parkedDrawQueue = new LatestWorker(
  new URL("../drawworker.js", import.meta.url),
);
