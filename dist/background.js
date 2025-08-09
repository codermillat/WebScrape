import { l as logger } from "./chunks/logger-NYlRQaHN.js";
logger.info("Background scaffold loaded (inactive until manifest swap)");
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if ("__ping" in msg && msg.__ping === "bg_scaffold") {
    sendResponse({ ok: true, scaffold: true, ts: Date.now() });
    return;
  }
  return false;
});
setTimeout(() => {
  logger.debug("Background scaffold idle checkpoint");
}, 2e3);
//# sourceMappingURL=background.js.map
