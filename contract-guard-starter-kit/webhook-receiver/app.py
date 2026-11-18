"""Webhook receiver: stands in for chat, email and paging.

POST any path            store the notification (JSON or text) with the time it arrived
GET  /                   web page listing everything received, newest first (refreshes every 3 s)
GET  /api/received       everything received, as JSON
DELETE /api/received     clear the list

Do not change this file: the evaluators use the original kit.
"""
import html
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", "9000"))
IST = timezone(timedelta(hours=5, minutes=30))
received = []
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else json.dumps(body, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        item = {"received_at": datetime.now(IST).isoformat(timespec="seconds"), "path": urlparse(self.path).path, "body": body}
        with lock:
            received.append(item)
            n = len(received)
        print(f"webhook #{n} on {item['path']}: {raw[:200]}", flush=True)
        self._send(200, {"ok": True, "id": n})

    def do_DELETE(self):
        if urlparse(self.path).path == "/api/received":
            with lock:
                received.clear()
            return self._send(200, {"ok": True})
        self._send(404, {"error": "not found"})

    def do_GET(self):
        path = urlparse(self.path).path
        with lock:
            items = list(received)
        if path == "/api/received":
            return self._send(200, items)
        if path == "/":
            rows = "".join(
                f"<tr><td>{len(items) - i}</td><td>{html.escape(it['received_at'])}</td><td>{html.escape(it['path'])}</td>"
                f"<td><pre>{html.escape(json.dumps(it['body'], indent=2) if not isinstance(it['body'], str) else it['body'])}</pre></td></tr>"
                for i, it in enumerate(reversed(items)))
            page = f"""<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<title>Webhook receiver</title><style>body{{font-family:system-ui,sans-serif;margin:24px}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}}pre{{margin:0;white-space:pre-wrap}}</style></head>
<body><h1>Webhook receiver</h1><p>{len(items)} notification(s) received. Times in IST. This page refreshes every 3 seconds.</p>
<table><tr><th>#</th><th>Received</th><th>Path</th><th>Body</th></tr>{rows}</table></body></html>"""
            return self._send(200, page, "text/html; charset=utf-8")
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"webhook receiver listening on port {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
