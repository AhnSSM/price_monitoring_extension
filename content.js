(function registerCollector() {
  function collectCoupangDetailImportPayload() {
    return {
      url: window.location.href,
      final_url: window.location.href,
      title: document.title || "",
      text: document.body ? document.body.innerText : ""
    };
  }

  window.collectCoupangDetailImportPayload = collectCoupangDetailImportPayload;
})();
