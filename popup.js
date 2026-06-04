const SERVER_URL = "http://100.118.184.5:5000";
const SERVER_ORIGIN = "http://100.118.184.5:5000";
const EXTENSION_VERSION = "0.3.1";
const AUTO_MODE_KEY = "autoModeEnabled";
const AUTO_STATUS_KEY = "lastAutoStatus";
const BATCH_STATUS_KEY = "currentListBatchStatus";
const SUPPORTED_PRODUCT_PAGE_RE = /^https:\/\/www\.coupang\.com\/vp\/products\/[^/?#]+/;

const form = document.getElementById("import-form");
const versionElement = document.getElementById("extension-version");
const serverUrlLabel = document.getElementById("server-url");
const saveButton = document.getElementById("save-button");
const statusElement = document.getElementById("status");
const autoModeToggle = document.getElementById("auto-mode-toggle");
const autoStatusElement = document.getElementById("auto-status");
const batchStatusElement = document.getElementById("batch-status");

serverUrlLabel.textContent = SERVER_URL;
versionElement.textContent = `v${EXTENSION_VERSION}`;

initialize().catch((error) => {
  setStatus(error.message || "초기화에 실패했습니다.", "error");
});

autoModeToggle.addEventListener("change", async () => {
  autoModeToggle.disabled = true;

  try {
    await setStorageValue(AUTO_MODE_KEY, autoModeToggle.checked);
    await renderAutoState();
  } catch (error) {
    autoModeToggle.checked = !autoModeToggle.checked;
    setStatus(error.message || "자동 송신 설정 저장에 실패했습니다.", "error");
  } finally {
    autoModeToggle.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    validateCoupangTab(tab);
    setStatus("페이지 텍스트를 수집하고 있습니다.", "default");

    const payload = await collectPagePayload(tab.id);
    if (!payload.text.trim()) {
      throw new Error("보이는 본문 텍스트가 비어 있습니다.");
    }

    setStatus("서버로 전송하고 있습니다.", "default");

    const response = await chrome.runtime.sendMessage({
      type: "manual-import",
      payload
    });

    if (!response || !response.ok) {
      const detail = response && response.error ? response.error : "알 수 없는 오류";
      throw new Error(`전송 실패: ${detail}`);
    }

    setStatus("가져오기를 요청했습니다. 서버에서 결과를 확인하세요.", "success");
  } catch (error) {
    setStatus(error.message || "알 수 없는 오류가 발생했습니다.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

async function initialize() {
  if (serverUrlLabel.textContent.trim() !== SERVER_ORIGIN) {
    serverUrlLabel.textContent = SERVER_ORIGIN;
  }

  await renderAutoState();
  await renderBatchState();
}

function validateCoupangTab(tab) {
  if (!tab || typeof tab.id !== "number" || !tab.url) {
    throw new Error("활성 탭을 찾을 수 없습니다.");
  }

  let currentUrl;
  try {
    currentUrl = new URL(tab.url);
  } catch (error) {
    throw new Error("현재 탭 URL을 읽을 수 없습니다.");
  }

  if (!SUPPORTED_PRODUCT_PAGE_RE.test(currentUrl.href)) {
    throw new Error("www.coupang.com 상품 상세 페이지에서만 사용할 수 있습니다.");
  }
}

async function collectPagePayload(tabId) {
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const currentUrl = new URL(window.location.href);
      const supported = currentUrl.hostname === "www.coupang.com" &&
        currentUrl.pathname.startsWith("/vp/products/");

      if (!supported) {
        throw new Error("지원하지 않는 페이지입니다.");
      }

      return {
        url: currentUrl.href,
        final_url: window.location.href,
        title: document.title || "",
        text: document.body ? document.body.innerText : ""
      };
    }
  });

  if (!injectionResult || !injectionResult.result) {
    throw new Error("페이지 데이터를 수집하지 못했습니다.");
  }

  return injectionResult.result;
}

async function renderAutoState() {
  const { autoModeEnabled, lastAutoStatus } = await getStorageValues([
    AUTO_MODE_KEY,
    AUTO_STATUS_KEY
  ]);

  autoModeToggle.checked = Boolean(autoModeEnabled);

  if (!lastAutoStatus || typeof lastAutoStatus !== "object") {
    const defaultMessage = autoModeEnabled
      ? "자동 송신이 켜져 있습니다. 지원 상품 페이지를 열면 한 번만 전송합니다."
      : "자동 송신은 현재 꺼져 있습니다.";
    setAutoStatus(defaultMessage, "default");
    return;
  }

  const suffix = lastAutoStatus.at ? ` (${formatTimestamp(lastAutoStatus.at)})` : "";
  setAutoStatus(`${lastAutoStatus.message || "최근 자동 송신 기록이 있습니다."}${suffix}`, lastAutoStatus.tone);
}

async function renderBatchState() {
  const { currentListBatchStatus } = await getStorageValues([BATCH_STATUS_KEY]);
  if (!currentListBatchStatus || typeof currentListBatchStatus !== "object") {
    setBatchStatus("최근 current-list batch 기록이 없습니다.", "default");
    return;
  }

  const summary = currentListBatchStatus.summary || {};
  const completed = Number(summary.completed || 0);
  const total = Number(summary.total || 0);
  const success = Number(summary.success || 0);
  const failure = Number(summary.failure || 0) + Number(summary.timeout || 0);
  const batchId = currentListBatchStatus.batchId || "current-list";
  const updatedAt = currentListBatchStatus.updatedAt
    ? ` (${formatTimestamp(currentListBatchStatus.updatedAt)})`
    : "";
  const stateLabel = currentListBatchStatus.state === "running" ? "진행 중" : "최근 결과";
  const tone = currentListBatchStatus.state === "failed"
    ? "error"
    : currentListBatchStatus.state === "completed"
      ? "success"
      : "default";

  setBatchStatus(
    `${stateLabel}: ${batchId} · ${completed}/${total} 완료 · 성공 ${success} · 실패 ${failure}${updatedAt}`,
    tone
  );
}

function setStatus(message, tone) {
  statusElement.textContent = message;
  if (tone === "error" || tone === "success") {
    statusElement.dataset.tone = tone;
    return;
  }

  delete statusElement.dataset.tone;
}

function setAutoStatus(message, tone) {
  autoStatusElement.textContent = message;
  if (tone === "error" || tone === "success") {
    autoStatusElement.dataset.tone = tone;
    return;
  }

  delete autoStatusElement.dataset.tone;
}

function setBatchStatus(message, tone) {
  batchStatusElement.textContent = message;
  if (tone === "error" || tone === "success") {
    batchStatusElement.dataset.tone = tone;
    return;
  }

  delete batchStatusElement.dataset.tone;
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getStorageValues(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}
