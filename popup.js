const DEFAULT_SERVER_URL = "http://100.118.184.5:5000";
const IMPORT_PATH = "/api/dedicated/coupang_apple_return_sale/detail-check/import";
const STORAGE_KEY = "coupangDetailImportSettings";
const ALLOWED_SERVER_ORIGINS = new Set([
  "http://100.118.184.5:5000",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:5001",
  "http://localhost:5000",
  "http://localhost:5001"
]);

const form = document.getElementById("import-form");
const serverUrlInput = document.getElementById("server-url");
const tokenInput = document.getElementById("token");
const saveButton = document.getElementById("save-button");
const statusElement = document.getElementById("status");

initialize().catch((error) => {
  setStatus(error.message || "초기화에 실패했습니다.", "error");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;

  try {
    const settings = getSettingsFromInputs();
    await saveSettings(settings);

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

    const response = await fetch(`${settings.serverUrl}${IMPORT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`
      },
      body: JSON.stringify(payload)
    });

    const responseBody = await parseJsonResponse(response);
    if (!response.ok || !responseBody.ok) {
      const detail = responseBody.error || responseBody.message || `HTTP ${response.status}`;
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
  const settings = await loadSettings();
  serverUrlInput.value = settings.serverUrl;
  tokenInput.value = settings.token;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedSettings = stored[STORAGE_KEY] || {};
  return {
    serverUrl: normalizeServerUrl(savedSettings.serverUrl || DEFAULT_SERVER_URL),
    token: savedSettings.token || ""
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: settings
  });
}

function getSettingsFromInputs() {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  const token = tokenInput.value.trim();

  if (!serverUrl) {
    throw new Error("서버 URL을 입력하세요.");
  }

  if (!token) {
    throw new Error("Bearer 토큰을 입력하세요.");
  }

  return {
    serverUrl,
    token
  };
}

function normalizeServerUrl(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch (error) {
    throw new Error("서버 URL 형식이 올바르지 않습니다.");
  }

  if (!ALLOWED_SERVER_ORIGINS.has(parsedUrl.origin)) {
    throw new Error("manifest.json에 허용된 서버 URL만 사용할 수 있습니다.");
  }

  return parsedUrl.origin;
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

  if (currentUrl.hostname !== "www.coupang.com") {
    throw new Error("www.coupang.com 상품 페이지에서만 사용할 수 있습니다.");
  }
}

async function collectPagePayload(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (typeof window.collectCoupangDetailImportPayload !== "function") {
        throw new Error("수집 함수를 찾지 못했습니다.");
      }

      return window.collectCoupangDetailImportPayload();
    }
  });

  if (!injectionResult || !injectionResult.result) {
    throw new Error("페이지 데이터를 수집하지 못했습니다.");
  }

  return injectionResult.result;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function setStatus(message, tone) {
  statusElement.textContent = message;
  if (tone === "error" || tone === "success") {
    statusElement.dataset.tone = tone;
    return;
  }

  delete statusElement.dataset.tone;
}
