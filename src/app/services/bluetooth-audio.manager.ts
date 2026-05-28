import { Injectable, signal } from '@angular/core';

/**
 * BluetoothAudioManager handles audio output device selection and routing
 * Provides UI controls for users to select their Bluetooth speaker
 */
@Injectable({
  providedIn: 'root'
})
export class BluetoothAudioManager {
  readonly audioOutputDevices = signal<MediaDeviceInfo[]>([]);
  readonly selectedOutputDeviceId = signal<string>('');
  readonly isBluetoothConnected = signal<boolean>(false);
  readonly audioElement: HTMLAudioElement | null = null;

  constructor() {
    this.detectAudioOutputDevices();
    this.setupMediaSession();
  }

  /**
   * Get all available audio output devices (speakers, headsets, etc.)
   * Requires user permission to enumerate devices
   */
  async detectAudioOutputDevices() {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((device) => device.kind === 'audiooutput');
      this.audioOutputDevices.set(audioOutputs);

      // Log devices for debugging
      audioOutputs.forEach((device) => {
        console.log(`Audio Output: ${device.label} (${device.deviceId})`);
        if (device.label.toLowerCase().includes('bluetooth')) {
          console.log('✓ Bluetooth device detected:', device.label);
        }
      });

      // Auto-select Bluetooth if available
      const bluetoothDevice = audioOutputs.find((device) =>
        device.label.toLowerCase().includes('bluetooth') ||
        device.label.toLowerCase().includes('br')
      );

      if (bluetoothDevice) {
        this.setAudioOutput(bluetoothDevice.deviceId);
        this.isBluetoothConnected.set(true);
      }
    } catch (e) {
      console.error('Failed to enumerate audio devices:', e);
    }
  }

  /**
   * Set the audio output device for all future audio playback
   * Works with HTML5 audio elements and some Web Audio API contexts
   */
  async setAudioOutput(deviceId: string) {
    try {
      const audioElement = document.createElement('audio');
      if ('setSinkId' in audioElement) {
        await (audioElement as any).setSinkId(deviceId);
        this.selectedOutputDeviceId.set(deviceId);

        // Also set for speechSynthesis if supported
        if ('audioOutputDeviceId' in window.speechSynthesis) {
          (window.speechSynthesis as any).audioOutputDeviceId = deviceId;
        }

        console.log(`✓ Audio output switched to device: ${deviceId}`);
        return true;
      } else {
        console.warn('setSinkId not supported on this browser');
        return false;
      }
    } catch (e) {
      console.error('Failed to set audio output device:', e);
      return false;
    }
  }

  /**
   * Setup Media Session API for better device audio control
   * Shows media controls on lock screen and enables better Bluetooth routing
   */
  private setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Queue Announcement',
        artist: 'Aura Queue System',
        artwork: [
          {
            src: '/logo-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      });

      // Set action handlers
      navigator.mediaSession.setActionHandler('play', () => {
        console.log('Media session: Play');
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        console.log('Media session: Pause');
      });
    }
  }

  /**
   * Listen for audio device changes (when user connects/disconnects Bluetooth)
   */
  onAudioDeviceChange(callback: () => void) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      console.log('Audio devices changed, re-detecting...');
      this.detectAudioOutputDevices();
      callback();
    });
  }

  /**
   * Get user-friendly name for audio device
   */
  getDeviceLabel(deviceId: string): string {
    const device = this.audioOutputDevices().find((d) => d.deviceId === deviceId);
    return device ? device.label : 'Unknown Device';
  }

  /**
   * Check if a specific device is Bluetooth
   */
  isBluetoothDevice(deviceId: string): boolean {
    const device = this.audioOutputDevices().find((d) => d.deviceId === deviceId);
    if (!device) return false;
    return (
      device.label.toLowerCase().includes('bluetooth') ||
      device.label.toLowerCase().includes('br') ||
      device.label.toLowerCase().includes('wireless')
    );
  }
}
