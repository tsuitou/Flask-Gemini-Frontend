# gevent を使う場合のモンキーパッチ（WSGIサーバを gevent にするため）
from gevent import monkey
monkey.patch_all()

import os
import json
import bcrypt
import hashlib
import re
import base64
import time
import sqlite3
import joblib
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
from google import genai
from google.genai import types 
from google.genai.types import Tool, GenerateContentConfig, GoogleSearch
from dotenv import load_dotenv
from pathlib import Path
from filelock import FileLock

# -----------------------------------------------------------
# 1) Flask + SocketIO の初期化
# -----------------------------------------------------------
app = Flask(__name__)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*")

# 環境変数の読み込み
load_dotenv()
GOOGLE_API_KEY = os.environ.get('GOOGLE_API_KEY')
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY environment variable not set")
client = genai.Client(api_key=GOOGLE_API_KEY)

google_search_tool = Tool(
    google_search=GoogleSearch()
)
MODELS = os.environ.get('MODELS', '').split(',')
SYSTEM_INSTRUCTION = os.environ.get('SYSTEM_INSTRUCTION')
VERSION = os.environ.get('VERSION')

# -----------------------------------------------------------
# 2) SQLite 用の初期設定
# -----------------------------------------------------------
DB_FILE = 'data/database.db'
os.makedirs('data/', exist_ok=True)  # data/ フォルダがなければ作成

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
    CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY,
        password TEXT,
        auto_login_token TEXT
    )
    ''')
    conn.commit()
    conn.close()

def generate_auto_login_token(username: str, version_salt: str):
    raw = (username + version_salt).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()

def hash_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password, hashed):
    return bcrypt.checkpw(password.encode(), hashed.encode())

def register_user(username, password):
    """新規ユーザー登録"""
    if username == '' or password == '':
        return {'status': 'error', 'message': 'ユーザー名かパスワードが空欄です'}
    # 英数字以外の文字がないかチェック
    if any(not re.match(r'^[a-zA-Z0-9]*$', field) for field in (username, password)):
        return {'status': 'error', 'message': '英数字以外の文字が含まれています。'}

    # すでに同名ユーザーが存在するかチェック
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT username FROM accounts WHERE username=?', (username,))
    existing = c.fetchone()
    if existing:
        conn.close()
        return {'status': 'error', 'message': '既存のユーザー名です。'}

    # 挿入
    hashed_pw = hash_password(password)
    c.execute('INSERT INTO accounts (username, password) VALUES (?, ?)', (username, hashed_pw))
    conn.commit()
    conn.close()
    return {'status': 'success', 'message': '登録完了'}

def authenticate(username, password):
    """ユーザー認証"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT password FROM accounts WHERE username=?', (username,))
    row = c.fetchone()
    conn.close()
    if row:
        hashed_pw = row[0]
        return verify_password(password, hashed_pw)
    return False

# ------------------------
# 認証 (SQLite)
# ------------------------
@socketio.on('register')
def handle_register(data):
    username = data.get('username')
    password = data.get('password')
    result = register_user(username, password)
    emit('register_response', result)

@socketio.on('login')
def handle_login(data):
    username = data.get('username')
    password = data.get('password')
    if authenticate(username, password):
        # 認証成功
        # ここでauto_login_tokenを生成してDBに保存し、クライアントに返す
        version_salt = VERSION  # 適宜、環境変数 or DBで管理してもOK
        auto_login_token = generate_auto_login_token(username, version_salt)
        print(auto_login_token)
        # DBに保存
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute('UPDATE accounts SET auto_login_token=? WHERE username=?', (auto_login_token, username))
        conn.commit()
        conn.close()

        # クライアントには username ではなく auto_login_token を返す
        emit('login_response', {
            'status': 'success',
            'username': username,  # UI表示用にユーザー名も返すことは可能
            'auto_login_token': auto_login_token
        })
    else:
        emit('login_response', {'status': 'error', 'message': 'ログイン失敗'})

@socketio.on('auto_login')
def handle_auto_login(data):
    token = data.get('token', '')

    # 1) まず、DBから「auto_login_token == token」なユーザを探す
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT username, auto_login_token FROM accounts WHERE auto_login_token = ?', (token,))
    row = c.fetchone()
    conn.close()

    if row:
        username, stored_token = row
        # 2) 現在のVERSIONで再ハッシュしたトークンを計算
        new_hash = generate_auto_login_token(username, VERSION)  # username + "v2" をSHA256など

        # 3) DBに保存されているトークンと合うか確認
        if new_hash == stored_token:
            # 一致 => 自動ログイン成功
            emit('auto_login_response', {
                'status': 'success',
                'username': username,
                'auto_login_token': stored_token
            })
        else:
            # 不一致 => バージョンが変わって旧トークンが合わなくなった or 改ざん
            emit('auto_login_response', {
                'status': 'error',
                'message': '自動ログイン失敗（バージョン不一致）'
            })
    else:
        # 該当なし => そもそもトークンが無効
        emit('auto_login_response', {
            'status': 'error',
            'message': '自動ログイン失敗（トークン無効）'
        })

# -----------------------------------------------------------
# 3) チャット用の定数や共通変数
# -----------------------------------------------------------
cancellation_flags = {}

EXTENSION_TO_MIME = {
    'pdf': 'application/pdf', 'js': 'application/x-javascript',
    'py': 'text/x-python', 'css': 'text/css', 'md': 'text/md',
    'csv': 'text/csv', 'xml': 'text/xml', 'rtf': 'text/rtf',
    'txt': 'text/plain', 'png': 'image/png', 'jpeg': 'image/jpeg',
    'jpg': 'image/jpeg', 'webp': 'image/webp', 'heic': 'image/heic',
    'heif': 'image/heif', 'mp4': 'video/mp4', 'mpeg': 'video/mpeg',
    'mov': 'video/mov', 'avi': 'video/avi', 'flv': 'video/x-flv',
    'mpg': 'video/mpg', 'webm': 'video/webm', 'wmv': 'video/wmv',
    '3gpp': 'video/3gpp', 'wav': 'audio/wav', 'mp3': 'audio/mp3',
    'aiff': 'audio/aiff', 'aac': 'audio/aac', 'ogg': 'audio/ogg',
    'flac': 'audio/flac',
}

USER_DIR = 'data/'  # ユーザーデータ保存ディレクトリ

def get_user_dir(username):
    user_dir = os.path.join(USER_DIR, username)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir

# -----------------------------------------------------------
# 4) チャット履歴管理 (従来どおりファイルに保存)
# -----------------------------------------------------------
def load_past_chats(user_dir):
    past_chats_file = os.path.join(user_dir, 'past_chats_list')
    lock_file = past_chats_file + '.lock'  # ロック用ファイル(.lock)

    # withブロックを抜けるまでロックが保持される
    with FileLock(lock_file):
        try:
            past_chats = joblib.load(past_chats_file)
        except Exception:
            past_chats = {}
    return past_chats

def save_past_chats(user_dir, past_chats):
    past_chats_file = os.path.join(user_dir, 'past_chats_list')
    lock_file = past_chats_file + '.lock'

    with FileLock(lock_file):
        joblib.dump(past_chats, past_chats_file)

def load_chat_messages(user_dir, chat_id):
    messages_file = os.path.join(user_dir, f'{chat_id}-st_messages')
    try:
        messages = joblib.load(messages_file)
    except Exception:
        messages = []
    return messages

def save_chat_messages(user_dir, chat_id, messages):
    messages_file = os.path.join(user_dir, f'{chat_id}-st_messages')
    joblib.dump(messages, messages_file)

def load_gemini_history(user_dir, chat_id):
    history_file = os.path.join(user_dir, f'{chat_id}-gemini_messages')
    try:
        history = joblib.load(history_file)
    except Exception:
        history = []
    return history

def save_gemini_history(user_dir, chat_id, history):
    history_file = os.path.join(user_dir, f'{chat_id}-gemini_messages')
    joblib.dump(history, history_file)

def delete_chat(user_dir, chat_id):
    try:
        os.remove(os.path.join(user_dir, f'{chat_id}-st_messages'))
        os.remove(os.path.join(user_dir, f'{chat_id}-gemini_messages'))
    except FileNotFoundError:
        pass
    past_chats = load_past_chats(user_dir)
    if chat_id in past_chats:
        del past_chats[chat_id]
        save_past_chats(user_dir, past_chats)

def find_gemini_index(messages, target_user_messages, include_model_responses=True):
    user_count = 0
    for idx, content in enumerate(messages):
        if content.role == 'user':
            user_count += 1
            if user_count == target_user_messages:
                if include_model_responses:
                    # ユーザー発言に続くすべてのモデルの応答を含める
                    while idx + 1 < len(messages) and messages[idx + 1].role == 'model':
                        idx += 1
                    return idx + 1
                else:
                    # ユーザー発言直後までとする
                    return idx + 1
    return len(messages)

# -----------------------------------------------------------
# 5) Flask ルートと SocketIO イベント
# -----------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('set_username')
def handle_set_username(data):
    username = data.get('username')
    print("Received username from client:", username)
    # 必要ならば、Flask のセッションに保存するなどの処理を実施

# ------------------------
# チャット関連イベント
# ------------------------
@socketio.on('count_token')
def handle_count_token(data):
    model_name = data.get('model_name')
    file_data_base64 = data.get('file_data')
    file_mime_type = data.get('file_mime_type')

    if file_mime_type in EXTENSION_TO_MIME.values():
        file_data = base64.b64decode(file_data_base64)
        file_part = types.Part.from_bytes(data=file_data, mime_type=file_mime_type)
        content = [file_part]
        
        response = client.models.count_tokens(model=model_name, contents=content,)
        token = f"{response.total_tokens:,}"
        emit('total_tokens', {'total_tokens': token})

@socketio.on('get_model_list')
def handle_get_model_list():
    api_models = client.models.list()
    api_model_names = [m.name for m in api_models]
    combined_models = sorted(set(api_model_names + [m.strip() for m in MODELS if m.strip()]))
    emit('model_list', {'models': combined_models})

@socketio.on('cancel_stream')
def handle_cancel_stream(data):
    sid = request.sid
    cancellation_flags[sid] = True

@socketio.on('send_message')
def handle_message(data):
    # キャンセルフラグをリセット
    sid = request.sid
    cancellation_flags[sid] = False

    username = data.get('username')
    chat_id = data.get('chat_id')
    model_name = data.get('model_name')
    message = data.get('message')
    grounding_enabled = data.get('grounding_enabled', False)
    file_data_base64 = data.get('file_data')
    file_name = data.get('file_name')
    file_mime_type = data.get('file_mime_type')

    user_dir = get_user_dir(username)
    messages = load_chat_messages(user_dir, chat_id)
    gemini_history = load_gemini_history(user_dir, chat_id)
    chat = client.chats.create(model=model_name, history=gemini_history)

    # 新規チャットの場合、past_chats にタイトルを登録
    past_chats = load_past_chats(user_dir)
    if chat_id not in past_chats:
        chat_title = message[:29]
        past_chats[chat_id] = {"title": chat_title, "bookmarked": False}
        save_past_chats(user_dir, past_chats)
        emit('history_list', {'history': past_chats})

    # ユーザーのプロンプトを履歴に追加
    messages.append({
        'role': 'user',
        'content': message + (f'\n\n[添付ファイル: {file_name}]' if file_name else '')
    })
    save_chat_messages(user_dir, chat_id, messages)

    try:
        # 添付ファイルがある場合
        if file_data_base64:
            file_data = base64.b64decode(file_data_base64)
            file_part = types.Part.from_bytes(data=file_data, mime_type=file_mime_type)
            contents = [file_part, message]
        else:
            contents = message

        if grounding_enabled:
            configs = GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                tools=[google_search_tool],
                response_modalities=["TEXT"]
            )
        else:
            configs = GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
            )

        # ストリーミング応答開始
        response = chat.send_message_stream(message=contents, config=configs)
        full_response = ""
        response_chunks = []
        usage_metadata = None
        formatted_metadata = ''

        for chunk in response:
            # クライアントがキャンセルをリクエストしたら中断
            if cancellation_flags.get(sid):
                print("Streaming canceled by client")
                break

            if hasattr(chunk, 'usage_metadata') and chunk.usage_metadata:
                usage_metadata = chunk.usage_metadata

            response_chunks.append(chunk)
            if chunk.text:
                full_response += chunk.text
                emit('gemini_response_chunk', {'chunk': chunk.text, 'chat_id': chat_id})

        # トークン数情報を整形
        if not cancellation_flags.get(sid):
            if usage_metadata:
                formatted_metadata = '\n\n---\n**' + model_name + '**    Token: ' + f"{usage_metadata.total_token_count:,}" + '\n\n'
                full_response += formatted_metadata
                emit('gemini_response_chunk', {'chunk': formatted_metadata, 'chat_id': chat_id})
                formatted_metadata = ''

        # グラウンディング処理
        if grounding_enabled and not cancellation_flags.get(sid):
            all_grounding_links = ''
            all_grounding_queries = ''
            for chunk in response_chunks:
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    candidate = chunk.candidates[0]
                    if hasattr(candidate, 'grounding_metadata') and candidate.grounding_metadata:
                        metadata = candidate.grounding_metadata
                        if hasattr(metadata, 'grounding_chunks') and metadata.grounding_chunks:
                            for i, grounding_chunk in enumerate(metadata.grounding_chunks):
                                if hasattr(grounding_chunk, 'web') and grounding_chunk.web:
                                    all_grounding_links += f'[{i + 1}][{grounding_chunk.web.title}]({grounding_chunk.web.uri}) '
                        if hasattr(metadata, 'web_search_queries') and metadata.web_search_queries:
                            for query in metadata.web_search_queries:
                                all_grounding_queries += f'{query} / '

            if all_grounding_queries:
                all_grounding_queries = ' / '.join(
                    sorted(set(all_grounding_queries.rstrip(' /').split(' / ')))
                )
            if all_grounding_links:
                formatted_metadata += all_grounding_links + '\n'
            if all_grounding_queries:
                formatted_metadata += '\nQuery: ' + all_grounding_queries + '\n'
            full_response += formatted_metadata
            emit('gemini_response_chunk', {'chunk': formatted_metadata, 'chat_id': chat_id})

        # キャンセルされていない場合は最終的な応答を保存
        if cancellation_flags.get(sid):
            return

        messages.append({'role': 'model', 'content': full_response})
        save_chat_messages(user_dir, chat_id, messages)
        save_gemini_history(user_dir, chat_id, chat._curated_history)
        emit('gemini_response_complete', {'chat_id': chat_id})

    except Exception as e:
        emit('gemini_response_error', {'error': str(e), 'chat_id': chat_id})
    finally:
        # 応答処理終了後にキャンセルフラグを削除
        cancellation_flags.pop(sid, None)

@socketio.on('disconnect')
def handle_disconnect():
    """クライアント切断時のクリーンアップ"""
    sid = request.sid
    # もしキャンセルフラグが残っていれば削除
    cancellation_flags.pop(sid, None)
    print(f"[disconnect] sid={sid} cleaned up.")

@socketio.on('delete_message')
def handle_delete_message(data):
    username = data.get('username')
    chat_id = data.get('chat_id')
    message_index = data.get('message_index')

    user_dir = get_user_dir(username)
    messages = load_chat_messages(user_dir, chat_id)
    gemini_history = load_gemini_history(user_dir, chat_id)

    if message_index == 0:
        delete_chat(user_dir, chat_id)
    else:
        deleted_message_role = messages[message_index]['role']
        messages = messages[:message_index]
        target_user_messages = sum(1 for msg in messages if msg['role'] == 'user')
        if deleted_message_role == 'model':
            gemini_index = find_gemini_index(gemini_history, target_user_messages, include_model_responses=False)
        else:
            gemini_index = find_gemini_index(gemini_history, target_user_messages, include_model_responses=True)
        gemini_history = gemini_history[:gemini_index]
        save_chat_messages(user_dir, chat_id, messages)
        save_gemini_history(user_dir, chat_id, gemini_history)

    emit('message_deleted', {'index': message_index})

@socketio.on('get_history_list')
def handle_get_history_list(data):
    username = data.get('username')
    user_dir = get_user_dir(username)
    past_chats = load_past_chats(user_dir)
    emit('history_list', {'history': past_chats})

@socketio.on('load_chat')
def handle_load_chat(data):
    username = data.get('username')
    chat_id = data.get('chat_id')
    user_dir = get_user_dir(username)
    messages = load_chat_messages(user_dir, chat_id)
    emit('chat_loaded', {'messages': messages, 'chat_id': chat_id})

@socketio.on('new_chat')
def handle_new_chat(data):
    username = data.get('username')
    new_chat_id = f'{time.time()}'
    emit('chat_created', {'chat_id': new_chat_id})

@socketio.on('delete_chat')
def handle_delete_chat(data):
    username = data.get('username')
    chat_id = data.get('chat_id')
    user_dir = get_user_dir(username)
    delete_chat(user_dir, chat_id)
    emit('chat_deleted', {'chat_id': chat_id})

@socketio.on('set_grounding')
def handle_set_grounding(data):
    grounding_enabled = data.get('grounding_enabled')
    emit('grounding_updated', {'grounding_enabled': grounding_enabled})

@socketio.on('rename_chat')
def handle_rename_chat(data):
    username = data.get('username')
    chat_id = data.get('chat_id')
    new_title = data.get('new_title')
    
    user_dir = get_user_dir(username)
    past_chats = load_past_chats(user_dir)
    
    if chat_id in past_chats:
        past_chats[chat_id]["title"] = new_title
        save_past_chats(user_dir, past_chats)
        emit('chat_renamed', {'chat_id': chat_id, 'new_title': new_title})
        emit('history_list', {'history': past_chats})

# ブックマーク切り替え用のSocketIOイベント
@socketio.on('toggle_bookmark')
def handle_toggle_bookmark(data):
    username = data.get('username')
    chat_id = data.get('chat_id')
    
    user_dir = get_user_dir(username)
    past_chats = load_past_chats(user_dir)
    
    if chat_id in past_chats:
        past_chats[chat_id]["bookmarked"] = not past_chats[chat_id].get("bookmarked", False)
        save_past_chats(user_dir, past_chats)
        emit('bookmark_toggled', {
            'chat_id': chat_id, 
            'bookmarked': past_chats[chat_id]["bookmarked"]
        })
        emit('history_list', {'history': past_chats})
# -----------------------------------------------------------
# 6) メイン実行
# -----------------------------------------------------------
if __name__ == '__main__':
    # SQLite初期化
    init_db()

    # geventベースでサーバ起動（geventインストール済みの場合に自動で使用）
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
