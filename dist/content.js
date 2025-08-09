import { l as logger } from "./chunks/logger-NYlRQaHN.js";
logger.info("Content scaffold bundle loaded (inactive until manifest swap)");
(function bootstrap() {
  try {
    if (window.__contentScaffoldLoaded) {
      logger.debug("Content scaffold already loaded, skipping");
      return;
    }
    window.__contentScaffoldLoaded = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.__ping === "content_scaffold") {
        sendResponse({ ok: true, scaffold: true, ts: Date.now() });
        return;
      }
      return false;
    });
    const markId = "content-scaffold-indicator";
    if (!document.getElementById(markId)) {
      const chip = document.createElement("div");
      chip.id = markId;
      chip.textContent = "Content Scaffold Active";
      chip.style.cssText = "position:fixed;top:4px;left:4px;z-index:2147483647;font:11px system-ui;padding:3px 6px;background:#0f766e;color:#fff;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,.2);opacity:.9;";
      document.documentElement.appendChild(chip);
      setTimeout(() => chip.remove(), 2e3);
    }
    logger.debug("Content scaffold init complete");
  } catch (e) {
    logger.error("Content scaffold init failed", e instanceof Error ? { message: e.message, stack: e.stack } : e);
  }
})();
//# sourceMappingURL=content.js.map
