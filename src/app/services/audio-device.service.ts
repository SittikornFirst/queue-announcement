import { Injectable, signal } from '@angular/core';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput' | 'videooutput';
}

@Injectable({
  providedIn: 'root'
})
export class AudioDeviceService {
  readonly audioDevices = signal<AudioDevice[]>([]);
  readonly selectedOutputDevice = signal<string>('');

  constructor() {
    this.loadAudioDevices();
    
    // Listen for device changes
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.loadAudioDevices());
    }
  }

  /**
   * Load all available audio output devices
   */
  private async loadAudioDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        console.warn('enumerateDevices not supported');
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputDevices = devices
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.substring(0, 5)}`,
          kind: 'audiooutput' as const
        }));

      this.audioDevices.set(audioOutputDevices);

      // Auto-select first device (usually default)
      if (audioOutputDevices.length > 0 && !this.selectedOutputDevice()) {
        this.selectedOutputDevice.set(audioOutputDevices[0].deviceId);
      }
    } catch (error) {
      console.error('Error enumerating audio devices:', error);
    }
  }

  /**
   * Set audio output device for an audio element
   * Use this with your audio element to route to specific device
   */
  async setSinkId(audioElement: HTMLAudioElement, deviceId: string): Promise<void> {
    try {
      if (!audioElement.setSinkId) {
        console.warn('setSinkId not supported on this browser');
        return;
      }

      await audioElement.setSinkId(deviceId);
      this.selectedOutputDevice.set(deviceId);
      console.log(`Audio output routed to device: ${deviceId}`);
    } catch (error) {
      console.error('Error setting audio device:', error);
    }
  }

  /**
   * Get Bluetooth speaker device if available
   */
  getBluetoothSpeaker(): AudioDevice | undefined {
    return this.audioDevices().find(device => 
      device.label.toLowerCase().includes('bluetooth') || 
      device.label.toLowerCase().includes('airpods') ||
      device.label.toLowerCase().includes('bromley') ||
      device.label.includes('450')
    );
  }

  /**
   * Try to connect to Bluetooth speaker automatically
   */
  async connectToBluetoothSpeaker(audioElement: HTMLAudioElement): Promise<boolean> {
    const btSpeaker = this.getBluetoothSpeaker();
    if (btSpeaker) {
      try {
        await this.setSinkId(audioElement, btSpeaker.deviceId);
        return true;
      } catch (error) {
        console.error('Failed to connect to Bluetooth speaker:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Refresh device list
   */
  async refreshDevices(): Promise<void> {
    this.loadAudioDevices();
  }
}
