const levelPriority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};
let currentLevel = "info";
function setLogLevel(lvl) {
  currentLevel = lvl;
}
function emit(entry) {
  if (levelPriority[entry.level] < levelPriority[currentLevel]) return;
  const payload = { ...entry };
  switch (entry.level) {
    case "debug":
      console.debug("[EXT]", payload);
      break;
    case "info":
      console.info("[EXT]", payload);
      break;
    case "warn":
      console.warn("[EXT]", payload);
      break;
    case "error":
      console.error("[EXT]", payload);
      break;
  }
}
function log(level, msg, meta, code) {
  emit({
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    msg,
    meta,
    code
  });
}
const logger = {
  setLevel: setLogLevel,
  debug: (msg, meta, code) => log("debug", msg, meta, code),
  info: (msg, meta, code) => log("info", msg, meta, code),
  warn: (msg, meta, code) => log("warn", msg, meta, code),
  error: (msg, meta, code) => log("error", msg, meta, code)
};
try {
  if (typeof location !== "undefined" && /\bdebug\b/i.test(location.search)) {
    setLogLevel("debug");
  }
} catch {
}
export {
  logger as l
};
//# sourceMappingURL=logger-NYlRQaHN.js.map
