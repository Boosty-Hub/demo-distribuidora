#!/usr/bin/env python3
"""
Dev server con:
  - SPA fallback (todas las rutas no-archivo sirven index.html)
  - Live reload automatico (recarga el navegador al guardar cualquier archivo)

Uso:  python server.py [puerto]   (default 8080)
"""
import http.server, os, sys, threading, time, json

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))
WATCH_EXTS = ('.html', '.jsx', '.js', '.css')

# ── File watcher: emite un "version" que cambia cuando se modifica algo ──
_version = {'v': str(int(time.time()))}

def _scan_mtime():
    latest = 0
    for dp, _, files in os.walk(ROOT):
        for f in files:
            if f.endswith(WATCH_EXTS):
                try: latest = max(latest, os.path.getmtime(os.path.join(dp, f)))
                except OSError: pass
    return latest

def _watch_loop():
    last = _scan_mtime()
    while True:
        time.sleep(0.4)
        now = _scan_mtime()
        if now > last:
            last = now
            _version['v'] = str(int(now * 1000))

threading.Thread(target=_watch_loop, daemon=True).start()

# ── Script inyectado en index.html para recargar al detectar cambios ──
LR_SCRIPT = """<script>
(function(){
  let v=null;
  setInterval(async()=>{
    try{
      const r=await fetch('/__lr_version',{cache:'no-store'});
      const t=await r.text();
      if(v===null) v=t;
      else if(v!==t){ console.log('[live-reload] cambio detectado, recargando...'); location.reload(); }
    }catch(e){}
  },500);
})();
</script>
"""

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Sin cache para que los cambios siempre se vean
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.path == '/__lr_version':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(_version['v'].encode())
            return
        return super().do_GET()

    def send_head(self):
        clean = self.path.split('?')[0].split('#')[0]
        fs_path = self.translate_path(clean)
        # SPA fallback: si no existe como archivo y no es la raiz/dir, sirve index.html
        if not os.path.exists(fs_path):
            self.path = '/index.html'
        # Resolvemos a que archivo apunta (incluyendo el caso "/" que apunta al directorio)
        served = self.translate_path(self.path.split('?')[0])
        if os.path.isdir(served):
            served = os.path.join(served, 'index.html')
        # Si vamos a servir index.html, inyectamos el script de live-reload
        if served.endswith('index.html') and os.path.isfile(served):
            try:
                with open(served, 'rb') as f:
                    body = f.read()
                injected = body.replace(b'</body>', LR_SCRIPT.encode() + b'</body>', 1)
                if injected == body:
                    injected = body + LR_SCRIPT.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(injected)))
                self.end_headers()
                from io import BytesIO
                return BytesIO(injected)
            except Exception as e:
                print(f'[server] error inyectando LR: {e}')
        return super().send_head()

    def log_message(self, fmt, *args):
        # Silencia los polls de live-reload
        msg = fmt % args
        if '/__lr_version' in msg: return
        print(f'  {msg}')

os.chdir(ROOT)
print(f'\n  Distribuidora Demo  >>  http://localhost:{PORT}')
print(f'  Live-reload activo (vigilando *.html, *.jsx, *.js, *.css)\n')
try:
    with http.server.ThreadingHTTPServer(('', PORT), DevHandler) as s:
        s.serve_forever()
except KeyboardInterrupt:
    print('\n  Servidor detenido.')
