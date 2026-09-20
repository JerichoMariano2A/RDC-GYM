#ifndef RDC_DOOR_CONFIG_H
#define RDC_DOOR_CONFIG_H

// ---------------------------------------------------------------------------
// WiFi - DYNAMIC configuration
// ---------------------------------------------------------------------------
// The ESP32 can be configured WITHOUT re-flashing:
//   1) Serial config (recommended): open the serial monitor (115200 baud).
//      Within the first CONFIG_SERIAL_WINDOW_MS after boot, type:
//          sc <ssid> <password>     then:  sh <backendIP>
//      (or `sc` with no args = SmartConfig / EspTouch phone app mode)
//   2) SmartConfig (EspTouch): type `sc` at the prompt & push credentials
//      from the free "EspTouch" app on your phone.
// These are stored in flash (NVS) and reused until you change them.
// The values below are only fallbacks when nothing is stored.
// ---------------------------------------------------------------------------
const char* WIFI_SSID = "SKYFiber_2.4GHz_kS4j"; // fallback SSID (leave empty to force config)
const char* WIFI_PASS = "fkHJ6AGe";            // fallback password
const uint32_t CONFIG_SERIAL_WINDOW_MS = 15000; // how long serial input is accepted at boot

// ---------------------------------------------------------------------------
// Backend (the Node/Express server; IP on the LAN or a public hostname)
//   e.g. host = "192.168.1.50", port = 4000   (LAN backend)
//   e.g. host = "rdc-gym-backend.onrender.com", port = 443 (public HTTPS backend)
// The firmware always talks to the backend over HTTPS. For a LAN backend that
// only serves plain HTTP, keep BACKEND_PORT = 4000 and use "http://" URLs;
// for a public (cloud) backend, keep BACKEND_PORT = 443.
// ---------------------------------------------------------------------------
const char* BACKEND_HOST = "rdc-gym-backend-z2di.onrender.com";  // fallback host (leave empty to force config)
const uint16_t BACKEND_PORT = 443;

// Shared secret - must match BACKEND .env ESP_SECRET (or BIOMETRIC_SECRET)
const char* ESP_SECRET = "rdc-esp-PEkZyOltKqQ5N91h";

// ---------------------------------------------------------------------------
// Pins (ESP32 DEVKITV1)
// ---------------------------------------------------------------------------
// Fingerprint sensor (R307/R307S/AS608) on Serial2
const uint8_t FP_RX = 16;   // Sensor TX -> ESP32 GPIO16 (RX2)
const uint8_t FP_TX = 17;   // Sensor RX -> ESP32 GPIO17 (TX2)

// Fingerprint sensor baud rate - both R307 and AS608 use 57600 by default.
// If your AS608 is configured for a different baud rate (e.g. 9600 or 115200),
// change it here: 57600, 9600, 115200, 38400, 19200.
const uint32_t FP_BAUD_RATE = 57600;

const uint8_t RELAY_PIN = 19;    // Relay IN -> controls solenoid lock
const uint8_t BUZZER_PIN = 18;   // Active buzzer (or speaker via transistor)
const uint8_t STATUS_LED = 21;   // Status LED (optional)

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------
// How long the door stays unlocked after a successful scan (ms)
const uint32_t DOOR_OPEN_MS = 5000;
// How often the ESP32 polls the server for a pending enrollment job (ms)
const uint32_t ENROLL_POLL_MS = 3000;
// How long the ESP32 waits for a finger during enrollment (ms)
const uint32_t ENROLL_TIMEOUT_MS = 20000;
// Delay between scan attempts when no finger is present (ms)
const uint32_t SCAN_POLL_MS = 300;

// Phantom-image guard: a dirty/moist sensor can produce isolated "ghost"
// captures with no real finger. Require this many consecutive "finger
// present" frames before treating the capture as a real press.
const uint8_t SCAN_DEBOUNCE_FRAMES = 3;
// Minimum gap between two "access denied" beeps + backend reports (ms).
// Stops a flickering ghost frame from spamming denials.
const uint32_t DENIED_COOLDOWN_MS = 6000;

// Relay polarity: relay modules are often active-LOW (IN0 = on, IN1 = off).
// Set RELAY_ACTIVE_LOW true if your module triggers on a LOW input.
const bool RELAY_ACTIVE_LOW = false;

#endif // RDC_DOOR_CONFIG_H
