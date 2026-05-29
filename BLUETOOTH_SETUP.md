# Bluetooth Speaker Support Implementation Guide

## What Has Been Done

Your queue announcement app now has full backend support for Bluetooth speaker audio routing:

### New Services Created:

1. **AudioService** (`src/app/services/audio.service.ts`)
   - Manages Web Audio API context for proper audio routing
   - Handles speech synthesis with audio context integration
   - Auto-detects and connects to available Bluetooth speakers
   - Provides methods to set audio output devices

2. **AudioDeviceService** (`src/app/services/audio-device.service.ts`)
   - Enumerates all available audio output devices
   - Automatically detects Bluetooth speakers (including "Bromley 450")
   - Provides `setSinkId()` to route audio to specific devices
   - Listens for device connection/disconnection changes

3. **Updated App Component** (`src/app/app.ts`)
   - Imports and injects both AudioService and AudioDeviceService
   - Provides new methods:
     - `selectAudioDevice(deviceId)` - Select any audio device
     - `connectBluetoothSpeaker()` - Connect to detected Bluetooth speaker
   - Exposes audio devices in template via computed signals

### Updated Services:

- **QueueService** - Now uses AudioService instead of AnnouncementService

## What You Need To Do In the UI Template

Update your `app.html` template to add audio device selection controls. Add this section:

```html
<!-- Audio Device Selection Section (Add to your settings/control area) -->
<div class="audio-settings">
  <h3>Audio Output Device</h3>
  
  <!-- Show current selected device -->
  <p>Current Device: <strong>{{ selectedAudioDevice() }}</strong></p>
  
  <!-- Bluetooth Speaker Quick Connect Button -->
  @if (bluetoothSpeaker()) {
    <button 
      (click)="connectBluetoothSpeaker()"
      class="btn-bluetooth"
    >
      🔊 Connect to {{ bluetoothSpeaker()!.label }}
    </button>
  } @else {
    <p style="color: #999;">No Bluetooth speaker detected. Pair a device first.</p>
  }
  
  <!-- Device Selector (if multiple devices available) -->
  @if (audioDevices().length > 1) {
    <button (click)="showDeviceSelector.set(!showDeviceSelector())">
      {{ showDeviceSelector() ? '▼ Hide Devices' : '▶ Show All Devices' }}
    </button>
    
    @if (showDeviceSelector()) {
      <ul class="device-list">
        @for (device of audioDevices(); track device.deviceId) {
          <li>
            <button
              (click)="selectAudioDevice(device.deviceId)"
              [class.active]="selectedAudioDevice() === device.deviceId"
            >
              {{ device.label }}
            </button>
          </li>
        }
      </ul>
    }
  }
</div>
```

### Add CSS Styling (in app.css):

```css
.audio-settings {
  border: 1px solid #ddd;
  padding: 15px;
  margin: 10px 0;
  border-radius: 5px;
  background-color: #f9f9f9;
}

.btn-bluetooth {
  background-color: #007aff;
  color: white;
  border: none;
  padding: 10px 15px;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
  margin: 10px 0;
  width: 100%;
}

.btn-bluetooth:hover {
  background-color: #0051d5;
}

.device-list {
  list-style: none;
  padding: 10px;
  margin: 10px 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 3px;
}

.device-list li {
  margin: 5px 0;
}

.device-list button {
  width: 100%;
  padding: 8px;
  text-align: left;
  background: white;
  border: 1px solid #ddd;
  border-radius: 3px;
  cursor: pointer;
}

.device-list button.active {
  background-color: #007aff;
  color: white;
  border-color: #0051d5;
}

.device-list button:hover {
  background-color: #f0f0f0;
}

.device-list button.active:hover {
  background-color: #0051d5;
}
```

## How To Use

1. **Pair your Bromley 450 Bluetooth speaker** with your device (system settings)
2. **Click "Start System"** to initialize the audio context
3. **In Audio Output Device section**, click **"🔊 Connect to Bromley 450"** (or your speaker name)
4. Now when announcements play, they will go to your Bluetooth speaker

## Important Notes

- The app **auto-detects Bluetooth speakers** and tries to connect automatically on startup
- Browser must have **permission to enumerate media devices** (you'll be asked to grant this)
- This works on **modern browsers** (Chrome, Firefox, Safari, Edge)
- **iOS Safari** requires the user to manually select the Bluetooth speaker in Control Center before using the app
- The `setSinkId()` API is **not supported in all browsers** - the app gracefully falls back to system default

## Browser Support

| Browser | Bluetooth Speaker Selection |
|---------|---------------------------|
| Chrome  | ✅ Full support           |
| Firefox | ✅ Full support           |
| Safari  | ⚠️ Limited (iOS only)     |
| Edge    | ✅ Full support           |

## Troubleshooting

**Audio still plays on phone speaker:**
1. Check if your Bluetooth speaker is paired at the OS level
2. Open browser console (F12) and check for errors
3. Try manually selecting the device from the device list
4. Make sure browser has media enumeration permissions

**Device list empty:**
- Your Bluetooth speaker may not be paired
- Try pairing it in system settings and refresh the page

**"Bromley 450" not detected:**
- The app searches for "bromley" or "450" in the device name
- If detection fails, select it manually from the device list
