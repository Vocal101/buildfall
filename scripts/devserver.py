"""Local dev server with caching disabled: python scripts/devserver.py [port] [snapdir]
POST /__snap/<name> saves the request body as <snapdir>/<name>.jpg (used by the ?dev harness T.snap)."""
import http.server, os, sys, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SNAPS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, '.snaps')

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def do_POST(self):
        m = re.match(r'^/__snap/([\w-]+)$', self.path)
        if not m:
            self.send_error(404); return
        os.makedirs(SNAPS, exist_ok=True)
        n = int(self.headers.get('Content-Length', 0))
        with open(os.path.join(SNAPS, m.group(1) + '.jpg'), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers()
    def log_message(self, *a):
        pass

os.chdir(ROOT)
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8775
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
