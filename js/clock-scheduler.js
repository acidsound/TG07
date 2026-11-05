// Master Tempo Clock, Grid Quantizer, Latch & Pre-input (Cue) Scheduler
import { buildInitialVoicing, computeVoiceLedVoicing, getAdjacentChordTone } from './voice-leading.js';

export const GRID_OPTIONS = [
  { id: '1/4',  label: '1/4 BEAT', beats: 1 },
  { id: '1/2',  label: '1/2 BAR',  beats: 2 },
  { id: '1bar', label: '1 BAR',    beats: 4 },
  { id: '2bar', label: '2 BARS',   beats: 8 },
];

export class QuantizedGlideScheduler {
  constructor(audioEngine, midiController, onStateChange) {
    this.audio = audioEngine;
    this.midi = midiController;
    this.onStateChange = onStateChange;

    // Clock parameters
    this.bpm = 108;
    this.gridId = '1bar'; // Default 1 BAR as discussed
    this.isRunning = false;
    this.latchEnabled = true;

    // Glide parameters
    this.curveType = 'exp-out';    // 'exp-out' | 'exp-in' | 's-curve' | 'linear'
    this.curveTension = 0.68;      // 0.1 .. 1.0
    this.glideRatio = 0.45;        // Fraction of grid (or beat) duration spent gliding (0.05 .. 0.95)
    this.triggerTiming = 'on-grid'; // 'on-grid' (Start on Bar) | 'land-on-grid' (Arrive on Bar) | 'immediate'
    this.strumMs = 35;             // Per-voice stagger (0 .. 140 ms)
    this.arpMotion = 'strum-up';   // 'simultaneous' | 'strum-up' | 'strum-down' | 'inner-arp'
    this.octaveOffset = 0;
    this.smoothVoiceLeading = true;

    // State
    this.activeChord = null;       // { root, typeId, voicing: number[] }
    this.cuedChord = null;         // { root, typeId, previewVoicing: number[], preTriggered: boolean }
    this.previousVoicing = null;   // Voicing before most recent transition (for visual trajectory)
    this.lastTransitionTime = 0;
    this.lastGlideDuration = 0.45;

    // Clock tracking
    this.clockStartAudioTime = 0;
    this.lastSubStepIndex = -1;
    this.lastGridIndex = -1;
    this.arpVoicePointer = 1;
    this.arpDirection = 1;

    // Optional Auto-Cue Loop Mode (for hands-free testing of curves & grid)
    this.autoLoopEnabled = false;
    this.autoLoopChords = [];
    this.autoLoopIndex = 0;
  }

  getGridBeats() {
    const found = GRID_OPTIONS.find((g) => g.id === this.gridId);
    return found ? found.beats : 4;
  }

  getBeatDurationSec() {
    return 60 / this.bpm;
  }

  getGridDurationSec() {
    return this.getBeatDurationSec() * this.getGridBeats();
  }

  getGlideDurationSec() {
    // Scale glide duration musically relative to grid (capped so it feels responsive even on 2-bar grids)
    const effectiveBeats = Math.min(4, this.getGridBeats());
    return Math.max(0.03, effectiveBeats * this.getBeatDurationSec() * this.glideRatio);
  }

  /**
   * User inputs a chord (via UI button, QWERTY keyboard, or MIDI)
   */
  inputChord(root, typeId) {
    this.autoLoopEnabled = false;
    // 1. If nothing is currently playing or clock is stopped, start immediately on Beat 1
    if (!this.isRunning || !this.activeChord || this.triggerTiming === 'immediate') {
      const voicing = this.activeChord
        ? computeVoiceLedVoicing(this.activeChord.voicing, root, typeId, this.octaveOffset, this.smoothVoiceLeading)
        : buildInitialVoicing(root, typeId, this.octaveOffset);

      const wasRunning = this.isRunning;
      if (!this.isRunning) {
        this.startClock();
      }

      if (!this.activeChord || !wasRunning) {
        this.previousVoicing = [...voicing];
        this.activeChord = { root, typeId, voicing };
        this.cuedChord = null;
        this.audio.engageVoicesImmediate(voicing);
        this.midi?.sendChordVoicing(voicing);
      } else {
        // Immediate glide mode
        this.executeGlideTransition({ root, typeId, previewVoicing: voicing }, this.audio.ctx.currentTime);
      }

      this.notify();
      return;
    }

    // 2. Clock is running and a chord is Latched -> Register into Pre-input (CUED) slot for Next Grid!
    const previewVoicing = computeVoiceLedVoicing(
      this.activeChord.voicing,
      root,
      typeId,
      this.octaveOffset,
      this.smoothVoiceLeading
    );

    this.cuedChord = {
      root,
      typeId,
      previewVoicing,
      preTriggered: false,
    };

    this.notify();
  }

  /**
   * Called on key release when Latch is OFF
   */
  handleInputRelease() {
    if (!this.latchEnabled && !this.autoLoopEnabled) {
      this.stopAndRelease();
    }
  }

  startClock() {
    if (!this.audio.isInitialized) return;
    this.isRunning = true;
    this.clockStartAudioTime = this.audio.ctx.currentTime;
    this.lastSubStepIndex = -1;
    this.lastGridIndex = 0;
    this.notify();
  }

  stopAndRelease() {
    this.isRunning = false;
    this.autoLoopEnabled = false;
    this.activeChord = null;
    this.cuedChord = null;
    this.audio.releaseAllVoices();
    this.midi?.sendAllNotesOff();
    this.notify();
  }

  /**
   * Toggle Auto-Progression Loop so the user can audition glide curves & grid settings hands-free
   */
  startAutoProgression(chords) {
    this.autoLoopChords = chords;
    this.autoLoopIndex = 0;
    this.autoLoopEnabled = true;

    const first = chords[0];
    const voicing = this.activeChord
      ? computeVoiceLedVoicing(this.activeChord.voicing, first.root, first.typeId, this.octaveOffset, this.smoothVoiceLeading)
      : buildInitialVoicing(first.root, first.typeId, this.octaveOffset);

    if (!this.isRunning) {
      this.startClock();
    }
    this.previousVoicing = [...voicing];
    this.activeChord = { root: first.root, typeId: first.typeId, voicing };
    this.audio.engageVoicesImmediate(voicing);
    this.midi?.sendChordVoicing(voicing);

    // Immediately cue the 2nd chord for the next grid boundary!
    this.cueNextAutoChord();
    this.notify();
  }

  cueNextAutoChord() {
    if (!this.autoLoopEnabled || this.autoLoopChords.length === 0 || !this.activeChord) return;
    this.autoLoopIndex = (this.autoLoopIndex + 1) % this.autoLoopChords.length;
    const next = this.autoLoopChords[this.autoLoopIndex];
    const previewVoicing = computeVoiceLedVoicing(
      this.activeChord.voicing,
      next.root,
      next.typeId,
      this.octaveOffset,
      this.smoothVoiceLeading
    );
    this.cuedChord = {
      root: next.root,
      typeId: next.typeId,
      previewVoicing,
      preTriggered: false,
    };
  }

  /**
   * High-frequency tick called from requestAnimationFrame (~60fps)
   * Returns live clock metrics for the UI and triggers sample-accurate transitions
   */
  tick() {
    if (!this.isRunning || !this.audio.isInitialized) {
      return {
        isRunning: false,
        gridProgress: 0,
        beatInGrid: 0,
        totalBeatsInGrid: this.getGridBeats(),
        step16InGrid: 0,
        timeToNextGridSec: 0,
      };
    }

    const now = this.audio.ctx.currentTime;
    const elapsed = Math.max(0, now - this.clockStartAudioTime);
    const gridDur = this.getGridDurationSec();
    const beatDur = this.getBeatDurationSec();
    const step16Dur = beatDur / 4;

    const currentGridIndex = Math.floor(elapsed / gridDur);
    const gridElapsed = elapsed - currentGridIndex * gridDur;
    const gridProgress = Math.min(1, Math.max(0, gridElapsed / gridDur));
    const timeToNextGridSec = Math.max(0, gridDur - gridElapsed);
    const nextGridAudioTime = this.clockStartAudioTime + (currentGridIndex + 1) * gridDur;

    // 1. Check "Land on Grid" (Pre-Grid Anticipated Glide)
    if (this.cuedChord && !this.cuedChord.preTriggered && this.triggerTiming === 'land-on-grid') {
      const glideDur = this.getGlideDurationSec();
      if (timeToNextGridSec <= glideDur + 0.03) {
        this.cuedChord.preTriggered = true;
        const startAt = Math.max(now, nextGridAudioTime - glideDur);
        this.executeCompositePreGridGlide(this.cuedChord, startAt, Math.min(glideDur, timeToNextGridSec));
      }
    }

    // 2. Check exact Grid Boundary arrival (e.g., Next Bar)
    if (currentGridIndex > this.lastGridIndex) {
      this.lastGridIndex = currentGridIndex;

      if (this.cuedChord) {
        if (this.cuedChord.preTriggered) {
          // Finalize state swap on the bar line for pre-triggered glide
          this.activeChord = {
            root: this.cuedChord.root,
            typeId: this.cuedChord.typeId,
            voicing: this.cuedChord.previewVoicing,
          };
          this.cuedChord = null;
        } else {
          // Standard 'on-grid': Start the exponential glide right on the new Bar!
          this.executeGlideTransition(this.cuedChord, now);
        }

        if (this.autoLoopEnabled) {
          this.cueNextAutoChord();
        }
        this.notify();
      } else if (this.autoLoopEnabled) {
        this.cueNextAutoChord();
        if (this.cuedChord) {
          this.executeGlideTransition(this.cuedChord, now);
          this.cueNextAutoChord();
          this.notify();
        }
      }
    }

    // 3. Check 16th-note subdivisions for Inner-Arp Glide mode
    const globalStep16 = Math.floor(elapsed / step16Dur);
    if (globalStep16 > this.lastSubStepIndex) {
      this.lastSubStepIndex = globalStep16;
      // Every 8th note (2 sixteenth steps), if inner-arp is active and not in the middle of a main chord transition
      if (this.arpMotion === 'inner-arp' && this.activeChord && globalStep16 % 2 === 0) {
        const timeSinceMainGlide = now - this.lastTransitionTime;
        if (timeSinceMainGlide > this.lastGlideDuration + 0.05) {
          this.triggerInnerArpStep(now, step16Dur * 1.85);
        }
      }
    }

    const totalBeatsInGrid = this.getGridBeats();
    const beatInGrid = Math.floor(gridProgress * totalBeatsInGrid);
    const step16InGrid = Math.floor(gridProgress * totalBeatsInGrid * 4);

    return {
      isRunning: true,
      gridProgress,
      beatInGrid,
      totalBeatsInGrid,
      step16InGrid,
      timeToNextGridSec,
    };
  }

  executeGlideTransition(cued, startTime) {
    const glideDur = this.getGlideDurationSec();
    const strumSec =
      this.arpMotion === 'simultaneous'
        ? 0
        : (this.strumMs / 1000);
    const strumDirection = this.arpMotion === 'strum-down' ? 'down' : 'up';

    this.previousVoicing = this.activeChord ? [...this.activeChord.voicing] : [...cued.previewVoicing];
    this.activeChord = {
      root: cued.root,
      typeId: cued.typeId,
      voicing: cued.previewVoicing,
    };
    this.cuedChord = null;
    this.lastTransitionTime = startTime;
    this.lastGlideDuration = glideDur;

    this.audio.schedulePolyGlide(this.activeChord.voicing, {
      startTime,
      durationSec: glideDur,
      curveType: this.curveType,
      tension: this.curveTension,
      strumSec,
      strumDirection,
    });

    this.midi?.sendChordVoicing(this.activeChord.voicing);
  }

  executeCompositePreGridGlide(cued, startTime, durationSec) {
    const strumSec = this.arpMotion === 'simultaneous' ? 0 : (this.strumMs / 1000);
    const strumDirection = this.arpMotion === 'strum-down' ? 'down' : 'up';

    this.previousVoicing = this.activeChord ? [...this.activeChord.voicing] : [...cued.previewVoicing];
    this.lastTransitionTime = startTime;
    this.lastGlideDuration = durationSec;

    this.audio.schedulePolyGlide(cued.previewVoicing, {
      startTime,
      durationSec,
      curveType: this.curveType,
      tension: this.curveTension,
      strumSec,
      strumDirection,
    });

    this.midi?.sendChordVoicing(cued.previewVoicing);
    this.notify();
  }

  /**
   * Inner-Arp Glide: while holding a latched chord, adjacent upper voices gently glide
   * to their neighboring chord tone and back in a rhythmic arpeggiated wave
   */
  triggerInnerArpStep(now, stepDurationSec) {
    if (!this.activeChord) return;
    const vIdx = this.arpVoicePointer;
    const baseMidi = this.activeChord.voicing[vIdx];
    const currentLive = this.audio.getLiveVoiceMidi(vIdx, now);

    // If voice is already displaced from its base chord tone, glide it back home; otherwise glide to adjacent chord tone
    let targetMidi;
    if (Math.abs(currentLive - baseMidi) > 0.25) {
      targetMidi = baseMidi;
    } else {
      targetMidi = getAdjacentChordTone(baseMidi, this.activeChord.root, this.activeChord.typeId, this.arpDirection);
    }

    this.audio.scheduleSingleVoiceGlide(
      vIdx,
      currentLive,
      targetMidi,
      now,
      stepDurationSec,
      this.curveType,
      this.curveTension
    );

    this.arpVoicePointer++;
    if (this.arpVoicePointer > 6) {
      this.arpVoicePointer = 1;
      this.arpDirection *= -1;
    }
  }

  notify() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this);
    }
  }
}
