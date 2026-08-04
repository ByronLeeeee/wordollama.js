var wordOllamaTaskPane = null;
var wordOllamaRibbonUI = null;

var WORDOLLAMA_WORKFLOWS = {
  OpenWordOllamaAgent: ["agent", "agent", "Agent"],
  OpenWordOllamaWriting: ["create", "writing", "AI 写作"],
  OpenWordOllamaImage: ["create", "image", "图片理解"],
  OpenWordOllamaTable: ["create", "table", "智能表格"],
  OpenWordOllamaHtml: ["create", "html", "HTML"],
  OpenWordOllamaMarkdown: ["create", "markdown", "Markdown"],
  OpenWordOllamaCustomPrompts: ["create", "custom-prompts", "我的指令"],
  OpenWordOllamaPolish: ["edit", "polish", "润色"],
  OpenWordOllamaExpand: ["edit", "expand", "扩写"],
  OpenWordOllamaSimplify: ["edit", "simplify", "精简"],
  OpenWordOllamaModify: ["edit", "modify", "修改"],
  OpenWordOllamaContinue: ["edit", "continue", "续写"],
  OpenWordOllamaSummarize: ["edit", "summarize", "总结"],
  OpenWordOllamaFix: ["edit", "fix", "校对"],
  OpenWordOllamaTranslate: ["edit", "translate", "自由翻译"],
  OpenWordOllamaRisk: ["legal", "risk", "风险分析"],
  OpenWordOllamaFairness: ["legal", "fairness", "公平审查"],
  OpenWordOllamaMootCourt: ["legal", "moot-court", "模拟法庭"],
  OpenWordOllamaContractCompare: ["compare", "contract-compare", "合同对比"],
  OpenWordOllamaCompare: ["compare", "compare", "文档比较"],
  OpenWordOllamaLawSearch: ["legal", "law-search", "法规检索"],
  OpenWordOllamaReview: ["review", "review", "文档审阅"],
  OpenWordOllamaSettings: ["settings", "settings", "设置"]
};

var WORDOLLAMA_RIBBON_ICONS = {
  WordOllamaAgent: "agent",
  WordOllamaWriting: "writing",
  WordOllamaImage: "image",
  WordOllamaTable: "table",
  WordOllamaHtml: "html",
  WordOllamaMarkdown: "markdown",
  WordOllamaCustomPrompts: "custom-prompts",
  WordOllamaPolish: "polish",
  WordOllamaExpand: "expand",
  WordOllamaSimplify: "simplify",
  WordOllamaModify: "modify",
  WordOllamaContinue: "continue",
  WordOllamaSummarize: "summarize",
  WordOllamaFix: "fix",
  WordOllamaTranslate: "translate",
  WordOllamaRisk: "risk",
  WordOllamaFairness: "fairness",
  WordOllamaMootCourt: "moot-court",
  WordOllamaContractCompare: "contract-compare",
  WordOllamaCompare: "compare",
  WordOllamaLawSearch: "law-search",
  WordOllamaReview: "review",
  WordOllamaSettings: "settings"
};

function WordOllamaOrigin() {
  return window.location.protocol + "//" + window.location.host;
}

function WordOllamaWorkflowUrl(surface, workflow) {
  return WordOllamaOrigin() + "/wps.html?surface=" +
    encodeURIComponent(surface) + "&workflow=" + encodeURIComponent(workflow);
}

function OpenWordOllamaSettingsDialog() {
  return Application.ShowDialog(
    WordOllamaOrigin() + "/settings.html?wpsDialog=1",
    "WordOllama.JS 设置",
    1080,
    760,
    false,
    true,
    2,
    "",
    15000,
    false,
    true,
    true
  );
}

function OnAddInLoad(ribbonUI) {
  wordOllamaRibbonUI = ribbonUI;
  window.wordOllamaRibbonUI = ribbonUI;
}

function OpenWordOllamaWorkflow(surface, workflow, title) {
  var url = WordOllamaWorkflowUrl(surface, workflow);
  if (!wordOllamaTaskPane) {
    wordOllamaTaskPane = Application.CreateTaskPane(url, "WordOllama.JS · " + title);
  } else if (typeof wordOllamaTaskPane.Navigate === "function") {
    wordOllamaTaskPane.Navigate(url);
  }
  if (wordOllamaTaskPane) wordOllamaTaskPane.Visible = true;
  return Boolean(wordOllamaTaskPane);
}

function OpenWordOllama() {
  return OpenWordOllamaWorkflow("agent", "agent", "Agent");
}

Object.keys(WORDOLLAMA_WORKFLOWS).forEach(function (functionName) {
  var route = WORDOLLAMA_WORKFLOWS[functionName];
  window[functionName] = function () {
    return OpenWordOllamaWorkflow(route[0], route[1], route[2]);
  };
});

window.OpenWordOllamaSettings = OpenWordOllamaSettingsDialog;

function GetWordOllamaImage(control) {
  var id = control && (control.Id || control.id);
  var icon = WORDOLLAMA_RIBBON_ICONS[id] || "agent";
  return "assets/ribbon/" + icon + ".svg";
}

window.OnAddInLoad = OnAddInLoad;
window.OpenWordOllama = OpenWordOllama;
window.OpenWordOllamaWorkflow = OpenWordOllamaWorkflow;
window.OpenWordOllamaSettingsDialog = OpenWordOllamaSettingsDialog;
window.GetWordOllamaImage = GetWordOllamaImage;
