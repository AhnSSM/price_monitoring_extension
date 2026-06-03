const EXTENSION_VERSION = "0.2.0";
const SERVER_URL = "http://100.118.184.5:5000";
const IMPORT_PATH = "/api/dedicated/coupang_apple_return_sale/detail-check/import";
const AUTO_MODE_KEY = "autoModeEnabled";
const AUTO_STATUS_KEY = "lastAutoStatus";
const AUTO_DEDUP_KEY = "autoDedupMetadata";
const AUTO_DEDUP_WINDOW_MS = 10 * 60 * 1000;
const SUPPORTED_PRODUCT_PAGE_RE = /^https:\/\/www\.coupang\.com\/vp\/products\/[^/?#]+/;

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeDefaults().catch(() => {});
});

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

  return false;
});

async function handleManualImport(payload) {
  validatePayloadShape(payload);
  const response = await postImport({
    ...buildImportBody(payload),
    source: "manual_popup"
  });

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

  const response = await postImport({
    ...buildImportBody(payload),
    source: "auto_page_view"
  });

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

async function initializeDefaults() {
  const state = await getLocalState([AUTO_MODE_KEY, AUTO_DEDUP_KEY, AUTO_STATUS_KEY]);
  const nextState = {};

  if (typeof state[AUTO_MODE_KEY] !== "boolean") {
    nextState[AUTO_MODE_KEY] = false;
  }

  if (!state[AUTO_DEDUP_KEY] || typeof state[AUTO_DEDUP_KEY] !== "object") {
    nextState[AUTO_DEDUP_KEY] = {};
  }

  if (Object.keys(nextState).length > 0) {
    await saveLocalState(nextState);
  }
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

async function postImport(body) {
  const response = await fetch(`${SERVER_URL}${IMPORT_PATH}`, {
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
