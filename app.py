import os
import json
import bcrypt
import re
import base64
import time
import joblib
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from google import genai
from google.genai import types 
from google.genai.types import Tool, GenerateContentConfig, GoogleSearch
from dotenv import load_dotenv
from pathlib import Path

cancellation_flags = {}

app = Flask(__name__)
# 必要に応じて cors_allowed_origins を設定
socketio = SocketIO(app, cors_allowed_origins="*")

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

# 拡張子 → MIME の対応表
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

# data/ フォルダがなければ作成
os.makedirs('data/', exist_ok=True)
ACCOUNT_FILE = 'data/accounts.json'
USER_DIR = 'data/'  # ユーザーデータ保存ディレクトリ

# ----------------------------------------
# 認証機能
# ----------------------------------------
def load_accounts():
    if os.path.exists(ACCOUNT_FILE):
        with open(ACCOUNT_FILE, "r") as f:
            try:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                return {}
    return {}

def save_accounts(accounts):
    with open(ACCOUNT_FILE, 'w') as f:
        json.dump(accounts, f, indent=4)

def hash_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password, hashed):
    return bcrypt.checkpw(password.encode(), hashed.encode())

def register_user(username, password):
    if username == '' or password == '':
        return {'status': 'error', 'message': 'ユーザー名かパスワードが空欄です'}
    if any(not re.match(r'^[a-zA-Z0-9]*$', field) for field in (username, password)):
        return {'status': 'error', 'message': '英数字以外の文字が含まれています。'}
    accounts = load_accounts()
    if username in accounts:
        return {'status': 'error', 'message': '既存のユーザー名です。'}
    accounts[username] = hash_password(password)
    save_accounts(accounts)
    return {'status': 'success', 'message': '登録完了'}

def authenticate(username, password):
    accounts = load_accounts()
    if username in accounts and verify_password(password, accounts[username]):
        return True
    return False

@socketio.on('set_username')
def handle_set_username(data):
    username = data.get('username')
    print("Received username from client:", username)
    # 必要ならば、Flask のセッションに保存するなどの処理を実施

# ----------------------------------------
# チャット履歴管理
# ----------------------------------------
def get_user_dir(username):
    user_dir = os.path.join(USER_DIR, username)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir

def load_past_chats(user_dir):
    past_chats_file = os.path.join(user_dir, 'past_chats_list')
    try:
        past_chats = joblib.load(past_chats_file)
    except Exception:
        past_chats = {}
    return past_chats

def save_past_chats(user_dir, past_chats):
    past_chats_file = os.path.join(user_dir, 'past_chats_list')
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

# ----------------------------------------
# Flask ルートと SocketIO イベント
# ----------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

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
        emit('login_response', {'status': 'success', 'username': username})
    else:
        emit('login_response', {'status': 'error', 'message': 'ログイン失敗'})

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
    # 現在のクライアントのセッションIDを取得し、キャンセルフラグをリセット
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
        past_chats[chat_id] = chat_title
        save_past_chats(user_dir, past_chats)
        emit('history_list', {'history': past_chats}, broadcast=True)

    # ユーザーのプロンプトを履歴に追加して保存（UIには既に表示済み）
    messages.append({
        'role': 'user',
        'content': message + (f'\n\n[添付ファイル: {file_name}]' if file_name else '')
    })
    save_chat_messages(user_dir, chat_id, messages)

    try:
        # 添付ファイルがある場合の処理
        if file_data_base64:
            file_data = base64.b64decode(file_data_base64)
            file_part = types.Part.from_bytes(data=file_data, mime_type=file_mime_type)
            contents = [file_part, message]
        else:
            contents = message

        configs = None
        if grounding_enabled:
            configs = GenerateContentConfig(
                tools=[google_search_tool],
                response_modalities=["TEXT"]
            )

        # ストリーミング応答の開始
        response = chat.send_message_stream(message=contents, config=configs)
        full_response = ""
        response_chunks = []

        for chunk in response:
            # クライアントからキャンセル要求が来ている場合は中断
            if cancellation_flags.get(sid):
                print("Streaming canceled by client")
                break

            response_chunks.append(chunk)
            if chunk.text:
                full_response += chunk.text
                emit('gemini_response_chunk', {'chunk': chunk.text, 'chat_id': chat_id})

        # グラウンディング処理（応答がキャンセルされていない場合のみ実施）
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
            formatted_metadata = ''
            if all_grounding_queries:
                all_grounding_queries = ' / '.join(
                    sorted(set(all_grounding_queries.rstrip(' /').split(' / ')))
                )
                formatted_metadata = '\n\n---\n'
            if all_grounding_links:
                formatted_metadata += all_grounding_links + '\n'
            if all_grounding_queries:
                formatted_metadata += '\nクエリ：' + all_grounding_queries + '\n'
            full_response += formatted_metadata
            emit('gemini_response_chunk', {'chunk': formatted_metadata, 'chat_id': chat_id})

        # 応答が途中でキャンセルされていた場合は、保存せずに終了
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
        # メッセージを先頭から指定インデックスまで残す
        deleted_message_role = messages[message_index]['role']
        messages = messages[:message_index]
        # ユーザー発言の数をカウント
        target_user_messages = sum(1 for msg in messages if msg['role'] == 'user')
        if deleted_message_role == 'model':
            gemini_index = find_gemini_index(gemini_history, target_user_messages, include_model_responses=False)
        else:
            gemini_index = find_gemini_index(gemini_history, target_user_messages, include_model_responses=True)
        gemini_history = gemini_history[:gemini_index]
        save_chat_messages(user_dir, chat_id, messages)
        save_gemini_history(user_dir, chat_id, gemini_history)

    emit('message_deleted', {'chat_id': chat_id})

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

if __name__ == '__main__':
    socketio.run(app, debug=True)
