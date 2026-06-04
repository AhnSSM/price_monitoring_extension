(function registerCurrentListBridge() {
  const BRIDGE_SOURCE = "price-monitoring-extension";
  const PAGE_SOURCE = "price-monitoring-web";
  const MESSAGE_TYPE_MAP = {
    "pm:ping": "current-list-ping",
    "pm:batch-start": "current-list-batch-start",
    "pm:batch-status": "current-list-batch-status"
  };
  const RESPONSE_TYPE_MAP = {
    "pm:ping": "pm:pong",
    "pm:batch-start": "pm:batch-start-response",
    "pm:batch-status": "pm:batch-status-response"
  };

  if (window.__pmCurrentListBridgeRegistered) {
    return;
  }

  window.__pmCurrentListBridgeRegistered = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || typeof data.type !== "string") {
      return;
    }

    const runtimeMessageType = MESSAGE_TYPE_MAP[data.type];
    if (!runtimeMessageType) {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: runtimeMessageType,
        requestId: data.requestId,
        payload: data.payload
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          postBridgeResponse({
            ok: false,
            type: RESPONSE_TYPE_MAP[data.type],
            requestId: data.requestId,
            error: runtimeError.message
          });
          return;
        }

        postBridgeResponse({
          ...response,
          type: response && typeof response.type === "string"
            ? response.type
            : RESPONSE_TYPE_MAP[data.type],
          requestId: data.requestId
        });
      }
    );
  });

  function postBridgeResponse(payload) {
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        ...payload
      },
      window.location.origin
    );
  }
})();
