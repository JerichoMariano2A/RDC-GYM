const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM5', baudRate: 115200 });

const out = [];
const start = Date.now();
let sent = false;

port.on('open', () => {
  console.log('[serial] COM5 open - flushing input for 1.5s, then sending "status"...');
  setTimeout(() => {
    port.write('status\n');
    sent = true;
  }, 1500);
});

port.on('data', (chunk) => {
  const s = chunk.toString('utf8');
  out.push(s);
  process.stdout.write(s);
});

port.on('error', (err) => {
  console.error('[serial] error:', err.message);
  finish();
});

function finish() {
  try { port.close(); } catch (_) {}
  console.log('\n[serial] done');
  process.exit(0);
}

const totalTimer = setTimeout(() => {
  if (out.length === 0) {
    console.log('\n[serial] No data received from COM5 (ESP may not be powered or COM busy).');
  } else if (sent) {
    console.log('\n[serial] Got response, closing.');
  }
  finish();
}, 8000);

process.on('SIGINT', finish);