// Minimal toast bus: showToast() from anywhere; <Toast/> renders them.
const listeners = new Set();
export function onToast(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function showToast(message, type = "info") {
  const t = { id: Date.now() + Math.random(), message, type };
  listeners.forEach((fn) => fn(t));
}
