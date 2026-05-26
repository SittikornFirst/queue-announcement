import { Injectable, signal, computed } from '@angular/core';

export interface SpeechSettings {
  volume: number;      // 0 to 1
  rate: number;        // 0.1 to 10 (normal is 1, iOS works best between 0.7 and 1.5)
  pitch: number;       // 0 to 2
  voiceURI: string;    // Selected voice URI
  lang: 'th-TH' | 'en-US';
}

@Injectable({
  providedIn: 'root'
})
export class AnnouncementService {
  private readonly synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  
  // Available voices list
  readonly voices = signal<SpeechSynthesisVoice[]>([]);
  
  // Speech active status
  readonly isSpeaking = signal<boolean>(false);
  
  // Audio initialized status (gesture captured)
  readonly isInitialized = signal<boolean>(false);

  // Settings
  readonly settings = signal<SpeechSettings>({
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

  private loadVoices() {
    if (!this.synth) return;
    const allVoices = this.synth.getVoices();
    this.voices.set(allVoices);
    
    // Auto-select a default voice if none selected
    const current = this.settings();
    if (!current.voiceURI && allVoices.length > 0) {
      // Find a suitable Thai voice first, or English as fallback
      let defaultVoice = allVoices.find(v => v.lang.startsWith('th')) || 
                         allVoices.find(v => v.lang.startsWith('en')) || 
                         allVoices[0];
      this.settings.set({
        ...current,
        voiceURI: defaultVoice.voiceURI,
        lang: defaultVoice.lang.startsWith('th') ? 'th-TH' : 'en-US'
      });
    }
  }

  /**
   * Initializes speech synthesis. MUST be called inside a user gesture (e.g., click)
   * to satisfy browser/Safari security policies, especially on iOS.
   */
  initSpeech(): boolean {
    if (!this.synth) return false;
    
    try {
      this.synth.cancel();
      // Speak a silent or extremely short utterance to unlock the audio context
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      utterance.rate = 2.0;
      
      const selectedVoice = this.voices().find(v => v.voiceURI === this.settings().voiceURI);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      
      this.synth.speak(utterance);
      this.isInitialized.set(true);
      return true;
    } catch (e) {
      console.error('Failed to initialize speech:', e);
      return false;
    }
  }

  updateSettings(newSettings: Partial<SpeechSettings>) {
    this.settings.set({
      ...this.settings(),
      ...newSettings
    });
  }

  /**
   * Robust queue announcement with iOS stuck safety timeout.
   */
  announce(queueNumber: string, counterName: string) {
    if (!this.synth) return;

    // Format the text representation
    const text = this.formatAnnouncementText(queueNumber, counterName);
    
    // Stop any current speaking/queue to make announcements snappy and responsive
    this.cancelAnnouncements();

    const utterance = new SpeechSynthesisUtterance(text);
    const currentSettings = this.settings();

    utterance.volume = currentSettings.volume;
    utterance.rate = currentSettings.rate;
    utterance.pitch = currentSettings.pitch;

    // Apply selected voice
    const voice = this.voices().find(v => v.voiceURI === currentSettings.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = currentSettings.lang;
    }

    // Handlers
    utterance.onstart = () => {
      this.isSpeaking.set(true);
      this.startSafetyTimeout();
    };

    utterance.onend = () => {
      this.clearSafetyTimeout();
      this.isSpeaking.set(false);
    };

    utterance.onerror = (event) => {
      console.warn('Speech error event:', event);
      this.clearSafetyTimeout();
      this.isSpeaking.set(false);
    };

    // Speak!
    this.synth.speak(utterance);
  }

  cancelAnnouncements() {
    if (!this.synth) return;
    this.synth.cancel();
    this.clearSafetyTimeout();
    this.isSpeaking.set(false);
  }

  /**
   * Formats the announcement speech string.
   * Spells numbers digit-by-digit for maximum acoustic clarity.
   */
  private formatAnnouncementText(queueNumber: string, counterName: string): string {
    const isThai = this.settings().lang.startsWith('th');
    
    // Helper to spell out digits clearly
    const digits = queueNumber.split('');
    let spelledNumber = '';

    if (isThai) {
      const thaiSpells: Record<string, string> = {
        '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม', '4': 'สี่',
        '5': 'ห้า', '6': 'หก', '7': 'เจ็ด', '8': 'แปด', '9': 'เก้า'
      };
      spelledNumber = digits.map(d => thaiSpells[d] || d).join(' ');
      
      // Clean up Counter wording for natural speech
      // e.g. "ช่องบริการ 1"
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
      spelledNumber = digits.map(d => englishSpells[d] || d).join(' ');

      return `Queue number ${spelledNumber}, at ${counterName}, please.`;
    }
  }

  /**
   * Safety timeout to recover if iOS Safari gets stuck and fails to fire onend/onerror.
   */
  private startSafetyTimeout() {
    this.clearSafetyTimeout();
    // Safety timer: most announcements take less than 4 seconds. If it exceeds 6 seconds, force reset.
    this.stuckTimeout = setTimeout(() => {
      console.warn('Speech safety timeout fired. Resetting speech synthesis...');
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
