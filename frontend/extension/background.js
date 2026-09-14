/* ============ 右键菜单：选中文字后右键可触发解析 ============ */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'yanwai-analyze',
    title: '言外 · 解析选中文字',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'yanwai-analyze' && tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'yanwai-analyze' }).catch(() => {});
  }
});
