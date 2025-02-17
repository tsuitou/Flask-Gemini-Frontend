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
const promptForm = document.querySelector('.prompt__form');
const promptInput = document.getElementById('promptInput');
const sendButton = document.getElementById('sendButton');
const stopButton = document.getElementById('stopButton');
const fileInput = document.getElementById('fileInput');
const attachButton = document.getElementById('attachButton');
const modelSelect = document.getElementById('modelSelect');
const groundingSwitch = document.getElementById('groundingSwitch');
const attachmentPreview = document.getElementById('attachmentPreview');


// State variables
let username = null;
let chat_id = null;
let currentModel = null;
let groundingEnabled = false;
let isGeneratingResponse = false;
let fileData = null;
let fileName = null;
let fileMimeType = null;

const md = window.markdownit({
  html: false, // htmlタグを有効にする
  breaks: true, // md内の改行を<br>に変換
});

// ----------------------------------------
// 認証 (ログイン/登録)
// ----------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const storedUsername = localStorage.getItem('username');
  const loginContainer = document.getElementById('loginContainer');
  const appContainer = document.getElementById('appContainer');

  if (storedUsername) {
    // ログイン状態の場合：ログインフォームを削除してアプリを表示
    loginContainer.innerHTML = '';  // または loginContainer.remove();
    appContainer.style.display = 'flex';
    initializeApp(); // アプリ初期化処理
  } else {
    // ログイン状態でない場合：ログインフォームを動的に生成して表示
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
    // ログイン用のイベントハンドラを設定
    setupLoginHandlers();
  }
});

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

// SocketIO でログインレスポンスを受け取った後の処理
socket.on('login_response', (response) => {
  // ログインフォームが存在する場合のみ取得
  const authSuccess = document.getElementById('authSuccess');
  const authError = document.getElementById('authError');
  
  if (response.status === 'success') {
    if (authSuccess) authSuccess.textContent = 'ログイン成功';
    if (authError) authError.textContent = '';
    // ログイン状態を保持
    localStorage.setItem('username', response.username);
    const loginContainer = document.getElementById('loginContainer');
    if (loginContainer) loginContainer.innerHTML = '';
    const appContainer = document.getElementById('appContainer');
    if (appContainer) appContainer.style.display = 'flex';
    initializeApp(); // アプリ初期化処理
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
  promptInput.value = '';
  fileData = null;
  fileName = null;
  fileMimeType = null;
}

socket.on('chat_created', (data) => {
  chat_id = data.chat_id; // 新規チャットのIDを保存
  fetchHistoryList();      // 履歴一覧を再読み込み
  loadChat(chat_id);       // 新規チャットを自動で読み込む
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
  chat_id = selectedChatId;
  socket.emit('load_chat', { username: username, chat_id: selectedChatId });
	fileData = null;
	fileName = null;
	fileMimeType = null;
	attachmentPreview.innerHTML = "";
	fileInput.value = "";
}

socket.on('chat_loaded', (data) => {
	if (chat_id === data.chat_id) {
		updateChatDisplay(data.messages);
	} else {
		chat_id = data.chat_id;
	}
  displayMessages(data.messages);
  // チャット全体再描画後にコードブロックを処理する
  hljs.highlightAll();
  addCopyButtonToCodeBlocks();
});

function displayMessages(messages) {
  chatsContainer.innerHTML = '';
  messages.forEach((message, index) => {
    const messageElement = createChatMessageElement(
      `<div class="message__content">
         <img class="message__avatar" src="${ message.role === 'user' ? PROFILE_IMG_URL : GEMINI_IMG_URL }" alt="${message.role} avatar">
         <p class="message__text"></p>
       </div>
       <button class="message__delete-button" onclick="deleteChatMessage(${index})"><i class='bx bx-trash'></i></button>
       <span onClick="copyMessageToClipboard(this)" class="message__icon hide"><i class='bx bx-copy-alt'></i></span>`,
      message.role, message.role === 'user' ? 'message--outgoing' : 'message--incoming'
    );
    messageElement.querySelector('.message__text').innerHTML = md.render(message.content);
    chatsContainer.appendChild(messageElement);
  });
  scrollToBottom();
}

// ヘルパー関数：新規メッセージDOM要素を生成する
function createMessageNode(msg, index) {
  const avatarURL = msg.role === 'user' ? PROFILE_IMG_URL : GEMINI_IMG_URL;
  const messageClass = msg.role === 'user' ? 'message--outgoing' : 'message--incoming';
  const htmlContent = `
    <div class="message__content">
      <img class="message__avatar" src="${avatarURL}" alt="${msg.role} avatar">
      <p class="message__text"></p>
    </div>
    <button class="message__delete-button" onclick="deleteChatMessage(${index})">
      <i class='bx bx-trash'></i>
    </button>
    <span onClick="copyMessageToClipboard(this)" class="message__icon hide">
      <i class='bx bx-copy-alt'></i>
    </span>
  `;
  const node = createChatMessageElement(htmlContent, msg.role, messageClass);
  // 現在のメッセージ内容をデータ属性として保持
  node.dataset.msgContent = msg.content;
  return node;
}

// 差分更新用の関数
function updateChatDisplay(newHistory) {
  const newCount = newHistory.length;
  
  // DOMにあるメッセージ数より多い場合、末尾から削除
  while (chatsContainer.children.length > newCount) {
    chatsContainer.removeChild(chatsContainer.lastChild);
  }
  
  // 削除後に現在の件数を再取得
  let currentCount = chatsContainer.children.length;
  
  // DOMに足りない場合、新規要素を追加
  for (let i = currentCount; i < newCount; i++) {
    const newNode = createMessageNode(newHistory[i], i);
    chatsContainer.appendChild(newNode);
  }
  
  // すべての要素について、内容の更新（常に末尾は再描画）
  for (let i = 0; i < newCount; i++) {
    const newMsg = newHistory[i];
    const domNode = chatsContainer.children[i];
    if (i === newCount - 1) {
      // 常に末尾は再描画（グラウンディングメタデータなど最新状態に更新）
      domNode.querySelector('.message__text').innerHTML = md.render(newMsg.content);
      domNode.dataset.msgContent = newMsg.content;
    } else {
      // 既存メッセージは内容が変わっていれば更新
      if (domNode.dataset.msgContent !== newMsg.content) {
        domNode.querySelector('.message__text').innerHTML = md.render(newMsg.content);
        domNode.dataset.msgContent = newMsg.content;
      }
    }
  }
  
  // scrollToBottom();
}

function deleteChatMessage(index) {
  if (!username || !chat_id) return;
  socket.emit('delete_message', { username: username, chat_id: chat_id, message_index: index });
}

socket.on('message_deleted', (data) => {
  if (chat_id === data.chat_id) {
    loadChat(chat_id);
    fetchHistoryList();
  }
});

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

promptForm.addEventListener('submit', handleSendMessage);

function handleSendMessage(e) {
  e.preventDefault();
  if (isGeneratingResponse) return;
  const message = promptInput.value.trim();
  if (!message && !fileData) return;
  
  // 応答中フラグをセットし、入力欄を無効化
  isGeneratingResponse = true;
  setPromptEnabled(false);
  // 送信ボタンを隠して停止ボタンを表示
  toggleResponseButtons(true);

  const userMessage = message + (fileName ? `\n\n[添付ファイル: ${fileName}]` : '');
  displayOutgoingMessage(userMessage);
  promptInput.value = '';

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
    <button class="message__delete-button" onclick="deleteChatMessage(${chatsContainer.children.length})">
      <i class='bx bx-trash'></i>
    </button>
    <span onClick="copyMessageToClipboard(this)" class="message__icon hide">
      <i class='bx bx-copy-alt'></i>
    </span>
  `;
  const messageElement = createChatMessageElement(messageHtml, 'user', 'message--outgoing');
  // innerText を使用することで、HTMLタグはエスケープされて表示される
  messageElement.querySelector('.message__text').innerText = message;
  chatsContainer.appendChild(messageElement);
  // scrollToBottom();
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
  const messageElement = createChatMessageElement(messageHtml, 'ai', 'message--incoming');
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
  const errorElement = createChatMessageElement(errorHtml, 'ai', 'message--error');
  chatsContainer.appendChild(errorElement);
  // scrollToBottom();
}

socket.on('gemini_response_complete', (data) => {
  if (chat_id !== data.chat_id) return;
  // 応答完了時に最新のチャット履歴を再描画する
  loadChat(chat_id);
  // 応答完了後にプロンプト入力欄を再有効化
  isGeneratingResponse = false;
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
  const loadingMessageElement = createChatMessageElement(loadingHtml, 'ai', 'message--incoming', 'message--loading');
  chatsContainer.appendChild(loadingMessageElement);
  // scrollToBottom();
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
    chatsContainer.scrollTop = chatsContainer.scrollHeight;
    }, 0);
};

const copyMessageToClipboard = (copyButton) => {
  const messageContent = copyButton.parentElement.querySelector('.message__text').innerText;
  navigator.clipboard.writeText(messageContent);
  copyButton.innerHTML = `<i class='bx bx-check'></i>`;
  setTimeout(() => (copyButton.innerHTML = `<i class='bx bx-copy-alt'></i>`), 1000);
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
attachButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        // 20MB = 20 * 1024 * 1024 バイト
        if (file.size > 20 * 1024 * 1024) {
            alert("添付ファイルの容量は20MBを超えることはできません。");
            fileData = null;
            fileName = null;
            fileMimeType = null;
            fileInput.value = ""; // ファイル入力欄をリセット
            attachmentPreview.innerHTML = ""; // 添付プレビューもクリア
            return;
        }

        fileName = file.name;
        fileMimeType = file.type || 'application/octet-stream';
        const reader = new FileReader();
        reader.onload = (event) => {
            // Base64部分を取得
            fileData = event.target.result.split(',')[1];
            let previewHTML = '';
            if (fileMimeType.startsWith('image/')) {
                previewHTML = `
                  <div class="attachment-item">
                    <img src="${event.target.result}" alt="${fileName}" style="max-width:100%; height:auto;">
                    <button class="attachment-delete-btn">×</button>
                  </div>
                `;
            } else {
                previewHTML = `
                  <div class="attachment-item">
                    <p>添付ファイル: ${fileName} (${fileMimeType})</p>
                    <button class="attachment-delete-btn">×</button>
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
    } else {
        fileData = null;
        fileName = null;
        fileMimeType = null;
        attachmentPreview.innerHTML = "";
    }
});

