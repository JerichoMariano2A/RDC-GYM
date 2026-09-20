const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM5', baudRate: 115200 });

const cmds = ['sc PLDTHOMEFIBRsxGb7 Totiya0103', 'sh 192.168.1.31'];

let step = 0;
const out = [];

port.on('open', () => {
  console.log('[serial] COM5 open - flushing input, then sending config...');
  setTimeout(sendNext, 1500);
});

function sendNext() {
  if (step >= cmds.length) { finish(); return; }
  const line = cmds[step] + '\n';
  step++;
  console.log('[serial] >', cmds[step - 1]);
  port.write(line);
  setTimeout(sendNext, 1200);
}

port.on('data', (chunk) => {
  const s = chunk.toString('utf8');
  out.push(s);
  const lines = s.split(/\r?\n/).filter((l) => l.includes('[cfg]'));
  for (const l of lines) process.stdout.write('[esp] ' + l + '\n');
});

port.on('error', (err) => {
  console.error('[serial] error:', err.message);
  finish();
});

const total = setTimeout(() => { console.log('[serial] timeout'); finish(); }, 12000);

function finish() {
  clearTimeout(total);
  try { port.close(); } catch (_) {}
  if (out.length === 0) console.log('[serial] No data received from COM5.');
  console.log('[serial] done');
  process.exit(0);
}

process.on('SIGINT', finish);