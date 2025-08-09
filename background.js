// Service worker for API calls to avoid popup CORS issues (MV3)
// Handles messages: { type: 'llmOrganize', provider: 'do'|'gemini', prompt }

const DO_ENDPOINT = 'https://inference.do-ai.run/v1/chat/completions';
const DO_MODEL = 'llama3.3-70b-instruct';
const GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEM_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'];

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Simple per-provider rate limiter (queue)
const rateState = {
  do: { intervalMs: 1200, chain: Promise.resolve(), nextAt: 0 },
  gemini: { intervalMs: 800, chain: Promise.resolve(), nextAt: 0 }
};
function schedule(provider, fn) {
  const state = rateState[provider];
  const now = Date.now();
  const waitMs = Math.max(0, state.nextAt - now);
  state.nextAt = Math.max(now, state.nextAt) + state.intervalMs;
  state.chain = state.chain.then(() => new Promise(res => setTimeout(res, waitMs))).then(fn);
  return state.chain;
}

async function limitedFetch(provider, url, options, timeoutMs, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      const res = await schedule(provider, () => fetchWithTimeout(url, options, timeoutMs));
      if (!res.ok && (res.status === 429 || res.status >= 500)) {
        if (attempt >= maxRetries) return res;
        const base = 700 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 300);
        await new Promise(r => setTimeout(r, base + jitter));
        attempt++;
        continue;
      }
      return res;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      const base = 700 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, base + jitter));
      attempt++;
    }
  }
}

async function doCall(prompt) {
  const { doApiKey } = await chrome.storage.local.get(['doApiKey']);
  if (!doApiKey) throw new Error('DO API key not set');
  const body = {
    model: DO_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1024
  };
  const res = await limitedFetch('do', DO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${doApiKey}` },
    body: JSON.stringify(body)
  }, 10000, 3);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DO ${res.status}: ${text}`);
  }
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Empty DO response');
  return out;
}

async function gemCall(prompt) {
  const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
  if (!geminiApiKey) throw new Error('Gemini API key not set');
  for (const model of GEM_MODELS) {
    const url = `${GEM_BASE}${model}:generateContent?key=${geminiApiKey}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'text/plain' }
    };
    try {
      const res = await limitedFetch('gemini', url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10000, 3);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini ${model} ${res.status}: ${text}`);
      }
      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (out) return out;
    } catch (e) {
      // try next model
    }
  }
  throw new Error('All Gemini attempts failed');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'llmOrganize') return;
  (async () => {
    try {
      if (msg.provider === 'do') {
        const out = await doCall(msg.prompt);
        sendResponse({ ok: true, text: out });
        return;
      }
      if (msg.provider === 'gemini') {
        const out = await gemCall(msg.prompt);
        sendResponse({ ok: true, text: out });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown provider' });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'Unknown error' });
    }
  })();
  return true; // async
});

// Handle download requests from sider
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'downloadText') return;
  (async () => {
    try {
      const blob = new Blob([msg.text || ''], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: msg.filename || 'webtext.txt', saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'download failed' });
    }
  })();
  return true;
});


