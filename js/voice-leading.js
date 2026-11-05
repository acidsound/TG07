// Polyphonic Shortest-Path Voice Leading & Glide Curve Math
import { getChordType } from './chords.js';

export const NUM_VOICES = 7; // Voice 0 = Bass, Voices 1..6 = Upper Harmonic Voices

// Ideal register anchors for the 7 voices (MIDI note numbers)
// Bass around D2..A2 (38..45), Upper 6 voices spread nicely across E3..E5 (52..76)
const IDEAL_CENTERS = [41, 53, 57, 61, 65, 69, 74];

/**
 * Build an initial balanced 7-voice voicing for a chord
 */
export function buildInitialVoicing(root, typeId, octaveOffset = 0) {
  const chord = getChordType(typeId);
  const intervals = chord.intervals;
  const shift = octaveOffset * 12;

  // Voice 0: Bass note in MIDI 36..47 range
  let bassMidi = 36 + root;
  if (bassMidi > 45) bassMidi -= 12;
  if (bassMidi < 34) bassMidi += 12;
  bassMidi += shift;

  // Upper 6 voices: spread intervals across octaves around IDEAL_CENTERS[1..6]
  const upperCandidates = [];
  for (let oct = 3; oct <= 6; oct++) {
    const base = oct * 12 + root;
    for (const iv of intervals) {
      const pitchClass = ((iv % 12) + 12) % 12;
      const midi = oct * 12 + ((root + pitchClass) % 12) + shift;
      if (midi >= 48 + shift && midi <= 84 + shift) {
        upperCandidates.push({ midi, pc: (root + pitchClass) % 12 });
      }
    }
  }

  // Deduplicate and sort ascending
  const uniqueMidi = [...new Set(upperCandidates.map((c) => c.midi))].sort((a, b) => a - b);

  // Pick 6 notes closest to IDEAL_CENTERS[1..6] while stays strictly ascending
  const chosenUpper = selectBestSixAscending(uniqueMidi, IDEAL_CENTERS.slice(1).map((c) => c + shift), root, intervals);

  return [bassMidi, ...chosenUpper];
}

/**
 * Given current 7 voice MIDI pitches, compute the shortest-path target pitches
 * for the next chord while preserving voice order, chord coverage, and register gravity.
 */
export function computeVoiceLedVoicing(currentVoices, nextRoot, nextTypeId, octaveOffset = 0, smoothVoiceLeading = true) {
  if (!currentVoices || currentVoices.length !== NUM_VOICES || !smoothVoiceLeading) {
    return buildInitialVoicing(nextRoot, nextTypeId, octaveOffset);
  }

  const chord = getChordType(nextTypeId);
  const intervals = chord.intervals;
  const shift = octaveOffset * 12;

  // 1. Bass Voice (Voice 0): shortest path within bass zone (33..47 + shift)
  const prevBass = currentVoices[0];
  const bassCandidates = [];
  for (let oct = 2; oct <= 4; oct++) {
    const m = oct * 12 + nextRoot + shift;
    if (m >= 32 + shift && m <= 48 + shift) {
      bassCandidates.push(m);
    }
  }
  bassCandidates.sort((a, b) => {
    const costA = Math.abs(a - prevBass) + Math.abs(a - (IDEAL_CENTERS[0] + shift)) * 0.28;
    const costB = Math.abs(b - prevBass) + Math.abs(b - (IDEAL_CENTERS[0] + shift)) * 0.28;
    return costA - costB;
  });
  const nextBass = bassCandidates[0] ?? (36 + nextRoot + shift);

  // 2. Collect all valid chord tones in the upper register (48..83 + shift)
  const chordPitchClasses = [...new Set(intervals.map((iv) => (nextRoot + (iv % 12) + 12) % 12))];
  const upperPool = [];
  for (let midi = 47 + shift; midi <= 83 + shift; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    if (chordPitchClasses.includes(pc)) {
      upperPool.push(midi);
    }
  }

  // Reference centers blend previous voice positions (for shortest path) with ideal register gravity (to prevent drift)
  const prevUpper = currentVoices.slice(1);
  const targetRefs = prevUpper.map((prevMidi, idx) => {
    const ideal = IDEAL_CENTERS[idx + 1] + shift;
    // 78% weight on current voice pitch (shortest path), 22% pull toward ideal register center
    return prevMidi * 0.78 + ideal * 0.22;
  });

  const nextUpper = selectBestSixAscending(upperPool, targetRefs, nextRoot, intervals, prevUpper);

  return [nextBass, ...nextUpper];
}

/**
 * Dynamic Programming / Beam Search to pick 6 strictly ascending notes from `pool`
 * that minimize distance to `refs` (and `prevVoices`), avoid cramped clusters in low register,
 * and maximize coverage of the chord's essential pitch classes.
 */
function selectBestSixAscending(pool, refs, root, intervals, prevVoices = null) {
  const N = pool.length;
  const K = 6;
  if (N < K) {
    // Fallback if pool is tiny
    const fallback = [];
    for (let i = 0; i < K; i++) {
      fallback.push(pool[i % N] || 60 + i * 3);
    }
    return fallback.sort((a, b) => a - b);
  }

  const requiredPcs = new Set(intervals.map((iv) => (root + (iv % 12) + 12) % 12));

  // Beam search over the 6 voice slots
  let beam = [{ notes: [], pcs: new Set(), cost: 0, lastIdx: -1 }];
  const BEAM_WIDTH = 42;

  for (let slot = 0; slot < K; slot++) {
    const nextBeam = [];
    for (const state of beam) {
      const minIdx = state.lastIdx + 1;
      const maxIdx = N - (K - slot);
      for (let i = minIdx; i <= maxIdx; i++) {
        const midi = pool[i];
        const prevNote = slot > 0 ? state.notes[slot - 1] : null;

        // Avoid mud: intervals < 2 semitones or wide gaps > 14 semitones between adjacent upper voices
        let spacingPenalty = 0;
        if (prevNote !== null) {
          const gap = midi - prevNote;
          if (gap < 2) spacingPenalty += 12;
          else if (gap === 2 && midi < 58) spacingPenalty += 3.5;
          else if (gap > 12) spacingPenalty += (gap - 12) * 1.8;
        }

        // Shortest-path distance cost
        const moveDist = prevVoices ? Math.abs(midi - prevVoices[slot]) : Math.abs(midi - refs[slot]);
        const gravityDist = Math.abs(midi - refs[slot]);
        const stepCost = moveDist * 1.15 + gravityDist * 0.45 + spacingPenalty;

        const nextPcs = new Set(state.pcs);
        nextPcs.add(((midi % 12) + 12) % 12);

        nextBeam.push({
          notes: [...state.notes, midi],
          pcs: nextPcs,
          cost: state.cost + stepCost,
          lastIdx: i,
        });
      }
    }
    nextBeam.sort((a, b) => a.cost - b.cost);
    beam = nextBeam.slice(0, BEAM_WIDTH);
  }

  // Final scoring: reward candidates that include all chord pitch classes (especially 3rd, 7th, extensions)
  let best = beam[0];
  let bestFinalCost = Infinity;

  for (const cand of beam) {
    let missingPenalty = 0;
    for (const pc of requiredPcs) {
      if (!cand.pcs.has(pc)) {
        // Root or 5th missing in upper voices is minor (bass has root); 3rd/7th/ext missing is costly
        const rel = (((pc - root) % 12) + 12) % 12;
        if (rel === 0 || rel === 7) missingPenalty += 2.0;
        else missingPenalty += 8.5;
      }
    }
    const total = cand.cost + missingPenalty;
    if (total < bestFinalCost) {
      bestFinalCost = total;
      best = cand;
    }
  }

  return best ? best.notes : pool.slice(0, 6);
}

/**
 * Compute an adjacent chord tone for a given voice (used in Arp-Glide motion mode)
 */
export function getAdjacentChordTone(currentMidi, root, typeId, direction = 1) {
  const chord = getChordType(typeId);
  const chordPcs = new Set(chord.intervals.map((iv) => (root + (iv % 12) + 12) % 12));
  const step = direction >= 0 ? 1 : -1;
  for (let delta = 1; delta <= 12; delta++) {
    const candidate = currentMidi + step * delta;
    const pc = ((candidate % 12) + 12) % 12;
    if (chordPcs.has(pc)) {
      return candidate;
    }
  }
  return currentMidi;
}

/**
 * Evaluate normalized glide curve progress y in [0, 1] for normalized time t in [0, 1].
 *
 * @param {number} t - Normalized time [0..1]
 * @param {'exp-out'|'exp-in'|'s-curve'|'linear'} curveType
 * @param {number} tension - Curvature intensity [0.1 .. 1.0], default 0.65
 */
export function evaluateGlideCurve(t, curveType = 'exp-out', tension = 0.65) {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 0) return 0;
  if (clamped === 1) return 1;

  // Map tension [0.1 .. 1.0] to exponent k in [1.4 .. 7.5]
  const k = 1.4 + tension * 6.2;

  switch (curveType) {
    case 'exp-out': {
      // Fast departure, smooth exponential landing (classic analog portamento RC filter curve)
      return (1 - Math.exp(-k * clamped)) / (1 - Math.exp(-k));
    }
    case 'exp-in': {
      // Holds current note, then accelerates exponentially into the target chord
      return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
    }
    case 's-curve': {
      // Smooth sigmoid ease-in / ease-out
      const s = k * 1.15;
      const sig = (x) => 1 / (1 + Math.exp(-s * (x - 0.5)));
      const y0 = sig(0);
      const y1 = sig(1);
      return (sig(clamped) - y0) / (y1 - y0);
    }
    case 'linear':
    default:
      return clamped;
  }
}
