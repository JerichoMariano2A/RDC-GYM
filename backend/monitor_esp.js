const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM5', baudRate: 115200 });
let buf = '';
port.on('open', () => console.log('[monitor] watching for 30s - SCAN NOW'));
port.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r/g, '').trim();
    buf = buf.slice(idx + 1);
    if (/\[(fp|scan|cfg|enroll)\]/.test(line)) process.stdout.write('[esp] ' + line + '\n');
  }
});
port.on('error', (err) => { console.error('[monitor] error:', err.message); finish(); });
const t = setTimeout(() => { console.log('[monitor] 30s closed.'); finish(); }, 30000);
function finish() { clearTimeout(t); try { port.close(); } catch (_) {} console.log('[monitor] done'); process.exit(0); }
process.on('SIGINT', finish);