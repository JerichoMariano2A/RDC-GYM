/*
 * RDC GYM - ESP32 Door Access Controller
 * --------------------------------------
 * Hardware:
 *   ESP32 DEVKITV1
 *   R307 fingerprint sensor (Serial2)
 *   Relay module -> solenoid door lock
 *   Buzzer
 *
 * Demo scope (per product decision):
 *   There is a SINGLE fingerprint sensor mounted at the door. There is NO
 *   desk reader and NO USB-serial desk enrollment. The web app queues an
 *   enrollment from the Memberships page; the ESP32 polls the backend,
 *   enrolls the finger pressed on the door sensor, and reports the result.
 *   A valid scan unlocks the door AND records a check-in/check-out + display
 *   event in the backend (same flow as the desk reader), so the Client
 *   Display and the Dashboard update in real time. Unrecognized fingers
 *   report a "denied" display event.
 *
 * Library deps (managed by PlatformIO):
 *   - Adafruit Fingerprint Sensor Library
 *   - ArduinoJson
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <Preferences.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>

#include "config.h"

// Runtime-selected connection settings (loaded from NVS or set at boot prompt).
String g_ssid = WIFI_SSID;
String g_pass = WIFI_PASS;
String g_host = BACKEND_HOST;
Preferences g_prefs;

// Custom types defined here (before any PlatformIO auto-generated prototypes)
// so the generated prototypes can resolve them.
struct EnrollJob {
  bool active = false;
  uint16_t memberId = 0;
  String name = "";
};

enum EnrollResult { ENROLL_OK, ENROLL_NO_MATCH, ENROLL_TIMEOUT, ENROLL_FAIL };

// Quality feedback for a single image2Tz capture.
struct CaptureQuality {
  int score;      // 0..100 confidence score (0 = poor, 100 = excellent)
  const char* text; // short guidance for the admin
};

// Fingerprint sensor on Serial2 (ESP32 hardware UART2)
HardwareSerial fpSerial(2);
Adafruit_Fingerprint finger(&fpSerial);

// Door state
volatile bool doorOpen = false;
unsigned long doorOpenUntil = 0;

// ---------------------------------------------------------------------------
// Buzzer / LED helpers
// ---------------------------------------------------------------------------
void beep(int times, int onMs = 120, int offMs = 120) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(onMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(offMs);
  }
}

void storeSuccessBeep() { beep(1, 120, 120); }
void storeFailureBeep() { beep(3, 200, 150); }

void setLock(bool open) {
  doorOpen = open;
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? (open ? LOW : HIGH) : (open ? HIGH : LOW));
  if (open) doorOpenUntil = millis() + DOOR_OPEN_MS;
}

void setLed(bool on) { digitalWrite(STATUS_LED, on ? HIGH : LOW); }

// ---------------------------------------------------------------------------
// Fingerprint reading helpers
// ---------------------------------------------------------------------------
// Wait until a finger is placed on the sensor. Returns true when an image
// is captured (getImage returned OK; the image stays in the sensor buffer).
bool awaitFingerPress() {
  uint32_t start = millis();
  while (millis() - start < ENROLL_TIMEOUT_MS) {
    int r = finger.getImage();
    if (r == FINGERPRINT_OK) {
      beep(1, 40, 40); // beep to confirm finger captured
      return true;
    }
    if (r == FINGERPRINT_PACKETRECIEVEERR) { delay(50); continue; }
    if (r == FINGERPRINT_NOFINGER) setLed((millis() / 400) % 2); // blink: waiting
    delay(SCAN_POLL_MS);
  }
  return false;
}

// Wait until the finger is lifted (NOFINGER), used between the two enroll presses.
bool awaitFingerLift(uint32_t timeoutMs) {
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    int r = finger.getImage();
    if (r == FINGERPRINT_NOFINGER) return true;
    delay(SCAN_POLL_MS);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Backend communication
// ---------------------------------------------------------------------------

// Ask the backend to record a scan (check-in or check-out + display event).
// Returns true if granted (door should unlock). Retries so a transient
// network/HTTP failure doesn't cause a missed unlock.
bool reportScan(uint16_t fingerprintId, String& action, String& message) {
  if (WiFi.status() != WL_CONNECTED) return false;

  StaticJsonDocument<256> doc;
  doc["fingerprint_id"] = fingerprintId;
  doc["secret"] = ESP_SECRET;
  String body;
  serializeJson(doc, body);

  bool granted = false;
  for (int attempt = 0; attempt < 3 && WiFi.status() == WL_CONNECTED; attempt++) {
    HTTPClient http;
    String url = String("http://") + g_host + ":" + BACKEND_PORT + "/esp/scan";
    http.begin(url);
    http.setTimeout(4000);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(body);
    if (code > 0) {
      String resp = http.getString();
      DynamicJsonDocument rd(512);
      if (deserializeJson(rd, resp) == DeserializationError::Ok) {
        granted = rd["granted"] | false;
        action = rd["action"] | "";
        message = rd["message"] | "";
      }
    } else {
      Serial.printf("[scan] reportScan HTTP failed (attempt %d, code=%d)\n", attempt + 1, code);
    }
    http.end();
    if (code > 0) break; // got a real HTTP response, no need to retry
    delay(250);
  }
  return granted;
}

// Report an unrecognized fingerprint to the backend so the Client Display
// shows "ACCESS DENIED". Returns true if the server acknowledged it.
bool reportScanDenied() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = String("http://") + g_host + ":" + BACKEND_PORT + "/esp/scan-denied";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["secret"] = ESP_SECRET;
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  http.end();
  return code > 0;
}

// Poll the backend for a pending enrollment job. Claims it if one exists.
bool fetchEnrollJob(EnrollJob& job) {
  job.active = false;
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = String("http://") + g_host + ":" + BACKEND_PORT + "/esp/enroll-job";
  http.begin(url);
  http.addHeader("x-esp-secret", ESP_SECRET);
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    DynamicJsonDocument rd(512);
    if (deserializeJson(rd, resp) == DeserializationError::Ok) {
      JsonObject jobObj = rd["job"];
      if (!jobObj.isNull()) {
        job.active = true;
        job.memberId = jobObj["memberId"] | 0;
        job.name = jobObj["name"] | "";
      }
    }
  }
  http.end();
  return job.active;
}

// Report the enrollment result to the backend (success true = enrolled).
// The `reason` tells the web app why an enrollment failed (e.g. the two
// finger presses did not match), so it can show a helpful message.
void sendEnrollResult(uint16_t memberId, bool success, const char* reason) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String("http://") + g_host + ":" + BACKEND_PORT + "/esp/enroll-result";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-esp-secret", ESP_SECRET);
  StaticJsonDocument<192> doc;
  doc["member_id"] = memberId;
  doc["success"] = success;
  if (!success && reason && strlen(reason) > 0) doc["reason"] = reason;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[enroll] result for member %u success=%u reason=%s -> HTTP %d\n", memberId, success, reason ? reason : "", code);
  http.end();
}

// Report live enrollment progress (step/quality/message) to the backend.
// The web UI polls for this data so the admin sees real-time capture feedback.
void reportEnrollStatus(uint16_t memberId, const char* step, int quality, const char* message) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String("http://") + g_host + ":" + BACKEND_PORT + "/esp/enroll-status";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-esp-secret", ESP_SECRET);
  StaticJsonDocument<256> doc;
  doc["member_id"] = memberId;
  doc["step"] = step;
  doc["quality"] = quality;
  if (message) doc["message"] = message;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[enroll-status] member=%u step=%s q=%d -> %d\n", memberId, step, quality, code);
  http.end();
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

CaptureQuality assessCapture(int tzRc) {
  switch (tzRc) {
    case FINGERPRINT_OK:         return { 90, "Good capture - finger correctly placed" };
    case FINGERPRINT_IMAGEMESS:  return { 20, "Image too messy - press flat, steady, and centered" };
    case FINGERPRINT_FEATUREFAIL: return { 40, "Few feature points - press firmer, center the fingertip" };
    case FINGERPRINT_INVALIDIMAGE: return { 15, "No clear image - wipe/clean sensor and reposition finger" };
    default:                     return { 30, "Capture problem - please reposition finger" };
  }
}

// Map an enrollment outcome to a short reason string sent to the backend.
const char* fpEnrollReason(EnrollResult r) {
  switch (r) {
    case ENROLL_NO_MATCH: return "no_match";
    case ENROLL_TIMEOUT:  return "timeout";
    case ENROLL_FAIL:     return "fail";
    default:              return "";
  }
}

EnrollResult doEnroll(uint16_t id) {
  Serial.printf("[enroll] Place finger to enroll as slot #%u\n", id);

  // Step: waiting for finger
  reportEnrollStatus(id, "waiting", 0, "Waiting for finger...");

  // 1st press -> char buffer 1
  beep(1, 60, 60);
  if (!awaitFingerPress()) {
    reportEnrollStatus(id, "timeout", 0, "No finger detected - timed out");
    return ENROLL_TIMEOUT;
  }
  {
    int rc = finger.image2Tz(1);
    CaptureQuality q = assessCapture(rc);
    reportEnrollStatus(id, "capture1", q.score, q.text);
    beep(q.score >= 70 ? 1 : 3, 60, 60);
    if (rc != FINGERPRINT_OK) {
      Serial.printf("[enroll] 1st image2Tz failed rc=%d quality=%d\n", rc, q.score);
      return ENROLL_FAIL;
    }
  }
  Serial.println("[enroll] 1st image captured - remove finger");
  reportEnrollStatus(id, "lift", 70, "Good! Please lift your finger");

  if (!awaitFingerLift(5000)) {
    reportEnrollStatus(id, "timeout", 0, "Timed out - lift finger was too slow");
    return ENROLL_TIMEOUT;
  }
  beep(1, 60, 60);

  // 2nd press -> char buffer 2
  reportEnrollStatus(id, "capture2", 0, "Place the same finger again (2nd capture)");
  if (!awaitFingerPress()) {
    reportEnrollStatus(id, "timeout", 0, "No finger detected - timed out");
    return ENROLL_TIMEOUT;
  }
  {
    int rc = finger.image2Tz(2);
    CaptureQuality q = assessCapture(rc);
    reportEnrollStatus(id, "capture2", q.score, q.text);
    beep(q.score >= 70 ? 1 : 3, 60, 60);
    if (rc != FINGERPRINT_OK) {
      Serial.printf("[enroll] 2nd image2Tz failed rc=%d quality=%d\n", rc, q.score);
      return ENROLL_FAIL;
    }
  }
  Serial.println("[enroll] 2nd image captured");

  reportEnrollStatus(id, "matching", 60, "Captures OK - checking they match...");
  if (finger.createModel() != FINGERPRINT_OK) {
    Serial.println("[enroll] Fingerprints did not match");
    reportEnrollStatus(id, "nomatch", 40, "The two captures did not match - try again");
    return ENROLL_NO_MATCH;
  }

  if (finger.storeModel(id) != FINGERPRINT_OK) {
    Serial.println("[enroll] Store failed");
    reportEnrollStatus(id, "error", 30, "Failed to save the fingerprint template");
    return ENROLL_FAIL;
  }

  Serial.printf("[enroll] Stored template at slot #%u\n", id);
  reportEnrollStatus(id, "done", 100, "Fingerprint enrolled successfully!");
  return ENROLL_OK;
}

// ---------------------------------------------------------------------------
// Setup / loop (simple state machine: IDLE <-> ENROLLING)
// ---------------------------------------------------------------------------
enum Mode { MODE_IDLE, MODE_ENROLLING };
Mode mode = MODE_IDLE;
EnrollJob pendingJob;
unsigned long lastEnrollPoll = 0;

// ---------------------------------------------------------------------------
// Runtime configuration (NVS + serial prompt + SmartConfig)
// ---------------------------------------------------------------------------
void saveConfig() {
  g_prefs.begin("rdc", false);
  g_prefs.putString("ssid", g_ssid);
  g_prefs.putString("pass", g_pass);
  g_prefs.putString("host", g_host);
  g_prefs.end();
  Serial.printf("[cfg] Saved -> ssid=%s host=%s\n",
                g_ssid.c_str(), g_host.c_str());
}

void loadStoredConfig() {
  g_prefs.begin("rdc", true);
  String s = g_prefs.getString("ssid", "");
  String p = g_prefs.getString("pass", "");
  String h = g_prefs.getString("host", "");
  g_prefs.end();
  if (s.length()) g_ssid = s; else g_ssid = WIFI_SSID;
  if (p.length()) g_pass = p; else g_pass = WIFI_PASS;
  if (h.length()) g_host = h; else g_host = BACKEND_HOST;
  Serial.printf("[cfg] Config -> ssid=%s host=%s\n",
                g_ssid.c_str(), g_host.c_str());
}

// Handles 'sh <ip>' and 'sc <ssid> <pass>' typed at any time (no reboot needed).
void handleSerialCommands() {
  static String line = "";
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line.length()) {
        Serial.printf("[cfg] got: %s\n", line.c_str());
        if (line.startsWith("sc ")) {
          int space = line.indexOf(' ', 3);
          if (space > 0) {
            g_ssid = line.substring(3, space);
            g_pass = line.substring(space + 1);
            saveConfig();
            Serial.println("[cfg] SSID/pass updated - will apply on next boot");
          } else {
            Serial.println("[cfg] usage: sc <ssid> <password>");
          }
        } else if (line.startsWith("sh ")) {
          g_host = line.substring(3);
          g_host.trim();
          saveConfig();
          Serial.printf("[cfg] Backend host set to %s (applies now)\n", g_host.c_str());
        } else if (line.startsWith("status")) {
          Serial.printf("[cfg] ssid=%s host=%s wifi=%s ip=",
                        g_ssid.c_str(), g_host.c_str(),
                        WiFi.status() == WL_CONNECTED ? "connected" : "down");
          Serial.println(WiFi.localIP());
        } else {
          Serial.println("[cfg] Unknown. Try: sc <ssid> <pass> / sh <ip> / status");
        }
      }
      line = "";
    } else {
      line += c;
    }
  }
}

bool connectWifi() {
  if (g_ssid.length() == 0) {
    Serial.println("[wifi] No SSID set. Type 'sc <ssid> <pass>' in the serial monitor.");
    return false;
  }
  Serial.printf("[wifi] Connecting to %s\n", g_ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(g_ssid.c_str(), g_pass.c_str());
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    tries++;
    setLed((millis() / 200) % 2);
    if (tries % 8 == 0) Serial.println("[wifi] still trying...");
  }
  return WiFi.status() == WL_CONNECTED;
}

void runSmartConfig() {
  Serial.println("[cfg] SmartConfig (EspTouch) - open the app and push your WiFi.");
  WiFi.mode(WIFI_STA);
  WiFi.beginSmartConfig();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 60000) {
    delay(300);
    setLed((millis() / 300) % 2);
    if (WiFi.smartConfigDone()) {
      Serial.println("[cfg] SmartConfig received credentials");
      g_ssid = WiFi.SSID();
      g_pass = WiFi.psk();
      saveConfig();
    }
  }
}

// Returns true if user supplied credentials that connected.
bool promptForConfig() {
  Serial.println();
  Serial.println("========================  RDC GYM CONFIG  ========================");
  Serial.println("The ESP32 did not connect to WiFi. Within the next few seconds,");
  Serial.println("you can configure it WITHOUT re-flashing:");
  Serial.println("   sc <ssid> <password>     - set WiFi then connect");
  Serial.println("   sh <backendIP>          - set backend host (e.g. sh 192.168.1.31)");
  Serial.println("   sc                       - use EspTouch SmartConfig app instead");
  Serial.println("Note: config persists and is reused on next boot.");
  Serial.printf("Current: ssid=[%s] host=[%s]\n", g_ssid.c_str(), g_host.c_str());
  Serial.println("========================  waiting for input  =====================");

  unsigned long start = millis();
  String line = "";
  while (millis() - start < CONFIG_SERIAL_WINDOW_MS) {
    setLed((millis() / 400) % 2);
    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        line.trim();
        if (line.length()) {
          Serial.printf("[cfg] got: %s\n", line.c_str());
          if (line.startsWith("sc ")) {
            int space = line.indexOf(' ', 3);
            if (space > 0) {
              g_ssid = line.substring(3, space);
              g_pass = line.substring(space + 1);
              saveConfig();
              return true;
            }
            Serial.println("[cfg] usage: sc <ssid> <password>");
          } else if (line == "sc") {
            runSmartConfig();
            saveConfig();
            return true;
          } else if (line.startsWith("sh ")) {
            g_host = line.substring(3);
            g_host.trim();
            saveConfig();
            Serial.printf("[cfg] Backend host set to %s\n", g_host.c_str());
          } else {
            Serial.println("[cfg] Unknown command. Try: sc <ssid> <pass> / sh <ip> / sc");
          }
        }
        line = "";
      } else {
        line += c;
      }
    }
    delay(20);
  }
  Serial.println("[cfg] Config window closed.");
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n\nRDC GYM Door Controller booting");

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(STATUS_LED, OUTPUT);
  setLock(false);
  digitalWrite(BUZZER_PIN, LOW);

  // Fingerprint sensor - try to detect and connect at the configured baud rate
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX, FP_TX);
  finger.begin(FP_BAUD_RATE);
  if (finger.verifyPassword()) {
    Serial.println("[fp] Sensor found");
  } else {
    // AS608 sensors may default to 9600 or 115200 baud. Try different rates.
    bool found = false;
    const uint32_t rates[] = { 9600, 115200, 38400, 19200 };
    for (uint32_t rate : rates) {
      if (rate == FP_BAUD_RATE) continue;
      fpSerial.begin(rate, SERIAL_8N1, FP_RX, FP_TX);
      finger.begin(rate);
      delay(100);
      if (finger.verifyPassword()) {
        Serial.printf("[fp] Sensor found at %lu baud (AS608-compatible)\n", rate);
        found = true;
        break;
      }
    }
    if (!found) {
      Serial.println("[fp] Sensor NOT found - check wiring/power");
      digitalWrite(BUZZER_PIN, HIGH); delay(300); digitalWrite(BUZZER_PIN, LOW);
    }
  }

  // WiFi - dynamic config (NVS stored; serial prompt or SmartConfig fallback)
  loadStoredConfig();
  if (!connectWifi()) {
    Serial.println("[wifi] No connection - waiting for runtime config...");
    bool have = promptForConfig();
    if (have) connectWifi();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[wifi] connected, IP: ");
    Serial.println(WiFi.localIP());
    setLed(true);
    beep(1);
  } else {
    Serial.println("[wifi] FAILED to connect");
  }
}

unsigned long lastWifiReconnect = 0;

// Debounce for denied-scan reporting: only report once per finger press.
bool deniedReported = false;

// Phantom-image guards (see config.h): consecutive "finger present" frames
// seen so far, and the earliest time a denied beep/report may fire again.
uint8_t okImageCount = 0;
unsigned long deniedCooldownUntil = 0;

// ---------------------------------------------------------------------------
// Scan handling (debounced against phantom/ghost frames)
// ---------------------------------------------------------------------------
void handleScan() {
  if (doorOpen) { delay(50); return; }
  if (WiFi.status() != WL_CONNECTED) { delay(50); return; }

  int img = finger.getImage();

  if (img == FINGERPRINT_OK) {
    // Require the image to persist for a few polls. A real press stays
    // present frame after frame; an isolated ghost capture is ignored.
    if (++okImageCount < SCAN_DEBOUNCE_FRAMES) {
      delay(SCAN_POLL_MS);
      return;
    }

    int tz = finger.image2Tz(1);
    if (tz != FINGERPRINT_OK) {
      // Messy/featureless frame (common from a dirty wet-ish ghost) ->
      // NOT a real finger, and definitely not a denial. Just skip it.
      Serial.printf("[scan] image2Tz rc=%d (ignored)\n", tz);
      delay(SCAN_POLL_MS);
      return;
    }

    int fs = finger.fingerFastSearch();
    if (fs == FINGERPRINT_OK) {
      deniedReported = true; // suppress denied while finger is down
      uint16_t id = finger.fingerID;
      Serial.printf("[scan] matched fingerprint id %u, confidence %u\n",
                    id, finger.confidence);
      String action, message;
      bool granted = reportScan(id, action, message);
      if (granted) {
        setLock(true);
        beep(2);
        Serial.printf("[scan] GRANTED (%s) - door open\n", action.c_str());
      } else {
        beep(1, 800); // single long beep for access denied
        Serial.printf("[scan] DENIED: %s\n", message.c_str());
      }
      // Wait for the finger to be lifted before continuing so the member is
      // not instantly checked out and the display is not overwritten.
      awaitFingerLift(4000);
      return;
    }

    // Clean image but no matching template -> a genuine unrecognized finger,
    // or a persistent phantom. Report at most once per press AND respect the
    // cooldown so a flickering ghost cannot spam beeps/denials.
    if (!deniedReported && millis() >= deniedCooldownUntil) {
      deniedReported = true;
      deniedCooldownUntil = millis() + DENIED_COOLDOWN_MS;
      beep(1, 800); // single long beep for access denied
      Serial.println("[scan] reporting denied scan to backend");
      reportScanDenied();
    }
    // Let this frame clear before scanning again (also throttles phantoms).
    awaitFingerLift(3000);
  } else if (img == FINGERPRINT_NOFINGER) {
    deniedReported = false; // finger lifted, allow next denial report
    okImageCount = 0;       // fresh start for the next press
  } else if (img == FINGERPRINT_PACKETRECIEVEERR) {
    // Serial glitch - retry next pass without resetting the debounce.
    Serial.printf("[scan] getImage packet error\n");
    delay(SCAN_POLL_MS);
    return;
  } else {
    okImageCount = 0; // any other error ends a potential press
    Serial.printf("[scan] getImage rc=%d\n", img);
  }
  delay(SCAN_POLL_MS);
}

void loop() {
  if (mode == MODE_IDLE) handleSerialCommands();

  // Auto-close the lock
  if (doorOpen && millis() >= doorOpenUntil) {
    setLock(false);
  }

  // Auto-reconnect WiFi if dropped: retry every 20s until connected.
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiReconnect > 20000) {
      lastWifiReconnect = millis();
      Serial.println("[wifi] Reconnecting...");
      WiFi.disconnect();
      WiFi.begin(g_ssid.c_str(), g_pass.c_str());
    }
  }

  if (mode == MODE_IDLE) {
    // Periodically check for a pending enrollment job from the web app.
    if (WiFi.status() == WL_CONNECTED &&
        millis() - lastEnrollPoll > ENROLL_POLL_MS) {
      lastEnrollPoll = millis();
      if (fetchEnrollJob(pendingJob)) {
        Serial.printf("[enroll] Got job for member #%u (%s)\n",
                      pendingJob.memberId, pendingJob.name.c_str());
        mode = MODE_ENROLLING;
        return;
      }
    }

    // Normal door scanning: look for a finger to unlock (debounced).
    if (!doorOpen && WiFi.status() == WL_CONNECTED) {
      handleScan();
    } else {
      delay(50);
    }
  } else {
    // MODE_ENROLLING: perform the actual finger enrollment for the job.
    setLed(true);
    EnrollResult r = doEnroll(pendingJob.memberId);
    bool success = (r == ENROLL_OK);
    switch (r) {
      case ENROLL_OK:      Serial.println("[enroll] SUCCESS"); storeSuccessBeep(); break;
      case ENROLL_NO_MATCH: Serial.println("[enroll] NO MATCH"); storeFailureBeep(); break;
      case ENROLL_TIMEOUT: Serial.println("[enroll] TIMEOUT"); storeFailureBeep(); break;
      case ENROLL_FAIL:    Serial.println("[enroll] FAIL"); storeFailureBeep(); break;
    }
    sendEnrollResult(pendingJob.memberId, success, fpEnrollReason(r));

    if (!awaitFingerLift(4000)) { /* ignore, resume anyway */ }
    pendingJob.active = false;
    mode = MODE_IDLE;
    setLed(WiFi.status() == WL_CONNECTED);
    lastEnrollPoll = millis(); // brief cool-down before polling again
  }
}
