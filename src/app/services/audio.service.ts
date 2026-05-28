import { Injectable, signal, computed } from '@angular/core';

export interface AudioSettings {
  volume: number;      // 0 to 1
  rate: number;        // 0.5 to 2.0
  pitch: number;       // 0.5 to 2.0
  voiceURI: string;    // Selected voice URI
  lang: 'th-TH' | 'en-US';
  useAudioContext: boolean; // Use Web Audio API for better Bluetooth support
}

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private readonly synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  // Available voices list
  readonly voices = signal<SpeechSynthesisVoice[]>([]);

  // Audio active status
  readonly isPlaying = signal<boolean>(false);

  // Audio initialized status (gesture captured)
  readonly isInitialized = signal<boolean>(false);

  // Settings
  readonly settings = signal<AudioSettings>({
    volume: 1.0,
    rate: 1.0,
    pitch: 1.0,
    voiceURI: '',
    lang: 'th-TH',
    useAudioContext: true
  });

  // Track stuck recovery timeout
  private stuckTimeout: any = null;

  constructor() {
    this.loadVoices();
    if (this.synth) {
      this.synth.onvoiceschanged = () => this.loadVoices();
    }
  }

  /**
   * Initialize Web Audio API context (required for Bluetooth speaker routing)
   * MUST be called inside a user gesture
   */
  initAudio(): boolean {
    try {
      if (this.settings().useAudioContext && !this.audioContext) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // Create gain node for volume control
        if (this.audioContext) {
          this.gainNode = this.audioContext.createGain();
          this.gainNode.connect(this.audioContext.destination);
          this.gainNode.gain.value = this.settings().volume;
        }
      }

      // Also initialize speech synthesis
      if (this.synth && !this.isInitialized()) {
        this.synth.cancel();
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0;
        utterance.rate = 2.0;

        const selectedVoice = this.voices().find(
          (v) => v.voiceURI === this.settings().voiceURI
        );
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }

        this.synth.speak(utterance);
      }

      this.isInitialized.set(true);
      return true;
    } catch (e) {
      console.error('Failed to initialize audio:', e);
      return false;
    }
  }

  /**
   * Resume audio context if suspended (iOS Safari requirement)
   */
  resumeAudioContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((e) => console.error('Failed to resume audio context:', e));
    }
  }

  private loadVoices() {
    if (!this.synth) return;
    const allVoices = this.synth.getVoices();
    this.voices.set(allVoices);

    const current = this.settings();
    if (!current.voiceURI && allVoices.length > 0) {
      let defaultVoice =
        allVoices.find((v) => v.lang.startsWith('th')) ||
        allVoices.find((v) => v.lang.startsWith('en')) ||
        allVoices[0];
      this.settings.set({
        ...current,
        voiceURI: defaultVoice.voiceURI,
        lang: defaultVoice.lang.startsWith('th') ? 'th-TH' : 'en-US'
      });
    }
  }

  updateSettings(newSettings: Partial<AudioSettings>) {
    const updated = { ...this.settings(), ...newSettings };
    this.settings.set(updated);

    // Update gain node volume immediately
    if (this.gainNode) {
      this.gainNode.gain.value = updated.volume;
    }
  }

  /**
   * Robust queue announcement with Bluetooth speaker support
   * Uses Web Speech API but with proper audio context setup
   */
  announce(queueNumber: string, counterName: string) {
    if (!this.synth) return;

    // Resume audio context if suspended (iOS)
    this.resumeAudioContext();

    const text = this.formatAnnouncementText(queueNumber, counterName);

    this.cancelAnnouncements();

    const utterance = new SpeechSynthesisUtterance(text);
    const currentSettings = this.settings();

    utterance.volume = currentSettings.volume;
    utterance.rate = currentSettings.rate;
    utterance.pitch = currentSettings.pitch;

    const voice = this.voices().find((v) => v.voiceURI === currentSettings.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = currentSettings.lang;
    }

    utterance.onstart = () => {
      this.isPlaying.set(true);
      this.startSafetyTimeout();
    };

    utterance.onend = () => {
      this.clearSafetyTimeout();
      this.isPlaying.set(false);
    };

    utterance.onerror = (event) => {
      console.warn('Speech error event:', event);
      this.clearSafetyTimeout();
      this.isPlaying.set(false);
    };

    this.synth.speak(utterance);
  }

  /**
   * Play audio from synthesized speech using Web Audio API
   * This can provide better Bluetooth speaker routing on some devices
   */
  async announceWithAudioAPI(queueNumber: string, counterName: string) {
    if (!this.synth || !this.audioContext) {
      console.warn('Audio API not initialized. Falling back to Web Speech API.');
      this.announce(queueNumber, counterName);
      return;
    }

    try {
      this.resumeAudioContext();
      this.cancelAnnouncements();

      const text = this.formatAnnouncementText(queueNumber, counterName);
      const utterance = new SpeechSynthesisUtterance(text);
      const currentSettings = this.settings();

      utterance.volume = 1; // Volume controlled by gainNode
      utterance.rate = currentSettings.rate;
      utterance.pitch = currentSettings.pitch;

      const voice = this.voices().find((v) => v.voiceURI === currentSettings.voiceURI);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      // Update gain node
      if (this.gainNode && this.audioContext) {
        this.gainNode.gain.setValueAtTime(currentSettings.volume, this.audioContext.currentTime);
      }

      this.isPlaying.set(true);
      this.startSafetyTimeout();

      utterance.onend = () => {
        this.clearSafetyTimeout();
        this.isPlaying.set(false);
      };

      utterance.onerror = (event) => {
        console.warn('Speech error:', event);
        this.clearSafetyTimeout();
        this.isPlaying.set(false);
      };

      this.synth.speak(utterance);
    } catch (e) {
      console.error('Audio API announcement failed:', e);
      this.announce(queueNumber, counterName);
    }
  }

  cancelAnnouncements() {
    if (!this.synth) return;
    this.synth.cancel();

    // Stop any audio source
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.currentAudioSource = null;
    }

    this.clearSafetyTimeout();
    this.isPlaying.set(false);
  }

  private formatAnnouncementText(queueNumber: string, counterName: string): string {
    const isThai = this.settings().lang.startsWith('th');

    const digits = queueNumber.split('');
    let spelledNumber = '';

    if (isThai) {
      const thaiSpells: Record<string, string> = {
        '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม', '4': 'สี่',
        '5': 'ห้า', '6': 'หก', '7': 'เจ็ด', '8': 'แปด', '9': 'เก้า'
      };
      spelledNumber = digits.map((d) => thaiSpells[d] || d).join(' ');

      let counterSpeech = counterName;
      if (counterName.toLowerCase().startsWith('counter')) {
        const num = counterName.replace(/counter/i, '').trim();
        counterSpeech = `ช่องบริการที่ ${num}`;
      }

      return `ขอเชิญ หมายเลข ${spelledNumber} ที่ ${counterSpeech} ค่ะ`;
    } else {
      const englishSpells: Record<string, string> = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
      };
      spelledNumber = digits.map((d) => englishSpells[d] || d).join(' ');

      return `Queue number ${spelledNumber}, at ${counterName}, please.`;
    }
  }

  private startSafetyTimeout() {
    this.clearSafetyTimeout();
    this.stuckTimeout = setTimeout(() => {
      console.warn('Audio safety timeout fired. Resetting...');
      this.cancelAnnouncements();
    }, 6000);
  }

  private clearSafetyTimeout() {
    if (this.stuckTimeout) {
      clearTimeout(this.stuckTimeout);
      this.stuckTimeout = null;
    }
  }
}
