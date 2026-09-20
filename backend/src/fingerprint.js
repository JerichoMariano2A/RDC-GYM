const EventEmitter = require('events');

let SerialPort = null;
try {
  SerialPort = require('serialport').SerialPort;
} catch (_) {
  // serialport not installed — device features disabled
}

const HEADER = Buffer.from([0xef, 0x01]);
const ADDRESS = Buffer.from([0xff, 0xff, 0xff, 0xff]);

// Common baud rates for R307 and AS608 sensors
const BAUD_RATES = [57600, 9600, 115200, 38400, 19200];
const DEFAULT_BAUD_RATE = 57600;

// Default passwords for different sensors
const PASSWORDS = {
  R307: Buffer.from([0x00, 0x00, 0x00, 0x00]), // Default R307 password
  AS608: Buffer.from([0x00, 0x00, 0x00, 0x00]), // Default AS608 password
};

const CMD = {
  GENERATE_IMAGE: 0x01,
  IMAGE_TO_TZ: 0x02,
  MATCH: 0x03,
  SEARCH: 0x04,
  STORE_TEMPLATE: 0x06,
  LOAD_TEMPLATE: 0x07,
  UP_CHAR: 0x08,
  DOWN_CHAR: 0x09,
  DELETE_TEMPLATE: 0x0c,
  READ_VALID_TEMPLATES: 0x1d,
  HANDSHAKE: 0x17,
  READ_SYSPARA: 0x0f,
  CAPTURE_FINGER: 0x10,
};

const TEMPLATE_LENGTH = 512;
const TEMPLATE_CHUNK = 128;

const ACK_OK = 0x00;
const ACK_NO_FINGER = 0x02;
const ACK_NOT_FOUND = 0x09;
const ACK_MISALIGN = 0x06;
const ACK_DB_FULL = 0x0a;
const ACK_INVALID_TPL = 0x0b;
const ACK_MERGE_FAIL = 0x0a;

class FingerprintDevice extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.connected = false;
    this.scanning = false;
    this.enrolling = null;
    this._buffer = Buffer.alloc(0);
    this._scanLoopTimer = null;
    this._collecting = null;
    this._applyFn = null;
    this.sensorType = null; // 'R307' or 'AS608'
    this.baudRate = DEFAULT_BAUD_RATE;
    this.password = PASSWORDS.R307;
  }

  async open(portPath, options = {}) {
    if (!SerialPort) {
      console.warn('[fingerprint] serialport package not installed — device features disabled');
      return false;
    }
    if (this.port && this.port.isOpen) return true;

    const baudRate = options.baudRate || this.baudRate;
    const sensorType = options.sensorType || null;

    // If sensor type is specified, try that baud rate first
    const baudRatesToTry = sensorType
      ? [baudRate, ...BAUD_RATES.filter(b => b !== baudRate)]
      : [baudRate, ...BAUD_RATES.filter(b => b !== baudRate)];

    for (const baud of baudRatesToTry) {
      const connected = await this._tryConnect(portPath, baud, sensorType);
      if (connected) {
        this.baudRate = baud;
        return true;
      }
    }

    console.error('[fingerprint] Failed to connect at any baud rate');
    return false;
  }

  _tryConnect(portPath, baudRate, sensorType = null) {
    return new Promise((resolve) => {
      try {
        this.port = new SerialPort({ path: portPath, baudRate });

        const timeout = setTimeout(() => {
          this.port.close();
          this.port = null;
          resolve(false);
        }, 3000);

        this.port.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          console.log(`[fingerprint] Connected to ${portPath} at ${baudRate} baud`);

          // Try handshake with different passwords
          this._tryHandshake(sensorType).then(ok => {
            if (ok) {
              this._detectSensorType().then(() => {
                this.emit('connected');
                resolve(true);
              });
            } else {
              this.port.close();
              this.port = null;
              this.connected = false;
              resolve(false);
            }
          }).catch(() => {
            this.port.close();
            this.port = null;
            this.connected = false;
            resolve(false);
          });
        });

        this.port.on('data', (data) => {
          this._buffer = Buffer.concat([this._buffer, data]);
          this._processBuffer();
        });

        this.port.on('error', (err) => {
          console.error('[fingerprint] Port error:', err.message);
          this.connected = false;
          this.emit('error', err);
        });

        this.port.on('close', () => {
          this.connected = false;
          this.scanning = false;
          this.enrolling = null;
          this._stopScanLoop();
          this.emit('disconnected');
        });
      } catch (err) {
        resolve(false);
      }
    });
  }

  async _tryHandshake(sensorType = null) {
    // Try default password first (0x00000000)
    const passwords = [
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // Default
      Buffer.from([0x00, 0x00, 0x00, 0x01]), // Alternative
    ];

    for (const pwd of passwords) {
      this.password = pwd;
      const ok = await this._handshakeWithPassword(pwd);
      if (ok) return true;
    }
    return false;
  }

  async _handshakeWithPassword(password) {
    try {
      const pkt = this._buildPacket(CMD.HANDSHAKE, password);
      const res = await this._sendRaw(pkt);
      return res.code === ACK_OK;
    } catch {
      return false;
    }
  }

  async _detectSensorType() {
    try {
      const res = await this._sendCommand(CMD.READ_SYSPARA, Buffer.alloc(0));
      if (res.code === ACK_OK && res.data.length >= 16) {
        // Read system parameters to identify sensor type
        const sensorId = res.data.readUInt32BE(0);
        const librarySize = res.data.readUInt16BE(4);
        const databaseSize = res.data.readUInt16BE(6);

        // AS608 typically has larger database size
        if (databaseSize > 300) {
          this.sensorType = 'AS608';
        } else {
          this.sensorType = 'R307';
        }
        console.log(`[fingerprint] Detected sensor: ${this.sensorType} (DB size: ${databaseSize})`);
      }
    } catch (err) {
      console.warn('[fingerprint] Could not detect sensor type:', err.message);
      this.sensorType = 'Unknown';
    }
  }

  close() {
    this._stopScanLoop();
    this.scanning = false;
    this.enrolling = null;
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.connected = false;
    this.sensorType = null;
  }

  getStatus() {
    return {
      connected: this.connected,
      scanning: this.scanning,
      enrolling: this.enrolling ? { memberId: this.enrolling.memberId, step: this.enrolling.step } : null,
      driverAvailable: !!SerialPort,
      sensorType: this.sensorType,
      baudRate: this.baudRate,
    };
  }

  _handshake() {
    return this._sendCommand(CMD.HANDSHAKE, Buffer.alloc(0)).then(res => res.code === ACK_OK);
  }

  _buildPacket(type, data) {
    const len = data.length + 5;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(len);

    const body = Buffer.concat([ADDRESS, Buffer.from([type]), lenBuf, data]);
    const checksum = this._checksum(body);

    const pkt = Buffer.alloc(1 + body.length + 2);
    HEADER.copy(pkt, 0);
    body.copy(pkt, 2);
    pkt.writeUInt16BE(checksum, 2 + body.length);
    return pkt;
  }

  _checksum(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return sum & 0xffff;
  }

  async _sendRaw(pkt) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        return reject(new Error('Device not connected'));
      }

      let settled = false;
      const cleanup = () => {
        this.removeListener('response', handler);
        clearTimeout(timeout);
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Command timeout'));
      }, 5000);

      const handler = (res) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(res);
      };
      this.on('response', handler);

      this.port.write(pkt, (err) => {
        if (err) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }
      });
    });
  }

  _sendCommand(cmdByte, data) {
    const pkt = this._buildPacket(cmdByte, data);
    return this._sendRaw(pkt);
  }

  _processBuffer() {
    while (this._buffer.length >= 12) {
      const idx = this._buffer.indexOf(0xef);
      if (idx < 0) { this._buffer = Buffer.alloc(0); return; }
      if (idx > 0) { this._buffer = this._buffer.slice(idx); }
      if (this._buffer.length < 12) return;

      const pktType = this._buffer[6];
      const dataLen = this._buffer.readUInt16BE(8);
      const totalLen = 1 + 4 + 1 + 2 + dataLen + 2;

      if (this._buffer.length < totalLen) return;

      const data = this._buffer.slice(10, 10 + dataLen);
      const code = data[0] || 0;

      this._buffer = this._buffer.slice(totalLen);

      if (this._collecting && pktType === 0x02) {
        this._collecting.chunks.push(data);
        if (this._applyFn) this._applyFn(data);
      } else if (this._collecting && pktType === 0x08) {
        const chunks = this._collecting.chunks;
        const tmpl = Buffer.concat(chunks);
        const resolve = this._collecting.resolve;
        const reject = this._collecting.reject;
        this._collecting = null;
        clearTimeout(this._collectingTimeout);
        if (tmpl.length >= TEMPLATE_LENGTH) {
          resolve(tmpl.slice(0, TEMPLATE_LENGTH));
        } else {
          reject(new Error('Incomplete template received'));
        }
      } else {
        this.emit('response', { code, data, pktType });
      }
    }
  }

  async captureImage() {
    try {
      const res = await this._sendCommand(CMD.CAPTURE_FINGER, Buffer.alloc(0));
      if (res.code === ACK_OK) {
        this.emit('finger-detected');
      }
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async generateImage() {
    try {
      const res = await this._sendCommand(CMD.GENERATE_IMAGE, Buffer.alloc(0));
      if (res.code === ACK_OK) {
        this.emit('image-captured');
      }
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async imageToBuffer(bufferId) {
    try {
      const buf = Buffer.alloc(1);
      buf[0] = bufferId;
      const res = await this._sendCommand(CMD.IMAGE_TO_TZ, buf);
      if (res.code === ACK_OK) {
        this.emit('image-processed');
      }
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async search() {
    const buf = Buffer.alloc(6);
    buf[0] = 0x01;
    buf.writeUInt16BE(0, 1);
    buf.writeUInt16BE(300, 3);
    try {
      const res = await this._sendCommand(CMD.SEARCH, buf);
      if (res.code === ACK_OK && res.data.length >= 5) {
        const templateId = res.data.readUInt16BE(1);
        const matchScore = res.data.readUInt16BE(3);
        return { found: true, templateId, matchScore };
      }
      if (res.code === ACK_NO_FINGER || res.code === ACK_NOT_FOUND) {
        return { found: false };
      }
      return { found: false };
    } catch { return { found: false }; }
  }

  async storeTemplate(bufferId, slotId) {
    const buf = Buffer.alloc(3);
    buf[0] = bufferId;
    buf.writeUInt16BE(slotId, 1);
    try {
      const res = await this._sendCommand(CMD.STORE_TEMPLATE, buf);
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async deleteTemplate(slotId) {
    const buf = Buffer.alloc(4);
    buf.writeUInt16BE(slotId, 0);
    buf.writeUInt16BE(1, 2);
    try {
      const res = await this._sendCommand(CMD.DELETE_TEMPLATE, buf);
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async readValidTemplateCount() {
    try {
      const res = await this._sendCommand(CMD.READ_VALID_TEMPLATES, Buffer.alloc(0));
      if (res.code === ACK_OK && res.data.length >= 3) {
        return res.data.readUInt16BE(1);
      }
      return 0;
    } catch { return 0; }
  }

  async loadTemplate(bufferId, slotId) {
    const buf = Buffer.alloc(3);
    buf[0] = bufferId;
    buf.writeUInt16BE(slotId, 1);
    try {
      const res = await this._sendCommand(CMD.LOAD_TEMPLATE, buf);
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async regModel() {
    try {
      const res = await this._sendCommand(0x05, Buffer.alloc(0));
      return res.code === ACK_OK;
    } catch { return false; }
  }

  async getTemplate(slotId) {
    if (!this.port || !this.port.isOpen) throw new Error('Device not connected');
    const ok = await this.loadTemplate(2, slotId);
    if (!ok) throw new Error('Failed to load template from device');

    const res = await this._sendCommand(CMD.UP_CHAR, Buffer.from([0x02]));
    if (res.code !== ACK_OK) throw new Error('UP_CHAR failed');

    const chunks = [];
    const collected = await new Promise((resolve, reject) => {
      clearTimeout(this._collectingTimeout);
      this._collecting = { chunks, resolve, reject };
      this._collectingTimeout = setTimeout(() => {
        this._collecting = null;
        reject(new Error('Template transfer timeout'));
      }, 10000);
    });
    return collected;
  }

  async setTemplate(slotId, templateBuffer) {
    if (!this.port || !this.port.isOpen) throw new Error('Device not connected');
    const tmpl = templateBuffer.slice(0, TEMPLATE_LENGTH);

    const res = await this._sendCommand(CMD.DOWN_CHAR, Buffer.from([0x02]));
    if (res.code !== ACK_OK) throw new Error('DOWN_CHAR failed');

    for (let offset = 0; offset < tmpl.length; offset += TEMPLATE_CHUNK) {
      const chunk = tmpl.slice(offset, offset + TEMPLATE_CHUNK);
      const ok = await this._writeData(chunk);
      if (!ok) throw new Error('Failed to write template data packet');
    }
    const okEnd = await this._writeData(Buffer.alloc(0), true);
    if (!okEnd) throw new Error('Failed to finalize template transfer');

    const stored = await this.storeTemplate(2, slotId);
    if (!stored) throw new Error('Failed to store template on device');
    return true;
  }

  async _writeData(data, endOfData = false) {
    const type = endOfData ? 0x08 : 0x02;
    const len = data.length + 5;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(len);
    const body = Buffer.concat([ADDRESS, Buffer.from([type]), lenBuf, data]);
    const checksum = this._checksum(body);
    const pkt = Buffer.alloc(1 + body.length + 2);
    HEADER.copy(pkt, 0);
    body.copy(pkt, 2);
    pkt.writeUInt16BE(checksum, 2 + body.length);

    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) return resolve(false);
      const handler = (res) => {
        this.removeListener('response', handler);
        resolve(res.code === ACK_OK);
      };
      const timer = setTimeout(() => { this.removeListener('response', handler); resolve(false); }, 3000);
      this.on('response', handler);
      this.port.write(pkt, (err) => {
        if (err) { clearTimeout(timer); this.removeListener('response', handler); resolve(false); }
      });
    });
  }

  async enroll(memberId) {
    if (this.enrolling) throw new Error('Already enrolling another member');
    this.enrolling = { memberId, step: 1 };
    this.emit('enroll-start', { memberId });

    try {
      this.emit('enroll-step', { memberId, step: 1, instruction: 'Place finger on sensor' });

      let ok = await this._waitForFinger();
      if (!ok) throw new Error('No finger detected');
      this.emit('finger-detected');

      ok = await this.generateImage();
      if (!ok) throw new Error('Failed to capture image');
      this.emit('image-captured');

      ok = await this.imageToBuffer(1);
      if (!ok) throw new Error('Failed to process image');
      this.emit('image-processed');

      this.emit('enroll-step', { memberId, step: 2, instruction: 'Lift finger, then place again' });
      await this._waitNoFinger();

      ok = await this._waitForFinger();
      if (!ok) throw new Error('No finger detected on second capture');
      this.emit('finger-detected');

      ok = await this.generateImage();
      if (!ok) throw new Error('Failed to capture second image');
      this.emit('image-captured');

      ok = await this.imageToBuffer(2);
      if (!ok) throw new Error('Failed to process second image');
      this.emit('image-processed');

      const matchRes = await this.search();
      if (matchRes.found) {
        throw new Error('Same finger already enrolled');
      }

      ok = await this.storeTemplate(2, memberId);
      if (!ok) throw new Error('Failed to store template');

      this.emit('enroll-done', { memberId, success: true });
      return { success: true, memberId };
    } catch (err) {
      this.emit('enroll-done', { memberId, success: false, error: err.message });
      return { success: false, error: err.message };
    } finally {
      this.enrolling = null;
    }
  }

  _waitForFinger(timeoutMs = 15000) {
    return new Promise((resolve) => {
      let resolved = false;
      const deadline = Date.now() + timeoutMs;

      const check = async () => {
        if (resolved) return;
        if (Date.now() > deadline) { resolved = true; resolve(false); return; }
        const captured = await this.captureImage();
        if (captured) { resolved = true; resolve(true); return; }
        setTimeout(check, 300);
      };
      check();
    });
  }

  _waitNoFinger(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let resolved = false;
      const deadline = Date.now() + timeoutMs;

      const check = async () => {
        if (resolved) return;
        if (Date.now() > deadline) { resolved = true; resolve(); return; }
        const res = await this._sendCommand(CMD.CAPTURE_FINGER, Buffer.alloc(0)).catch(() => null);
        if (res && res.code === ACK_NO_FINGER) { resolved = true; resolve(); return; }
        setTimeout(check, 200);
      };
      check();
    });
  }

  startScanLoop(onMatch) {
    if (this.scanning) return;
    this.scanning = true;
    this.emit('scan-started');

    const loop = async () => {
      if (!this.scanning || !this.connected) return;
      if (this.enrolling) {
        this._scanLoopTimer = setTimeout(loop, 1000);
        return;
      }

      const captured = await this.captureImage();
      if (captured) {
        this.emit('finger-detected');

        const ok = await this.generateImage();
        if (ok) {
          this.emit('image-captured');

          await this.imageToBuffer(1);
          this.emit('image-processed');

          const result = await this.search();
          if (result.found) {
            this.emit('match', { templateId: result.templateId, matchScore: result.matchScore });
            if (onMatch) onMatch(result);
          } else {
            this.emit('no-match');
          }
        }
        await this._waitNoFinger(2000);
      }

      if (this.scanning) {
        this._scanLoopTimer = setTimeout(loop, 500);
      }
    };

    loop();
  }

  stopScanLoop() {
    this._stopScanLoop();
  }

  _stopScanLoop() {
    this.scanning = false;
    if (this._scanLoopTimer) {
      clearTimeout(this._scanLoopTimer);
      this._scanLoopTimer = null;
    }
    this.emit('scan-stopped');
  }
}

const device = new FingerprintDevice();
module.exports = device;
