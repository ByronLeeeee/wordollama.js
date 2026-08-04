var wordOllamaTaskPane = null;

function WordOllamaBaseUrl() {
  return window.location.href.replace(/\/index\.html(?:[?#].*)?$/i, "").replace(/\/$/, "");
}

function OnAddInLoad(ribbonUI) {
  window.wordOllamaRibbonUI = ribbonUI;
}

function OpenWordOllama() {
  if (!wordOllamaTaskPane) {
    wordOllamaTaskPane = Application.CreateTaskPane(
      WordOllamaBaseUrl() + "/wps.html",
      "WordOllama.JS"
    );
  }
  if (wordOllamaTaskPane) wordOllamaTaskPane.Visible = true;
}
