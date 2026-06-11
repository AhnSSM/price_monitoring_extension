import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(
  new URL("../background.js", import.meta.url),
  "utf8"
);

const listeners = {
  runtime: [],
  startup: [],
  installed: [],
  tabRemoved: [],
  tabUpdated: [],
  windowRemoved: [],
};

const removedWindowIds = [];

const sandbox = {
  console,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  setTimeout,
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
      create: (_createProperties, callback) => callback({ id: 1 }),
      get: () => {},
      sendMessage: (_tabId, _message, callback) => callback({ ok: true, payload: {} }),
    },
    windows: {
      onRemoved: { addListener: (listener) => listeners.windowRemoved.push(listener) },
      remove: (windowId, callback) => {
        if (!removedWindowIds.includes(windowId)) removedWindowIds.push(windowId);
        if (typeof callback === "function") callback();
      },
      create: (_createProperties, callback) => callback({ id: 7001 }),
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
globalThis.__v034TestExports = {
  EXTENSION_VERSION,
  normalizeBatchPayload,
  createBatchRun,
  processBatchItem,
  detectBlockedResponse,
  extractImportResultStatus,
  registerBatchTabForTest: (entry) => batchTabRegistry.set(entry.tabId, entry),
  getBatchTabEntryForTest: (tabId) => batchTabRegistry.get(tabId),
  removeBatchTabEntryForTest: (tabId) => batchTabRegistry.delete(tabId),
  listBatchTabEntriesForTest: () => Array.from(batchTabRegistry.values()),
  registerBatchWindowForTest: (entry) => batchWindowRegistry.set(entry.windowId, entry),
  getBatchWindowEntryForTest: (windowId) => batchWindowRegistry.get(windowId),
  removeBatchWindowEntryForTest: (windowId) => batchWindowRegistry.delete(windowId),
  listBatchWindowEntriesForTest: () => Array.from(batchWindowRegistry.values()),
  closeOwnedBatchTabsForBatchForTest: closeOwnedBatchTabsForBatch,
  closeOwnedBatchWindowsForBatchForTest: closeOwnedBatchWindowsForBatch,
  closeOwnedBatchTabForTest: closeOwnedBatchTab,
};
`,
  sandbox,
  { filename: "background.js" },
);

const {
  EXTENSION_VERSION,
  normalizeBatchPayload,
  createBatchRun,
  processBatchItem,
  detectBlockedResponse,
  extractImportResultStatus,
  registerBatchTabForTest,
  getBatchTabEntryForTest,
  removeBatchTabEntryForTest,
  listBatchTabEntriesForTest,
  registerBatchWindowForTest,
  getBatchWindowEntryForTest,
  removeBatchWindowEntryForTest,
  listBatchWindowEntriesForTest,
  closeOwnedBatchTabsForBatchForTest,
  closeOwnedBatchWindowsForBatchForTest,
  closeOwnedBatchTabForTest,
} = sandbox.__v034TestExports;

// Stub removeTab for this test: the helper expects a real chrome.tabs.remove path.
// The production code path uses removeTab; we patch chrome.tabs.remove to a recorder.
const removedTabIds = [];
sandbox.chrome.tabs.remove = (tabId, callback) => {
  if (!removedTabIds.includes(tabId)) removedTabIds.push(tabId);
  removeBatchTabEntryForTest(tabId);
  if (typeof callback === "function") callback();
};

// === v0.4.1 version bump ===
assert.equal(EXTENSION_VERSION, "0.4.1", "EXTENSION_VERSION must be bumped to 0.4.1");

// === extractImportResultStatus: helper exists and reads from nested result ===
assert.equal(
  typeof extractImportResultStatus,
  "function",
  "extractImportResultStatus helper must be exported"
);
assert.equal(
  extractImportResultStatus({ responseBody: { status: "blocked_or_captcha" } }),
  "blocked_or_captcha"
);
assert.equal(
  extractImportResultStatus({ responseBody: { result_status: "blocked_or_captcha" } }),
  "blocked_or_captcha"
);
assert.equal(
  extractImportResultStatus({ responseBody: { result: { status: "blocked_or_captcha" } } }),
  "blocked_or_captcha"
);
assert.equal(
  extractImportResultStatus({ responseBody: { result: { status: "saved" } } }),
  "saved"
);
assert.equal(extractImportResultStatus({ responseBody: null }), "");
assert.equal(extractImportResultStatus({}), "");
assert.equal(extractImportResultStatus(null), "");

// === detectBlockedResponse: must catch nested result.status ===
assert.equal(
  detectBlockedResponse({
    responseBody: { result: { status: "blocked_or_captcha" } },
  }),
  true,
  "nested responseBody.result.status must be detected as blocked"
);
assert.equal(
  detectBlockedResponse({
    responseBody: { result: { status: "blocked_or_captcha" } },
    statusCode: 200,
  }),
  true,
  "nested blocked must win over HTTP 200"
);

// === detectBlockedResponse: must not regress existing top-level / http-status cases ===
assert.equal(
  detectBlockedResponse({ responseBody: { status: "blocked_or_captcha" } }),
  true
);
assert.equal(
  detectBlockedResponse({ responseBody: { result_status: "blocked_or_captcha" } }),
  true
);
assert.equal(detectBlockedResponse({ responseStatus: "blocked_or_captcha" }), true);
assert.equal(detectBlockedResponse({ errorCode: "blocked_or_captcha" }), true);
assert.equal(detectBlockedResponse({ statusCode: 403 }), true);
assert.equal(detectBlockedResponse({ statusCode: 429 }), true);
assert.equal(detectBlockedResponse({ statusCode: 503 }), true);
assert.equal(
  detectBlockedResponse({
    responseBody: { result: { status: "saved" } },
    statusCode: 200,
  }),
  false
);
assert.equal(
  detectBlockedResponse({
    responseBody: { result: { status: "queued" } },
    statusCode: 200,
  }),
  false
);

// === closeOwnedBatchTabsForBatch: same-batch owned tabs all close, others preserved ===

// Clear any leftover entries from prior asserts.
for (const entry of listBatchTabEntriesForTest()) {
  removeBatchTabEntryForTest(entry.tabId);
}
removedTabIds.length = 0;

const activeBatchId = "clb_v034_blocked";
const otherBatchId = "clb_v034_other";

// Same active batch, owned by batch — must be closed
registerBatchTabForTest({ tabId: 1001, batchId: activeBatchId, ownedByBatch: true });
// Same active batch, sibling tab opened earlier in the same round — must be closed
registerBatchTabForTest({ tabId: 1002, batchId: activeBatchId, ownedByBatch: true });
// Different batch id — must NOT be closed
registerBatchTabForTest({ tabId: 1003, batchId: otherBatchId, ownedByBatch: true });
// Same batch id but ownedByBatch=false (user-opened) — must NOT be closed
registerBatchTabForTest({ tabId: 1004, batchId: activeBatchId, ownedByBatch: false });
// Registry entry shape with null batchId — must NOT crash and must NOT close
registerBatchTabForTest({ tabId: 1005, batchId: null, ownedByBatch: true });
// User-opened tab shape: ownedByBatch undefined
registerBatchTabForTest({ tabId: 1006, batchId: activeBatchId });

const closeReport = await closeOwnedBatchTabsForBatchForTest(activeBatchId);
assert.equal(closeReport.closed, 2, "must close both same-batch owned tabs");
assert.deepEqual(removedTabIds.slice().sort(), [1001, 1002].sort(),
  "removeTab must be called for same-batch owned tabs only");

assert.equal(getBatchTabEntryForTest(1001), undefined,
  "same-batch owned tab entry should be removed after close");
assert.equal(getBatchTabEntryForTest(1002), undefined,
  "sibling same-batch owned tab entry should be removed after close");
assert.notEqual(getBatchTabEntryForTest(1003), undefined,
  "different-batch owned tab must be preserved");
assert.notEqual(getBatchTabEntryForTest(1004), undefined,
  "user-opened (ownedByBatch=false) tab must be preserved");
assert.notEqual(getBatchTabEntryForTest(1005), undefined,
  "registry entry with null batchId must be preserved");
assert.notEqual(getBatchTabEntryForTest(1006), undefined,
  "registry entry with undefined ownedByBatch must be preserved");

// === closeOwnedBatchTabsForBatch: returns zeros when no matching tabs exist ===
for (const entry of listBatchTabEntriesForTest()) {
  removeBatchTabEntryForTest(entry.tabId);
}
removedTabIds.length = 0;
registerBatchTabForTest({ tabId: 2001, batchId: otherBatchId, ownedByBatch: true });
registerBatchTabForTest({ tabId: 2002, batchId: activeBatchId, ownedByBatch: false });

const noMatchReport = await closeOwnedBatchTabsForBatchForTest(activeBatchId);
assert.equal(noMatchReport.closed, 0,
  "no tabs should be closed when no owned same-batch entry exists");
assert.equal(removedTabIds.length, 0,
  "removeTab must not be called for non-matching entries");
assert.notEqual(getBatchTabEntryForTest(2001), undefined);
assert.notEqual(getBatchTabEntryForTest(2002), undefined);

// === closeOwnedBatchWindowsForBatch: same-batch owned windows close, others preserved ===
for (const entry of listBatchWindowEntriesForTest()) {
  removeBatchWindowEntryForTest(entry.windowId);
}
removedWindowIds.length = 0;

registerBatchWindowForTest({ windowId: 5001, batchId: activeBatchId, ownedByBatch: true });
registerBatchWindowForTest({ windowId: 5002, batchId: otherBatchId, ownedByBatch: true });
registerBatchWindowForTest({ windowId: 5003, batchId: activeBatchId, ownedByBatch: false });
registerBatchWindowForTest({ windowId: 5004, batchId: null, ownedByBatch: true });

const windowCloseReport = await closeOwnedBatchWindowsForBatchForTest(activeBatchId);
assert.equal(windowCloseReport.closed, 1, "must close same-batch owned private windows only");
assert.equal(windowCloseReport.skipped, 0);
assert.deepEqual(removedWindowIds.slice().sort(), [5001]);
assert.equal(getBatchWindowEntryForTest(5001), undefined);
assert.notEqual(getBatchWindowEntryForTest(5002), undefined,
  "different-batch owned window must be preserved");
assert.notEqual(getBatchWindowEntryForTest(5003), undefined,
  "user/non-owned same-batch window must be preserved");
assert.notEqual(getBatchWindowEntryForTest(5004), undefined,
  "null-batch window entry must be preserved");

// === processBatchItem: blocked detection must promptly stop batch and close same-batch owned siblings ===
for (const entry of listBatchTabEntriesForTest()) {
  removeBatchTabEntryForTest(entry.tabId);
}
for (const entry of listBatchWindowEntriesForTest()) {
  removeBatchWindowEntryForTest(entry.windowId);
}
removedTabIds.length = 0;
removedWindowIds.length = 0;

const immediateStopPayload = normalizeBatchPayload({
  batchId: "clb_v034_prompt_stop",
  requiredExtensionVersion: "0.4.1",
  roundSizeMin: 1,
  roundSizeMax: 1,
  stopOnBlock: true,
  blockStopThreshold: 1,
  candidates: [
    {
      trackingKey: "product:3001",
      url: "https://www.coupang.com/vp/products/3001",
      title: "Blocked candidate",
    },
    {
      trackingKey: "product:3002",
      url: "https://www.coupang.com/vp/products/3002",
      title: "Pending sibling",
    },
  ],
});
const immediateStopRun = createBatchRun(immediateStopPayload);
immediateStopRun.status.closedOwnedWindows = 2;
immediateStopRun.status.closedOwnedWindowsSkipped = 1;

registerBatchTabForTest({ tabId: 3002, batchId: immediateStopRun.batchId, ownedByBatch: true });
registerBatchTabForTest({ tabId: 3003, batchId: "other_batch", ownedByBatch: true });
registerBatchTabForTest({ tabId: 3004, batchId: immediateStopRun.batchId, ownedByBatch: false });
registerBatchWindowForTest({ windowId: 3301, batchId: immediateStopRun.batchId, ownedByBatch: true });
registerBatchWindowForTest({ windowId: 3302, batchId: "other_batch", ownedByBatch: true });
registerBatchWindowForTest({ windowId: 3303, batchId: immediateStopRun.batchId, ownedByBatch: false });

sandbox.chrome.tabs.create = (_createProperties, callback) => callback({ id: 3001 });
sandbox.chrome.tabs.get = (_tabId, callback) => callback({ id: 3001, status: "complete" });
sandbox.chrome.tabs.sendMessage = (_tabId, _message, callback) => callback({
  ok: true,
  payload: {
    url: "https://www.coupang.com/vp/products/3001",
    final_url: "https://www.coupang.com/vp/products/3001",
    title: "Blocked candidate",
    text: "Apple test product 1,244,170원 장바구니 바로구매",
  },
});
sandbox.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result: { status: "blocked_or_captcha" } }),
});

await processBatchItem(immediateStopRun, immediateStopRun.items[0]);

assert.equal(immediateStopRun.items[0].status, "failure");
assert.equal(immediateStopRun.items[0].errorCode, "blocked_or_captcha");
assert.equal(immediateStopRun.items[0].responseStatus, "blocked_or_captcha");
assert.equal(immediateStopRun.status.state, "stopped",
  "blocked item must stop the batch immediately");
assert.equal(immediateStopRun.status.stopReason, "blocked_or_captcha");
assert.equal(immediateStopRun.items[1].status, "skipped",
  "not-yet-started item must be skipped when blocked stop triggers");
assert.deepEqual(removedTabIds.slice().sort(), [3001, 3002].sort(),
  "current blocked tab and same-batch owned sibling must both close promptly");
assert.deepEqual(removedWindowIds.slice().sort(), [3301],
  "same-batch owned private window must close promptly");
assert.equal(immediateStopRun.status.closedOwnedWindows, 3,
  "blocked cleanup must add to prior round window close count");
assert.equal(immediateStopRun.status.closedOwnedWindowsSkipped, 1,
  "blocked cleanup must preserve prior skipped window close count");
assert.equal(getBatchTabEntryForTest(3001), undefined);
assert.equal(getBatchTabEntryForTest(3002), undefined);
assert.notEqual(getBatchTabEntryForTest(3003), undefined,
  "different-batch owned tab must be preserved");
assert.notEqual(getBatchTabEntryForTest(3004), undefined,
  "user-opened same-batch tab must be preserved");
assert.equal(getBatchWindowEntryForTest(3301), undefined);
assert.notEqual(getBatchWindowEntryForTest(3302), undefined,
  "different-batch owned window must be preserved");
assert.notEqual(getBatchWindowEntryForTest(3303), undefined,
  "same-batch non-owned window must be preserved");

// === processBatchItem: blocked item must not stop batch when stopOnBlock=false ===
for (const entry of listBatchTabEntriesForTest()) {
  removeBatchTabEntryForTest(entry.tabId);
}
for (const entry of listBatchWindowEntriesForTest()) {
  removeBatchWindowEntryForTest(entry.windowId);
}
removedTabIds.length = 0;
removedWindowIds.length = 0;

const continueOnBlockPayload = normalizeBatchPayload({
  batchId: "clb_v034_continue_on_block",
  requiredExtensionVersion: "0.4.1",
  roundSizeMin: 1,
  roundSizeMax: 1,
  stopOnBlock: false,
  blockStopThreshold: 1,
  candidates: [
    {
      trackingKey: "product:3101",
      url: "https://www.coupang.com/vp/products/3101",
      title: "Blocked but continue",
    },
    {
      trackingKey: "product:3102",
      url: "https://www.coupang.com/vp/products/3102",
      title: "Still pending",
    },
  ],
});
const continueOnBlockRun = createBatchRun(continueOnBlockPayload);

registerBatchTabForTest({ tabId: 3102, batchId: continueOnBlockRun.batchId, ownedByBatch: true });
registerBatchTabForTest({ tabId: 3103, batchId: "other_batch", ownedByBatch: true });
registerBatchWindowForTest({ windowId: 3401, batchId: continueOnBlockRun.batchId, ownedByBatch: true });

sandbox.chrome.tabs.create = (_createProperties, callback) => callback({ id: 3101 });
sandbox.chrome.tabs.get = (_tabId, callback) => callback({ id: 3101, status: "complete" });
sandbox.chrome.tabs.sendMessage = (_tabId, _message, callback) => callback({
  ok: true,
  payload: {
    url: "https://www.coupang.com/vp/products/3101",
    final_url: "https://www.coupang.com/vp/products/3101",
    title: "Blocked but continue",
    text: "Apple test product 1,244,170원 장바구니 바로구매",
  },
});
sandbox.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result: { status: "blocked_or_captcha" } }),
});

await processBatchItem(continueOnBlockRun, continueOnBlockRun.items[0]);

assert.equal(continueOnBlockRun.items[0].status, "failure");
assert.equal(continueOnBlockRun.items[0].errorCode, "blocked_or_captcha");
assert.equal(continueOnBlockRun.items[0].responseStatus, "blocked_or_captcha");
assert.equal(continueOnBlockRun.status.state, "running",
  "stopOnBlock=false이면 차단이 발생해도 배치는 중단되면 안 된다");
assert.equal(continueOnBlockRun.status.stopReason, "");
assert.equal(continueOnBlockRun.items[1].status, "pending",
  "stopOnBlock=false이면 아직 시작하지 않은 항목은 그대로 pending이어야 한다");
assert.deepEqual(removedTabIds.slice().sort(), [3101],
  "현재 처리 중인 탭만 닫고 같은 배치 형제 탭 정리는 하지 않아야 한다");
assert.deepEqual(removedWindowIds.slice().sort(), [],
  "stopOnBlock=false이면 owned window 정리는 하지 않아야 한다");
assert.equal(getBatchTabEntryForTest(3101), undefined);
assert.notEqual(getBatchTabEntryForTest(3102), undefined,
  "stopOnBlock=false이면 같은 배치 형제 owned 탭을 유지해야 한다");
assert.notEqual(getBatchTabEntryForTest(3103), undefined);
assert.notEqual(getBatchWindowEntryForTest(3401), undefined);

// === processBatchItem: blocked item below threshold must not stop or cleanup ===
for (const entry of listBatchTabEntriesForTest()) {
  removeBatchTabEntryForTest(entry.tabId);
}
removedTabIds.length = 0;

const thresholdPayload = normalizeBatchPayload({
  batchId: "clb_v034_threshold_two",
  requiredExtensionVersion: "0.4.1",
  roundSizeMin: 1,
  roundSizeMax: 1,
  stopOnBlock: true,
  blockStopThreshold: 2,
  candidates: [
    {
      trackingKey: "product:3201",
      url: "https://www.coupang.com/vp/products/3201",
      title: "First blocked",
    },
    {
      trackingKey: "product:3202",
      url: "https://www.coupang.com/vp/products/3202",
      title: "Second blocked",
    },
    {
      trackingKey: "product:3203",
      url: "https://www.coupang.com/vp/products/3203",
      title: "Pending sibling",
    },
  ],
});
const thresholdRun = createBatchRun(thresholdPayload);

registerBatchTabForTest({ tabId: 3203, batchId: thresholdRun.batchId, ownedByBatch: true });
registerBatchTabForTest({ tabId: 3204, batchId: "other_batch", ownedByBatch: true });

sandbox.chrome.tabs.create = (_createProperties, callback) => callback({ id: 3201 });
sandbox.chrome.tabs.get = (_tabId, callback) => callback({ id: 3201, status: "complete" });
sandbox.chrome.tabs.sendMessage = (_tabId, _message, callback) => callback({
  ok: true,
  payload: {
    url: "https://www.coupang.com/vp/products/3201",
    final_url: "https://www.coupang.com/vp/products/3201",
    title: "First blocked",
    text: "Apple test product 1,244,170원 장바구니 바로구매",
  },
});
sandbox.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result: { status: "blocked_or_captcha" } }),
});

await processBatchItem(thresholdRun, thresholdRun.items[0]);

assert.equal(thresholdRun.items[0].status, "failure");
assert.equal(thresholdRun.items[0].errorCode, "blocked_or_captcha");
assert.equal(thresholdRun.status.state, "running",
  "임계치 미만 첫 차단에서는 배치가 멈추면 안 된다");
assert.equal(thresholdRun.items[1].status, "pending");
assert.equal(thresholdRun.items[2].status, "pending");
assert.deepEqual(removedTabIds.slice().sort(), [3201],
  "임계치 미도달 시 현재 탭 외 형제 탭 정리는 발생하면 안 된다");
assert.equal(getBatchTabEntryForTest(3201), undefined);
assert.notEqual(getBatchTabEntryForTest(3203), undefined,
  "임계치 미도달 시 같은 배치 형제 owned 탭을 유지해야 한다");
assert.notEqual(getBatchTabEntryForTest(3204), undefined);

// Optional regression: reaching threshold should still stop/cleanup promptly.
removedTabIds.length = 0;
registerBatchTabForTest({ tabId: 3205, batchId: thresholdRun.batchId, ownedByBatch: true });
sandbox.chrome.tabs.create = (_createProperties, callback) => callback({ id: 3202 });
sandbox.chrome.tabs.get = (_tabId, callback) => callback({ id: 3202, status: "complete" });
sandbox.chrome.tabs.sendMessage = (_tabId, _message, callback) => callback({
  ok: true,
  payload: {
    url: "https://www.coupang.com/vp/products/3202",
    final_url: "https://www.coupang.com/vp/products/3202",
    title: "Second blocked",
    text: "Apple test product 1,244,170원 장바구니 바로구매",
  },
});

await processBatchItem(thresholdRun, thresholdRun.items[1]);

assert.equal(thresholdRun.items[1].status, "failure");
assert.equal(thresholdRun.items[1].errorCode, "blocked_or_captcha");
assert.equal(thresholdRun.status.state, "stopped",
  "차단 수가 임계치에 도달하면 즉시 배치를 중단해야 한다");
assert.equal(thresholdRun.status.stopReason, "blocked_or_captcha");
assert.equal(thresholdRun.items[2].status, "skipped",
  "임계치 도달 후 아직 시작하지 않은 항목은 skipped 처리되어야 한다");
assert.deepEqual(removedTabIds.slice().sort(), [3202, 3203, 3205].sort(),
  "임계치 도달 시 현재 탭과 같은 배치 owned 형제 탭을 즉시 정리해야 한다");
assert.equal(getBatchTabEntryForTest(3202), undefined);
assert.equal(getBatchTabEntryForTest(3203), undefined);
assert.equal(getBatchTabEntryForTest(3205), undefined);
assert.notEqual(getBatchTabEntryForTest(3204), undefined,
  "다른 배치 탭은 임계치 도달 시에도 유지되어야 한다");

console.log("v0.4.1 blocked-detection and batch-tab cleanup tests passed");
