import { Injectable, signal, inject } from '@angular/core';
import { QueueService } from './queue.service';

@Injectable({
  providedIn: 'root'
})
export class PeerService {
  private peer: any = null;
  private dataConnection: any = null;

  // Signals for state
  readonly roomId = signal<string>('');
  readonly connectionState = signal<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  readonly connectedDeviceName = signal<string>('');
  readonly errorMessage = signal<string>('');

  /**
   * Helper to generate a random 5-letter Room ID (excluding confusing characters like O, 0, I, 1)
   */
  private generateRandomRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * HOST MODE: Set up iPad as the Main Display Board
   */
  async startHostMode(queueService: QueueService) {
    this.disconnect();
    this.connectionState.set('connecting');
    this.errorMessage.set('');

    const generatedId = this.generateRandomRoomId();
    this.roomId.set(generatedId);

    // Construct a globally unique Peer ID for our public namespace
    const peerHostId = `auraqueue-room-${generatedId}`;

    try {
      // Import PeerJS dynamically to prevent SSR/compilation issues on non-browser environments if any
      const { Peer } = await import('peerjs');
      
      this.peer = new Peer(peerHostId, {
        debug: 1 // Only log errors
      });

      this.peer.on('open', (id: string) => {
        console.log('Host Peer opened successfully with ID:', id);
        this.connectionState.set('disconnected'); // Waiting for client
      });

      this.peer.on('connection', (conn: any) => {
        // If already connected to a device, close the new one or let them takeover
        if (this.dataConnection) {
          this.dataConnection.close();
        }

        this.dataConnection = conn;
        this.connectionState.set('connected');
        this.connectedDeviceName.set(conn.metadata?.deviceName || 'Handheld Controller');

        // Setup connection handlers
        conn.on('data', (data: any) => {
          this.handleIncomingAction(data, queueService);
        });

        conn.on('close', () => {
          console.log('Controller disconnected.');
          this.connectionState.set('disconnected');
          this.connectedDeviceName.set('');
          this.dataConnection = null;
        });

        conn.on('error', (err: any) => {
          console.error('Data Connection error:', err);
          this.connectionState.set('error');
          this.errorMessage.set('Connection interrupted.');
        });
      });

      this.peer.on('error', (err: any) => {
        console.error('Host Peer error:', err);
        this.connectionState.set('error');
        if (err.type === 'unavailable-id') {
          // Retry generating once more if collision
          this.startHostMode(queueService);
        } else {
          this.errorMessage.set('Failed to initialize local network host.');
        }
      });

    } catch (e) {
      console.error('Failed to import PeerJS:', e);
      this.connectionState.set('error');
      this.errorMessage.set('Network module failed to load.');
    }
  }

  /**
   * CLIENT MODE: Set up Phone as Handheld Controller
   */
  async connectToHost(targetRoomId: string) {
    this.disconnect();
    this.connectionState.set('connecting');
    this.errorMessage.set('');

    const sanitizedRoomId = targetRoomId.trim().toUpperCase();
    this.roomId.set(sanitizedRoomId);

    const targetPeerId = `auraqueue-room-${sanitizedRoomId}`;

    try {
      const { Peer } = await import('peerjs');
      
      // Let PeerJS generate a random, unique temporary ID for the phone client
      this.peer = new Peer({
        debug: 1
      });

      this.peer.on('open', () => {
        console.log('Client Peer opened. Connecting to Room ID:', sanitizedRoomId);
        
        // Connect to the iPad Host
        const conn = this.peer.connect(targetPeerId, {
          metadata: { deviceName: 'Wireless Remote Controller' }
        });

        this.dataConnection = conn;

        conn.on('open', () => {
          console.log('Successfully connected to Host Board!');
          this.connectionState.set('connected');
          this.connectedDeviceName.set('iPad Main Board');
        });

        conn.on('close', () => {
          console.log('Host disconnected.');
          this.connectionState.set('disconnected');
          this.connectedDeviceName.set('');
          this.dataConnection = null;
        });

        conn.on('error', (err: any) => {
          console.error('Client Connection error:', err);
          this.connectionState.set('error');
          this.errorMessage.set('Failed to connect to display board.');
        });
      });

      this.peer.on('error', (err: any) => {
        console.error('Client Peer error:', err);
        this.connectionState.set('error');
        this.errorMessage.set('Display board room code not found or offline.');
      });

    } catch (e) {
      console.error('Failed to import PeerJS:', e);
      this.connectionState.set('error');
      this.errorMessage.set('Network module failed to load.');
    }
  }

  /**
   * Terminate all peer network links cleanly
   */
  disconnect() {
    if (this.dataConnection) {
      try {
        this.dataConnection.close();
      } catch (e) {}
      this.dataConnection = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
      this.peer = null;
    }

    this.roomId.set('');
    this.connectionState.set('disconnected');
    this.connectedDeviceName.set('');
    this.errorMessage.set('');
  }

  /**
   * Action Sender (sends message packet to peer connection)
   */
  private sendAction(action: { type: string; [key: string]: any }) {
    if (this.dataConnection && this.connectionState() === 'connected') {
      try {
        this.dataConnection.send(action);
      } catch (e) {
        console.error('Failed to send real-time action packet:', e);
      }
    } else {
      console.warn('Action not sent: No active connection found.');
    }
  }

  // Action Methods for Remote Controller (Phone)
  sendNext() {
    this.sendAction({ type: 'NEXT' });
  }

  sendPrev() {
    this.sendAction({ type: 'PREV' });
  }

  sendRecall() {
    this.sendAction({ type: 'RECALL' });
  }

  sendCall(num: number, counter: string) {
    this.sendAction({ type: 'CALL', number: num, counter });
  }

  sendReset() {
    this.sendAction({ type: 'RESET' });
  }

  /**
   * Action Receiver (handles incoming action packet on host device)
   */
  private handleIncomingAction(action: any, queueService: QueueService) {
    console.log('Host received action packet:', action);
    if (!action || !action.type) return;

    switch (action.type) {
      case 'NEXT':
        queueService.nextQueue();
        break;
      case 'PREV':
        queueService.prevQueue();
        break;
      case 'RECALL':
        queueService.recall();
        break;
      case 'CALL':
        if (typeof action.number === 'number' && typeof action.counter === 'string') {
          queueService.callQueue(action.number, action.counter);
        }
        break;
      case 'RESET':
        queueService.resetQueue();
        break;
      default:
        console.warn('Unknown real-time action type received:', action.type);
    }
  }
}
