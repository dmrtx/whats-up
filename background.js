chrome.runtime.onInstalled.addListener(() => {
  console.log('WhatsApp Web Improver: Extension installed/updated');

  // Reload all WhatsApp Web tabs to ensure content script is injected
  chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      console.log(`Reloading tab: ${tab.id}`);
      chrome.tabs.reload(tab.id);
    });
  });
});
