import { Injectable, signal } from '@angular/core';

export interface AudioSettings {
  volume: number;      // 0 to 1
  rate: number;        // 0.5 to 2.0
  pitch: number;       // 0.5 to 2.0
  voiceURI: string;    // Selected voice URI
  lang: 'th-TH' | 'en-US';
}

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private readonly synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  private audioContext: AudioContext | null = null;
  private mediaElementAudioSource: MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
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
    lang: 'th-TH'
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
   * Initialize Web Audio API context with proper Bluetooth routing
   * MUST be called inside a user gesture (click/tap)
   */
  initAudio(): boolean {
    try {
      if (!this.audioContext) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass({
          latency: 'interactive',
          sampleRate: 44100
        });

        // Create gain node for volume control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.value = this.settings().volume;

        // Create or reuse hidden audio element for Bluetooth routing
        if (!this.audioElement) {
          this.audioElement = new Audio();
          this.audioElement.style.display = 'none';
          this.audioElement.crossOrigin = 'anonymous';
          document.body.appendChild(this.audioElement);

          // Connect audio element to audio context
          this.mediaElementAudioSource = this.audioContext.createMediaElementAudioSource(this.audioElement);
          this.mediaElementAudioSource.connect(this.gainNode);
        }
      }

      // Resume audio context if suspended
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(e => console.warn('Audio context resume failed:', e));
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
  private resumeAudioContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((e) => {
        console.warn('Failed to resume audio context:', e);
      });
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
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(updated.volume, this.audioContext.currentTime);
    }
  }

  /**
   * Announce using Web Speech API with Audio Context routing
   * This ensures audio goes through the system's selected audio output (including Bluetooth)
   */
  announce(queueNumber: string, counterName: string) {
    if (!this.synth) return;

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

    // Force Bluetooth output by resuming audio context
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        this.synth?.speak(utterance);
      }).catch(() => {
        this.synth?.speak(utterance);
      });
    } else {
      this.synth.speak(utterance);
    }
  }

  cancelAnnouncements() {
    if (!this.synth) return;
    this.synth.cancel();

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
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

  /**
   * Cleanup when app is destroyed
   */
  destroy() {
    this.cancelAnnouncements();
    if (this.audioElement && this.audioElement.parentNode) {
      this.audioElement.parentNode.removeChild(this.audioElement);
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
