// Chord dictionary and pitch utilities for GLIDE // 01

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_DISPLAY = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// 24 Chord Types organized for intuitive one-touch access and rich harmonic voicings
export const CHORD_TYPES = [
  // Row 1: Triads, Sus, 6ths, Add
  { id: 'maj',     label: 'maj',     name: 'Major',          intervals: [0, 4, 7],             keyHint: '1' },
  { id: 'm',       label: 'm',       name: 'Minor',          intervals: [0, 3, 7],             keyHint: '2' },
  { id: 'sus2',    label: 'sus2',    name: 'Suspended 2nd',  intervals: [0, 2, 7],             keyHint: '3' },
  { id: 'sus4',    label: 'sus4',    name: 'Suspended 4th',  intervals: [0, 5, 7],             keyHint: '4' },
  { id: 'dim',     label: 'dim',     name: 'Diminished',     intervals: [0, 3, 6],             keyHint: '5' },
  { id: 'aug',     label: 'aug',     name: 'Augmented',      intervals: [0, 4, 8],             keyHint: '6' },
  { id: 'add9',    label: 'add9',    name: 'Major Add 9',    intervals: [0, 4, 7, 14],         keyHint: '7' },
  { id: 'maj6',    label: '6',       name: 'Major 6th',      intervals: [0, 4, 7, 9],          keyHint: '8' },
  { id: 'm6',      label: 'm6',      name: 'Minor 6th',      intervals: [0, 3, 7, 9],          keyHint: '9' },
  { id: '6/9',     label: '6/9',     name: 'Six Nine',       intervals: [0, 4, 7, 9, 14],      keyHint: '0' },
  { id: '7sus4',   label: '7sus4',   name: 'Dom 7th Sus4',   intervals: [0, 5, 7, 10],         keyHint: '-' },
  { id: 'dim7',    label: 'dim7',    name: 'Diminished 7th', intervals: [0, 3, 6, 9],          keyHint: '=' },

  // Row 2: 7ths, 9ths, Extensions & Altered (Mapped to QWERTYUIOP[])
  { id: 'maj7',    label: 'maj7',    name: 'Major 7th',      intervals: [0, 4, 7, 11],         keyHint: 'Q' },
  { id: 'm7',      label: 'm7',      name: 'Minor 7th',      intervals: [0, 3, 7, 10],         keyHint: 'W' },
  { id: 'dom7',    label: '7',       name: 'Dominant 7th',   intervals: [0, 4, 7, 10],         keyHint: 'E' },
  { id: 'm7b5',    label: 'm7♭5',    name: 'Half Diminished',intervals: [0, 3, 6, 10],         keyHint: 'R' },
  { id: 'maj9',    label: 'maj9',    name: 'Major 9th',      intervals: [0, 4, 7, 11, 14],     keyHint: 'T' },
  { id: 'm9',      label: 'm9',      name: 'Minor 9th',      intervals: [0, 3, 7, 10, 14],     keyHint: 'Y' },
  { id: 'dom9',    label: '9',       name: 'Dominant 9th',   intervals: [0, 4, 7, 10, 14],     keyHint: 'U' },
  { id: 'm11',     label: 'm11',     name: 'Minor 11th',     intervals: [0, 3, 7, 10, 14, 17], keyHint: 'I' },
  { id: 'dom13',   label: '13',      name: 'Dominant 13th',  intervals: [0, 4, 7, 10, 14, 21], keyHint: 'O' },
  { id: '7b9',     label: '7♭9',     name: 'Dom 7th Flat 9', intervals: [0, 4, 7, 10, 13],     keyHint: 'P' },
  { id: '7#9',     label: '7♯9',     name: 'Dom 7th Sharp 9',intervals: [0, 4, 7, 10, 15],     keyHint: '[' },
  { id: 'maj7#11', label: 'maj7♯11', name: 'Lydian Maj7♯11', intervals: [0, 4, 7, 11, 14, 18], keyHint: ']' },
];

export const PRESET_PROGRESSIONS = [
  {
    name: 'Neo-Soul Turnaround (Dm9 → G13 → Cmaj9 → A7♭9)',
    chords: [
      { root: 2, typeId: 'm9' },
      { root: 7, typeId: 'dom13' },
      { root: 0, typeId: 'maj9' },
      { root: 9, typeId: '7b9' },
    ],
  },
  {
    name: 'Warm Cinema (Fmaj9 → Fm6 → Em7 → A7♯9)',
    chords: [
      { root: 5, typeId: 'maj9' },
      { root: 5, typeId: 'm6' },
      { root: 4, typeId: 'm7' },
      { root: 9, typeId: '7#9' },
    ],
  },
  {
    name: 'Floating Lydian (Cmaj7♯11 → Bm7 → Am9 → D13)',
    chords: [
      { root: 0, typeId: 'maj7#11' },
      { root: 11, typeId: 'm7' },
      { root: 9, typeId: 'm9' },
      { root: 2, typeId: 'dom13' },
    ],
  },
];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_DISPLAY[pc]}${octave}`;
}

export function getChordType(typeId) {
  return CHORD_TYPES.find((c) => c.id === typeId) || CHORD_TYPES[0];
}

export function formatChordName(root, typeId) {
  const chordType = getChordType(typeId);
  return `${NOTE_DISPLAY[root]}${chordType.label}`;
}

/**
 * Simple MIDI chord recognition from an array of pressed MIDI notes
 */
export function detectChordFromMidiNotes(midiNotes) {
  if (!midiNotes || midiNotes.length === 0) return null;
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const bassNote = sorted[0];
  const rootPc = ((bassNote % 12) + 12) % 12;

  if (sorted.length === 1) {
    return { root: rootPc, typeId: 'maj9' };
  }

  const relPcs = new Set(sorted.map((n) => (((n - bassNote) % 12) + 12) % 12));

  let bestType = 'maj7';
  let bestScore = -999;

  for (const ct of CHORD_TYPES) {
    const ctPcs = new Set(ct.intervals.map((iv) => ((iv % 12) + 12) % 12));
    let matched = 0;
    let extra = 0;
    for (const pc of relPcs) {
      if (ctPcs.has(pc)) matched++;
      else extra++;
    }
    const missing = ctPcs.size - matched;
    const score = matched * 3 - extra * 2 - missing * 0.8;
    if (score > bestScore) {
      bestScore = score;
      bestType = ct.id;
    }
  }

  return { root: rootPc, typeId: bestType };
}
