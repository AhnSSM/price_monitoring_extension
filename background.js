const EXTENSION_VERSION = "0.4.1";
const SERVER_URL = "http://100.118.184.5:5000";
const IMPORT_PATH = "/api/dedicated/coupang_apple_return_sale/detail-check/import";
const AUTO_MODE_KEY = "autoModeEnabled";
const AUTO_STATUS_KEY = "lastAutoStatus";
const AUTO_DEDUP_KEY = "autoDedupMetadata";
const BATCH_STATUS_KEY = "currentListBatchStatus";
const AUTO_DEDUP_WINDOW_MS = 10 * 60 * 1000;
const BATCH_CANDIDATE_CAP = 30;
const DEFAULT_BATCH_ROUND_SIZE_MIN = 8;
const DEFAULT_BATCH_ROUND_SIZE_MAX = 12;
const LEGACY_BATCH_WAVE_PATTERN = [6, 5, 4];
const MAX_BATCH_ROUND_SIZE = BATCH_CANDIDATE_CAP;
const DEFAULT_WAVE_SLEEP_MIN_SECONDS = 10;
const DEFAULT_WAVE_SLEEP_MAX_SECONDS = 20;
const SESSION_MODES = new Set(["incognito", "regular"]);
const SESSION_ROTATIONS = new Set(["per_round"]);
const DEFAULT_SESSION_MODE = "incognito";
const DEFAULT_SESSION_ROTATION = "per_round";
const DEFAULT_TAB_OPEN_DELAY_MIN_SECONDS = 0.3;
const DEFAULT_TAB_OPEN_DELAY_MAX_SECONDS = 1.0;
const MAX_TAB_OPEN_DELAY_SECONDS = 5.0;
const DEFAULT_STOP_ON_BLOCK = true;
const DEFAULT_BLOCK_STOP_THRESHOLD = 1;
const BLOCKED_RESULT_KEYS = new Set(["blocked_or_captcha"]);
const BLOCKED_STATUS_CODES = new Set([403, 429, 503]);
const TAB_LOAD_TIMEOUT_MS = 30 * 1000;
const PAYLOAD_TIMEOUT_MS = 20 * 1000;
const PAYLOAD_RETRY_INTERVAL_MS = 1500;
const SUPPORTED_PRODUCT_PAGE_RE = /^https:\/\/www\.coupang\.com\/vp\/products\/[^/?#]+/;
const PRODUCT_PRICE_SIGNAL_RE = /(?:\d{1,3}(?:,\d{3})+|\d{4,})\s*원/;
const PRODUCT_READY_SIGNAL_RE = /(장바구니|바로\s*구매|구매하기|쿠팡상품번호|일시\s*품절|품절|Access\s*Denied|Robot\s*Check|captcha|You\s*(?:don't|do\s+not)\s*have\s*permission|Permission\s*Denied|access\s*denied|permission\s*denied)/i;

let activeBatchRun = null;
const batchTabRegistry = new Map();
const batchWindowRegistry = new Map();

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeDefaults().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  batchTabRegistry.delete(tabId);
});

if (chrome && chrome.windows && chrome.windows.onRemoved && typeof chrome.windows.onRemoved.addListener === "function") {
  chrome.windows.onRemoved.addListener((windowId) => {
    if (typeof windowId !== "number") {
      return;
    }
    const entry = batchWindowRegistry.get(windowId);
    if (!entry) {
      return;
    }
    batchWindowRegistry.delete(windowId);
    const batchRun = entry.batchRunRef;
    if (batchRun && batchRun.roundSession && batchRun.roundSession.windowId === windowId) {
      batchRun.roundSession.windowId = null;
      batchRun.roundSession.closed = true;
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "manual-import") {
    handleManualImport(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "수동 전송 처리에 실패했습니다."
        });
      });
    return true;
  }

  if (message.type === "auto-page-view") {
    handleAutoPageView(message.payload, sender)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "자동 전송 처리에 실패했습니다."
        });
      });
    return true;
  }

  if (message.type === "current-list-ping") {
    handleCurrentListPing()
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          type: "pm:pong",
          error: error.message || "확장 상태를 확인하지 못했습니다."
        });
      });
    return true;
  }

  if (message.type === "current-list-batch-status") {
    handleCurrentListBatchStatus()
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          type: "pm:batch-status-response",
          error: error.message || "배치 상태를 읽지 못했습니다."
        });
      });
    return true;
  }

  if (message.type === "current-list-batch-start") {
    handleCurrentListBatchStart(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          type: "pm:batch-start-response",
          error: error.message || "배치를 시작하지 못했습니다."
        });
      });
    return true;
  }

  return false;
});

async function handleManualImport(payload) {
  validatePayloadShape(payload);
  const response = await postImport(
    {
      ...buildImportBody(payload),
      source: "manual_popup"
    },
    {}
  );

  if (!response.ok) {
    throw new Error(response.errorMessage);
  }

  return {
    ok: true,
    statusCode: response.statusCode,
    responseBody: response.responseBody || {}
  };
}

async function handleAutoPageView(payload, sender) {
  validatePayloadShape(payload);

  const tabUrl = sender && sender.tab && typeof sender.tab.url === "string"
    ? sender.tab.url
    : payload.final_url;

  if (!isSupportedProductUrl(tabUrl) || !isSupportedProductUrl(payload.final_url)) {
    return { ok: true, skipped: true, reason: "unsupported_page" };
  }

  const state = await getLocalState([AUTO_MODE_KEY, AUTO_DEDUP_KEY, AUTO_STATUS_KEY]);
  if (!state[AUTO_MODE_KEY]) {
    return { ok: true, skipped: true, reason: "auto_mode_disabled" };
  }

  const now = Date.now();
  const dedupMetadata = pruneDedupMetadata(state[AUTO_DEDUP_KEY], now);
  const dedupKey = buildDedupKey(payload);
  const recentEntry = dedupMetadata[dedupKey];

  if (recentEntry && now - recentEntry.timestamp < AUTO_DEDUP_WINDOW_MS) {
    await saveLocalState({
      [AUTO_DEDUP_KEY]: dedupMetadata,
      [AUTO_STATUS_KEY]: {
        code: "duplicate_suppressed",
        tone: "default",
        message: "같은 상품 자동 송신을 최근 10분 안에 이미 보냈습니다.",
        at: new Date(now).toISOString(),
        source: "auto_page_view",
        dedupKey
      }
    });
    return { ok: true, skipped: true, reason: "duplicate_suppressed" };
  }

  const response = await postImport(
    {
      ...buildImportBody(payload),
      source: "auto_page_view"
    },
    {}
  );

  if (response.ok) {
    dedupMetadata[dedupKey] = {
      timestamp: now,
      canonicalUrl: payload.canonical_url || "",
      finalUrl: payload.final_url || payload.url || ""
    };

    const responseStatus = response.responseBody && response.responseBody.status
      ? response.responseBody.status
      : "saved";
    const successMessage = responseStatus === "unmanaged_queued"
      ? "자동 송신이 접수됐고 서버가 미관리 inbox로 분류했습니다."
      : "자동 송신이 서버에 접수됐습니다.";

    await saveLocalState({
      [AUTO_DEDUP_KEY]: dedupMetadata,
      [AUTO_STATUS_KEY]: {
        code: responseStatus,
        tone: "success",
        message: successMessage,
        at: new Date(now).toISOString(),
        source: "auto_page_view",
        dedupKey,
        finalUrl: payload.final_url || payload.url || ""
      }
    });
    return { ok: true, statusCode: response.statusCode, responseBody: response.responseBody || {} };
  }

  const errorCode = response.errorCode || "";
  const needsUpdate = errorCode === "unsupported_extension_version" ||
    errorCode === "extension_version_mismatch";
  const statusMessage = needsUpdate
    ? "서버가 이 확장 버전을 거부했습니다. 업데이트 또는 재설치 후 자동 송신을 다시 켜세요."
    : response.errorMessage;

  const nextState = {
    [AUTO_DEDUP_KEY]: dedupMetadata,
    [AUTO_STATUS_KEY]: {
      code: errorCode || `http_${response.statusCode}`,
      tone: "error",
      message: statusMessage,
      at: new Date(now).toISOString(),
      source: "auto_page_view",
      dedupKey,
      finalUrl: payload.final_url || payload.url || ""
    }
  };

  if (needsUpdate) {
    nextState[AUTO_MODE_KEY] = false;
  }

  await saveLocalState(nextState);
  return {
    ok: false,
    error: response.errorMessage,
    errorCode,
    statusCode: response.statusCode
  };
}

async function handleCurrentListPing() {
  const batchStatus = await getLatestBatchStatus();
  const incognitoAllowed = await isAllowedIncognitoAccess();
  return {
    ok: true,
    type: "pm:pong",
    extensionVersion: EXTENSION_VERSION,
    incognitoAllowed,
    batchStatus
  };
}

async function handleCurrentListBatchStatus() {
  const batchStatus = await getLatestBatchStatus();
  return {
    ok: true,
    type: "pm:batch-status-response",
    extensionVersion: EXTENSION_VERSION,
    batchStatus
  };
}

async function handleCurrentListBatchStart(payload) {
  const normalizedPayload = normalizeBatchPayload(payload);
  const sessionMode = normalizedPayload.sessionMode || DEFAULT_SESSION_MODE;

  if (activeBatchRun) {
    return {
      ok: false,
      type: "pm:batch-start-response",
      error: "이미 실행 중인 current-list batch가 있습니다.",
      errorCode: "batch_already_running",
      extensionVersion: EXTENSION_VERSION,
      sessionMode,
      batchStatus: activeBatchRun.status
    };
  }

  if (sessionMode === "incognito") {
    const incognitoAllowed = await isAllowedIncognitoAccess();
    if (!incognitoAllowed) {
      const rejectedStatus = {
        batchId: normalizedPayload.batchId,
        state: "failed",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        extensionVersion: EXTENSION_VERSION,
        errorCode: "incognito_not_allowed",
        error: "확장이 시크릿/프라이빗 창에서 실행되도록 허용되지 않았습니다. Brave는 'Allow in Private', Chrome은 'Allow in Incognito'을 켜고 다시 시도하세요.",
        sessionMode,
        sessionModeIsPrivate: true,
        accepted: normalizedPayload.candidates.length,
        candidateCount: normalizedPayload.candidates.length,
        roundSize: normalizedPayload.roundSize,
        waveSleepMinSeconds: normalizedPayload.waveSleepMinSeconds,
        waveSleepMaxSeconds: normalizedPayload.waveSleepMaxSeconds,
        tabOpenDelayMinSeconds: normalizedPayload.tabOpenDelayMinSeconds,
        tabOpenDelayMaxSeconds: normalizedPayload.tabOpenDelayMaxSeconds,
        summary: { pending: 0, running: 0, success: 0, failure: 0, timeout: 0, skipped: 0, completed: 0, total: normalizedPayload.candidates.length },
        items: []
      };
      await persistBatchStatus(rejectedStatus);
      return {
        ok: false,
        type: "pm:batch-start-response",
        extensionVersion: EXTENSION_VERSION,
        error: "확장이 시크릿 창에서 실행되도록 허용되지 않았습니다.",
        errorCode: "incognito_not_allowed",
        sessionMode,
        incognitoAllowed: false,
        batchStatus: rejectedStatus
      };
    }
  }

  const batchRun = createBatchRun(normalizedPayload);
  activeBatchRun = batchRun;
  await persistBatchStatus(batchRun.status);

  runBatch(batchRun).catch(async (error) => {
    await markBatchFailed(batchRun, error);
  });

  return {
    ok: true,
    type: "pm:batch-start-response",
    extensionVersion: EXTENSION_VERSION,
    batchId: batchRun.batchId,
    accepted: batchRun.items.length,
    startedAt: batchRun.status.startedAt,
    roundSize: batchRun.roundSize,
    sessionMode: batchRun.sessionMode,
    sessionRotation: batchRun.sessionRotation
  };
}

async function runBatch(batchRun) {
  while (batchRun.nextIndex < batchRun.items.length) {
    const waveItems = takeNextBatchWave(batchRun);
    batchRun.status.state = "running";
    batchRun.status.nextWaveDelaySeconds = 0;
    touchBatchStatus(batchRun);
    await persistBatchStatus(batchRun.status);
    batchRun.roundSession = { windowId: null, closed: false };
    let roundSessionOpened = false;
    try {
      if (batchRun.sessionMode === "incognito") {
        await openRoundSession(batchRun);
        roundSessionOpened = true;
      }
      await processBatchRound(batchRun, waveItems, batchRun.roundSession);
    } finally {
      if (roundSessionOpened) {
        await closeRoundSession(batchRun);
      }
    }

    if (shouldStopBatch(batchRun)) {
      await triggerBlockedBatchStop(batchRun);
      break;
    }

    if (batchRun.nextIndex < batchRun.items.length) {
      const delaySeconds = buildInterWaveDelaySeconds(batchRun);
      batchRun.status.state = "waiting";
      batchRun.status.nextWaveDelaySeconds = delaySeconds;
      touchBatchStatus(batchRun);
      await persistBatchStatus(batchRun.status);
      await delay(delaySeconds * 1000);
    }
  }

  if (batchRun.status.state !== "stopped") {
    batchRun.status.state = "completed";
    batchRun.status.nextWaveDelaySeconds = 0;
    batchRun.status.completedAt = new Date().toISOString();
    touchBatchStatus(batchRun);
    await persistBatchStatus(batchRun.status);
  }

  if (activeBatchRun && activeBatchRun.batchId === batchRun.batchId) {
    activeBatchRun = null;
  }
}

function takeNextBatchWave(batchRun) {
  if (batchRun.nextIndex >= batchRun.items.length) {
    return [];
  }

  const roundSize = batchRun.roundSize || {
    min: DEFAULT_BATCH_ROUND_SIZE_MIN,
    max: DEFAULT_BATCH_ROUND_SIZE_MAX
  };
  const remaining = batchRun.items.length - batchRun.nextIndex;
  const desired = (roundSize.mode === "legacy" && Array.isArray(roundSize.legacyPattern) && roundSize.legacyPattern.length)
    ? roundSize.legacyPattern[batchRun.legacyWaveIndex % roundSize.legacyPattern.length]
    : randomRoundSize(roundSize);
  const size = Math.min(Math.max(1, desired), remaining);
  const startIndex = batchRun.nextIndex;
  const endIndex = startIndex + size;
  const waveItems = batchRun.items.slice(startIndex, endIndex);

  batchRun.nextIndex = endIndex;
  batchRun.legacyWaveIndex = (batchRun.legacyWaveIndex || 0) + 1;
  batchRun.status.currentRound += 1;
  batchRun.status.roundCount += 1;
  batchRun.status.lastRoundSize = size;
  return waveItems;
}

async function processBatchItem(batchRun, item, roundSession) {
  item.status = "running";
  item.startedAt = new Date().toISOString();
  touchBatchStatus(batchRun);
  await persistBatchStatus(batchRun.status);

  let tabId = null;

  try {
    const tabCreateProperties = { active: false, url: item.url };
    if (roundSession && typeof roundSession.windowId === "number") {
      tabCreateProperties.windowId = roundSession.windowId;
      item.ownedWindowId = roundSession.windowId;
    } else if (batchRun && batchRun.sessionMode !== "incognito") {
      // Regular mode: no owned window, no windowId hint.
    } else if (batchRun && batchRun.sessionMode === "incognito" && batchRun.roundSession && typeof batchRun.roundSession.windowId === "number") {
      tabCreateProperties.windowId = batchRun.roundSession.windowId;
      item.ownedWindowId = batchRun.roundSession.windowId;
    }
    const createdTab = await createTab(tabCreateProperties);
    tabId = createdTab.id;
    item.tabId = tabId;
    if (typeof item.ownedWindowId !== "number" && createdTab && typeof createdTab.windowId === "number") {
      item.ownedWindowId = createdTab.windowId;
    }
    registerBatchTab({
      tabId,
      batchId: batchRun.batchId,
      trackingKey: item.trackingKey,
      ownedByBatch: true
    });

    await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);
    const payload = await requestPayloadWithRetry(tabId, PAYLOAD_TIMEOUT_MS);
    const response = await postImport(
      {
        ...buildImportBody(payload),
        source: "auto_page_view"
      },
      {
        serverUrl: batchRun.serverUrl,
        importPath: batchRun.importPath
      }
    );

    const responseStatus = extractImportResultStatus(response);
    if (!response.ok || BLOCKED_RESULT_KEYS.has(responseStatus)) {
      item.status = "failure";
      item.error = response.errorMessage || (
        BLOCKED_RESULT_KEYS.has(responseStatus)
          ? "차단/캡차 응답이 감지되었습니다."
          : ""
      );
      item.errorCode = response.errorCode || responseStatus || "";
      item.statusCode = response.statusCode;
      item.responseStatus = responseStatus;
      if (detectBlockedResponse({
        responseBody: response.responseBody,
        responseStatus,
        errorCode: item.errorCode,
        statusCode: item.statusCode
      }) && shouldStopBatch(batchRun)) {
        await triggerBlockedBatchStop(batchRun);
      }
    } else {
      item.status = "success";
      item.statusCode = response.statusCode;
      item.responseStatus = responseStatus || "saved";
    }
  } catch (error) {
    item.status = error && error.code === "payload_timeout"
      ? "timeout"
      : "failure";
    item.error = error && error.message
      ? error.message
      : "배치 항목 처리에 실패했습니다.";
    item.errorCode = error && error.code ? error.code : "";
    item.statusCode = typeof (error && error.statusCode) === "number" ? error.statusCode : null;
  } finally {
    item.finishedAt = new Date().toISOString();
    touchBatchStatus(batchRun);
    await persistBatchStatus(batchRun.status);

    if (typeof tabId === "number") {
      await closeOwnedBatchTab(tabId);
    }
  }
}

async function triggerBlockedBatchStop(batchRun) {
  if (!batchRun || typeof batchRun !== "object") {
    return { closed: 0, skipped: 0 };
  }

  if (batchRun.stopCleanupPromise) {
    return batchRun.stopCleanupPromise;
  }

  batchRun.stopCleanupPromise = (async () => {
    batchRun.status.state = "stopped";
    batchRun.status.stopReason = "blocked_or_captcha";
    batchRun.status.nextWaveDelaySeconds = 0;
    markUnstartedItemsSkipped(batchRun, "차단 감지로 미실행");
    batchRun.status.completedAt = new Date().toISOString();
    touchBatchStatus(batchRun);
    const cleanupReport = await closeOwnedBatchTabsForBatch(batchRun.batchId);
    const windowReport = await closeOwnedBatchWindowsForBatch(batchRun.batchId);
    batchRun.status.closedOwnedTabs = cleanupReport.closed;
    batchRun.status.closedOwnedTabsSkipped = cleanupReport.skipped;
    batchRun.status.closedOwnedWindows = Number(batchRun.status.closedOwnedWindows || 0) + windowReport.closed;
    batchRun.status.closedOwnedWindowsSkipped = Number(batchRun.status.closedOwnedWindowsSkipped || 0) + windowReport.skipped;
    await persistBatchStatus(batchRun.status);
    return { tabs: cleanupReport, windows: windowReport };
  })();

  return batchRun.stopCleanupPromise;
}

async function markBatchFailed(batchRun, error) {
  batchRun.status.state = "failed";
  batchRun.status.error = error && error.message
    ? error.message
    : "배치 실행 중 알 수 없는 오류가 발생했습니다.";
  batchRun.status.completedAt = new Date().toISOString();
  touchBatchStatus(batchRun);
  await persistBatchStatus(batchRun.status);

  if (activeBatchRun && activeBatchRun.batchId === batchRun.batchId) {
    activeBatchRun = null;
  }
}

function normalizeBatchPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("batch payload가 비어 있습니다.");
  }

  const requiredVersion = typeof payload.requiredExtensionVersion === "string"
    ? payload.requiredExtensionVersion.trim()
    : "";
  if (requiredVersion && requiredVersion !== EXTENSION_VERSION) {
    throw new Error(`확장 버전이 맞지 않습니다. 현재 ${EXTENSION_VERSION}이 필요합니다.`);
  }

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const normalizedCandidates = candidates
    .map((candidate) => normalizeCandidate(candidate))
    .filter(Boolean);

  if (normalizedCandidates.length === 0) {
    throw new Error("실행 가능한 current-list candidate가 없습니다.");
  }

  if (normalizedCandidates.length > BATCH_CANDIDATE_CAP) {
    throw new Error(`current-list batch는 최대 ${BATCH_CANDIDATE_CAP}개까지만 지원합니다.`);
  }

  const roundSize = normalizeRoundSize({
    roundSizeMin: payload.roundSizeMin !== undefined ? payload.roundSizeMin : payload.round_size_min,
    roundSizeMax: payload.roundSizeMax !== undefined ? payload.roundSizeMax : payload.round_size_max,
    roundSizeMode: payload.roundSizeMode !== undefined ? payload.roundSizeMode : payload.round_size_mode,
    wavePattern: payload.wavePattern !== undefined ? payload.wavePattern : payload.wave_pattern
  }, normalizedCandidates.length);
  const waveSleepMinSeconds = normalizeSleepBound(
    payload.waveSleepMinSeconds !== undefined ? payload.waveSleepMinSeconds : payload.wave_sleep_min_seconds,
    DEFAULT_WAVE_SLEEP_MIN_SECONDS
  );
  const waveSleepMaxSeconds = normalizeSleepBound(
    payload.waveSleepMaxSeconds !== undefined ? payload.waveSleepMaxSeconds : payload.wave_sleep_max_seconds,
    DEFAULT_WAVE_SLEEP_MAX_SECONDS
  );
  const stopOnBlock = normalizeBooleanOption(
    payload.stopOnBlock !== undefined ? payload.stopOnBlock : payload.stop_on_block,
    DEFAULT_STOP_ON_BLOCK
  );
  const blockStopThreshold = normalizeBlockStopThreshold(
    payload.blockStopThreshold !== undefined ? payload.blockStopThreshold : payload.block_stop_threshold,
    DEFAULT_BLOCK_STOP_THRESHOLD
  );
  const tabOpenDelayBounds = normalizeTabOpenDelayBounds(
    payload.tabOpenDelayMinSeconds !== undefined ? payload.tabOpenDelayMinSeconds : payload.tab_open_delay_min_seconds,
    payload.tabOpenDelayMaxSeconds !== undefined ? payload.tabOpenDelayMaxSeconds : payload.tab_open_delay_max_seconds
  );
  const sessionMode = normalizeSessionMode(
    payload.sessionMode !== undefined ? payload.sessionMode : payload.session_mode
  );
  const sessionRotation = normalizeSessionRotation(
    payload.sessionRotation !== undefined ? payload.sessionRotation : payload.session_rotation
  );

  return {
    batchId: typeof payload.batchId === "string" && payload.batchId.trim()
      ? payload.batchId.trim()
      : `clb_${Date.now()}`,
    requiredVersion,
    serverUrl: SERVER_URL,
    importPath: IMPORT_PATH,
    roundSize,
    waveSleepMinSeconds,
    waveSleepMaxSeconds,
    tabOpenDelayMinSeconds: tabOpenDelayBounds.min,
    tabOpenDelayMaxSeconds: tabOpenDelayBounds.max,
    stopOnBlock,
    blockStopThreshold,
    sessionMode,
    sessionRotation,
    candidates: normalizedCandidates
  };
}

function normalizeSessionMode(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "private" || normalized === "incognito") {
      return "incognito";
    }
    if (normalized === "regular" || normalized === "normal") {
      return "regular";
    }
  }
  if (value === false) {
    return "regular";
  }
  if (value === true) {
    return "incognito";
  }
  return DEFAULT_SESSION_MODE;
}

function normalizeSessionRotation(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (SESSION_ROTATIONS.has(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_SESSION_ROTATION;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const rawTrackingKey = typeof candidate.trackingKey === "string" && candidate.trackingKey.trim()
    ? candidate.trackingKey
    : candidate.tracking_key;
  const trackingKey = typeof rawTrackingKey === "string" && rawTrackingKey.trim()
    ? rawTrackingKey.trim()
    : null;
  const url = typeof candidate.url === "string" && candidate.url.trim()
    ? candidate.url.trim()
    : null;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";

  if (!trackingKey || !url || !isSupportedProductUrl(url)) {
    return null;
  }

  return {
    trackingKey,
    url,
    title
  };
}

function normalizeRoundSize(input, candidateCap) {
  const fallback = {
    min: DEFAULT_BATCH_ROUND_SIZE_MIN,
    max: DEFAULT_BATCH_ROUND_SIZE_MAX
  };

  const explicitMin = parsePositiveInt(
    input && (input.roundSizeMin !== undefined ? input.roundSizeMin : undefined)
  );
  const explicitMax = parsePositiveInt(
    input && (input.roundSizeMax !== undefined ? input.roundSizeMax : undefined)
  );
  const mode = (() => {
    if (!input) return "random";
    const raw = input.roundSizeMode !== undefined ? input.roundSizeMode : undefined;
    if (typeof raw !== "string") return "random";
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return "random";
    return normalized;
  })();

  // Legacy fallback only: when the page still sends the old wavePattern field and no
  // explicit round size min/max, keep a deterministic pattern so v0.3.1 callers still
  // observe the prior 6-5-4 cadence. New v0.3.3 clients should send roundSizeMin/Max.
  if (explicitMin === null && explicitMax === null) {
    const legacyPattern = Array.isArray(input && input.wavePattern) ? input.wavePattern : null;
    if (mode === "legacy" && legacyPattern) {
      const cleaned = legacyPattern
        .map((item) => parsePositiveInt(item))
        .filter((item) => item !== null)
        .map((item) => Math.min(item, MAX_BATCH_ROUND_SIZE));
      if (cleaned.length) {
        return {
          min: cleaned[0],
          max: cleaned[cleaned.length - 1],
          mode: "legacy",
          legacyPattern: cleaned
        };
      }
    }
  }

  let min = explicitMin !== null ? explicitMin : fallback.min;
  let max = explicitMax !== null ? explicitMax : fallback.max;

  if (min < 1) min = fallback.min;
  if (max < min) max = min;
  const cap = Math.max(1, Math.min(MAX_BATCH_ROUND_SIZE, candidateCap || BATCH_CANDIDATE_CAP));
  if (max > cap) max = cap;
  if (min > cap) min = cap;

  return {
    min,
    max,
    mode: "random"
  };
}

function parsePositiveInt(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function randomRoundSize(roundSize) {
  const min = roundSize.min;
  const max = Math.max(min, roundSize.max);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeSleepBound(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
}

function normalizeBlockStopThreshold(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultValue;
  }
  return parsed;
}

function normalizeBooleanOption(value, defaultValue) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return defaultValue;
}

function createBatchRun(payload) {
  const startedAt = new Date().toISOString();
  const items = payload.candidates.map((candidate) => ({
    trackingKey: candidate.trackingKey,
    url: candidate.url,
    title: candidate.title,
    status: "pending",
    tabId: null,
    ownedWindowId: null,
    startedAt: null,
    finishedAt: null
  }));

  const roundSize = payload.roundSize || {
    min: DEFAULT_BATCH_ROUND_SIZE_MIN,
    max: DEFAULT_BATCH_ROUND_SIZE_MAX
  };

  const sessionMode = payload.sessionMode || DEFAULT_SESSION_MODE;
  const sessionRotation = payload.sessionRotation || DEFAULT_SESSION_ROTATION;

  return {
    batchId: payload.batchId,
    serverUrl: payload.serverUrl,
    importPath: payload.importPath,
    roundSize,
    waveSleepMinSeconds: payload.waveSleepMinSeconds,
    waveSleepMaxSeconds: payload.waveSleepMaxSeconds,
    tabOpenDelayMinSeconds: payload.tabOpenDelayMinSeconds,
    tabOpenDelayMaxSeconds: payload.tabOpenDelayMaxSeconds,
    stopOnBlock: payload.stopOnBlock,
    blockStopThreshold: payload.blockStopThreshold,
    sessionMode,
    sessionRotation,
    items,
    nextIndex: 0,
    legacyWaveIndex: 0,
    blockCount: 0,
    roundSession: { windowId: null, closed: false },
    status: {
      batchId: payload.batchId,
      state: "running",
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      extensionVersion: EXTENSION_VERSION,
      roundSize,
      waveSleepMinSeconds: payload.waveSleepMinSeconds,
      waveSleepMaxSeconds: payload.waveSleepMaxSeconds,
      tabOpenDelayMinSeconds: payload.tabOpenDelayMinSeconds,
      tabOpenDelayMaxSeconds: payload.tabOpenDelayMaxSeconds,
      nextTabOpenDelaySeconds: 0,
      stopOnBlock: payload.stopOnBlock,
      blockStopThreshold: payload.blockStopThreshold,
      currentRound: 0,
      roundCount: 0,
      lastRoundSize: 0,
      nextWaveDelaySeconds: 0,
      stopReason: "",
      skipped: 0,
      blocked: 0,
      candidateCount: items.length,
      sessionMode,
      sessionRotation,
      sessionModeIsPrivate: sessionMode === "incognito",
      ownedWindowId: null,
      closedOwnedWindows: 0,
      closedOwnedWindowsSkipped: 0,
      summary: buildBatchSummary(items),
      items: cloneBatchItems(items)
    }
  };
}

function touchBatchStatus(batchRun) {
  batchRun.status.updatedAt = new Date().toISOString();
  batchRun.status.summary = buildBatchSummary(batchRun.items);
  batchRun.status.skipped = batchRun.status.summary.skipped;
  batchRun.status.blocked = countBlockedItems(batchRun.items);
  batchRun.status.items = cloneBatchItems(batchRun.items);
}

function buildBatchSummary(items) {
  const summary = {
    pending: 0,
    running: 0,
    success: 0,
    failure: 0,
    timeout: 0,
    skipped: 0
  };

  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(summary, item.status)) {
      summary[item.status] += 1;
    }
  }

  summary.completed = summary.success + summary.failure + summary.timeout + summary.skipped;
  summary.total = items.length;
  return summary;
}

function cloneBatchItems(items) {
  return items.map((item) => ({
    trackingKey: item.trackingKey,
    url: item.url,
    title: item.title,
    status: item.status,
    tabId: item.tabId,
    ownedWindowId: typeof item.ownedWindowId === "number" ? item.ownedWindowId : null,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    error: item.error || "",
    errorCode: item.errorCode || "",
    statusCode: typeof item.statusCode === "number" ? item.statusCode : null,
    responseStatus: item.responseStatus || ""
  }));
}

function randomDelaySeconds(minSeconds, maxSeconds) {
  const min = Math.max(0, Number.parseInt(minSeconds, 10) || 0);
  const max = Math.max(min, Number.parseInt(maxSeconds, 10) || min);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function buildInterWaveDelaySeconds(batchRun) {
  return randomDelaySeconds(batchRun.waveSleepMinSeconds, batchRun.waveSleepMaxSeconds);
}

function normalizeTabOpenDelayBounds(rawMin, rawMax) {
  const parsedMin = Number.parseFloat(rawMin);
  const parsedMax = Number.parseFloat(rawMax);
  let min = Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : DEFAULT_TAB_OPEN_DELAY_MIN_SECONDS;
  let max = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : DEFAULT_TAB_OPEN_DELAY_MAX_SECONDS;
  if (min < DEFAULT_TAB_OPEN_DELAY_MIN_SECONDS) {
    min = DEFAULT_TAB_OPEN_DELAY_MIN_SECONDS;
  }
  if (max < min) {
    max = min;
  }
  if (max > MAX_TAB_OPEN_DELAY_SECONDS) {
    max = MAX_TAB_OPEN_DELAY_SECONDS;
  }
  return { min, max };
}

function buildTabOpenDelaySeconds(batchRun) {
  const bounds = normalizeTabOpenDelayBounds(
    batchRun && batchRun.tabOpenDelayMinSeconds,
    batchRun && batchRun.tabOpenDelayMaxSeconds
  );
  const lower = bounds.min;
  const upper = bounds.max;
  if (upper <= lower) {
    return lower;
  }
  return lower + Math.random() * (upper - lower);
}

async function processBatchRound(batchRun, waveItems, roundSession) {
  const session = roundSession || (batchRun && batchRun.roundSession) || null;
  const promises = [];
  for (let index = 0; index < waveItems.length; index += 1) {
    if (shouldStopBatch(batchRun)) {
      break;
    }
    promises.push(processBatchItem(batchRun, waveItems[index], session));
    if (index < waveItems.length - 1) {
      const delaySeconds = buildTabOpenDelaySeconds(batchRun);
      batchRun.status.nextTabOpenDelaySeconds = delaySeconds;
      touchBatchStatus(batchRun);
      await persistBatchStatus(batchRun.status);
      await delay(delaySeconds * 1000);
    }
  }
  if (promises.length === 0) {
    return;
  }
  await Promise.all(promises);
  batchRun.status.nextTabOpenDelaySeconds = 0;
  touchBatchStatus(batchRun);
  await persistBatchStatus(batchRun.status);
}

function extractImportResultStatus(response) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const responseBody = response.responseBody && typeof response.responseBody === "object"
    ? response.responseBody
    : null;
  if (!responseBody) {
    return "";
  }
  if (typeof responseBody.status === "string" && responseBody.status) {
    return responseBody.status;
  }
  if (typeof responseBody.result_status === "string" && responseBody.result_status) {
    return responseBody.result_status;
  }
  if (responseBody.result && typeof responseBody.result === "object") {
    const nestedStatus = responseBody.result.status;
    if (typeof nestedStatus === "string" && nestedStatus) {
      return nestedStatus;
    }
  }
  return "";
}

function detectBlockedResponse(response) {
  if (!response || typeof response !== "object") {
    return false;
  }
  return BLOCKED_RESULT_KEYS.has(extractImportResultStatus(response)) ||
    BLOCKED_RESULT_KEYS.has(response.responseStatus) ||
    BLOCKED_RESULT_KEYS.has(response.errorCode) ||
    BLOCKED_STATUS_CODES.has(response.statusCode);
}

function countBlockedItems(items) {
  return items.reduce((count, item) => count + (detectBlockedResponse(item) ? 1 : 0), 0);
}

function shouldStopBatch(batchRun, options = null) {
  const stopOnBlock = options && Object.prototype.hasOwnProperty.call(options, "stopOnBlock")
    ? options.stopOnBlock
    : batchRun.stopOnBlock;
  if (!stopOnBlock) {
    return false;
  }
  const blockStopThreshold = options && options.blockStopThreshold
    ? options.blockStopThreshold
    : batchRun.blockStopThreshold;
  const blocked = countBlockedItems(batchRun.items);
  batchRun.blockCount = blocked;
  batchRun.status.blocked = blocked;
  return blocked >= blockStopThreshold;
}

function markUnstartedItemsSkipped(batchRun, reason) {
  let skipped = 0;
  for (const item of batchRun.items) {
    if (item.status === "pending") {
      item.status = "skipped";
      item.error = reason || "미실행";
      item.finishedAt = new Date().toISOString();
      skipped += 1;
    }
  }
  touchBatchStatus(batchRun);
  return skipped;
}

async function getLatestBatchStatus() {
  if (activeBatchRun && activeBatchRun.status) {
    return activeBatchRun.status;
  }

  const state = await getLocalState([BATCH_STATUS_KEY]);
  return state[BATCH_STATUS_KEY] || null;
}

async function persistBatchStatus(status) {
  await saveLocalState({
    [BATCH_STATUS_KEY]: status
  });
}

function registerBatchTab(entry) {
  batchTabRegistry.set(entry.tabId, entry);
}

async function closeOwnedBatchTab(tabId) {
  const entry = batchTabRegistry.get(tabId);
  if (!entry || entry.ownedByBatch !== true) {
    return;
  }

  batchTabRegistry.delete(tabId);

  try {
    await removeTab(tabId);
  } catch (error) {
    if (!String(error && error.message).includes("No tab with id")) {
      throw error;
    }
  }
}

function registerBatchWindow(entry) {
  if (!entry || typeof entry.windowId !== "number") {
    return;
  }
  batchWindowRegistry.set(entry.windowId, entry);
}

async function openRoundSession(batchRun) {
  if (!batchRun || batchRun.sessionMode !== "incognito") {
    return null;
  }
  const createdWindow = await createWindow({
    url: "about:blank",
    incognito: true,
    focused: false
  });
  if (!createdWindow || typeof createdWindow.id !== "number") {
    throw new Error("private window 생성에 실패했습니다.");
  }
  batchRun.roundSession = {
    windowId: createdWindow.id,
    closed: false
  };
  registerBatchWindow({
    windowId: createdWindow.id,
    batchId: batchRun.batchId,
    ownedByBatch: true,
    batchRunRef: batchRun
  });
  return batchRun.roundSession;
}

async function closeRoundSession(batchRun) {
  if (!batchRun || !batchRun.roundSession) {
    return { closed: 0, skipped: 0 };
  }
  const sessionWindowId = batchRun.roundSession.windowId;
  if (typeof sessionWindowId !== "number") {
    return { closed: 0, skipped: 0 };
  }
  const entry = batchWindowRegistry.get(sessionWindowId);
  if (entry) {
    batchWindowRegistry.delete(sessionWindowId);
  }
  try {
    await removeWindow(sessionWindowId);
  } catch (error) {
    if (!String(error && error.message).includes("No window with id")) {
      throw error;
    }
  }
  batchRun.roundSession.windowId = null;
  batchRun.roundSession.closed = true;
  if (batchRun.status) {
    batchRun.status.closedOwnedWindows = Number(batchRun.status.closedOwnedWindows || 0) + 1;
    batchRun.status.closedOwnedWindowsSkipped = Number(batchRun.status.closedOwnedWindowsSkipped || 0);
    touchBatchStatus(batchRun);
  }
  return { closed: 1, skipped: 0 };
}

async function closeOwnedBatchWindowsForBatch(batchId) {
  if (typeof batchId !== "string" || !batchId) {
    return { closed: 0, skipped: 0 };
  }
  const ownedWindowIds = [];
  for (const [windowId, entry] of batchWindowRegistry.entries()) {
    if (!entry || entry.ownedByBatch !== true) {
      continue;
    }
    if (entry.batchId !== batchId) {
      continue;
    }
    ownedWindowIds.push(windowId);
  }
  let closed = 0;
  let skipped = 0;
  for (const windowId of ownedWindowIds) {
    try {
      const entry = batchWindowRegistry.get(windowId);
      batchWindowRegistry.delete(windowId);
      try {
        await removeWindow(windowId);
      } catch (error) {
        if (!String(error && error.message).includes("No window with id")) {
          throw error;
        }
      }
      if (entry && entry.batchRunRef && entry.batchRunRef.roundSession && entry.batchRunRef.roundSession.windowId === windowId) {
        entry.batchRunRef.roundSession.windowId = null;
        entry.batchRunRef.roundSession.closed = true;
      }
      closed += 1;
    } catch (error) {
      skipped += 1;
    }
  }
  return { closed, skipped };
}

async function closeOwnedBatchTabsForBatch(batchId) {
  if (typeof batchId !== "string" || !batchId) {
    return { closed: 0, skipped: 0 };
  }

  const ownedTabIds = [];
  for (const [tabId, entry] of batchTabRegistry.entries()) {
    if (!entry || entry.ownedByBatch !== true) {
      continue;
    }
    if (entry.batchId !== batchId) {
      continue;
    }
    ownedTabIds.push(tabId);
  }

  let closed = 0;
  let skipped = 0;
  for (const tabId of ownedTabIds) {
    try {
      await closeOwnedBatchTab(tabId);
      closed += 1;
    } catch (error) {
      skipped += 1;
    }
  }
  return { closed, skipped };
}

async function requestPayloadWithRetry(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await sendMessageToTab(tabId, { type: "collect-page-payload" });
      if (response && response.ok && response.payload) {
        validatePayloadShape(response.payload);
        if (response.payload.text.trim()) {
          return response.payload;
        }
      }
    } catch (error) {
      if (!shouldRetryPayloadError(error)) {
        throw error;
      }
    }

    await delay(PAYLOAD_RETRY_INTERVAL_MS);
  }

  const timeoutError = new Error("상품 페이지 payload 수집이 시간 안에 완료되지 않았습니다.");
  timeoutError.code = "payload_timeout";
  throw timeoutError;
}

function shouldRetryPayloadError(error) {
  const message = String(error && error.message ? error.message : "");
  return message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist") ||
    message.includes("지원하지 않는 페이지입니다.") ||
    message.includes("보이는 본문 텍스트가 비어 있습니다.") ||
    message.includes("상품 정보가 아직 준비되지 않았습니다.");
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("상품 페이지 탭 로드를 기다리다 timeout이 발생했습니다."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) {
        return;
      }

      if (changeInfo.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(runtimeError.message));
        return;
      }

      if (tab && tab.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function validatePayloadShape(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("전송 payload가 비어 있습니다.");
  }

  const requiredKeys = ["url", "final_url", "title", "text"];
  for (const key of requiredKeys) {
    if (typeof payload[key] !== "string") {
      throw new Error(`payload ${key} 형식이 올바르지 않습니다.`);
    }
  }

  if (!payload.text.trim()) {
    throw new Error("보이는 본문 텍스트가 비어 있습니다.");
  }

  if (!hasReadyProductEvidence(payload)) {
    throw new Error("상품 정보가 아직 준비되지 않았습니다.");
  }
}

function hasReadyProductEvidence(payload) {
  const text = typeof payload.text === "string" ? payload.text : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const evidenceText = `${title}\n${text}`;
  return PRODUCT_READY_SIGNAL_RE.test(evidenceText) ||
    (
      PRODUCT_PRICE_SIGNAL_RE.test(evidenceText) &&
      /상품|Apple|Mac|iPad|iPhone|Watch|쿠팡|반품|배송/i.test(evidenceText)
    );
}

function buildImportBody(payload) {
  return {
    extension_version: EXTENSION_VERSION,
    url: payload.url,
    final_url: payload.final_url,
    title: payload.title,
    text: payload.text
  };
}

function buildDedupKey(payload) {
  if (typeof payload.dedup_key === "string" && payload.dedup_key.trim()) {
    return payload.dedup_key.trim();
  }

  if (typeof payload.canonical_url === "string" && payload.canonical_url.trim()) {
    return `canonical:${payload.canonical_url.trim()}`;
  }

  return `url:${payload.final_url || payload.url}`;
}

function isSupportedProductUrl(urlString) {
  return typeof urlString === "string" && SUPPORTED_PRODUCT_PAGE_RE.test(urlString);
}

function pruneDedupMetadata(metadata, now) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const next = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!value || typeof value.timestamp !== "number") {
      continue;
    }

    if (now - value.timestamp < AUTO_DEDUP_WINDOW_MS) {
      next[key] = value;
    }
  }

  return next;
}

async function postImport(body, options) {
  const targetServerUrl = options && options.serverUrl ? options.serverUrl : SERVER_URL;
  const targetImportPath = options && options.importPath ? options.importPath : IMPORT_PATH;
  const response = await fetch(`${targetServerUrl}${targetImportPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Price-Monitoring-Extension-Version": EXTENSION_VERSION
    },
    body: JSON.stringify(body)
  });

  const responseBody = await parseJsonResponse(response);
  const errorCode = responseBody.error || responseBody.code || "";
  const errorMessage = responseBody.message || responseBody.error || `HTTP ${response.status}`;
  const ok = response.ok && responseBody.ok !== false;

  return {
    ok,
    statusCode: response.status,
    responseBody,
    errorCode,
    errorMessage
  };
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function initializeDefaults() {
  return getLocalState([AUTO_MODE_KEY, AUTO_DEDUP_KEY, AUTO_STATUS_KEY, BATCH_STATUS_KEY])
    .then((state) => {
      const nextState = {};

      if (typeof state[AUTO_MODE_KEY] !== "boolean") {
        nextState[AUTO_MODE_KEY] = false;
      }

      if (!state[AUTO_DEDUP_KEY] || typeof state[AUTO_DEDUP_KEY] !== "object") {
        nextState[AUTO_DEDUP_KEY] = {};
      }

      if (!Object.prototype.hasOwnProperty.call(state, BATCH_STATUS_KEY)) {
        nextState[BATCH_STATUS_KEY] = null;
      }

      if (Object.keys(nextState).length === 0) {
        return null;
      }

      return saveLocalState(nextState);
    });
}

function getLocalState(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function saveLocalState(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(response);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createWindow(createProperties) {
  return new Promise((resolve, reject) => {
    if (!chrome || !chrome.windows || typeof chrome.windows.create !== "function") {
      reject(new Error("chrome.windows.create API를 사용할 수 없습니다."));
      return;
    }
    chrome.windows.create(createProperties, (window) => {
      const runtimeError = chrome.runtime && chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(window);
    });
  });
}

function removeWindow(windowId) {
  return new Promise((resolve, reject) => {
    if (!chrome || !chrome.windows || typeof chrome.windows.remove !== "function") {
      reject(new Error("chrome.windows.remove API를 사용할 수 없습니다."));
      return;
    }
    chrome.windows.remove(windowId, () => {
      const runtimeError = chrome.runtime && chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

function isAllowedIncognitoAccess() {
  return new Promise((resolve) => {
    if (!chrome || !chrome.extension || typeof chrome.extension.isAllowedIncognitoAccess !== "function") {
      resolve(false);
      return;
    }
    try {
      chrome.extension.isAllowedIncognitoAccess((allowed) => {
        const runtimeError = chrome.runtime && chrome.runtime.lastError;
        if (runtimeError) {
          resolve(false);
          return;
        }
        resolve(Boolean(allowed));
      });
    } catch (error) {
      resolve(false);
    }
  });
}
