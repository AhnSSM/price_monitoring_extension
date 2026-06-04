(function registerAutoImportContentScript() {
  const AUTO_SEND_DELAY_MS = 1500;
  const SUPPORTED_PATH_PREFIX = "/vp/products/";

  if (window.__pmAutoImportInitialized) {
    return;
  }

  window.__pmAutoImportInitialized = true;

  function isSupportedProductPage(locationObject) {
    return (
      locationObject.hostname === "www.coupang.com" &&
      locationObject.pathname.startsWith(SUPPORTED_PATH_PREFIX)
    );
  }

  function buildCanonicalUrl(locationObject, productId, itemId, vendorItemId) {
    const canonicalUrl = new URL(locationObject.href);
    canonicalUrl.hash = "";
    canonicalUrl.search = "";

    if (itemId) {
      canonicalUrl.searchParams.set("itemId", itemId);
    }

    if (vendorItemId) {
      canonicalUrl.searchParams.set("vendorItemId", vendorItemId);
    }

    if (!productId && !itemId && !vendorItemId) {
      return canonicalUrl.href;
    }

    return canonicalUrl.href;
  }

  function collectIdentifiers(locationObject) {
    const pathMatch = locationObject.pathname.match(/^\/vp\/products\/([^/?#]+)/);
    const productId = pathMatch ? pathMatch[1] : "";
    const itemId = locationObject.searchParams.get("itemId") || "";
    const vendorItemId = locationObject.searchParams.get("vendorItemId") || "";
    const canonicalUrl = buildCanonicalUrl(locationObject, productId, itemId, vendorItemId);
    const dedupKey = productId || itemId || vendorItemId
      ? `product:${productId}|item:${itemId}|vendor:${vendorItemId}`
      : `canonical:${canonicalUrl}`;

    return {
      productId,
      itemId,
      vendorItemId,
      canonicalUrl,
      dedupKey
    };
  }

  function buildPayload() {
    const currentUrl = new URL(window.location.href);
    if (!isSupportedProductPage(currentUrl)) {
      return null;
    }

    const identifiers = collectIdentifiers(currentUrl);
    return {
      url: currentUrl.href,
      final_url: window.location.href,
      title: document.title || "",
      text: document.body ? document.body.innerText : "",
      dedup_key: identifiers.dedupKey,
      canonical_url: identifiers.canonicalUrl,
      product_id: identifiers.productId,
      item_id: identifiers.itemId,
      vendor_item_id: identifiers.vendorItemId
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "collect-page-payload") {
      return false;
    }

    try {
      const payload = buildPayload();
      if (!payload) {
        throw new Error("지원하지 않는 페이지입니다.");
      }

      if (!payload.text.trim()) {
        throw new Error("보이는 본문 텍스트가 비어 있습니다.");
      }

      sendResponse({
        ok: true,
        payload
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error.message || "페이지 payload 수집에 실패했습니다."
      });
    }

    return true;
  });

  function scheduleAutoSend() {
    if (window.__pmAutoImportScheduledFor === window.location.href) {
      return;
    }

    if (!isSupportedProductPage(window.location)) {
      return;
    }

    window.__pmAutoImportScheduledFor = window.location.href;

    window.setTimeout(() => {
      const payload = buildPayload();
      if (!payload || !payload.text.trim()) {
        return;
      }

      chrome.runtime.sendMessage({
        type: "auto-page-view",
        payload
      });
    }, AUTO_SEND_DELAY_MS);
  }

  scheduleAutoSend();

  if (document.readyState !== "complete") {
    window.addEventListener("load", scheduleAutoSend, { once: true });
  }
})();
