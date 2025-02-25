const socket = io();

// UI要素の取得（省略せずそのまま）
const loginWrapper = document.getElementById('loginWrapper');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('loginButton');
const registerButton = document.getElementById('registerButton');
const authError = document.getElementById('authError');
const authSuccess = document.getElementById('authSuccess');

const appContainer = document.getElementById('appContainer');
const leftSidebar = document.getElementById('leftSidebar');
const mainContent = document.getElementById('mainContent');
const rightSidebar = document.getElementById('rightSidebar');
const chatHistoryList = document.getElementById('chatHistoryList');
const newChatButton = document.getElementById('newChatButton');
const chatsContainer = document.getElementById('chats');
const chatsWrapper= document.getElementById('chatsWrapper')
const promptForm = document.querySelector('.prompt__form');
const promptInput = document.getElementById('promptInput');
const sendButton = document.getElementById('sendButton');
const stopButton = document.getElementById('stopButton');
const fileInput = document.getElementById('fileInput');
const attachButton = document.getElementById('attachButton');
const modelSelect = document.getElementById('modelSelect');
const groundingSwitch = document.getElementById('groundingSwitch');
const attachmentPreview = document.getElementById('attachmentPreview');
const dragOverlay = document.getElementById('dragOverlay');


// State variables
let username = null;
let chat_id = null;
let currentModel = null;
let groundingEnabled = false;
let isGeneratingResponse = false;
let fileData = null;
let fileName = null;
let fileMimeType = null;
let isSameChat = false;
let resendMessage = ''

const md = window.markdownit({
  html: false, // htmlタグを有効にする
  breaks: true, // md内の改行を<br>に変換
});

// ----------------------------------------
// 認証 (ログイン/登録)
// ----------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const storedToken = localStorage.getItem('autoLoginToken');
  if (storedToken) {
    // 自動ログインを試みる
    socket.emit('auto_login', { token: storedToken });
  } else {
    // 通常のログインフォーム表示
    showLoginForm();
  }
});

// 自動ログイン用のサーバレスポンス
socket.on('auto_login_response', (data) => {
  if (data.status === 'success') {
    // 成功：アプリ表示
    localStorage.setItem('autoLoginToken', data.auto_login_token); // 再発行があれば更新
    localStorage.setItem('username', data.username);
    const loginContainer = document.getElementById('loginContainer');
    if (loginContainer) loginContainer.innerHTML = '';
    const appContainer = document.getElementById('appContainer');
    if (appContainer) appContainer.style.display = 'flex';

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
	appContainer.style.display = 'none';
	setupLoginHandlers();
}

// ログイン用のイベントハンドラ設定例
function setupLoginHandlers() {
  const loginButton = document.getElementById('loginButton');
  const registerButton = document.getElementById('registerButton');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const authError = document.getElementById('authError');
  const authSuccess = document.getElementById('authSuccess');

  loginButton.addEventListener('click', (e) => {
    e.preventDefault();
    const uname = usernameInput.value;
    const pwd = passwordInput.value;
    socket.emit('login', { username: uname, password: pwd });
  });

  registerButton.addEventListener('click', (e) => {
    e.preventDefault();
    const uname = usernameInput.value;
    const pwd = passwordInput.value;
    socket.emit('register', { username: uname, password: pwd });
  });
}

socket.on('login_response', (response) => {
  const authSuccess = document.getElementById('authSuccess');
  const authError = document.getElementById('authError');
  
  if (response.status === 'success') {
    if (authSuccess) authSuccess.textContent = 'ログイン成功';
    if (authError) authError.textContent = '';

    // 従来は localStorage に username を直接保存していたところを、
    // 今回はトークンを保存する
    localStorage.setItem('autoLoginToken', response.auto_login_token);

    // さらにUI用に username も保存したいなら
    localStorage.setItem('username', response.username);

    // 以下は従来通り
    const loginContainer = document.getElementById('loginContainer');
    if (loginContainer) loginContainer.innerHTML = '';
    const appContainer = document.getElementById('appContainer');
    if (appContainer) appContainer.style.display = 'flex';

    initializeApp();
  } else {
    if (authError) authError.textContent = response.message;
    if (authSuccess) authSuccess.textContent = '';
  }
});

socket.on('register_response', (response) => {
  // ログインフォームのエラーメッセージ要素が存在するか確認
  const authSuccess = document.getElementById('authSuccess');
  const authError = document.getElementById('authError');
  
  if (response.status === 'success') {
    if (authSuccess) authSuccess.textContent = '登録成功。ログインしてください。';
    if (authError) authError.textContent = '';
  } else {
    if (authError) authError.textContent = response.message;
    if (authSuccess) authSuccess.textContent = '';
  }
});

// 例：アプリ初期化処理
function initializeApp() {
  // localStorageからusernameを取得してグローバル変数にセット
  username = localStorage.getItem('username');
  // サーバー側に username を送信（接続直後にセットするなど）
  socket.emit('set_username', { username: username });
  
  // その後、各種初期化処理を実行
  fetchModelList();
  fetchHistoryList();
  startNewChat();
	// グローバルに一度だけ登録（他の場所で重複して登録されないようにする）
	socket.off('chat_deleted'); // 既存のリスナーを削除
	socket.on('chat_deleted', (data) => {
		// 削除されたチャットが現在表示中の場合は新規チャットに切り替え
		if (chat_id === data.chat_id) {
			startNewChat();
		}
		// 履歴一覧を更新
		fetchHistoryList();
	});
}

// ----------------------------------------
// モデル選択
// ----------------------------------------
function fetchModelList() {
  socket.emit('get_model_list');
}

socket.on('model_list', (data) => {
  modelSelect.innerHTML = '';
  data.models.forEach(modelName => {
    const option = document.createElement('option');
    option.value = modelName;
    option.textContent = modelName.split('/').pop();
    modelSelect.appendChild(option);
  });
  if (data.models.length > 0) {
    currentModel = data.models[0];
    modelSelect.value = currentModel;
  }
  modelSelect.addEventListener('change', (event) => {
    currentModel = event.target.value;
  });
});

// ----------------------------------------
// チャット履歴と新規チャット
// ----------------------------------------
function fetchHistoryList() {
  if (!username) return;
  socket.emit('get_history_list', { username: username });
}

function displayHistoryList(history) {
  chatHistoryList.innerHTML = '';

  // chat_id をキーとした履歴アイテムの配列に変換
  const historyItems = Object.entries(history);
  // 降順に並べ替え
  historyItems.sort((a, b) => Number(b[0]) - Number(a[0]));

  historyItems.forEach(([chatId, chatTitle]) => {
    const historyItem = document.createElement('div');
    historyItem.classList.add('chat-history-item');
    historyItem.style.cursor = 'pointer';
    
    // 履歴アイテム全体にクリックイベントを設定
    historyItem.addEventListener('click', () => {
      loadChat(chatId);
      document.querySelectorAll('.chat-history-item').forEach(item => item.classList.remove('active'));
      historyItem.classList.add('active');
    });
    
    // タイトル部分（単なるテキスト）
    const titleSpan = document.createElement('span');
    titleSpan.textContent = chatTitle;
    
    // 削除ボタン
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.classList.add('chat-history-delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('このチャット履歴を削除しますか？')) {
        socket.emit('delete_chat', { username: username, chat_id: chatId });
      }
    });
    
    // アイテムにタイトルと削除ボタンを追加
    historyItem.appendChild(titleSpan);
    historyItem.appendChild(deleteBtn);
    
    if (chatId === chat_id) {
      historyItem.classList.add('active');
    }
    chatHistoryList.appendChild(historyItem);
  });
}

// サーバー側からの最新履歴受信時にも自動で再描画
socket.on('history_list', (data) => {
  displayHistoryList(data.history);
});

newChatButton.addEventListener('click', () => {
  startNewChat();
  document.querySelectorAll('.chat-history-item').forEach(item => item.classList.remove('active'));
});

function startNewChat() {
  if (!username) return;
  socket.emit('new_chat', { username: username });
  chatsContainer.innerHTML = '';
  chat_id = null;
  fileData = null;
  fileName = null;
  fileMimeType = null;
	isSameChat = false;
}

socket.on('chat_created', (data) => {
  chat_id = data.chat_id; // 新規チャットのIDを保存
  fetchHistoryList();      // 履歴一覧を再読み込み
	loadChat(chat_id)
});

function loadChat(selectedChatId) {
  if (!username) return;
  // もし現在応答中ならキャンセルイベントを送信して応答処理を中断する
  if (isGeneratingResponse) {
    socket.emit('cancel_stream', { username: username, chat_id: chat_id });
    isGeneratingResponse = false; // クライアント側のフラグもリセット
		setPromptEnabled(true);
		toggleResponseButtons(false);
  }
	isSameChat = (chat_id === selectedChatId)
  chat_id = selectedChatId;
  socket.emit('load_chat', { username: username, chat_id: selectedChatId });
	fileData = null;
	fileName = null;
	fileMimeType = null;
	attachmentPreview.innerHTML = "";
	fileInput.value = "";
}

socket.on('chat_loaded', (data) => {
	if (isSameChat) {
		updateChatDisplay(data.messages);
	} else {
		resendMessage = ''
		displayMessages(data.messages);
		scrollToBottom();
	}
  // チャット全体再描画後にコードブロックを処理する
  hljs.highlightAll();
  addCopyButtonToCodeBlocks();
	if (resendMessage != '') {
		sendMessage(resendMessage);
		resendMessage = ''
	}
});

function displayMessages(messages) {
  chatsContainer.innerHTML = '';
  messages.forEach((message, index) => {
    const resendButton = message.role === 'user' ? `<button onClick="resendPrompt((this), ${index})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>` : '';
    const messageElement = createChatMessageElement(
      `<div class="message__content">
         <img class="message__avatar" src="${ message.role === 'user' ? PROFILE_IMG_URL : GEMINI_IMG_URL }" alt="${message.role} avatar">
         <p class="message__text"></p>
       </div>
			 <div class="button__icons">
				 <button class="message__delete-button" onclick="deleteChatMessage(${index})"><i class='bx bx-trash'></i></button>
				 <button onClick="copyMessageToClipboard(this)" class="message__copy-button"><i class='bx bx-copy-alt'></i></button>
				 ${resendButton}
			 </div>`,
      message.role, message.role === 'user' ? 'message--outgoing' : 'message--incoming'
    );
		const textElement = messageElement.querySelector('.message__text');
		if (message.role === 'user') {
			textElement.innerText = message.content;
		} else {
			textElement.innerHTML = md.render(message.content);
		}
    chatsContainer.appendChild(messageElement);
  });
}

// ヘルパー関数：新規メッセージDOM要素を生成する
function createMessageNode(msg, index) {
  const avatarURL = msg.role === 'user' ? PROFILE_IMG_URL : GEMINI_IMG_URL;
  const messageClass = msg.role === 'user' ? 'message--outgoing' : 'message--incoming';
	const resendButton = msg.role === 'user' ? `<button onClick="resendPrompt((this), ${index})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>` : '';
  const htmlContent = `
    <div class="message__content">
      <img class="message__avatar" src="${avatarURL}" alt="${msg.role} avatar">
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
    const textElement = domNode.querySelector('.message__text');
    
    // 常に末尾は再描画（グラウンディングなど最新状態に更新）
    if (i === newCount - 1) {
      if (newMsg.role === 'user') {
        textElement.innerText = newMsg.content;
      } else {
        textElement.innerHTML = md.render(newMsg.content);
      }
      domNode.dataset.msgContent = newMsg.content;
    } else {
      // 既存メッセージは内容が変わっていれば更新
      if (domNode.dataset.msgContent !== newMsg.content) {
        if (newMsg.role === 'user') {
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
  socket.emit('delete_message', { username: username, chat_id: chat_id, message_index: index});
}

socket.on('message_deleted', (data) => {
	if (data.index === 0) {
		startNewChat();
	} else { 
		fetchHistoryList();
		loadChat(chat_id);
	}
});

function resendPrompt(resendButton, index) {
	if (isGeneratingResponse) return;
	resendMessage = resendButton.parentElement.parentElement.querySelector('.message__text').innerText;
	deleteChatMessage(index)
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
    sendButton.style.display = 'none';
    stopButton.style.display = 'block';
  } else {
    sendButton.style.display = 'block';
    stopButton.style.display = 'none';
  }
}

function handleKeyDown(event) {
  if (event.key === 'Tab') {
    event.preventDefault(); // デフォルトのTabキーの動作をキャンセル

    const start = promptInput.selectionStart;
    const end = promptInput.selectionEnd;

    // Tab文字を挿入
    promptInput.value = promptInput.value.substring(0, start) + "\t" + promptInput.value.substring(end);

    // カーソル位置を更新
    promptInput.selectionStart = promptInput.selectionEnd = start + 1;
  }
}

promptForm.addEventListener('submit', handleSendMessage);

function handleSendMessage (e) {
  e.preventDefault();
  if (isGeneratingResponse) return;
  const message = promptInput.value;
  if (!message && !fileData) return;

	sendMessage(message);

  promptInput.value = '';
	promptInput.style.height = 'auto';

}

function sendMessage(message) {
  if (isGeneratingResponse) return;

  // 応答中フラグをセットし、入力欄を無効化
  isGeneratingResponse = true;
  setPromptEnabled(false);
  // 送信ボタンを隠して停止ボタンを表示
  toggleResponseButtons(true);

  const userMessage = message + (fileName ? `\n\n[添付ファイル: ${fileName}]` : '');
  displayOutgoingMessage(userMessage);

  const messageData = {
    username: username,
    chat_id: chat_id,
    model_name: currentModel,
    message: message,
    grounding_enabled: groundingEnabled,
    file_data: fileData,
    file_name: fileName,
    file_mime_type: fileMimeType,
  };

  socket.emit('send_message', messageData);
  displayLoadingIndicator();
  fileData = null;
  fileName = null;
  fileMimeType = null;
}


function displayOutgoingMessage(message) {
  const messageHtml = `
    <div class="message__content">
      <img class="message__avatar" src="${PROFILE_IMG_URL}" alt="User avatar">
      <p class="message__text"></p>
    </div>
		<div class="button__icons">
			<button class="message__delete-button" onclick="deleteChatMessage(${chatsContainer.children.length})"><i class='bx bx-trash'></i></button>
			<button onClick="copyMessageToClipboard(this)" class="message__copy-button"><i class='bx bx-copy-alt'></i></button>
			<button onClick="resendPrompt((this), ${chatsContainer.children.length})" class="resend__prompt-button"><i class='bx bx-refresh'></i></button>
		</div>
  `;
  const messageElement = createChatMessageElement(messageHtml, 'user', 'message--outgoing');
  messageElement.querySelector('.message__text').innerText = message;
  chatsContainer.appendChild(messageElement);
}

function displayIncomingMessage(message, index) {
  const messageHtml = `
    <div class="message__content">
      <img class="message__avatar" src="${GEMINI_IMG_URL}" alt="Gemini avatar">
      <p class="message__text"></p>
      <div class="message__loading-indicator hide">
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
      </div>
    </div>
  `;
  const messageElement = createChatMessageElement(messageHtml, 'model', 'message--incoming');
  chatsContainer.appendChild(messageElement);
  // scrollToBottom();
  return messageElement.querySelector('.message__text');
}

socket.on('gemini_response_chunk', (data) => {
  if (chat_id !== data.chat_id) return;
  const chunk = data.chunk;
  let messageElement = document.querySelector('.message--incoming:last-child .message__text');
  if (!messageElement) {
    const index = chatsContainer.children.length;
    messageElement = displayIncomingMessage('', index);
  }
  let chunkBuffer = messageElement.dataset.chunkBuffer || '';
  chunkBuffer += chunk;
  messageElement.dataset.chunkBuffer = chunkBuffer;
  // throttle の返り値を即時呼び出す
  const throttledUpdate = throttle(() => {
    messageElement.innerHTML = md.render(chunkBuffer);
    hljs.highlightAll();
    addCopyButtonToCodeBlocks();
  }, 100);
  throttledUpdate();
  removeLoadingIndicator();
});

socket.on('gemini_response_error', (data) => {
  if (chat_id !== data.chat_id) return;
  // 既存のローディング・受信中の要素があれば削除する
  const loadingElement = document.querySelector('.message--loading');
  if (loadingElement) {
    loadingElement.remove();
  }
  removeLoadingIndicator();
  isGeneratingResponse = false;
  setPromptEnabled(true);  // 入力欄を再有効化
	toggleResponseButtons(false);
  displayErrorMessage(data.error);
});

function displayErrorMessage(error) {
  // エラー用のHTMLを作成（アイコンは1つのみ）
  const errorHtml = `
    <div class="message__content message--error">
      <img class="message__avatar" src="${GEMINI_IMG_URL}" alt="Gemini avatar">
      <p class="message__text">エラーが発生しました: ${error}</p>
    </div>
    <button class="message__delete-button error-delete" onclick="deleteErrorMessage(this)">
      <i class='bx bx-trash'></i>
    </button>
  `;
  const errorElement = createChatMessageElement(errorHtml, 'model', 'message--error');
  chatsContainer.appendChild(errorElement);
  // scrollToBottom();
}

socket.on('gemini_response_complete', (data) => {
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
      <img class="message__avatar" src="${GEMINI_IMG_URL}" alt="Gemini avatar">
      <p class="message__text"></p>
      <div class="message__loading-indicator">
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
        <div class="message__loading-bar"></div>
      </div>
    </div>
  `;
  const loadingMessageElement = createChatMessageElement(loadingHtml, 'model', 'message--incoming', 'message--loading');
  chatsContainer.appendChild(loadingMessageElement);
  scrollToBottom();
}

function removeLoadingIndicator() {
  const loadingElement = document.querySelector('.message--loading');
  if (loadingElement) {
    loadingElement.classList.remove('message--loading');
    const loadingIndicator = loadingElement.querySelector('.message__loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.classList.add('hide');
    }
  }
}

// ----------------------------------------
// UIヘルパー関数
// ----------------------------------------

promptInput.addEventListener('input', function() {
    // 一度高さをリセットして再計算
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

stopButton.addEventListener('click', () => {
  // 現在応答中ならキャンセルイベントを送信
  if (isGeneratingResponse) {
    socket.emit('cancel_stream', { username: username, chat_id: chat_id });
    // 応答中フラグをリセットして、入力欄を再有効化
    isGeneratingResponse = false;
    setPromptEnabled(true);
    // ボタンを切り替え
    toggleResponseButtons(false);
		loadChat(chat_id);
  }
});

const createChatMessageElement = (htmlContent, role, ...cssClasses) => {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', ...cssClasses);
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
  const messageContent = copyButton.parentElement.parentElement.querySelector('.message__text').innerText;
  navigator.clipboard.writeText(messageContent);
  copyButton.innerHTML = `<i class='bx bx-check'></i>`;
  setTimeout(() => (copyButton.innerHTML = `<i class='bx bx-copy-alt'></i>`), 2000);
};

const addCopyButtonToCodeBlocks = () => {
  const codeBlocks = document.querySelectorAll('pre');
  codeBlocks.forEach((block) => {
    if (block.querySelector('.code__copy-btn')) return;
    const codeElement = block.querySelector('code');
    if (!codeElement) return;
    let language = [...codeElement.classList].find((cls) => cls.startsWith('language-'))?.replace('language-', '') || 'Text';
    const languageLabel = document.createElement('div');
    languageLabel.innerText = language.charAt(0).toUpperCase() + language.slice(1);
    languageLabel.classList.add('code__language-label');
    block.appendChild(languageLabel);
    const copyButton = document.createElement('button');
    copyButton.innerHTML = `<i class='bx bx-copy'></i>`;
    copyButton.classList.add('code__copy-btn');
    block.appendChild(copyButton);
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(codeElement.innerText).then(() => {
        copyButton.innerHTML = `<i class='bx bx-check'></i>`;
        setTimeout(() => (copyButton.innerHTML = `<i class='bx bx-copy'></i>`), 2000);
      }).catch((err) => {
        console.error('Copy failed:', err);
        alert('Unable to copy text!');
      });
    });
  });
};

const throttle = (callback, limit) => {
  let waiting = false;
  return function() {
    if (!waiting) {
      callback.apply(this, arguments);
      waiting = true;
      setTimeout(() => { waiting = false; }, limit);
    }
  };
};

// ----------------------------------------
// グラウンディング
// ----------------------------------------
groundingSwitch.addEventListener('change', () => {
  groundingEnabled = groundingSwitch.checked;
  socket.emit('set_grounding', { grounding_enabled: groundingEnabled });
});

socket.on('grounding_updated', (data) => {
  groundingEnabled = data.grounding_enabled;
  groundingSwitch.checked = groundingEnabled;
});

// ----------------------------------------
// ファイル添付
// ----------------------------------------
// ドラッグ＆ドロップ関連のイベントリスナー
document.addEventListener('dragover', (event) => {
    event.preventDefault();
    dragOverlay.classList.add('dragover');
});

// 'dragleave' イベントは、要素からマウスが離れたときに発生
document.addEventListener('dragleave', (event) => {
    // body の外にドラッグが出た場合のみ、オーバーレイを非表示にする
    if (!event.relatedTarget) {
        dragOverlay.classList.remove('dragover');
    }
});

document.addEventListener('drop', (event) => {
    event.preventDefault();
    dragOverlay.classList.remove('dragover');

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        handleFile(file);
    }
});

// transitionend イベントを監視し、opacity が 0 になった後に display を none に設定
dragOverlay.addEventListener('transitionend', () => {
  if (dragOverlay.style.opacity === '0') {
    dragOverlay.style.display = 'none';
  }
});

function countToken() {
		const data = {
			model_name: currentModel,
			file_data: fileData,
			file_name: fileName,
			file_mime_type: fileMimeType,
		};
		socket.emit('count_token', data);
		return;
}

socket.on('total_tokens', (total_tokens) => {
  const tokenCountDisplay = document.getElementById('tokenCountDisplay');
  tokenCountDisplay.textContent = `token: ${total_tokens.total_tokens}`;
});

function handleFile(file) {
    // 20MB 超えるかどうかのチェック
    if (file.size > 20 * 1024 * 1024) {
        alert("添付ファイルの容量は20MBを超えることはできません。");
        fileData = null;
        fileName = null;
        fileMimeType = null;
        fileInput.value = ""; // ファイル入力欄をリセット
        attachmentPreview.innerHTML = ""; // 添付プレビューもクリア
        return;
    }

    // 拡張子チェック (xlsx / xlsm の場合はテキスト変換)
    if (/\.(xlsx|xlsm)$/i.test(file.name)) {
        // SheetJS を使った変換用の読み込み (ArrayBuffer で読み込み)
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            // SheetJS で Workbook を読み込む
            const workbook = XLSX.read(data, { type: 'array' });

            // テキスト出力用の変数
            let textOutput = '';

            // 全てのシートをループして CSV(またはTSV) 文字列に変換
            workbook.SheetNames.forEach((sheetName) => {
                const worksheet = workbook.Sheets[sheetName];
                // CSV 形式で取得 (タブ区切りなら sheet_to_txt などに切り替える)
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                // シート名や区切りを入れたい場合は適宜追記
                textOutput += `=== Sheet: ${sheetName} ===\n${csv}\n\n`;
            });

            // テキストデータをBlob化
            const blob = new Blob([textOutput], { type: 'text/plain' });
            const textReader = new FileReader();

            // Blob から DataURL(base64) に変換してプレビュー用に格納
            textReader.onload = (textEvent) => {
                // 先頭の "data:text/plain;base64," などを除去してBase64部分だけを取得
                fileData = textEvent.target.result.split(',')[1];
                // 拡張子を .txt に差し替え
                fileName = file.name.replace(/\.(xlsx|xlsm)$/i, '.txt');
                fileMimeType = 'text/plain';
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
                const deleteBtn = attachmentPreview.querySelector('.attachment-delete-btn');
                deleteBtn.addEventListener('click', () => {
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
        fileMimeType = file.type || 'application/octet-stream';

        const reader = new FileReader();
        reader.onload = (event) => {
            fileData = event.target.result.split(',')[1];
            let previewHTML = '';
            if (fileMimeType.startsWith('image/')) {
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
            const deleteBtn = attachmentPreview.querySelector('.attachment-delete-btn');
            deleteBtn.addEventListener('click', () => {
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

attachButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
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

