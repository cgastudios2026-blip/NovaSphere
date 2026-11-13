import json
import os
import smtplib
import sqlite3
import uuid
from datetime import datetime
from email.message import EmailMessage
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'app.db')
PORT = int(os.environ.get('PORT', '8000'))
SMTP_HOST = os.getenv('SMTP_HOST', 'disabled')
SMTP_PORT = int(os.getenv('SMTP_PORT', '1025'))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SMTP_FROM = os.getenv('SMTP_FROM', 'no-reply@novasphere.local')


def hash_password(password: str) -> str:
    return sha256(password.encode('utf-8')).hexdigest()


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def calculate_age(dob: str) -> int:
    if not dob:
        return 0
    try:
        birth_date = datetime.strptime(dob, '%Y-%m-%d')
        today = datetime.today()
        age = today.year - birth_date.year
        if (today.month, today.day) < (birth_date.month, birth_date.day):
            age -= 1
        return age
    except ValueError:
        return 0


def ensure_column(table_name: str, column_name: str, column_definition: str):
    conn = get_db_connection()
    columns = [row['name'] for row in conn.execute(f'PRAGMA table_info({table_name})').fetchall()]
    if column_name not in columns:
        conn.execute(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}')
    conn.commit()
    conn.close()


def init_db():
    conn = get_db_connection()
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            dob TEXT NOT NULL,
            age INTEGER NOT NULL,
            password TEXT NOT NULL,
            accepted_terms INTEGER NOT NULL DEFAULT 0,
            accepted_privacy INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            level INTEGER DEFAULT 1,
            xp INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            used INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.commit()
    conn.close()

    ensure_column('users', 'accepted_terms', 'INTEGER NOT NULL DEFAULT 0')
    ensure_column('users', 'accepted_privacy', 'INTEGER NOT NULL DEFAULT 0')
    ensure_column('progress', 'level', 'INTEGER DEFAULT 1')
    ensure_column('progress', 'xp', 'INTEGER DEFAULT 0')
    ensure_column('progress', 'streak', 'INTEGER DEFAULT 0')
    ensure_column('progress', 'wins', 'INTEGER DEFAULT 0')
    ensure_column('progress', 'score', 'INTEGER DEFAULT 0')

    conn = get_db_connection()
    conn.execute(
        '''
        INSERT OR IGNORE INTO progress (email, level, xp, streak, wins, score)
        VALUES ('demo@novasphere.com', 12, 840, 7, 35, 1500)
        '''
    )
    conn.commit()
    conn.close()


def send_json(handler, payload, status=200):
    data = json.dumps(payload).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def parse_body(handler):
    length = int(handler.headers.get('Content-Length', '0'))
    raw = handler.rfile.read(length) if length else b''
    return json.loads(raw.decode('utf-8')) if raw else {}


def get_session_user(handler):
    auth_header = handler.headers.get('Authorization', '')
    token = auth_header.replace('Bearer ', '').strip() if auth_header.startswith('Bearer ') else ''
    if not token:
        return None
    conn = get_db_connection()
    row = conn.execute('SELECT email FROM sessions WHERE token = ?', (token,)).fetchone()
    conn.close()
    return row['email'] if row else None


def send_reset_email(email: str, token: str) -> bool:
    reset_link = f'http://localhost:{PORT}/reset?token={token}'
    message = EmailMessage()
    message['Subject'] = 'NovaSphere password reset request'
    message['From'] = SMTP_FROM
    message['To'] = email
    message.set_content(
        f'Hello,\n\nUse the following link to reset your NovaSphere password:\n{reset_link}\n\nIf you did not request this, ignore this email.'
    )

    try:
        if not SMTP_HOST or SMTP_HOST.strip().lower() == 'disabled':
            print(f'Password reset link for {email}: {reset_link}')
            return True
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=5) as server:
            server.ehlo()
            if SMTP_USER and SMTP_PASS:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(message)
        return True
    except Exception as exc:
        print(f'SMTP send failed: {exc}')
        print(f'Password reset link for {email}: {reset_link}')
        return False


def route_static(handler, path):
    if path in ('', '/'):
        path = '/index.html'
    sanitized = path.lstrip('/')
    if sanitized.startswith('api/'):
        return False
    if '..' in sanitized:
        handler.send_error(403)
        return True
    file_path = os.path.join(BASE_DIR, sanitized)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        ext = os.path.splitext(file_path)[1].lower()
        mime = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }.get(ext, 'application/octet-stream')
        with open(file_path, 'rb') as file:
            content = file.read()
        handler.send_response(200)
        handler.send_header('Content-Type', mime)
        handler.send_header('Content-Length', str(len(content)))
        handler.end_headers()
        handler.wfile.write(content)
        return True
    handler.send_error(404)
    return True


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/health':
            send_json(self, {'status': 'ok', 'service': 'novasphere'})
            return

        if path == '/api/leaderboard':
            conn = get_db_connection()
            rows = conn.execute(
                '''
                SELECT u.first_name, u.last_name, p.score, p.streak
                FROM progress p
                JOIN users u ON u.email = p.email
                ORDER BY p.score DESC, p.wins DESC
                LIMIT 10
                '''
            ).fetchall()
            conn.close()
            leaderboard = [
                {
                    'name': f"{row['first_name']} {row['last_name']}".strip(),
                    'score': int(row['score']) if row['score'] is not None else 0,
                    'streak': int(row['streak']) if row['streak'] is not None else 0,
                }
                for row in rows
            ]
            if not leaderboard:
                leaderboard = [
                    {'name': 'Nova User', 'score': 1500, 'streak': 7},
                    {'name': 'Ava', 'score': 1420, 'streak': 6},
                    {'name': 'Milo', 'score': 1380, 'streak': 8},
                ]
            send_json(self, {'leaderboard': leaderboard})
            return

        if path == '/api/progress':
            email = get_session_user(self)
            if not email:
                send_json(self, {'message': 'Authentication required.'}, 401)
                return
            conn = get_db_connection()
            row = conn.execute(
                'SELECT level, xp, streak, wins, score FROM progress WHERE email = ?', (email,)
            ).fetchone()
            conn.close()
            if not row:
                send_json(self, {'message': 'No progress yet.'}, 404)
                return
            send_json(self, {
                'level': row['level'],
                'xp': row['xp'],
                'streak': row['streak'],
                'wins': row['wins'],
                'score': row['score'],
            })
            return

        if not route_static(self, path):
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/register':
            try:
                payload = parse_body(self)
            except Exception:
                send_json(self, {'message': 'Invalid JSON body.'}, 400)
                return

            first_name = (payload.get('first_name') or '').strip()
            last_name = (payload.get('last_name') or '').strip()
            email = (payload.get('email') or '').strip().lower()
            dob = (payload.get('dob') or '').strip()
            password = payload.get('password') or ''
            confirm_password = payload.get('confirm_password') or ''
            accepted_terms = bool(payload.get('accepted_terms'))
            accepted_privacy = bool(payload.get('accepted_privacy'))

            if not all([first_name, last_name, email, dob, password]):
                send_json(self, {'message': 'All fields are required.'}, 400)
                return
            if not first_name.replace(' ', '').isalpha() or not last_name.replace(' ', '').isalpha():
                send_json(self, {'message': 'Names can only contain letters and spaces.'}, 400)
                return
            if '@' not in email or '.' not in email:
                send_json(self, {'message': 'Please provide a valid email address.'}, 400)
                return
            if password != confirm_password:
                send_json(self, {'message': 'Passwords do not match.'}, 400)
                return
            if len(password) < 8:
                send_json(self, {'message': 'Password must be at least 8 characters long.'}, 400)
                return
            if not any(ch.isupper() for ch in password) or not any(ch.islower() for ch in password) or not any(ch.isdigit() for ch in password):
                send_json(self, {'message': 'Password must contain uppercase, lowercase, and a number.'}, 400)
                return
            if not accepted_terms or not accepted_privacy:
                send_json(self, {'message': 'You must accept the Terms & Conditions and Privacy Policy.'}, 400)
                return

            age = calculate_age(dob)
            if age < 13:
                send_json(self, {'message': 'You must be at least 13 years old to register.'}, 400)
                return

            conn = get_db_connection()
            existing = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            if existing:
                conn.close()
                send_json(self, {'message': 'This email is already registered.'}, 409)
                return

            conn.execute(
                'INSERT INTO users (first_name, last_name, email, dob, age, password, accepted_terms, accepted_privacy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (first_name, last_name, email, dob, age, hash_password(password), int(accepted_terms), int(accepted_privacy))
            )
            conn.execute(
                'INSERT INTO progress (email, level, xp, streak, wins, score) VALUES (?, 1, 0, 0, 0, 0)',
                (email,)
            )
            conn.commit()
            conn.close()
            send_json(self, {'message': 'Registration successful. You can now log in.'}, 201)
            return

        if path == '/api/login':
            try:
                payload = parse_body(self)
            except Exception:
                send_json(self, {'message': 'Invalid JSON body.'}, 400)
                return

            email = (payload.get('email') or '').strip().lower()
            password = payload.get('password') or ''
            if not email or not password:
                send_json(self, {'message': 'Email and password are required.'}, 400)
                return

            conn = get_db_connection()
            user = conn.execute(
                'SELECT first_name, last_name, email, dob, age FROM users WHERE email = ? AND password = ?',
                (email, hash_password(password))
            ).fetchone()
            conn.close()
            if not user:
                send_json(self, {'message': 'Invalid email or password.'}, 401)
                return

            token = str(uuid.uuid4())
            conn = get_db_connection()
            conn.execute('DELETE FROM sessions WHERE email = ?', (email,))
            conn.execute('INSERT INTO sessions (email, token) VALUES (?, ?)', (email, token))
            conn.commit()
            conn.close()
            send_json(self, {
                'message': 'Login successful.',
                'token': token,
                'user': {
                    'first_name': user['first_name'],
                    'last_name': user['last_name'],
                    'email': user['email'],
                    'dob': user['dob'],
                    'age': user['age'],
                },
            })
            return

        if path == '/api/forgot':
            try:
                payload = parse_body(self)
            except Exception:
                send_json(self, {'message': 'Invalid JSON body.'}, 400)
                return

            email = (payload.get('email') or '').strip().lower()
            if not email or '@' not in email or '.' not in email:
                send_json(self, {'message': 'Please enter a valid email address.'}, 400)
                return

            conn = get_db_connection()
            user = conn.execute('SELECT email FROM users WHERE email = ?', (email,)).fetchone()
            conn.close()
            if not user:
                send_json(self, {'message': 'No account was found for that email.'}, 404)
                return

            token = uuid.uuid4().hex
            conn = get_db_connection()
            conn.execute('INSERT INTO password_resets (email, token) VALUES (?, ?)', (email, token))
            conn.commit()
            conn.close()
            send_reset_email(email, token)
            send_json(self, {'message': f'Password reset instructions were sent to {email}.'})
            return

        if path == '/api/logout':
            token = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
            if token:
                conn = get_db_connection()
                conn.execute('DELETE FROM sessions WHERE token = ?', (token,))
                conn.commit()
                conn.close()
            send_json(self, {'message': 'Logged out successfully.'})
            return

        if path == '/api/progress':
            email = get_session_user(self)
            if not email:
                send_json(self, {'message': 'Authentication required.'}, 401)
                return
            try:
                payload = parse_body(self)
            except Exception:
                send_json(self, {'message': 'Invalid JSON body.'}, 400)
                return
            conn = get_db_connection()
            conn.execute(
                'UPDATE progress SET level = ?, xp = ?, streak = ?, wins = ?, score = ?, updated_at = ? WHERE email = ?',
                (
                    int(payload.get('level', 1)),
                    int(payload.get('xp', 0)),
                    int(payload.get('streak', 0)),
                    int(payload.get('wins', 0)),
                    int(payload.get('score', 0)),
                    datetime.now().isoformat(),
                    email,
                )
            )
            conn.commit()
            conn.close()
            send_json(self, {'message': 'Progress saved successfully.'})
            return

        if path == '/api/account':
            email = get_session_user(self)
            if not email:
                send_json(self, {'message': 'Authentication required.'}, 401)
                return
            try:
                payload = parse_body(self)
            except Exception:
                send_json(self, {'message': 'Invalid JSON body.'}, 400)
                return

            first_name = (payload.get('first_name') or '').strip()
            last_name = (payload.get('last_name') or '').strip()
            new_email = (payload.get('email') or '').strip().lower()

            if not first_name or not last_name:
                send_json(self, {'message': 'Name and surname are required.'}, 400)
                return
            if '@' not in new_email or '.' not in new_email:
                send_json(self, {'message': 'Please enter a valid email address.'}, 400)
                return

            conn = get_db_connection()
            duplicate = conn.execute('SELECT id FROM users WHERE email = ? AND email != ?', (new_email, email)).fetchone()
            if duplicate:
                conn.close()
                send_json(self, {'message': 'This email is already associated with another account.'}, 409)
                return

            conn.execute(
                'UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE email = ?',
                (first_name, last_name, new_email, email)
            )
            conn.execute('UPDATE progress SET email = ? WHERE email = ?', (new_email, email))
            conn.execute('UPDATE sessions SET email = ? WHERE email = ?', (new_email, email))
            conn.commit()
            conn.close()
            send_json(self, {'message': 'Account updated successfully.'})
            return

        send_json(self, {'message': 'Not found'}, 404)

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), AppHandler)
    print(f'NovaSphere running on http://localhost:{PORT}')
    server.serve_forever()
