const socket = io();

// UI要素の取得（省略せずそのまま）
const loginWrapper = document.getElementById("loginWrapper");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const authError = document.getElementById("authError");
const authSuccess = document.getElementById("authSuccess");

const appContainer = document.getElementById("appContainer");
const leftSidebar = document.getElementById("leftSidebar");
const mainContent = document.getElementById("mainContent");
const rightSidebar = document.getElementById("rightSidebar");
const chatHistoryList = document.getElementById("chatHistoryList");
const newChatButton = document.getElementById("newChatButton");
const chatsContainer = document.getElementById("chats");
const chatsWrapper = document.getElementById("chatsWrapper");
const promptForm = document.querySelector(".prompt__form");
const promptInput = document.getElementById("promptInput");
const sendButton = document.getElementById("sendButton");
const stopButton = document.getElementById("stopButton");
const fileInput = document.getElementById("fileInput");
const attachButton = document.getElementById("attachButton");
const modelSelect = document.getElementById("modelSelect");
const groundingSwitch = document.getElementById("groundingSwitch");
const codeExecutionSwitch = document.getElementById("codeExecutionSwitch");
const attachmentPreview = document.getElementById("attachmentPreview");
const dragOverlay = document.getElementById("dragOverlay");

// State variables
let username = null;
let token = null;
let chat_id = null;
let currentModel = null;
let groundingEnabled = false;
let codeExecutionEnabled = false;
let isGeneratingResponse = false;
let fileData = null;
let fileName = null;
let fileMimeType = null;
let isSameChat = false;
let resendMessage = "";
let currentChatTitle = null;
let fileId = null;


const FILE_SIZE_THRESHOLD = 10 * 1024 * 1024;

const md = window.markdownit({
  html: false,
  breaks: true,
});

const tm = window.texmath.use(katex);
md.use(tm, {
  engine: katex,
  delimiters: "dollars", // $...$ と $$...$$ 記法を使用
  katexOptions: {
    strict: false // または 'ignore'
  },
  macros: {
    /* カスタムマクロがあれば設定 */
  },
});

// ----------------------------------------
// 認証 (ログイン/登録)
// ----------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const storedToken = localStorage.getItem("autoLoginToken");
  if (storedToken) {
    // 自動ログインを試みる
    socket.emit("auto_login", { token: storedToken });
  } else {
    // 通常のログインフォーム表示
    showLoginForm();
  }
});

// 自動ログイン用のサーバレスポンス
socket.on("auto_login_response", (data) => {
  if (data.status === "success") {
    // 成功：アプリ表示
    localStorage.setItem("autoLoginToken", data.auto_login_token); // 再発行があれば更新
    localStorage.setItem("username", data.username);
    const loginContainer = document.getElementById("loginContainer");
    if (loginContainer) loginContainer.innerHTML = "";
    const appContainer = document.getElementById("appContainer");
    if (appContainer) appContainer.style.display = "flex";

    initializeApp();
  } else {
    // 失敗：通常のログインフォームを表示
    showLoginForm();
  }
});

function showLoginForm() {
  loginContainer.innerHTML = `
	<div class="login-wrapper" id="loginWrapper">
			<div class="login-form">
					<h2>ログイン / 新規登録</h2>
					<div class="form-group">
							<label for="username">ユーザー名:</label>
							<input type="text" id="username" name="username" required>
					</div>
					<div class="form-group">
							<label for="password">パスワード:</label>
							<input type="password" id="password" name="password" required>
					</div>
					<div class="form-buttons">
							<button id="loginButton">ログイン</button>
							<button id="registerButton">新規登録</button>
					</div>
					<div id="authError" class="error-message"></div>
					<div id="authSuccess" class="success-message"></div>
			</div>
	</div>
	`;
  appContainer.style.display = "none";
  setupLoginHandlers();
}

// ログイン用のイベントハンドラ設定例
function setupLoginHandlers() {
  const loginButton = document.getElementById("loginButton");
  const registerButton = document.getElementById("registerButton");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const authError = document.getElementById("authError");
  const authSuccess = document.getElementById("authSuccess");

  loginButton.addEventListener("click", (e) => {
    e.preventDefault();
    const uname = usernameInput.value;
    const pwd = passwordInput.value;
    socket.emit("login", { username: uname, password: pwd });
  });

  registerButton.addEventListener("click", (e) => {
    e.preventDefault();
    const uname = usernameInput.value;
    const pwd = passwordInput.value;
    socket.emit("register", { username: uname, password: pwd });
  });
}

socket.on("login_response", (response) => {
  const authSuccess = document.getElementById("authSuccess");
  const authError = document.getElementById("authError");

  if (response.status === "success") {
    if (authSuccess) authSuccess.textContent = "ログイン成功";
    if (authError) authError.textContent = "";

    // 従来は localStorage に username を直接保存していたところを、
    // 今回はトークンを保存する
    localStorage.setItem("autoLoginToken", response.auto_login_token);

    // さらにUI用に username も保存したいなら
    localStorage.setItem("username", response.username);

    // 以下は従来通り
    const loginContainer = document.getElementById("loginContainer");
    if (loginContainer) loginContainer.innerHTML = "";
    const appContainer = document.getElementById("appContainer");
    if (appContainer) appContainer.style.display = "flex";

    initializeApp();
  } else {
    if (authError) authError.textContent = response.message;
    if (authSuccess) authSuccess.textContent = "";
  }
});

socket.on("register_response", (response) => {
  // ログインフォームのエラーメッセージ要素が存在するか確認
  const authSuccess = document.getElementById("authSuccess");
  const authError = document.getElementById("authError");

  if (response.status === "success") {
    if (authSuccess)
      authSuccess.textContent = "登録成功。ログインしてください。";
    if (authError) authError.textContent = "";
  } else {
    if (authError) authError.textContent = response.message;
    if (authSuccess) authSuccess.textContent = "";
  }
});

// ユーザー名設定のレスポンスを処理
socket.on("set_username_response", (data) => {
  if (data.status === "success") {
    username = data.username;
    console.log(`認証成功: ${username}`);
  } else {
    console.error("認証エラー:", data.message);
    // エラー時は再ログインを促す
    localStorage.removeItem("autoLoginToken");
    localStorage.removeItem("username");
    showLoginForm();
  }
});

// エラー処理を追加
socket.on("error", (data) => {
  alert(data.message);
  // 認証エラーの場合はログイン画面に戻す
  if (data.message.includes("認証")) {
    localStorage.removeItem("autoLoginToken");
    localStorage.removeItem("username");
    showLoginForm();
  }
});

function initializeApp() {
  username = localStorage.getItem("username");
  token = localStorage.getItem("autoLoginToken");
  socket.emit("set_username", { token: token });

  initializeChatTitle();
  fetchModelList();
  fetchHistoryList();
  startNewChat();
	setupEditor();
	promptForm.addEventListener("submit", handleSendMessage);

  socket.off("chat_deleted");
  socket.on("chat_deleted", (data) => {
    if (chat_id === data.chat_id) {
      startNewChat();
    }
    fetchHistoryList();
  });
}

// ----------------------------------------
// モデル選択
// ----------------------------------------
function fetchModelList() {
  socket.emit("get_model_list");
}

socket.on("model_list", (data) => {
  modelSelect.innerHTML = "";
  data.models.forEach((modelName) => {
    const option = document.createElement("option");
    option.value = modelName;
    option.textContent = modelName.split("/").pop();
    modelSelect.appendChild(option);
  });
  if (data.models.length > 0) {
    currentModel = data.models[0];
    modelSelect.value = currentModel;
  }
  modelSelect.addEventListener("change", (event) => {
    currentModel = event.target.value;
  });
});

// ----------------------------------------
// チャット履歴と新規チャット
// ----------------------------------------

// チャットタイトル表示用のUIを初期化
function initializeChatTitle() {
  const mainContent = document.getElementById("mainContent");

  // 既存の要素があれば削除
  const existingTitle = document.getElementById("chatTitleContainer");
  if (existingTitle) existingTitle.remove();

  // タイトル表示用のHTML
  const titleHTML = `
    <div id="chatTitleContainer" class="chat-title-container">
      <h3 id="chatTitle" class="chat-title">New Chat</h3>
      <div id="titleMenu" class="title-menu hide">
        <div class="title-menu-option" id="renameOption">
          <i class="bx bx-edit"></i> リネーム
        </div>
        <div class="title-menu-option" id="bookmarkOption">
          <i class="bx bx-bookmark"></i> ブックマーク
        </div>
      </div>
      <div id="renameForm" class="rename-form hide">
        <input type="text" id="renameInput" class="rename-input">
        <div class="rename-buttons">
          <button id="saveRenameButton">保存</button>
          <button id="cancelRenameButton">キャンセル</button>
        </div>
      </div>
    </div>
  `;

  // MainContentの先頭に追加
  mainContent.insertAdjacentHTML("afterbegin", titleHTML);

  // イベントリスナー追加
  document
    .getElementById("chatTitle")
    .addEventListener("click", toggleTitleMenu);
  document
    .getElementById("renameOption")
    .addEventListener("click", showRenameForm);
  document
    .getElementById("bookmarkOption")
    .addEventListener("click", toggleBookmark);
  document
    .getElementById("saveRenameButton")
    .addEventListener("click", saveNewTitle);
  document
    .getElementById("cancelRenameButton")
    .addEventListener("click", hideRenameForm);

  // 外部クリックでメニューを非表示に
  document.addEventListener("click", function (e) {
    const titleMenu = document.getElementById("titleMenu");
    const chatTitle = document.getElementById("chatTitle");

    if (
      titleMenu &&
      !titleMenu.classList.contains("hide") &&
      !titleMenu.contains(e.target) &&
      e.target !== chatTitle
    ) {
      titleMenu.classList.add("hide");
    }
  });
}

// タイトルメニューの表示/非表示切り替え
function toggleTitleMenu(e) {
  e.stopPropagation();
  const titleMenu = document.getElementById("titleMenu");
  titleMenu.classList.toggle("hide");
}

// リネームフォームを表示
function showRenameForm() {
  document.getElementById("titleMenu").classList.add("hide");
  document.getElementById("renameForm").classList.remove("hide");

  const renameInput = document.getElementById("renameInput");
  renameInput.value =
    currentChatTitle || document.getElementById("chatTitle").textContent;
  renameInput.focus();
}

// リネームフォームを非表示
function hideRenameForm() {
  document.getElementById("renameForm").classList.add("hide");
}

// 新しいタイトルを保存
function saveNewTitle() {
  const newTitle = document.getElementById("renameInput").value.trim();

  if (newTitle && chat_id) {
    socket.emit("rename_chat", {
      token: token,
      chat_id: chat_id,
      new_title: newTitle,
    });

    // UI即時更新
    document.getElementById("chatTitle").textContent = newTitle;
    currentChatTitle = newTitle;
    hideRenameForm();
  }
}

// ブックマーク切り替え
function toggleBookmark() {
  if (chat_id) {
    socket.emit("toggle_bookmark", {
      token: token,
      chat_id: chat_id,
    });
    document.getElementById("titleMenu").classList.add("hide");
  }
}

// 履歴リストを表示
function displayHistoryList(history) {
  chatHistoryList.innerHTML = "";

  // ブックマークと履歴用のセクション作成
  const bookmarkedHTML = `
    <div class="chat-history-section">
      <h4>ブックマーク</h4>
      <div id="bookmarkedItems" class="chat-history-items"></div>
    </div>
  `;

  const historyHTML = `
    <div class="chat-history-section">
      <h4>履歴</h4>
      <div id="historyItems" class="chat-history-items"></div>
    </div>
  `;

  // HTML追加
  chatHistoryList.innerHTML = bookmarkedHTML + historyHTML;

  const bookmarkedItems = document.getElementById("bookmarkedItems");
  const historyItems = document.getElementById("historyItems");

  // chat_idでソートした履歴アイテム
  const sortedItems = Object.entries(history).sort(
    (a, b) => Number(b[0]) - Number(a[0])
  );

  let hasBookmarks = false;

  // 各チャット履歴アイテムの生成
  sortedItems.forEach(([chatId, chatData]) => {
    // 新形式・旧形式の両方に対応
    const isObject = typeof chatData === "object";
    const chatTitle = isObject ? chatData.title : chatData;
    const isBookmarked = isObject && chatData.bookmarked;

    // チャット履歴アイテムを作成
    const itemHTML = `
      <div class="chat-history-item ${
        chatId === chat_id ? "active" : ""
      }" data-chat-id="${chatId}">
        ${
          isBookmarked
            ? '<i class="bx bxs-bookmark chat-history-bookmark-icon"></i>'
            : ""
        }
        <span>${chatTitle}</span>
        <button class="chat-history-delete-btn">×</button>
      </div>
    `;

    // ブックマークされているかどうかで表示先を決定
    if (isBookmarked) {
      bookmarkedItems.insertAdjacentHTML("beforeend", itemHTML);
      hasBookmarks = true;
    } else {
      historyItems.insertAdjacentHTML("beforeend", itemHTML);
    }
  });

  // ブックマークがない場合はセクションを非表示
  if (!hasBookmarks) {
    document.querySelector(".chat-history-section:first-child").style.display =
      "none";
  }

  // 履歴アイテムにイベントリスナーを追加
  document.querySelectorAll(".chat-history-item").forEach((item) => {
    const chatId = item.getAttribute("data-chat-id");

    // クリックで該当チャットをロード
    item.addEventListener("click", () => {
      loadChat(chatId);
      document
        .querySelectorAll(".chat-history-item")
        .forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
    });

    // 削除ボタン
    item
      .querySelector(".chat-history-delete-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("このチャット履歴を削除しますか？")) {
          socket.emit("delete_chat", { token: token, chat_id: chatId });
        }
      });
  });
}

// サーバーからの応答処理
socket.on("chat_renamed", (data) => {
  if (data.chat_id === chat_id) {
    document.getElementById("chatTitle").textContent = data.new_title;
    currentChatTitle = data.new_title;
  }
});

socket.on("bookmark_toggled", (data) => {
  if (data.chat_id === chat_id) {
    const bookmarkOption = document.getElementById("bookmarkOption");
    if (data.bookmarked) {
      bookmarkOption.innerHTML =
        '<i class="bx bxs-bookmark"></i> ブックマーク解除';
    } else {
      bookmarkOption.innerHTML = '<i class="bx bx-bookmark"></i> ブックマーク';
    }
  }
});

// チャットのロード処理を修正
function loadChat(selectedChatId) {
  if (!username) return;

  // 応答中ならキャンセル処理
  if (isGeneratingResponse) {
    socket.emit("cancel_stream", { token: token, chat_id: chat_id });
    isGeneratingResponse = false;
    setPromptEnabled(true);
    toggleResponseButtons(false);
  }

  isSameChat = chat_id === selectedChatId;
  chat_id = selectedChatId;

  // チャットメッセージと履歴情報をロード
  socket.emit("load_chat", { token: token, chat_id: selectedChatId });

  // ファイル添付情報をリセット
  fileData = null;
  fileName = null;
  fileMimeType = null;
  attachmentPreview.innerHTML = "";
  fileInput.value = "";

  // チャットタイトルを更新
  updateChatTitle(selectedChatId);
}

// チャットタイトルを更新する簡易関数
function updateChatTitle(chatId) {
  // サーバーに履歴情報をリクエスト
  socket.emit("get_history_list", { token: token });

  // 履歴情報のコールバックでタイトルを設定（既存イベント利用）
  socket.once("history_list", (data) => {
    const chatData = data.history[chatId];
    if (chatData) {
      const title = typeof chatData === "object" ? chatData.title : chatData;
      const isBookmarked = typeof chatData === "object" && chatData.bookmarked;

      // タイトル更新
      document.getElementById("chatTitle").textContent = title;
      currentChatTitle = title;

      // ブックマーク状態更新
      const bookmarkOption = document.getElementById("bookmarkOption");
      if (isBookmarked) {
        bookmarkOption.innerHTML =
          '<i class="bx bxs-bookmark"></i> ブックマーク解除';
      } else {
        bookmarkOption.innerHTML =
          '<i class="bx bx-bookmark"></i> ブックマーク';
      }
    }
  });
}

// 新規チャット作成時の処理修正
function startNewChat() {
  if (!username) return;
  socket.emit("new_chat", { token: token });
  chatsContainer.innerHTML = "";
  chat_id = null;
  fileData = null;
  fileName = null;
  fileMimeType = null;
  isSameChat = false;

  // タイトルをリセット
  document.getElementById("chatTitle").textContent = "New Chat";
  currentChatTitle = "New Chat";

  // ブックマークオプションもリセット
  document.getElementById("bookmarkOption").innerHTML =
    '<i class="bx bx-bookmark"></i> ブックマーク';
}

function fetchHistoryList() {
  if (!username) return;
  socket.emit("get_history_list", { token: token });
}

// サーバー側からの最新履歴受信時にも自動で再描画
socket.on("history_list", (data) => {
  displayHistoryList(data.history);
});

newChatButton.addEventListener("click", () => {
  startNewChat();
  document
    .querySelectorAll(".chat-history-item")
    .forEach((item) => item.classList.remove("active"));
});

socket.on("chat_created", (data) => {
  chat_id = data.chat_id; // 新規チャットのIDを保存
  fetchHistoryList(); // 履歴一覧を再読み込み
  loadChat(chat_id);
});

socket.on("chat_loaded", (data) => {
  if (isSameChat) {
    updateChatDisplay(data.messages);
  } else {
    resendMessage = "";
    displayMessages(data.messages);
    scrollToBottom();
  }
  // チャット全体再描画後にコードブロックを処理する
  safeHighlightAll();
  addCopyButtonToCodeBlocks();
  if (resendMessage != "") {
    sendMessage(resendMessage);
    resendMessage = "";
  }
});

function displayMessages(messages) {
  chatsContainer.innerHTML = "";
  messages.forEach((message, index) => {
    const resendButton =
      message.role === "user"
        ? `<button onClick="resendPrompt((this), ${index})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>`
        : "";
    const messageElement = createChatMessageElement(
      `<div class="message__content">
         <p class="message__text"></p>
       </div>
			 <div class="button__icons">
				 <button class="message__delete-button" onclick="deleteChatMessage(${index})"><i class='bx bx-trash'></i></button>
				 <button onClick="copyMessageToClipboard(this)" class="message__copy-button"><i class='bx bx-copy-alt'></i></button>
				 ${resendButton}
			 </div>`,
      message.role,
      message.role === "user" ? "message--outgoing" : "message--incoming"
    );
    const textElement = messageElement.querySelector(".message__text");
    if (message.role === "user") {
      textElement.innerText = message.content;
    } else {
      textElement.innerHTML = md.render(message.content);
    }
    chatsContainer.appendChild(messageElement);
  });
}

// ヘルパー関数：新規メッセージDOM要素を生成する
function createMessageNode(msg, index) {
  const messageClass =
    msg.role === "user" ? "message--outgoing" : "message--incoming";
  const resendButton =
    msg.role === "user"
      ? `<button onClick="resendPrompt((this), ${index})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>`
      : "";
  const htmlContent = `
    <div class="message__content">
      <p class="message__text"></p>
    </div>
		<div class="button__icons">
			<button class="message__delete-button" onclick="deleteChatMessage(${index})"><i class='bx bx-trash'></i></button>
			<button onClick="copyMessageToClipboard(this)" class="message__copy-button"><i class='bx bx-copy-alt'></i></button>
			${resendButton}
		</div>
  `;
  const node = createChatMessageElement(htmlContent, msg.role, messageClass);
  // 現在のメッセージ内容をデータ属性として保持
  node.dataset.msgContent = msg.content;
  return node;
}

// 差分更新用の関数
function updateChatDisplay(newHistory) {
  const newCount = newHistory.length;

  // DOMにあるメッセージ数が新しい履歴より多い場合、末尾から削除
  if (chatsContainer.children.length > 0) {
    while (chatsContainer.children.length >= newCount) {
      chatsContainer.removeChild(chatsContainer.lastChild);
    }
  }

  // DOMに足りない場合は新規要素を追加
  let currentCount = chatsContainer.children.length;
  for (let i = currentCount; i < newCount; i++) {
    const newNode = createMessageNode(newHistory[i], i);
    chatsContainer.appendChild(newNode);
  }

  // すべての要素について、内容が変更されている場合に更新
  for (let i = 0; i < newCount; i++) {
    const newMsg = newHistory[i];
    const domNode = chatsContainer.children[i];
    const textElement = domNode.querySelector(".message__text");

    // 常に末尾は再描画（グラウンディングなど最新状態に更新）
    if (i === newCount - 1) {
      if (newMsg.role === "user") {
        textElement.innerText = newMsg.content;
      } else {
        textElement.innerHTML = md.render(newMsg.content);
      }
      domNode.dataset.msgContent = newMsg.content;
    } else {
      // 既存メッセージは内容が変わっていれば更新
      if (domNode.dataset.msgContent !== newMsg.content) {
        if (newMsg.role === "user") {
          textElement.innerText = newMsg.content;
        } else {
          textElement.innerHTML = md.render(newMsg.content);
        }
        domNode.dataset.msgContent = newMsg.content;
      }
    }
  }

  //scrollToBottom();
}

function deleteChatMessage(index) {
  if (!username || !chat_id) return;
  socket.emit("delete_message", {
    token: token,
    chat_id: chat_id,
    message_index: index,
  });
}

socket.on("message_deleted", (data) => {
  if (data.index === 0) {
    startNewChat();
  } else {
    fetchHistoryList();
    loadChat(chat_id);
  }
});

function resendPrompt(resendButton, index) {
  if (isGeneratingResponse) return;
  resendMessage =
    resendButton.parentElement.parentElement.querySelector(
      ".message__text"
    ).innerText;
  deleteChatMessage(index);
}

// ----------------------------------------
// メッセージ送受信
// ----------------------------------------
function setPromptEnabled(enabled) {
  sendButton.disabled = !enabled;
  // 送信ボタンのスタイルも変更するなどの工夫があれば追加
}

function toggleResponseButtons(isResponding) {
  if (isResponding) {
    sendButton.style.display = "none";
    stopButton.style.display = "block";
  } else {
    sendButton.style.display = "block";
    stopButton.style.display = "none";
  }
}

function handleSendMessage(e) {
  e.preventDefault();
  if (isGeneratingResponse) return;
  const message = promptInput.value;
  if (!message && !fileData) return;

  sendMessage(message);

  promptInput.value = "";
  promptInput.style.height = "auto";
	chatsWrapper.style.paddingBottom = "100px";
}

function sendMessage(message) {
  if (isGeneratingResponse) return;

  // 応答中フラグをセットし、入力欄を無効化
  isGeneratingResponse = true;
  setPromptEnabled(false);
  // 送信ボタンを隠して停止ボタンを表示
  toggleResponseButtons(true);

  const userMessage =
    message + (fileName ? `\n\n[添付ファイル: ${fileName}]` : "");
  displayOutgoingMessage(userMessage);

  // メッセージデータの構築
  const messageData = {
    token: token,
    chat_id: chat_id,
    model_name: currentModel,
    message: message,
    grounding_enabled: groundingEnabled,
		code_execution_enabled: codeExecutionEnabled,
  };

  // ファイル情報の追加 - 大容量と小容量を区別
  if (fileId) {
    // 大容量ファイルはIDを送信
    messageData.file_id = fileId;
    messageData.file_name = fileName;
    messageData.file_mime_type = fileMimeType;
  } else if (fileData) {
    // 小容量ファイルは従来どおりbase64データを送信
    messageData.file_data = fileData;
    messageData.file_name = fileName;
    messageData.file_mime_type = fileMimeType;
  }

  socket.emit("send_message", messageData);
  displayLoadingIndicator();

  // 送信後にファイル情報をリセット
  fileData = null;
  fileName = null;
  fileMimeType = null;
  fileId = null;
  fileInput.value = "";
}

function displayOutgoingMessage(message) {
  const messageHtml = `
    <div class="message__content">
      <p class="message__text"></p>
    </div>
		<div class="button__icons">
			<button class="message__delete-button" onclick="deleteChatMessage(${chatsContainer.children.length})"><i class='bx bx-trash'></i></button>
			<button onClick="copyMessageToClipboard(this)" class="message__copy-button"><i class='bx bx-copy-alt'></i></button>
			<button onClick="resendPrompt((this), ${chatsContainer.children.length})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>
		</div>
  `;
  const messageElement = createChatMessageElement(
    messageHtml,
    "user",
    "message--outgoing"
  );
  messageElement.querySelector(".message__text").innerText = message;
  chatsContainer.appendChild(messageElement);
}

function displayIncomingMessage(message, index) {
  const messageHtml = `
    <div class="message__content">
      <p class="message__text"></p>
    </div>
  `;
  const messageElement = createChatMessageElement(
    messageHtml,
    "model",
    "message--incoming"
  );
  chatsContainer.appendChild(messageElement);
  // scrollToBottom();
  return messageElement.querySelector(".message__text");
}

socket.on("gemini_response_chunk", (data) => {
  if (chat_id !== data.chat_id) return;
  const chunk = data.chunk;
  let messageElement = document.querySelector(
    ".message--incoming:last-child .message__text"
  );
  if (!messageElement) {
    const index = chatsContainer.children.length;
    messageElement = displayIncomingMessage("", index);
  }
  let chunkBuffer = messageElement.dataset.chunkBuffer || "";
  chunkBuffer += chunk;
  messageElement.dataset.chunkBuffer = chunkBuffer;
  // throttle の返り値を即時呼び出す
  const throttledUpdate = throttle(() => {
    messageElement.innerHTML = md.render(chunkBuffer + "\n\n▌");
    safeHighlightAll();
    addCopyButtonToCodeBlocks();
  }, 100);
  throttledUpdate();
  removeLoadingIndicator();
});

socket.on("gemini_response_error", (data) => {
  if (chat_id !== data.chat_id) return;
  // 既存のローディング・受信中の要素があれば削除する
  const loadingElement = document.querySelector(".message--loading");
  if (loadingElement) {
    loadingElement.remove();
  }
  removeLoadingIndicator();
  isGeneratingResponse = false;
  setPromptEnabled(true); // 入力欄を再有効化
  toggleResponseButtons(false);
  displayErrorMessage(data.error);
});

function displayErrorMessage(error) {
  // エラー用のHTMLを作成（アイコンは1つのみ）
  const errorHtml = `
    <div class="message__content message--error">
      <p class="message__text">エラーが発生しました: ${error}</p>
    </div>
    <button class="message__delete-button error-delete" onclick="deleteErrorMessage(this)">
      <i class='bx bx-trash'></i>
    </button>
  `;
  const errorElement = createChatMessageElement(
    errorHtml,
    "model",
    "message--error"
  );
  chatsContainer.appendChild(errorElement);
  // scrollToBottom();
}

socket.on("gemini_response_complete", (data) => {
  if (chat_id !== data.chat_id) return;
  isGeneratingResponse = false;
  // 応答完了時に最新のチャット履歴を再描画する
  loadChat(chat_id);
  // 応答完了後にプロンプト入力欄を再有効化
  setPromptEnabled(true);
  toggleResponseButtons(false);
});

function deleteErrorMessage(button) {
  loadChat(chat_id);
}

// ----------------------------------------
// Loading indicator
// ----------------------------------------
function displayLoadingIndicator() {
  const loadingHtml = `
    <div class="message__content">
      <p class="message__text"></p>
      <div class="message__loading-indicator">
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
      </div>
    </div>
  `;
  const loadingMessageElement = createChatMessageElement(
    loadingHtml,
    "model",
    "message--incoming",
    "message--loading"
  );
  chatsContainer.appendChild(loadingMessageElement);
  scrollToBottom();
}

function removeLoadingIndicator() {
  const loadingElement = document.querySelector(".message--loading");
  if (loadingElement) {
    loadingElement.classList.remove("message--loading");
    const loadingIndicator = loadingElement.querySelector(
      ".message__loading-indicator"
    );
    if (loadingIndicator) {
      loadingIndicator.classList.add("hide");
    }
  }
}

// ----------------------------------------
// UIヘルパー関数
// ----------------------------------------

stopButton.addEventListener("click", () => {
  // 現在応答中ならキャンセルイベントを送信
  if (isGeneratingResponse) {
    socket.emit("cancel_stream", { token: token, chat_id: chat_id });
    // 応答中フラグをリセットして、入力欄を再有効化
    isGeneratingResponse = false;
    setPromptEnabled(true);
    // ボタンを切り替え
    toggleResponseButtons(false);
    loadChat(chat_id);
  }
});

const createChatMessageElement = (htmlContent, role, ...cssClasses) => {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message", ...cssClasses);
  messageElement.classList.add(`message--${role}`);
  messageElement.innerHTML = htmlContent;
  return messageElement;
};

const scrollToBottom = () => {
  setTimeout(() => {
    chatsWrapper.scrollTop = chatsWrapper.scrollHeight;
  }, 0);
};

const copyMessageToClipboard = (copyButton) => {
  const messageContent =
    copyButton.parentElement.parentElement.querySelector(
      ".message__text"
    ).innerText;
  navigator.clipboard.writeText(messageContent);
  copyButton.innerHTML = `<i class='bx bx-check'></i>`;
  setTimeout(
    () => (copyButton.innerHTML = `<i class='bx bx-copy-alt'></i>`),
    2000
  );
};

// 既存の hljs.highlightAll() の呼び出しを置き換える関数
function safeHighlightAll() {
  // 未ハイライトのコードブロックのみを選択
  const notHighlightedBlocks = document.querySelectorAll("pre code:not(.hljs)");
  notHighlightedBlocks.forEach((block) => {
    hljs.highlightElement(block);
  });
}

// コードブロックのコピーボタン追加処理も修正
function addCopyButtonToCodeBlocks() {
  const codeBlocks = document.querySelectorAll("pre");
  codeBlocks.forEach((block) => {
    // 既にコピーボタンが追加されているブロックはスキップ
    if (block.querySelector(".code__copy-btn")) return;

    const codeElement = block.querySelector("code");
    if (!codeElement) return;

    let language =
      [...codeElement.classList]
        .find((cls) => cls.startsWith("language-"))
        ?.replace("language-", "") || "Text";

    const languageLabel = document.createElement("div");
    languageLabel.innerText =
      language.charAt(0).toUpperCase() + language.slice(1);
    languageLabel.classList.add("code__language-label");
    block.appendChild(languageLabel);

    const copyButton = document.createElement("button");
    copyButton.innerHTML = `<i class='bx bx-copy'></i>`;
    copyButton.classList.add("code__copy-btn");
    block.appendChild(copyButton);

    copyButton.addEventListener("click", () => {
      navigator.clipboard
        .writeText(codeElement.innerText)
        .then(() => {
          copyButton.innerHTML = `<i class='bx bx-check'></i>`;
          setTimeout(
            () => (copyButton.innerHTML = `<i class='bx bx-copy'></i>`),
            2000
          );
        })
        .catch((err) => {
          console.error("Copy failed:", err);
          alert("Unable to copy text!");
        });
    });
  });
}

const throttle = (callback, limit) => {
  let waiting = false;
  return function () {
    if (!waiting) {
      callback.apply(this, arguments);
      waiting = true;
      setTimeout(() => {
        waiting = false;
      }, limit);
    }
  };
};

function setupEditor() {
  const textarea = promptInput;
  
  // Tabキーの処理
  textarea.addEventListener('keydown', function(e) {
    // Tabキー
    if (e.key === 'Tab') {
      e.preventDefault();
      
      const start = this.selectionStart;
      const end = this.selectionEnd;
      const value = this.value;
      
      // 選択範囲があるかどうか確認
      if (start !== end) {
        // 複数行の選択処理
        const selectedText = value.substring(start, end);
        const lines = selectedText.split('\n');
        
        // Shiftキーが押されているかどうかチェック
        if (e.shiftKey) {
          // インデント削除
          const processedLines = lines.map(line => {
            if (line.startsWith('\t')) {
              return line.substring(1);
            } else if (line.startsWith('  ')) {
              return line.substring(2);
            }
            return line;
          });
          
          const newText = processedLines.join('\n');
          const indentDiff = selectedText.length - newText.length;
          
          this.value = value.substring(0, start) + newText + value.substring(end);
          this.selectionStart = start;
          this.selectionEnd = end - indentDiff;
        } else {
          // インデント追加
          const processedLines = lines.map(line => '\t' + line);
          const newText = processedLines.join('\n');
          
          this.value = value.substring(0, start) + newText + value.substring(end);
          this.selectionStart = start;
          this.selectionEnd = start + newText.length;
        }
      } else {
        // 単一カーソル位置での処理
        if (e.shiftKey) {
          // カーソル位置ではShift+Tabは何もしない
        } else {
          // カーソル位置にタブを挿入
          this.value = value.substring(0, start) + '\t' + value.substring(end);
          this.selectionStart = this.selectionEnd = start + 1;
        }
      }
    }
  });
  
  // Ctrl+Z (アンドゥ) と Ctrl+Y (リドゥ) の履歴管理
  const history = [];
  let historyIndex = -1;
  let ignoreChange = false;
  
  // 初期値を履歴に追加
  saveToHistory(textarea.value);
  
  // 履歴に保存する関数
  function saveToHistory(value) {
    // 変更を無視する場合はスキップ
    if (ignoreChange) return;
    
    // 現在のインデックス以降の履歴を削除（リドゥ履歴のクリア）
    if (historyIndex < history.length - 1) {
      history.splice(historyIndex + 1);
    }
    
    // 新しい履歴を追加
    history.push(value);
    historyIndex = history.length - 1;
    
    // 履歴が多すぎる場合は古いものを削除
    if (history.length > 100) {
      history.shift();
      historyIndex--;
    }
  }
  
  // テキスト変更時に履歴に追加
  textarea.addEventListener('input', function() {
		this.style.height = "auto";
		this.style.height = this.scrollHeight + "px";
		chatsWrapper.style.paddingBottom = 100 + this.offsetHeight + "px";
    saveToHistory(this.value);
  });
  
  // キーボードショートカット（Ctrl+Z, Ctrl+Y）
  textarea.addEventListener('keydown', function(e) {
    // Ctrl+Z (アンドゥ)
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        ignoreChange = true;
        this.value = history[historyIndex];
        ignoreChange = false;
        
        // カーソル位置を末尾に設定
        this.selectionStart = this.selectionEnd = this.value.length;
      }
    }
    
    // Ctrl+Y (リドゥ)
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        ignoreChange = true;
        this.value = history[historyIndex];
        ignoreChange = false;
        
        // カーソル位置を末尾に設定
        this.selectionStart = this.selectionEnd = this.value.length;
      }
    }
  });
}

// ----------------------------------------
// グラウンディング
// ----------------------------------------
groundingSwitch.addEventListener("change", () => {
  groundingEnabled = groundingSwitch.checked;
});

codeExecutionSwitch.addEventListener("change", () => {
  codeExecutionEnabled = codeExecutionSwitch.checked;
});


// ----------------------------------------
// ファイル添付
// ----------------------------------------
// ドラッグ＆ドロップ関連のイベントリスナー
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  dragOverlay.classList.add("dragover");
});

// 'dragleave' イベントは、要素からマウスが離れたときに発生
document.addEventListener("dragleave", (event) => {
  // body の外にドラッグが出た場合のみ、オーバーレイを非表示にする
  if (!event.relatedTarget) {
    dragOverlay.classList.remove("dragover");
  }
});

document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragOverlay.classList.remove("dragover");

  const files = event.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    handleFile(file);
  }
});

// transitionend イベントを監視し、opacity が 0 になった後に display を none に設定
dragOverlay.addEventListener("transitionend", () => {
  if (dragOverlay.style.opacity === "0") {
    dragOverlay.style.display = "none";
  }
});

function countToken() {
  const data = {
    model_name: currentModel,
    file_data: fileData,
    file_name: fileName,
    file_mime_type: fileMimeType,
  };
  socket.emit("count_token", data);
  return;
}

socket.on("total_tokens", (total_tokens) => {
  const tokenCountDisplay = document.getElementById("tokenCountDisplay");
  tokenCountDisplay.textContent = `token: ${total_tokens.total_tokens}`;
});

function handleFile(file) {
  if (
    !/\.(pdf|js|py|css|md|csv|xml|rtf|txt|png|jpeg|jpg|webp|heic|heif|mp4|mpeg|mov|avi|flv|mpg|webm|wmv|3gpp|wav|mp3|aiff|aac|ogg|flac|xlsx|xlsm)$/i.test(
      file.name
    )
  ) {
    alert("非対応の拡張子です");
    fileData = null;
    fileName = null;
    fileMimeType = null;
    fileInput.value = ""; // ファイル入力欄をリセット
    attachmentPreview.innerHTML = ""; // 添付プレビューもクリア
    return;
  }
  // 10MB 超えるかどうかのチェック
  if (file.size > FILE_SIZE_THRESHOLD) {
    if (
      /\.(mp4|mpeg|mov|avi|flv|mpg|webm|wmv|3gpp|wav|mp3|aiff|aac|ogg|flac)$/i.test(
        file.name
      )
    ) {
      uploadLargeFile(file);
    } else {
      alert("動画・音声以外のファイルサイズ上限は10MBです");
      fileData = null;
      fileName = null;
      fileMimeType = null;
      fileInput.value = ""; // ファイル入力欄をリセット
      attachmentPreview.innerHTML = ""; // 添付プレビューもクリア
    }
    return;
  }

  // 拡張子チェック (xlsx / xlsm の場合はテキスト変換)
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    // SheetJS を使った変換用の読み込み (ArrayBuffer で読み込み)
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      // SheetJS で Workbook を読み込む
      const workbook = XLSX.read(data, { type: "array" });

      // テキスト出力用の変数
      let textOutput = "";

      // 全てのシートをループして CSV(またはTSV) 文字列に変換
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        // CSV 形式で取得 (タブ区切りなら sheet_to_txt などに切り替える)
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        // シート名や区切りを入れたい場合は適宜追記
        textOutput += `=== Sheet: ${sheetName} ===\n${csv}\n\n`;
      });

      // テキストデータをBlob化
      const blob = new Blob([textOutput], { type: "text/plain" });
      const textReader = new FileReader();

      // Blob から DataURL(base64) に変換してプレビュー用に格納
      textReader.onload = (textEvent) => {
        // 先頭の "data:text/plain;base64," などを除去してBase64部分だけを取得
        fileData = textEvent.target.result.split(",")[1];
        // 拡張子を .txt に差し替え
        fileName = file.name.replace(/\.(xlsx|xlsm)$/i, ".txt");
        fileMimeType = "text/plain";
        // プレビュー表記
        const previewHTML = `
									<div id="tokenCountDisplay"></div>
                  <div class="attachment-item">
                    <button class="attachment-delete-btn">×</button>
										<img src="${FILE_IMG_URL}" alt="${fileName}" style="max-width:100%; height:auto;">
										<p>${fileName}</p>
                  </div>
                `;
        attachmentPreview.innerHTML = previewHTML;

        // 削除ボタンのイベント追加
        const deleteBtn = attachmentPreview.querySelector(
          ".attachment-delete-btn"
        );
        deleteBtn.addEventListener("click", () => {
          fileData = null;
          fileName = null;
          fileMimeType = null;
          attachmentPreview.innerHTML = "";
          fileInput.value = "";
        });
      };
      // Blob から DataURL に変換開始
      textReader.readAsDataURL(blob);
    };
    // Excel ファイルを ArrayBuffer 形式で読み込み
    reader.readAsArrayBuffer(file);
  } else {
    // 上記以外 (画像やPDFなど) のファイルは従来どおり DataURL で読み込む
    fileName = file.name;
    fileMimeType = file.type || "application/octet-stream";

    const reader = new FileReader();
    reader.onload = (event) => {
      fileData = event.target.result.split(",")[1];
      let previewHTML = "";
      if (fileMimeType.startsWith("image/")) {
        // 画像プレビュー
        previewHTML = `
									<div id="tokenCountDisplay"></div>
                  <div class="attachment-item">
                    <button class="attachment-delete-btn">×</button>
                    <img src="${event.target.result}" alt="${fileName}" style="max-width:100%; height:auto;">
                  </div>
                `;
      } else {
        previewHTML = `
									<div id="tokenCountDisplay"></div>
                  <div class="attachment-item">
                    <button class="attachment-delete-btn">×</button>
										<img src="${FILE_IMG_URL}" alt="${fileName}" style="max-width:100%; height:auto;">
										<p>${fileName}</p>
                  </div>
                `;
      }
      attachmentPreview.innerHTML = previewHTML;

      // 削除ボタンのイベント追加
      const deleteBtn = attachmentPreview.querySelector(
        ".attachment-delete-btn"
      );
      deleteBtn.addEventListener("click", () => {
        fileData = null;
        fileName = null;
        fileMimeType = null;
        attachmentPreview.innerHTML = "";
        fileInput.value = "";
      });
    };
    reader.readAsDataURL(file);
  }
}

attachButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) {
    handleFile(file);
  } else {
    fileData = null;
    fileName = null;
    fileMimeType = null;
    attachmentPreview.innerHTML = "";
  }
});

// 大容量ファイル用のアップロード関数を追加
function uploadLargeFile(file) {
  // アップロード中の表示
  attachmentPreview.innerHTML = `
        <div class="attachment-item">
            <div class="upload-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <p>アップロード中... 0%</p>
            </div>
        </div>
    `;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("token", token);

  // FormDataでファイルをアップロード
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload_large_file", true);

  // 進捗表示
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percentComplete = Math.round((event.loaded / event.total) * 50);
      const progressFill = attachmentPreview.querySelector(".progress-fill");
      const progressText =
        attachmentPreview.querySelector(".upload-progress p");

      if (progressFill) progressFill.style.width = percentComplete + "%";
      if (progressText)
        progressText.textContent = `アップロード中... ${percentComplete}%`;
    }
  };

  xhr.onload = function () {
    if (xhr.status === 200) {
      try {
        const response = JSON.parse(xhr.responseText);

        if (response.status === "success") {
          // アップロード成功 - ファイルIDを保存
          fileId = response.file_id;
          fileName = response.file_name;
          fileMimeType = response.file_mime_type;
          fileData = null; // base64データは使わない

          // プレビュー表示を更新
          attachmentPreview.innerHTML = `
                        <div id="tokenCountDisplay"></div>
                        <div class="attachment-item">
                            <button class="attachment-delete-btn">×</button>
                            <img src="${FILE_IMG_URL}" alt="${fileName}" style="max-width:100%; height:auto;">
                            <p>${fileName} (アップロード済み)</p>
                        </div>
                    `;

          // 削除ボタンのイベント追加
          const deleteBtn = attachmentPreview.querySelector(
            ".attachment-delete-btn"
          );
          deleteBtn.addEventListener("click", () => {
            fileData = null;
            fileName = null;
            fileMimeType = null;
            fileId = null;
            attachmentPreview.innerHTML = "";
            fileInput.value = "";
          });
        } else {
          // エラー処理
          attachmentPreview.innerHTML = "";
          alert(`アップロードエラー: ${response.message}`);
        }
      } catch (e) {
        attachmentPreview.innerHTML = "";
        alert("応答解析エラー: " + e.message);
      }
    } else {
      attachmentPreview.innerHTML = "";
      alert("アップロードエラー: " + xhr.status);
    }
  };

  xhr.onerror = function () {
    attachmentPreview.innerHTML = "";
    alert("ネットワークエラー");
  };

  xhr.send(formData);
}
