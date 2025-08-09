import { l as logger } from "../chunks/logger-NYlRQaHN.js";
logger.info("Popup scaffold bundle loaded (inactive until manifest swap)");
function initScaffold() {
  try {
    logger.debug("Popup scaffold init start");
    const dbg = /\bdebug\b/i.test(location.search);
    if (dbg) logger.setLevel("debug");
    if (!document.getElementById("popup-scaffold-indicator")) {
      const badge = document.createElement("div");
      badge.id = "popup-scaffold-indicator";
      badge.textContent = "Popup Scaffold Active";
      badge.style.cssText = "position:fixed;bottom:4px;right:4px;font:11px/1 system-ui;padding:4px 6px;background:#2563eb;color:#fff;border-radius:4px;z-index:99999;opacity:0.85;";
      document.body.appendChild(badge);
      setTimeout(() => badge.remove(), 2500);
    }
    logger.debug("Popup scaffold init complete");
  } catch (e) {
    logger.error("Popup scaffold init failed", e instanceof Error ? { message: e.message, stack: e.stack } : e);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScaffold);
} else {
  initScaffold();
}
//# sourceMappingURL=index.js.map
