import { Injectable, signal, computed, effect } from '@angular/core';
import { AudioService } from './audio.service';

export interface HistoryItem {
  queueNumber: string;
  counter: string;
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class QueueService {
  // Current raw queue number (0 - 999)
  readonly currentNumber = signal<number>(0);

  // Format current queue number, stripping leading zeros (e.g. 001 -> 1, 050 -> 50, 809 -> 809)
  readonly formattedNumber = computed(() => {
    return this.currentNumber().toString();
  });

  // Current counter calling
  readonly currentCounter = signal<string>('Counter 1');

  // Recent history of calls (max 6 items)
  readonly history = signal<HistoryItem[]>([]);

  // List of active counters available
  readonly availableCounters = signal<string[]>([
    'Mango station',
    'Drink station',
  ]);

  // Auto advance simulator active state
  readonly isAutoAdvancing = signal<boolean>(false);
  private autoAdvanceTimer: any = null;

  constructor(private audioService: AudioService) {}

  /**
   * Utility helper to pad numbers to 3 digits (e.g., 5 -> "005", 999 -> "999")
   */
  padNumber(num: number): string {
    return num.toString().padStart(3, '0');
  }

  /**
   * Advances to next queue number and speaks it.
   */
  nextQueue() {
    const nextVal = (this.currentNumber() + 1) % 1000;
    this.callQueue(nextVal, this.currentCounter());
  }

  /**
   * Backs up to previous queue number and speaks it.
   */
  prevQueue() {
    const prevVal = this.currentNumber() <= 0 ? 999 : this.currentNumber() - 1;
    this.callQueue(prevVal, this.currentCounter());
  }

  /**
   * Re-announces the current active queue number and counter.
   */
  recall() {
    this.announceCurrent();
  }

  /**
   * Set a specific number and counter and announce.
   */
  callQueue(num: number, counter: string) {
    // Validate bounds
    const cleanNum = Math.max(0, Math.min(999, num));

    // Add old value to history if it's different
    const oldNum = this.formattedNumber();
    const oldCounter = this.currentCounter();

    // Set new states
    this.currentNumber.set(cleanNum);
    this.currentCounter.set(counter);

    // Add to history (only if this isn't the first call of 0, and is a new number)
    if (oldNum !== '0' || this.history().length > 0) {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newItem: HistoryItem = {
        queueNumber: oldNum,
        counter: oldCounter,
        timestamp
      };

      // Prepend to history and limit to 6 items
      this.history.set([newItem, ...this.history().slice(0, 5)]);
    }

    // Announce
    this.announceCurrent();
  }

  /**
   * Reset entire state
   */
  resetQueue() {
    this.stopAutoAdvance();
    this.currentNumber.set(0);
    this.history.set([]);
    this.audioService.cancelAnnouncements();
  }

  /**
   * Trigger actual Text-to-Speech
   */
  private announceCurrent() {
    this.audioService.announce(this.formattedNumber(), this.currentCounter());
  }

  /**
   * Automatic queue simulator (Auto-Advance)
   */
  startAutoAdvance(intervalSeconds: number = 8) {
    this.stopAutoAdvance();
    this.isAutoAdvancing.set(true);

    // Run immediate next
    this.nextQueue();

    this.autoAdvanceTimer = setInterval(() => {
      // Randomly select a counter to make simulator look realistic
      const counters = this.availableCounters();
      const randomCounter = counters[Math.floor(Math.random() * counters.length)];
      this.currentCounter.set(randomCounter);
      this.nextQueue();
    }, intervalSeconds * 1000);
  }

  stopAutoAdvance() {
    this.isAutoAdvancing.set(false);
    if (this.autoAdvanceTimer) {
      clearInterval(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  toggleAutoAdvance(intervalSeconds: number = 8) {
    if (this.isAutoAdvancing()) {
      this.stopAutoAdvance();
    } else {
      this.startAutoAdvance(intervalSeconds);
    }
  }
}
