# RDC GYM — ESP32 Door Access Controller

Firmware for the **ESP32 DEVKITV1** that controls the **R307/AS608 fingerprint sensor**, a **buzzer**,
and a **relay → solenoid door lock** at the door.

> **Demo scope:** There is a SINGLE fingerprint sensor (R307 or AS608) on the ESP32 at the door. There
> is **no** desk reader and **no** USB-serial desk enrollment. Enrollment is queued from the web app
> and done on the door sensor itself. A valid scan **unlocks the door only** — there is no
> check-in/check-out or visit logging.

## Role in the system

- **Enroll:** Staff click **Enroll FP** for a member on the Admin/Staff **Memberships** page. The
  backend queues an enrollment job. This ESP32 polls the backend (`GET /esp/enroll-job`), and when
  a job appears it prompts the member to press the finger **twice** on the door's sensor, creates the
  model and stores it at **slot = member id**. It reports success/failure via
  `POST /esp/enroll-result`, which sets the member's `fingerprint_id`.
- **Scan / unlock:** On a valid scan the ESP32 calls `POST /esp/scan`. If granted, it opens the
  lock (relay → solenoid) for `DOOR_OPEN_MS` and double-beeps; invalid/expired members are denied
  with a longer buzz.

## Wiring (ESP32 DEVKITV1)

| Component      | ESP32 pin | Notes |
|----------------|-----------|-------|
| Sensor TX      | GPIO16 (RX2) | Sensor serial TX → ESP32 RX2 |
| Sensor RX      | GPIO17 (TX2) | Sensor serial RX → ESP32 TX2 |
| Sensor VCC     | 5V         | R307/AS608 needs 5V power |
| Sensor GND     | GND        | Common ground with ESP32 |
| Relay IN       | GPIO19     | Relay module control input |
| Relay VCC/GND  | 5V / GND   | Relay module power |
| Solenoid lock  | Relay COM/NO | Use a separate 12V supply for the lock |
| Buzzer (+)     | GPIO18     | Active buzzer |
| Buzzer (−)     | GND        | |
| Status LED     | GPIO21     | Optional |

See `config.h` — all pins are configurable there.

**R307/AS608 logic level:** the sensor data lines are 3.3 V logic, which matches the ESP32 GPIO pins.
Power the sensor from 5 V, but keep the signal lines common-ground with the ESP32.

**Relay polarity:** most relay modules trigger on a **LOW** input. If yours does, set
`RELAY_ACTIVE_LOW = true` in `config.h`.

## R307 vs AS608

Both the R307 and AS608 use the same UART protocol and are pin-compatible. The firmware auto-detects
the baud rate at boot — it tries `FP_BAUD_RATE` first (default 57600), then falls back to 9600,
115200, 38400 and 19200 so the AS608 works out of the box even if it was reconfigured to a non-default
baud.

## Build & flash

Install [PlatformIO](https://platformio.org) (VS Code extension or CLI), then:

```bash
cd esp32/RDC_Door

# 1. Edit config.h: WiFi credentials, backend host/port, ESP secret
# 2. Plug the ESP32 into the PC and build + upload
pio run --target upload

# 3. Watch the serial monitor
pio device monitor -b 115200
```

Or open the `esp32/RDC_Door` folder in **Arduino IDE**:
1. Add board support for `esp32` via Boards Manager (`espressif32`).
2. Install libraries via Library Manager: **Adafruit Fingerprint Sensor Library**, **ArduinoJson**.
3. Select *ESP32 Dev Module*, choose the port, and Upload.

## Configuration (`config.h`)

- `WIFI_SSID` / `WIFI_PASS` — your local WiFi.
- `BACKEND_HOST` / `BACKEND_PORT` — the Node backend on your LAN (e.g. `192.168.1.50`, `4000`).
- `ESP_SECRET` — must match the backend `.env` `ESP_SECRET` (default `rdc_esp_secret`).
- `FP_BAUD_RATE` — the fingerprint sensor baud rate (default 57600; auto-falls back to other rates).
- `DOOR_OPEN_MS` — how long the lock stays open after a valid scan.
- `ENROLL_POLL_MS` — how often the ESP32 polls for a pending enrollment job.
- `ENROLL_TIMEOUT_MS` — how long it waits for a finger to be pressed during enrollment.
- `SCAN_POLL_MS` — delay between scan attempts when no finger is present.

## Behavior

- **Boot:** connects to WiFi, initialises the fingerprint sensor (auto baud detect) and the
  relay/buzzer pins.
- **Idle scan:** polls the sensor; on a match calls `POST /esp/scan`. Granted → relay opens the lock
  for `DOOR_OPEN_MS` and double-beeps. Denied/expired → triple-beeps.
- **Enroll (from web):** every `ENROLL_POLL_MS` polls `GET /esp/enroll-job`. When a job arrives it
  blinks the LED and prompts the user: press finger (1) → lift → press finger (2) → stores the model
  at slot = member id → posts the result. Each successful finger capture is confirmed with a short
  beep.
- **LED:** solid on when connected; blinks while connecting or waiting for a finger during enroll.
