import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

const listeners = {
  runtime: [],
  startup: [],
  installed: [],
  tabRemoved: [],
  tabUpdated: [],
};

const sandbox = {
  console,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  setTimeout,
  clearTimeout,
  URL,
  chrome: {
    runtime: {
      lastError: null,
      onInstalled: { addListener: (listener) => listeners.installed.push(listener) },
      onStartup: { addListener: (listener) => listeners.startup.push(listener) },
      onMessage: { addListener: (listener) => listeners.runtime.push(listener) },
    },
    tabs: {
      onRemoved: { addListener: (listener) => listeners.tabRemoved.push(listener) },
      onUpdated: {
        addListener: (listener) => listeners.tabUpdated.push(listener),
        removeListener: () => {},
      },
      get: () => {},
    },
    storage: {
      local: {
        get: (_keys, callback) => callback({}),
        set: (_state, callback) => callback(),
      },
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(
  `${backgroundSource}
globalThis.__batchTestExports = {
  EXTENSION_VERSION,
  BATCH_CANDIDATE_CAP,
  DEFAULT_BATCH_WAVE_PATTERN,
  normalizeBatchPayload,
  createBatchRun,
  takeNextBatchWave,
};
`,
  sandbox,
  { filename: "background.js" },
);

const {
  EXTENSION_VERSION,
  BATCH_CANDIDATE_CAP,
  DEFAULT_BATCH_WAVE_PATTERN,
  normalizeBatchPayload,
  createBatchRun,
  takeNextBatchWave,
} = sandbox.__batchTestExports;

const candidates = Array.from({ length: 15 }, (_value, index) => {
  const id = 9000 + index;
  return {
    trackingKey: `product:${id}`,
    url: `https://www.coupang.com/vp/products/${id}`,
    title: `Mac candidate ${id}`,
  };
});

const payload = normalizeBatchPayload({
  batchId: "clb_wave_test",
  requiredExtensionVersion: "0.3.1",
  wavePattern: [6, 5, 4],
  candidates,
});

assert.equal(EXTENSION_VERSION, "0.3.1");
assert.equal(BATCH_CANDIDATE_CAP, 15);
assert.deepEqual(Array.from(DEFAULT_BATCH_WAVE_PATTERN), [6, 5, 4]);
assert.equal(payload.candidates.length, 15);
assert.deepEqual(Array.from(payload.wavePattern), [6, 5, 4]);
assert.equal(payload.concurrency, 6);

const batchRun = createBatchRun(payload);
assert.deepEqual(Array.from(batchRun.status.wavePattern), [6, 5, 4]);
assert.equal(batchRun.status.currentWave, 0);
assert.equal(batchRun.status.waveCount, 0);

const waveSizes = [];
let wave = takeNextBatchWave(batchRun);
while (wave.length > 0) {
  waveSizes.push(wave.length);
  wave = takeNextBatchWave(batchRun);
}

assert.deepEqual(waveSizes, [6, 5, 4]);
assert.equal(batchRun.nextIndex, 15);
assert.equal(batchRun.nextWaveIndex, 3);
