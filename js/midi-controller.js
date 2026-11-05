// WebMIDI Input & Output Controller (Split-Keyboard & Poly Chord Detection + MIDI Out)
import { CHORD_TYPES, detectChordFromMidiNotes } from './chords.js';

export class WebMidiController {
  constructor(onChordTriggered, onChordReleased, onStatusUpdate, onRootSelected) {
    this.onChordTriggered = onChordTriggered;
    this.onChordReleased = onChordReleased;
    this.onStatusUpdate = onStatusUpdate;
    this.onRootSelected = onRootSelected;

    this.midiAccess = null;
    this.inputs = [];
    this.outputs = [];
    this.selectedInputId = 'all';
    this.selectedOutputId = 'none';
    this.inputMode = 'root-only'; // 'root-only' (Any Key = Root) | 'split' (Below C3 = Root, C3..B4 = 24 Chords) | 'detect' (Poly)
    this.splitNote = 48; // C3

    this.heldNotes = new Set();
    this.currentRoot = 0; // C
    this.activeOutNotes = [];
    this.supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async init() {
    if (!this.supported) {
      this.notifyStatus('UNSUPPORTED (USE CHROME/EDGE)', false);
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.midiAccess.onstatechange = () => this.refreshPorts();
      this.refreshPorts();
      return true;
    } catch (err) {
      this.notifyStatus('PERMISSION DENIED', false);
      return false;
    }
  }

  refreshPorts() {
    if (!this.midiAccess) return;
    this.inputs = Array.from(this.midiAccess.inputs.values());
    this.outputs = Array.from(this.midiAccess.outputs.values());

    for (const input of this.inputs) {
      input.onmidimessage = (e) => {
        if (this.selectedInputId === 'all' || input.id === this.selectedInputId) {
          this.handleMidiMessage(e);
        }
      };
    }

    const inCount = this.inputs.length;
    const label = inCount > 0 ? `${inCount} MIDI PORT${inCount > 1 ? 'S' : ''} READY` : 'NO MIDI DEVICE';
    this.notifyStatus(label, inCount > 0);
  }

  handleMidiMessage(event) {
    const [status, data1, data2] = event.data;
    const command = status & 0xf0;

    // Note On
    if (command === 0x90 && data2 > 0) {
      this.heldNotes.add(data1);
      this.processNoteOn(data1, data2);
    }
    // Note Off
    else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      this.heldNotes.delete(data1);
      if (this.heldNotes.size === 0) {
        this.onChordReleased?.();
      }
    }
  }

  processNoteOn(midiNote) {
    const pc = ((midiNote % 12) + 12) % 12;

    if (this.inputMode === 'root-only') {
      this.currentRoot = pc;
      this.onRootSelected?.(pc, true);
      return;
    }

    if (this.inputMode === 'split') {
      if (midiNote < this.splitNote) {
        // Root selector (Below C3)
        this.currentRoot = pc;
        this.onRootSelected?.(pc, true);

        // Check if any chord key above split is also held
        const heldUpper = [...this.heldNotes].find((n) => n >= this.splitNote && n < this.splitNote + 24);
        if (heldUpper !== undefined) {
          const typeIdx = heldUpper - this.splitNote;
          const chordType = CHORD_TYPES[typeIdx];
          if (chordType) {
            this.onChordTriggered?.(this.currentRoot, chordType.id);
          }
        }
      } else if (midiNote >= this.splitNote && midiNote < this.splitNote + 24) {
        const typeIdx = midiNote - this.splitNote;
        const chordType = CHORD_TYPES[typeIdx];
        if (chordType) {
          this.onChordTriggered?.(this.currentRoot, chordType.id);
        }
      }
    } else {
      // Poly chord detection mode
      const notes = [...this.heldNotes];
      const detected = detectChordFromMidiNotes(notes);
      if (detected) {
        this.currentRoot = detected.root;
        this.onRootSelected?.(detected.root, false);
        this.onChordTriggered?.(detected.root, detected.typeId);
      }
    }
  }

  sendChordVoicing(midiNotes) {
    const out = this.getSelectedOutput();
    if (!out) return;

    this.sendAllNotesOff();
    const rounded = midiNotes.map((n) => Math.max(0, Math.min(127, Math.round(n))));
    for (const note of rounded) {
      out.send([0x90, note, 92]);
    }
    this.activeOutNotes = rounded;
  }

  sendAllNotesOff() {
    const out = this.getSelectedOutput();
    if (!out || this.activeOutNotes.length === 0) return;
    for (const note of this.activeOutNotes) {
      out.send([0x80, note, 0]);
    }
    this.activeOutNotes = [];
  }

  getSelectedOutput() {
    if (!this.midiAccess || this.selectedOutputId === 'none') return null;
    return this.outputs.find((o) => o.id === this.selectedOutputId) || null;
  }

  notifyStatus(text, connected) {
    this.onStatusUpdate?.({
      text,
      connected,
      inputs: this.inputs,
      outputs: this.outputs,
    });
  }
}
