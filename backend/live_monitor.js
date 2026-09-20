const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM5', baudRate: 115200 });
let buf = '';
port.on('open', () => {
  console.log('[live] watching raw serial for 10s...');
  setTimeout(() => { port.write('status\n'); console.log('[live] > status'); }, 1000);
});
port.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r/g, '').trim();
    buf = buf.slice(idx + 1);
    if (/\[(cfg|wifi|fp|scan)\]/.test(line) || line.includes('ssid=')) {
      process.stdout.write('[esp] ' + line + '\n');
    }
  }
});
port.on('error', (err) => console.error('[live] error:', err.message));
const t = setTimeout(() => { console.log('[live] 10s done'); try { port.close(); } catch(_){} process.exit(0); }, 10000);
process.on('SIGINT', () => { clearTimeout(t); try { port.close(); } catch(_){} process.exit(0); });