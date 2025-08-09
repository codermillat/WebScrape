/**
 * Background service worker bootstrap (Phase 2 scaffold).
 * NOTE: Manifest still points to legacy background.js until migration completes.
 */
import { logger } from '../shared/logger';

logger.info('Background scaffold loaded (inactive until manifest swap)');

type BgScaffoldPing = { __ping: 'bg_scaffold' };

type AnyMessage = BgScaffoldPing | Record<string, unknown>;

chrome.runtime.onMessage.addListener((
  msg: AnyMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean | void => {
  if (!msg || typeof msg !== 'object') return;
  if ('__ping' in msg && (msg as BgScaffoldPing).__ping === 'bg_scaffold') {
    sendResponse({ ok: true, scaffold: true, ts: Date.now() });
    return;
  }
  // Return false (no async response) for unhandled messages
  return false;
});

// Graceful idle log (service worker may terminate earlier)
setTimeout(() => {
  logger.debug('Background scaffold idle checkpoint');
}, 2000);
