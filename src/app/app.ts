import { Component, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QueueService, HistoryItem } from './services/queue.service';
import { AudioService } from './services/audio.service';
import { AudioDeviceService, AudioDevice } from './services/audio-device.service';
import { PeerService } from './services/peer.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly Math = Math;

  // Inject services
  readonly queueService = inject(QueueService);
  readonly audioService = inject(AudioService);
  readonly audioDeviceService = inject(AudioDeviceService);
  readonly peerService = inject(PeerService);

  // Make audioService public for template access (some templates reference it directly)
  public readonly announcementService = this.audioService;

  // Local Form state
  readonly inputNumber = signal<string>('');
  readonly selectedCounter = signal<string>('Counter 1');
  readonly autoAdvanceInterval = signal<number>(8);
  
  // Multi-device synchronization state
  readonly deviceMode = signal<'standalone' | 'host' | 'controller'>('standalone');
  readonly roomIdInput = signal<string>('');

  // Audio device selection UI state
  readonly showDeviceSelector = signal<boolean>(false);

  readonly speedPresets = [
    { label: 'Slow (0.8x)', value: 0.8 },
    { label: 'Normal (1.0x)', value: 1.0 },
    { label: 'Fast (1.2x)', value: 1.2 },
    { label: 'Very Fast (1.4x)', value: 1.4 }
  ];

  // Helper getters from services to keep template clean
  readonly isInitialized = computed(() => this.audioService.isInitialized());
  readonly isSpeaking = computed(() => this.audioService.isPlaying());
  readonly formattedNumber = computed(() => this.queueService.formattedNumber());
  readonly currentNumber = computed(() => this.queueService.currentNumber());
  readonly currentCounter = computed(() => this.queueService.currentCounter());
  readonly history = computed(() => this.queueService.history());
  readonly availableCounters = computed(() => this.queueService.availableCounters());
  readonly voices = computed(() => this.audioService.voices());
  readonly ttsSettings = computed(() => this.audioService.settings());
  readonly isAutoAdvancing = computed(() => this.queueService.isAutoAdvancing());
  readonly audioDevices = computed(() => this.audioDeviceService.audioDevices());
  readonly selectedAudioDevice = computed(() => this.audioDeviceService.selectedOutputDevice());
  readonly bluetoothSpeaker = computed(() => this.audioDeviceService.getBluetoothSpeaker());

  // WebRTC Sync Getters
  readonly peerRoomId = computed(() => this.peerService.roomId());
  readonly peerConnectionState = computed(() => this.peerService.connectionState());
  readonly connectedDeviceName = computed(() => this.peerService.connectedDeviceName());
  readonly peerErrorMessage = computed(() => this.peerService.errorMessage());

  readonly getJoinUrl = computed(() => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${window.location.pathname}?join=${this.peerRoomId()}`;
    }
    return '';
  });

  readonly getQrCodeUrl = computed(() => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&color=ffffff&bgcolor=12121a&data=${encodeURIComponent(this.getJoinUrl())}`;
  });

  constructor() {
    // Check query parameter for automatic join
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get('join');
      if (joinCode) {
        this.deviceMode.set('controller');
        this.roomIdInput.set(joinCode);
        
        // Wait briefly for Web Speech synthesis loading, then connect
        setTimeout(() => {
          this.connectToDisplayBoard();
        }, 1000);
      }
    }
  }

  /**
   * Action: Start session by capturing required browser user gesture
   */
  startSystem() {
    const success = this.audioService.initAudio();
    if (success) {
      setTimeout(() => {
        const isThai = this.ttsSettings().lang.startsWith('th');
        const welcomeText = isThai ? 'ระบบคิวพร้อมใช้งานค่ะ' : 'Queue system is ready.';
        const utterance = new SpeechSynthesisUtterance(welcomeText);
        utterance.volume = 0.8;
        utterance.rate = 1.0;
        
        const voice = this.voices().find(v => v.voiceURI === this.ttsSettings().voiceURI);
        if (voice) utterance.voice = voice;
        
        window.speechSynthesis.speak(utterance);
      }, 300);
    }
  }

  /**
   * Action: Enable Host Display Mode (iPad)
   */
  enableHostMode() {
    this.deviceMode.set('host');
    this.peerService.startHostMode(this.queueService);
  }

  /**
   * Action: Connect as Wireless Remote Controller (Phone)
   */
  connectToDisplayBoard() {
    const code = this.roomIdInput().trim().toUpperCase();
    if (code.length === 0) {
      alert('Please enter a valid 5-letter Room ID.');
      return;
    }
    this.deviceMode.set('controller');
    this.peerService.connectToHost(code);
  }

  /**
   * Action: Exit host/controller sync mode back to standalone
   */
  exitPeerMode() {
    this.peerService.disconnect();
    this.deviceMode.set('standalone');
    
    // Clear URL parameters
    if (typeof window !== 'undefined' && window.history) {
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Action: Call next queue
   */
  nextQueue() {
    if (this.deviceMode() === 'controller') {
      this.peerService.sendNext();
    } else {
      this.queueService.nextQueue();
    }
  }

  /**
   * Action: Call previous queue
   */
  prevQueue() {
    if (this.deviceMode() === 'controller') {
      this.peerService.sendPrev();
    } else {
      this.queueService.prevQueue();
    }
  }

  /**
   * Action: Re-announce current number
   */
  recall() {
    if (this.deviceMode() === 'controller') {
      this.peerService.sendRecall();
    } else {
      this.queueService.recall();
    }
  }

  /**
   * Action: Call direct custom number
   */
  callCustomNumber() {
    const numStr = this.inputNumber().trim();
    if (numStr === '') return;
    
    const parsed = parseInt(numStr, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 999) {
      alert('Please enter a queue number between 0 and 999');
      return;
    }

    if (this.deviceMode() === 'controller') {
      this.peerService.sendCall(parsed, this.selectedCounter());
    } else {
      this.queueService.callQueue(parsed, this.selectedCounter());
    }
    this.inputNumber.set(''); // Reset input
  }

  /**
   * Direct trigger from history list
   */
  callHistoryItem(item: HistoryItem) {
    const parsed = parseInt(item.queueNumber, 10);
    if (!isNaN(parsed)) {
      if (this.deviceMode() === 'controller') {
        this.peerService.sendCall(parsed, item.counter);
      } else {
        this.queueService.callQueue(parsed, item.counter);
      }
    }
  }

  /**
   * Toggle automated demo simulator
   */
  toggleSimulator() {
    this.queueService.toggleAutoAdvance(this.autoAdvanceInterval());
  }

  /**
   * Reset stats
   */
  resetSystem() {
    if (confirm('Are you sure you want to reset the queue counter to 0 and clear history?')) {
      if (this.deviceMode() === 'controller') {
        this.peerService.sendReset();
      } else {
        this.queueService.resetQueue();
      }
    }
  }

  /**
   * Change voice setting variables
   */
  updateSpeechVolume(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    this.audioService.updateSettings({ volume: val });
  }

  updateSpeechRate(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    this.audioService.updateSettings({ rate: val });
  }

  updateSpeechPitch(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    this.audioService.updateSettings({ pitch: val });
  }

  updateVoice(voiceURI: string) {
    const voice = this.voices().find(v => v.voiceURI === voiceURI);
    if (voice) {
      this.audioService.updateSettings({
        voiceURI: voiceURI,
        lang: voice.lang.startsWith('th') ? 'th-TH' : 'en-US' as any
      });
      const testUtterance = new SpeechSynthesisUtterance(voice.lang.startsWith('th') ? 'ทดสอบเสียง' : 'Test voice');
      testUtterance.voice = voice;
      testUtterance.rate = this.ttsSettings().rate;
      testUtterance.pitch = this.ttsSettings().pitch;
      testUtterance.volume = 0.5;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(testUtterance);
    }
  }

  /**
   * Set audio output device
   */
  async selectAudioDevice(deviceId: string) {
    await this.audioService.setAudioDevice(deviceId);
    this.showDeviceSelector.set(false);
  }

  /**
   * Connect to Bluetooth speaker if available
   */
  async connectBluetoothSpeaker() {
    const btSpeaker = this.bluetoothSpeaker();
    if (btSpeaker) {
      await this.selectAudioDevice(btSpeaker.deviceId);
      console.log('Connected to Bluetooth speaker:', btSpeaker.label);
    }
  }

  incrementInput() {
    const current = parseInt(this.inputNumber() || '0', 10);
    if (!isNaN(current) && current < 999) {
      this.inputNumber.set((current + 1).toString());
    }
  }

  decrementInput() {
    const current = parseInt(this.inputNumber() || '0', 10);
    if (!isNaN(current) && current > 0) {
      this.inputNumber.set((current - 1).toString());
    }
  }
}
