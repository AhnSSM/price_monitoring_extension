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

const scheduledDelays = [];
const createdTabs = [];
const recordSetTimeout = (handler, ms, ...rest) => {
  const numericMs = Number(ms);
  if (Number.isFinite(numericMs)) {
    scheduledDelays.push(numericMs);
  }
  return setTimeout(handler, ms, ...rest);
};
const getScheduledDelaysForTest = () => scheduledDelays.slice();
const resetScheduledDelaysForTest = () => { scheduledDelays.length = 0; };
const getCreatedTabsForTest = () => createdTabs.slice();
const resetCreatedTabsForTest = () => { createdTabs.length = 0; };
const sandbox = {
  console,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  setTimeout: recordSetTimeout,
  clearTimeout,
  URL,
  Math,
  JSON,
  Date,
  Promise,
  Map,
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
      create: (createProperties, callback) => {
        createdTabs.push(createProperties);
        callback({ id: 9000 + createdTabs.length });
      },
      get: (_tabId, callback) => { if (typeof callback === "function") callback({ id: _tabId, status: "complete" }); },
      remove: (_tabId, callback) => { if (typeof callback === "function") callback(); },
      sendMessage: () => {
        throw new Error("stop_payload_retry_for_test");
      },
    },
    storage: {
      local: {
        get: (_keys, callback) => callback({}),
        set: (_state, callback) => callback(),
      },
    },
  },
};

sandbox.getScheduledDelaysForTest = getScheduledDelaysForTest;
sandbox.resetScheduledDelaysForTest = resetScheduledDelaysForTest;
sandbox.getCreatedTabsForTest = getCreatedTabsForTest;
sandbox.resetCreatedTabsForTest = resetCreatedTabsForTest;

vm.createContext(sandbox);
vm.runInContext(
  `${backgroundSource}
globalThis.__batchTestExports = {
  EXTENSION_VERSION,
  BATCH_CANDIDATE_CAP,
  DEFAULT_BATCH_ROUND_SIZE_MIN,
  DEFAULT_BATCH_ROUND_SIZE_MAX,
  LEGACY_BATCH_WAVE_PATTERN,
  MAX_BATCH_ROUND_SIZE,
  DEFAULT_WAVE_SLEEP_MIN_SECONDS,
  DEFAULT_WAVE_SLEEP_MAX_SECONDS,
  DEFAULT_STOP_ON_BLOCK,
  DEFAULT_BLOCK_STOP_THRESHOLD,
  normalizeBatchPayload,
  createBatchRun,
  handleCurrentListBatchStart,
  takeNextBatchWave,
  randomRoundSize,
  randomDelaySeconds,
  detectBlockedResponse,
  shouldStopBatch,
  buildInterWaveDelaySeconds,
  markUnstartedItemsSkipped,
  setActiveBatchRunForTest: (batchRun) => { activeBatchRun = batchRun; },
  buildTabOpenDelaySeconds,
  processBatchRound,
  processBatchItem,
};
`,
  sandbox,
  { filename: "background.js" },
);

const {
  EXTENSION_VERSION,
  BATCH_CANDIDATE_CAP,
  DEFAULT_BATCH_ROUND_SIZE_MIN,
  DEFAULT_BATCH_ROUND_SIZE_MAX,
  LEGACY_BATCH_WAVE_PATTERN,
  MAX_BATCH_ROUND_SIZE,
  DEFAULT_WAVE_SLEEP_MIN_SECONDS,
  DEFAULT_WAVE_SLEEP_MAX_SECONDS,
  DEFAULT_STOP_ON_BLOCK,
  DEFAULT_BLOCK_STOP_THRESHOLD,
  normalizeBatchPayload,
  createBatchRun,
  handleCurrentListBatchStart,
  takeNextBatchWave,
  randomRoundSize,
  randomDelaySeconds,
  detectBlockedResponse,
  shouldStopBatch,
  buildInterWaveDelaySeconds,
  markUnstartedItemsSkipped,
  setActiveBatchRunForTest,
  buildTabOpenDelaySeconds,
  processBatchRound,
} = sandbox.__batchTestExports;

// === Version, cap, and defaults ===
assert.equal(EXTENSION_VERSION, "0.3.5");
assert.equal(BATCH_CANDIDATE_CAP, 30);
assert.equal(DEFAULT_BATCH_ROUND_SIZE_MIN, 5);
assert.equal(DEFAULT_BATCH_ROUND_SIZE_MAX, 10);
assert.deepEqual(Array.from(LEGACY_BATCH_WAVE_PATTERN), [6, 5, 4]);
assert.equal(MAX_BATCH_ROUND_SIZE, 30);
assert.equal(DEFAULT_WAVE_SLEEP_MIN_SECONDS, 10);
assert.equal(DEFAULT_WAVE_SLEEP_MAX_SECONDS, 30);
assert.equal(DEFAULT_STOP_ON_BLOCK, true);
assert.equal(DEFAULT_BLOCK_STOP_THRESHOLD, 1);

// === Cap at 30 candidates with random 5-10 round sizes ===
const candidates = Array.from({ length: 30 }, (_value, index) => {
  const id = 9000 + index;
  return {
    trackingKey: `product:${id}`,
    url: `https://www.coupang.com/vp/products/${id}`,
    title: `Mac candidate ${id}`,
  };
});

const payload = normalizeBatchPayload({
  batchId: "clb_wave_v033",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 5,
  roundSizeMax: 10,
  roundSizeMode: "random",
  waveSleepMinSeconds: 10,
  waveSleepMaxSeconds: 30,
  stopOnBlock: true,
  blockStopThreshold: 1,
  candidates,
});

assert.equal(payload.candidates.length, 30);
assert.equal(payload.roundSize.min, 5);
assert.equal(payload.roundSize.max, 10);
assert.equal(payload.roundSize.mode, "random");
assert.equal(payload.waveSleepMinSeconds, 10);
assert.equal(payload.waveSleepMaxSeconds, 30);
assert.equal(payload.stopOnBlock, true);
assert.equal(payload.blockStopThreshold, 1);
assert.ok(!Object.prototype.hasOwnProperty.call(payload, "wavePattern"),
  "v0.3.5 payload should not expose wavePattern");
assert.ok(!Object.prototype.hasOwnProperty.call(payload, "concurrency"),
  "v0.3.5 payload should not expose concurrency");

const batchRun = createBatchRun(payload);
assert.equal(batchRun.status.currentRound, 0);
assert.equal(batchRun.status.roundCount, 0);
assert.equal(batchRun.status.lastRoundSize, 0);
assert.equal(batchRun.status.nextWaveDelaySeconds, 0);
assert.equal(batchRun.status.stopReason, "");
assert.equal(batchRun.status.skipped, 0);
assert.equal(batchRun.status.blocked, 0);
assert.equal(batchRun.roundSize.min, 5);
assert.equal(batchRun.roundSize.max, 10);
assert.ok(!Object.prototype.hasOwnProperty.call(batchRun, "wavePattern"),
  "batchRun should not keep wavePattern");
assert.ok(!Object.prototype.hasOwnProperty.call(batchRun, "nextWaveIndex"),
  "batchRun should not keep nextWaveIndex");

// === Random round sizes for many runs: every non-final round is in [5, 10], all 30 items consumed ===
const SAMPLE_RUNS = 50;
for (let run = 0; run < SAMPLE_RUNS; run += 1) {
  const sample = createBatchRun(payload);
  const roundSizes = [];
  let totalOpened = 0;
  let wave = takeNextBatchWave(sample);
  while (wave.length > 0) {
    roundSizes.push(wave.length);
    totalOpened += wave.length;
    wave = takeNextBatchWave(sample);
  }
  for (let i = 0; i < roundSizes.length - 1; i += 1) {
    assert.ok(
      roundSizes[i] >= 5 && roundSizes[i] <= 10,
      `non-final round size ${roundSizes[i]} out of [5,10]`
    );
  }
  assert.ok(
    roundSizes[roundSizes.length - 1] >= 1 && roundSizes[roundSizes.length - 1] <= 10,
    `final round size ${roundSizes[roundSizes.length - 1]} must clamp to remaining (<=10)`,
  );
  assert.equal(totalOpened, 30, "all 30 candidates must be consumed");
  assert.ok(roundSizes[roundSizes.length - 1] >= 1, "last round must be at least 1");
  assert.equal(sample.nextIndex, 30);
  assert.equal(sample.status.roundCount, roundSizes.length);
  assert.equal(sample.status.currentRound, roundSizes.length);
  assert.equal(sample.status.lastRoundSize, roundSizes[roundSizes.length - 1] || 0);
}

// === Default to 5-10 when server omits roundSizeMin/Max/Mode ===
const defaultsPayload = normalizeBatchPayload({
  batchId: "clb_wave_v033_defaults",
  requiredExtensionVersion: "0.3.5",
  candidates,
});
assert.equal(defaultsPayload.roundSize.min, 5);
assert.equal(defaultsPayload.roundSize.max, 10);
assert.equal(defaultsPayload.roundSize.mode, "random");

// === snake_case aliases accepted ===
const snakePayload = normalizeBatchPayload({
  batchId: "clb_wave_v033_snake",
  requiredExtensionVersion: "0.3.5",
  round_size_min: 6,
  round_size_max: 9,
  round_size_mode: "random",
  wave_sleep_min_seconds: 11,
  wave_sleep_max_seconds: 27,
  candidates,
});
assert.equal(snakePayload.roundSize.min, 6);
assert.equal(snakePayload.roundSize.max, 9);
assert.equal(snakePayload.waveSleepMinSeconds, 11);
assert.equal(snakePayload.waveSleepMaxSeconds, 27);

// === Impossible range normalization: max < min, min < 1, max > cap ===
const invertedPayload = normalizeBatchPayload({
  batchId: "clb_wave_v033_inverted",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 20,
  roundSizeMax: 8,
  candidates,
});
// When max < min, the spec is to set max = min so the single point is the min value.
assert.equal(invertedPayload.roundSize.max, invertedPayload.roundSize.min,
  "max<min must clamp max=min");

const zeroMinPayload = normalizeBatchPayload({
  batchId: "clb_wave_v033_zero",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 0,
  roundSizeMax: 12,
  candidates,
});
assert.equal(zeroMinPayload.roundSize.min, 5, "min<1 must fall back to default 5");
assert.equal(zeroMinPayload.roundSize.max, 12);

const overCapPayload = normalizeBatchPayload({
  batchId: "clb_wave_v033_overcap",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 5,
  roundSizeMax: 100,
  candidates,
});
assert.equal(overCapPayload.roundSize.max, BATCH_CANDIDATE_CAP,
  "max must clamp to candidate cap (30)");

// === Candidate cap still enforced: 31 candidates must be rejected ===
const overflow = Array.from({ length: 31 }, (_value, index) => ({
  trackingKey: `product:${9500 + index}`,
  url: `https://www.coupang.com/vp/products/${9500 + index}`,
  title: `Mac overflow ${9500 + index}`,
}));
assert.throws(
  () => normalizeBatchPayload({
    batchId: "clb_overflow",
    requiredExtensionVersion: "0.3.5",
    roundSizeMin: 5,
    roundSizeMax: 10,
    candidates: overflow,
  }),
  /최대 30개/,
);

// === Last round clamps to remaining when small candidate set is supplied ===
const smallCandidates = Array.from({ length: 7 }, (_value, index) => ({
  trackingKey: `product:${9700 + index}`,
  url: `https://www.coupang.com/vp/products/${9700 + index}`,
  title: `Mac small ${9700 + index}`,
}));
const smallPayload = normalizeBatchPayload({
  batchId: "clb_small",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 5,
  roundSizeMax: 10,
  candidates: smallCandidates,
});
const smallRun = createBatchRun(smallPayload);
const smallSizes = [];
let smallWave = takeNextBatchWave(smallRun);
while (smallWave.length > 0) {
  smallSizes.push(smallWave.length);
  smallWave = takeNextBatchWave(smallRun);
}
// First round is random in [5, 10] — for 7 candidates it must be exactly the first 5..7
// window because that's all the remaining at that point. We accept any value in [5, 7].
assert.ok(smallSizes[0] >= 5 && smallSizes[0] <= 7, `first round ${smallSizes[0]} out of [5,7]`);
assert.equal(smallSizes.reduce((a, b) => a + b, 0), 7);
assert.ok(smallSizes.length === 1 || smallSizes.length === 2,
  "small candidate set should be processed in 1 or 2 rounds");
if (smallSizes.length === 2) {
  assert.equal(smallSizes[1], 7 - smallSizes[0],
    "second round must clamp to remaining after the first round");
}
assert.equal(smallRun.status.lastRoundSize, smallSizes[smallSizes.length - 1]);

// === randomRoundSize bounds check ===
for (let i = 0; i < 200; i += 1) {
  const size = randomRoundSize({ min: 5, max: 10 });
  assert.ok(Number.isInteger(size));
  assert.ok(size >= 5 && size <= 10, `randomRoundSize ${size} out of bounds`);
}
for (let i = 0; i < 50; i += 1) {
  const size = randomRoundSize({ min: 7, max: 7 });
  assert.equal(size, 7);
}

// === Legacy mode: explicit mode=legacy + wavePattern returns deterministic pattern ===
const legacyPayload = normalizeBatchPayload({
  batchId: "clb_legacy",
  requiredExtensionVersion: "0.3.5",
  roundSizeMode: "legacy",
  wavePattern: [6, 5, 4],
  candidates,
});
assert.equal(legacyPayload.roundSize.mode, "legacy");
assert.deepEqual(legacyPayload.roundSize.legacyPattern, [6, 5, 4]);
assert.equal(legacyPayload.roundSize.min, 6);
assert.equal(legacyPayload.roundSize.max, 4);
const legacyRun = createBatchRun(legacyPayload);
const legacySizes = [];
let legacyWave = takeNextBatchWave(legacyRun);
while (legacyWave.length > 0) {
  legacySizes.push(legacyWave.length);
  legacyWave = takeNextBatchWave(legacyRun);
}
assert.deepEqual(legacySizes, [6, 5, 4, 6, 5, 4]);

// === Random delay bounds: 10-30 inclusive, no sleep after final wave ===
for (let i = 0; i < 200; i += 1) {
  const delay = buildInterWaveDelaySeconds({ waveSleepMinSeconds: 10, waveSleepMaxSeconds: 30 });
  assert.ok(Number.isInteger(delay), "delay should be integer");
  assert.ok(delay >= 10 && delay <= 30, `delay ${delay} out of bounds`);
}

assert.equal(buildInterWaveDelaySeconds({ waveSleepMinSeconds: 5, waveSleepMaxSeconds: 5 }), 5);

const inverted = buildInterWaveDelaySeconds({ waveSleepMinSeconds: 30, waveSleepMaxSeconds: 10 });
assert.equal(inverted, 30, "max<min should clamp to max=min");

// === Block detection: status, errorCode, and HTTP 403/429/503 ===
assert.equal(detectBlockedResponse({ responseBody: { status: "blocked_or_captcha" } }), true);
assert.equal(detectBlockedResponse({ responseBody: { result_status: "blocked_or_captcha" } }), true);
assert.equal(detectBlockedResponse({ responseBody: { result: { status: "blocked_or_captcha" } } }), true);
assert.equal(detectBlockedResponse({ responseStatus: "blocked_or_captcha" }), true);
assert.equal(detectBlockedResponse({ errorCode: "blocked_or_captcha" }), true);
assert.equal(detectBlockedResponse({ statusCode: 403 }), true);
assert.equal(detectBlockedResponse({ statusCode: 429 }), true);
assert.equal(detectBlockedResponse({ statusCode: 503 }), true);
assert.equal(detectBlockedResponse({ responseBody: { status: "saved" }, statusCode: 200 }), false);
assert.equal(detectBlockedResponse({ responseBody: { status: "queued" }, statusCode: 200 }), false);

// === Stop threshold and skipped marking ===
const stopRun = createBatchRun(payload);
const stopWave = takeNextBatchWave(stopRun);
assert.ok(stopWave.length >= 5 && stopWave.length <= 10);
const stopWaveLen = stopWave.length;
// markUnstartedItemsSkipped only flips items that are still "pending". Two items in the
// stopped wave were already moved to success/failure, so 2 of stopWaveLen stay non-pending.
const remainingPendingInStopWave = stopWaveLen - 2;
const remainingOutsideStopWave = 30 - stopWaveLen;
const expectedSkipped = remainingOutsideStopWave + remainingPendingInStopWave;

stopWave[0].status = "success";
stopWave[1].status = "failure";
stopWave[1].errorCode = "blocked_or_captcha";
stopWave[1].statusCode = 403;
for (let i = 2; i < stopWave.length; i += 1) {
  stopWave[i].status = "pending";
}

assert.equal(shouldStopBatch(stopRun, { stopOnBlock: true, blockStopThreshold: 1 }), true);
assert.equal(shouldStopBatch(stopRun, { stopOnBlock: false, blockStopThreshold: 1 }), false);

stopRun.status.state = "stopped";
stopRun.status.stopReason = "blocked_or_captcha";
const skippedCount = markUnstartedItemsSkipped(stopRun, "차단 감지로 미실행");
assert.equal(skippedCount, expectedSkipped);
assert.equal(stopRun.status.skipped, expectedSkipped);
assert.equal(stopRun.items.filter((item) => item.status === "skipped").length, expectedSkipped);

// === Skipped state must not count as blocked and must surface in summary ===
assert.equal(stopRun.status.blocked, 1);
const summary = stopRun.status.summary;
assert.ok(Object.prototype.hasOwnProperty.call(summary, "skipped"), "summary should include skipped");
assert.equal(summary.skipped, expectedSkipped);
assert.equal(summary.success, 1);
assert.equal(summary.failure, 1);
assert.equal(summary.pending, 0);

// === Active batch lock must reject a new start while waiting between rounds ===
const waitingRun = createBatchRun(payload);
waitingRun.status.state = "waiting";
waitingRun.status.nextWaveDelaySeconds = 18;
setActiveBatchRunForTest(waitingRun);
const secondStart = await handleCurrentListBatchStart({
  ...payload,
  batchId: "clb_should_be_rejected",
});
assert.equal(secondStart.ok, false);
assert.equal(secondStart.errorCode, "batch_already_running");
assert.equal(secondStart.batchStatus.state, "waiting");
assert.ok(!Object.prototype.hasOwnProperty.call(secondStart, "wavePattern"),
  "lock response should not expose wavePattern");
setActiveBatchRunForTest(null);


// === v0.3.5: buildTabOpenDelaySeconds continuous random within [min, max] ===
for (let i = 0; i < 200; i += 1) {
  const delay = buildTabOpenDelaySeconds({ tabOpenDelayMinSeconds: 0.3, tabOpenDelayMaxSeconds: 1.0 });
  assert.ok(typeof delay === "number", "delay should be a number");
  assert.ok(delay >= 0.3 && delay <= 1.0, `delay ${delay} out of bounds [0.3, 1.0]`);
  assert.equal(Number.isInteger(delay), false, "delay should be a continuous (non-integer) value");
}
assert.equal(buildTabOpenDelaySeconds({ tabOpenDelayMinSeconds: 0.5, tabOpenDelayMaxSeconds: 0.5 }), 0.5);
assert.equal(buildTabOpenDelaySeconds({ tabOpenDelayMinSeconds: 1.0, tabOpenDelayMaxSeconds: 0.3 }), 1.0,
  "max<min must clamp to min");
{
  const samples = Array.from({ length: 50 }, () =>
    buildTabOpenDelaySeconds({ tabOpenDelayMinSeconds: -5, tabOpenDelayMaxSeconds: 10 }));
  for (const sample of samples) {
    assert.ok(sample >= 0.3 && sample <= 5.0001, `negative min sample ${sample} out of normalized bounds`);
  }
  // normalized min should be the default 0.3, normalized max should be capped to 5.0
  assert.ok(samples.every((s) => s <= 5.0), "normalized max should cap to 5.0");
}
assert.equal(buildTabOpenDelaySeconds({ tabOpenDelayMinSeconds: 10, tabOpenDelayMaxSeconds: 10 }), 10,
  "min==max should return the bound regardless of cap");

// === v0.3.5: payload exposes tabOpenDelayMinSeconds / tabOpenDelayMaxSeconds ===
assert.equal(payload.tabOpenDelayMinSeconds, 0.3);
assert.equal(payload.tabOpenDelayMaxSeconds, 1.0);

const snakeDelayPayload = normalizeBatchPayload({
  batchId: "clb_snake",
  requiredExtensionVersion: "0.3.5",
  tab_open_delay_min_seconds: 0.4,
  tab_open_delay_max_seconds: 0.9,
  candidates,
});
assert.equal(snakeDelayPayload.tabOpenDelayMinSeconds, 0.4);
assert.equal(snakeDelayPayload.tabOpenDelayMaxSeconds, 0.9);

const clampedDelayPayload = normalizeBatchPayload({
  batchId: "clb_clamp",
  requiredExtensionVersion: "0.3.5",
  tabOpenDelayMinSeconds: 2.0,
  tabOpenDelayMaxSeconds: 0.5,
  candidates,
});
assert.equal(clampedDelayPayload.tabOpenDelayMinSeconds, 2.0);
assert.equal(clampedDelayPayload.tabOpenDelayMaxSeconds, 2.0, "max<min must clamp to min");

const cappedDelayPayload = normalizeBatchPayload({
  batchId: "clb_cap",
  requiredExtensionVersion: "0.3.5",
  tabOpenDelayMinSeconds: 0.1,
  tabOpenDelayMaxSeconds: 30,
  candidates,
});
assert.equal(cappedDelayPayload.tabOpenDelayMinSeconds, 0.3,
  "invalid min below default floor must fall back to 0.3");
assert.ok(cappedDelayPayload.tabOpenDelayMaxSeconds <= 5.0001, "excessive max must be capped");

// === v0.3.5: batchRun.status carries tab open delay fields and nextTabOpenDelaySeconds ===
assert.equal(batchRun.status.tabOpenDelayMinSeconds, 0.3);
assert.equal(batchRun.status.tabOpenDelayMaxSeconds, 1.0);
assert.ok(Object.prototype.hasOwnProperty.call(batchRun.status, "nextTabOpenDelaySeconds"),
  "status should expose nextTabOpenDelaySeconds");
assert.equal(batchRun.status.nextTabOpenDelaySeconds, 0);

// === v0.3.5: processBatchRound opens tabs one-by-one with random ms delay (300-1000) ===
const staggerPayload = normalizeBatchPayload({
  batchId: "clb_stagger",
  requiredExtensionVersion: "0.3.5",
  roundSizeMin: 5,
  roundSizeMax: 5,
  tabOpenDelayMinSeconds: 0.3,
  tabOpenDelayMaxSeconds: 1.0,
  candidates: Array.from({ length: 5 }, (_v, idx) => ({
    trackingKey: `product:stagger_${idx}`,
    url: `https://www.coupang.com/vp/products/stagger_${idx}`,
    title: `Stagger ${idx}`,
  })),
});
const staggerRun = createBatchRun(staggerPayload);

resetScheduledDelaysForTest();
resetCreatedTabsForTest();
const waveItems = takeNextBatchWave(staggerRun);

// Stub fetch so postImport fails fast and the item transitions through catch->finally.
sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

await processBatchRound(staggerRun, waveItems);

// For 5 items we expect 4 inter-tab delays, each 300-1000 ms.
// requestPayloadWithRetry internally schedules retry timers (1500ms / 30000ms),
// so we filter scheduledDelays to the stagger range.
const interDelays = getScheduledDelaysForTest().filter((ms) => ms >= 300 && ms <= 1000);
assert.equal(interDelays.length, 4,
  `expected 4 inter-tab delays for 5 items, got ${interDelays.length}: ${JSON.stringify(interDelays)}`);
for (const ms of interDelays) {
  assert.ok(ms >= 300 && ms <= 1000, `inter-tab delay ${ms}ms out of [300, 1000]`);
}
assert.equal(getCreatedTabsForTest().length, 5,
  "processBatchRound should have created 5 tabs (one per item) before returning");
// processBatchRound resets nextTabOpenDelaySeconds to 0 once the round finishes.
assert.equal(staggerRun.status.nextTabOpenDelaySeconds, 0,
  "status.nextTabOpenDelaySeconds should reset to 0 after the round completes");

// Note: processBatchRound itself does not schedule a 10-30s inter-wave delay;
// runBatch owns the inter-wave sleep. We do not assert on background
// 30000ms timers here because waitForTabComplete and requestPayloadWithRetry
// both register their own timeout timers, which are part of the normal
// per-item timeout policy and are not processBatchRound's concern.

console.log("v0.3.5 batch runner tests passed");
