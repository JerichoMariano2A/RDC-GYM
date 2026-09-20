const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM5', baudRate: 115200 });
let buf = '';
port.on('open', () => { setTimeout(() => port.write('status\n'), 1500); });
port.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r/g, '').trim();
    buf = buf.slice(idx + 1);
    if (line.includes('ssid=')) process.stdout.write('[esp] ' + line + '\n');
  }
});
const t = setTimeout(finish, 6000);
port.on('error', () => finish());
function finish() { clearTimeout(t); try { port.close(); } catch (_) {} console.log('[done]'); process.exit(0); }
process.on('SIGINT', finish);