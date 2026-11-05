// 7-Voice Polyphonic Glide Synthesizer Engine (Web Audio API)
import { midiToFreq } from './chords.js';
import { NUM_VOICES, evaluateGlideCurve } from './voice-leading.js';

export const SOUND_PRESETS = {
  warmPad: {
    name: 'Warm Braun Pad',
    osc1Type: 'sawtooth',
    osc2Type: 'triangle',
    detuneCents: 11,
    osc2Mix: 0.65,
    subBassMix: 0.45,
    cutoffHz: 1850,
    resonance: 1.4,
    chorusMix: 0.35,
    spaceMix: 0.32,
    attackSec: 0.08,
    accentPulse: 0.25,
  },
  neoSoulSaw: {
    name: 'Liquid Neo-Soul',
    osc1Type: 'sawtooth',
    osc2Type: 'sawtooth',
    detuneCents: 16,
    osc2Mix: 0.75,
    subBassMix: 0.5,
    cutoffHz: 2600,
    resonance: 2.1,
    chorusMix: 0.45,
    spaceMix: 0.36,
    attackSec: 0.04,
    accentPulse: 0.35,
  },
  glassOrgan: {
    name: 'Dieter Glass Choir',
    osc1Type: 'triangle',
    osc2Type: 'sine',
    detuneCents: 7,
    osc2Mix: 0.85,
    subBassMix: 0.6,
    cutoffHz: 3400,
    resonance: 0.9,
    chorusMix: 0.30,
    spaceMix: 0.44,
    attackSec: 0.12,
    accentPulse: 0.18,
  },
  vintageReed: {
    name: 'SK-4 Reed Ensemble',
    osc1Type: 'square',
    osc2Type: 'sawtooth',
    detuneCents: 9,
    osc2Mix: 0.45,
    subBassMix: 0.4,
    cutoffHz: 1450,
    resonance: 1.8,
    chorusMix: 0.38,
    spaceMix: 0.28,
    attackSec: 0.05,
    accentPulse: 0.30,
  },
};

export class GlideAudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isGateOpen = false;

    this.presetKey = 'warmPad';
    this.params = {
      masterVolume: 0.75,
      cutoffHz: 1850,
      resonance: 1.4,
      detuneCents: 11,
      spaceMix: 0.32,
      accentPulse: 0.25,
    };

    this.voices = [];
    this.masterGain = null;
    this.analyser = null;
  }

  async init() {
    if (this.isInitialized) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // Master chain: VoicesBus -> Warm Saturation -> Chorus/Space Send -> Compressor -> MasterGain -> Analyser -> Destination
    this.voicesBus = this.ctx.createGain();
    this.voicesBus.gain.value = 0.85;

    // Master Lowpass Filter (Global tone shaping)
    this.globalFilter = this.ctx.createBiquadFilter();
    this.globalFilter.type = 'lowpass';
    this.globalFilter.frequency.value = this.params.cutoffHz;
    this.globalFilter.Q.value = this.params.resonance;

    // Stereo Chorus effect
    this.chorusDelayL = this.ctx.createDelay(0.05);
    this.chorusDelayR = this.ctx.createDelay(0.05);
    this.chorusDelayL.delayTime.value = 0.014;
    this.chorusDelayR.delayTime.value = 0.019;

    this.chorusLfo = this.ctx.createOscillator();
    this.chorusLfo.type = 'sine';
    this.chorusLfo.frequency.value = 0.42;
    this.chorusLfoGainL = this.ctx.createGain();
    this.chorusLfoGainR = this.ctx.createGain();
    this.chorusLfoGainL.gain.value = 0.0032;
    this.chorusLfoGainR.gain.value = -0.0032;
    this.chorusLfo.connect(this.chorusLfoGainL);
    this.chorusLfo.connect(this.chorusLfoGainR);
    this.chorusLfoGainL.connect(this.chorusDelayL.delayTime);
    this.chorusLfoGainR.connect(this.chorusDelayR.delayTime);
    this.chorusLfo.start();

    this.chorusMerger = this.ctx.createChannelMerger(2);
    this.chorusDelayL.connect(this.chorusMerger, 0, 0);
    this.chorusDelayR.connect(this.chorusMerger, 0, 1);

    this.chorusWet = this.ctx.createGain();
    this.chorusWet.gain.value = 0.35;
    this.chorusMerger.connect(this.chorusWet);

    // Lush Stereo Delay / Reverb Network (Independent L/R feedback to prevent 2x summing runaway)
    this.spaceSend = this.ctx.createGain();
    this.spaceSend.gain.value = this.params.spaceMix;

    this.delayL = this.ctx.createDelay(1.0);
    this.delayR = this.ctx.createDelay(1.0);
    this.delayL.delayTime.value = 0.24;
    this.delayR.delayTime.value = 0.36;

    this.feedbackFilterL = this.ctx.createBiquadFilter();
    this.feedbackFilterL.type = 'lowpass';
    this.feedbackFilterL.frequency.value = 1800;
    this.feedbackFilterL.Q.value = 0.5;

    this.feedbackFilterR = this.ctx.createBiquadFilter();
    this.feedbackFilterR.type = 'lowpass';
    this.feedbackFilterR.frequency.value = 1800;
    this.feedbackFilterR.Q.value = 0.5;

    this.feedbackGainL = this.ctx.createGain();
    this.feedbackGainR = this.ctx.createGain();
    this.feedbackGainL.gain.value = 0.26;
    this.feedbackGainR.gain.value = 0.26;

    this.spaceMerger = this.ctx.createChannelMerger(2);
    this.spaceSend.connect(this.delayL);
    this.spaceSend.connect(this.delayR);

    // Ping-pong without L+R summing (strictly 0.26 loop gain per stage)
    this.delayL.connect(this.feedbackFilterL);
    this.feedbackFilterL.connect(this.feedbackGainL);
    this.feedbackGainL.connect(this.delayR);

    this.delayR.connect(this.feedbackFilterR);
    this.feedbackFilterR.connect(this.feedbackGainR);
    this.feedbackGainR.connect(this.delayL);

    this.delayL.connect(this.spaceMerger, 0, 0);
    this.delayR.connect(this.spaceMerger, 0, 1);
    this.spaceOutGain = this.ctx.createGain();
    this.spaceOutGain.gain.value = 0.35;
    this.spaceMerger.connect(this.spaceOutGain);

    // Convolver Reverb for plush ambient tail
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createImpulseResponse(2.4, 2.6);
    this.reverbWet = this.ctx.createGain();
    this.reverbWet.gain.value = this.params.spaceMix * 0.7;
    this.spaceSend.connect(this.convolver);
    this.convolver.connect(this.reverbWet);

    // Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.22;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterVolume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;

    // Wire graph
    this.voicesBus.connect(this.globalFilter);
    this.globalFilter.connect(this.compressor);

    this.globalFilter.connect(this.chorusDelayL);
    this.globalFilter.connect(this.chorusDelayR);
    this.chorusWet.connect(this.compressor);

    this.globalFilter.connect(this.spaceSend);
    this.spaceOutGain.connect(this.compressor);
    this.reverbWet.connect(this.compressor);

    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Create the 7 independent polyphonic voices
    const stereoPans = [0.0, -0.55, 0.48, -0.32, 0.35, -0.18, 0.22];
    const baseMidi = [41, 53, 57, 61, 65, 69, 74];

    for (let i = 0; i < NUM_VOICES; i++) {
      const voice = this.createVoice(i, baseMidi[i], stereoPans[i]);
      this.voices.push(voice);
    }

    this.isInitialized = true;
    this.applyPreset(this.presetKey);
  }

  createImpulseResponse(durationSec, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        data[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
    }
    return impulse;
  }

  createVoice(index, initialMidi, panValue) {
    const isBass = index === 0;
    const freq = midiToFreq(initialMidi);

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = isBass ? 'sine' : 'triangle';

    osc1.frequency.value = freq;
    osc2.frequency.value = isBass ? freq * 0.5 : freq;

    // Slight natural analog drift per voice
    const driftSign = index % 2 === 0 ? 1 : -1;
    osc1.detune.value = driftSign * (index + 1) * 1.3;
    osc2.detune.value = -driftSign * this.params.detuneCents;

    const osc1Gain = this.ctx.createGain();
    const osc2Gain = this.ctx.createGain();
    osc1Gain.gain.value = isBass ? 0.55 : 0.35;
    osc2Gain.gain.value = isBass ? 0.45 : 0.28;

    // Individual voice filter so lower voices are warm and upper voices shimmer
    const voiceFilter = this.ctx.createBiquadFilter();
    voiceFilter.type = 'lowpass';
    voiceFilter.frequency.value = isBass ? 950 : 2800;
    voiceFilter.Q.value = isBass ? 1.1 : 0.8;

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.value = 0; // Strictly 0 until gate opens

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panValue;

    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    osc1Gain.connect(voiceFilter);
    osc2Gain.connect(voiceFilter);
    voiceFilter.connect(voiceGain);
    voiceGain.connect(panner);
    panner.connect(this.voicesBus);

    osc1.start();
    osc2.start();

    return {
      index,
      isBass,
      osc1,
      osc2,
      osc1Gain,
      osc2Gain,
      voiceFilter,
      voiceGain,
      panner,
      currentMidi: initialMidi,
      fromMidi: initialMidi,
      toMidi: initialMidi,
      glideStartTime: 0,
      glideDuration: 0.001,
      curveType: 'exp-out',
      tension: 0.65,
    };
  }

  applyPreset(presetKey) {
    const preset = SOUND_PRESETS[presetKey] || SOUND_PRESETS.warmPad;
    this.presetKey = presetKey;
    this.params.cutoffHz = preset.cutoffHz;
    this.params.resonance = preset.resonance;
    this.params.detuneCents = preset.detuneCents;
    this.params.spaceMix = preset.spaceMix;
    this.params.accentPulse = preset.accentPulse;

    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    this.globalFilter.frequency.setTargetAtTime(preset.cutoffHz, now, 0.05);
    this.globalFilter.Q.setTargetAtTime(preset.resonance, now, 0.05);
    this.chorusWet.gain.setTargetAtTime(preset.chorusMix, now, 0.05);
    this.spaceSend.gain.setTargetAtTime(preset.spaceMix, now, 0.05);
    this.reverbWet.gain.setTargetAtTime(preset.spaceMix * 0.7, now, 0.05);

    for (const v of this.voices) {
      v.osc1.type = preset.osc1Type;
      v.osc2.type = v.isBass ? 'sine' : preset.osc2Type;
      const driftSign = v.index % 2 === 0 ? 1 : -1;
      v.osc2.detune.setTargetAtTime(-driftSign * preset.detuneCents, now, 0.04);
      v.osc2Gain.gain.setTargetAtTime(v.isBass ? preset.subBassMix : preset.osc2Mix * 0.38, now, 0.04);
    }
  }

  setCutoff(hz) {
    this.params.cutoffHz = hz;
    if (this.isInitialized) {
      this.globalFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.03);
    }
  }

  setResonance(q) {
    this.params.resonance = q;
    if (this.isInitialized) {
      this.globalFilter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.03);
    }
  }

  setDetune(cents) {
    this.params.detuneCents = cents;
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      const driftSign = v.index % 2 === 0 ? 1 : -1;
      v.osc2.detune.setTargetAtTime(-driftSign * cents, now, 0.03);
    }
  }

  setSpaceMix(mix) {
    this.params.spaceMix = mix;
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.spaceSend.gain.setTargetAtTime(mix, now, 0.04);
    this.reverbWet.gain.setTargetAtTime(mix * 0.7, now, 0.04);
  }

  setMasterVolume(val) {
    this.params.masterVolume = val;
    if (this.isInitialized) {
      this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.03);
    }
  }

  /**
   * Open gate and set initial chord pitches immediately (first chord triggered)
   */
  engageVoicesImmediate(targetMidiNotes) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.isGateOpen = true;

    for (let i = 0; i < NUM_VOICES; i++) {
      const v = this.voices[i];
      const midi = targetMidiNotes[i];
      const freq = midiToFreq(midi);

      v.currentMidi = midi;
      v.fromMidi = midi;
      v.toMidi = midi;
      v.glideStartTime = now;
      v.glideDuration = 0.001;

      v.osc1.frequency.cancelScheduledValues(now);
      v.osc2.frequency.cancelScheduledValues(now);
      v.osc1.frequency.setValueAtTime(freq, now);
      v.osc2.frequency.setValueAtTime(v.isBass ? freq * 0.5 : freq, now);

      const level = v.isBass ? 0.23 : 0.145;
      v.voiceGain.gain.cancelScheduledValues(now);
      v.voiceGain.gain.setTargetAtTime(level, now, 0.06);
    }
  }

  /**
   * Schedule a polyphonic voice glide to `targetMidiNotes` with customizable curve, tension, and strum stagger.
   */
  schedulePolyGlide(targetMidiNotes, options = {}) {
    if (!this.isInitialized) return;
    if (!this.isGateOpen) {
      this.engageVoicesImmediate(targetMidiNotes);
      return;
    }

    const now = this.ctx.currentTime;
    const startTime = Math.max(now, options.startTime ?? now);
    const baseDuration = Math.max(0.015, options.durationSec ?? 0.45);
    const curveType = options.curveType ?? 'exp-out';
    const tension = options.tension ?? 0.65;
    const strumSec = options.strumSec ?? 0;
    const strumDirection = options.strumDirection ?? 'up'; // 'up' | 'down'

    // Subtle filter breath on chord transition so the bar transition feels alive
    const cutoff = this.params.cutoffHz;
    const boost = Math.min(7500, cutoff * (1 + this.params.accentPulse * 0.75));
    this.globalFilter.frequency.cancelScheduledValues(startTime);
    this.globalFilter.frequency.setValueAtTime(cutoff, startTime);
    this.globalFilter.frequency.linearRampToValueAtTime(boost, startTime + 0.045);
    this.globalFilter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff), startTime + Math.max(0.25, baseDuration * 0.95));

    for (let i = 0; i < NUM_VOICES; i++) {
      const v = this.voices[i];
      const orderIdx = strumDirection === 'down' ? (NUM_VOICES - 1 - i) : i;
      const voiceStart = startTime + orderIdx * strumSec;
      const voiceDuration = Math.max(0.015, baseDuration);

      // Snapshot the live interpolated MIDI position if currently mid-glide
      const currentLiveMidi = this.getLiveVoiceMidi(i, now);
      const targetMidi = targetMidiNotes[i];

      this.scheduleSingleVoiceGlide(i, currentLiveMidi, targetMidi, voiceStart, voiceDuration, curveType, tension);
    }
  }

  /**
   * Schedule a single voice's frequency trajectory using a 64-point pitch curve
   */
  scheduleSingleVoiceGlide(voiceIndex, fromMidi, toMidi, startTime, durationSec, curveType, tension) {
    const v = this.voices[voiceIndex];
    const now = this.ctx.currentTime;
    const safeStart = Math.max(now, startTime);
    const safeDur = Math.max(0.015, durationSec);

    v.fromMidi = fromMidi;
    v.toMidi = toMidi;
    v.glideStartTime = safeStart;
    v.glideDuration = safeDur;
    v.curveType = curveType;
    v.tension = tension;

    const STEPS = 64;
    const curve1 = new Float32Array(STEPS);
    const curve2 = new Float32Array(STEPS);

    for (let s = 0; s < STEPS; s++) {
      const t = s / (STEPS - 1);
      const y = evaluateGlideCurve(t, curveType, tension);
      const midi = fromMidi + (toMidi - fromMidi) * y;
      const freq = midiToFreq(midi);
      curve1[s] = freq;
      curve2[s] = v.isBass ? freq * 0.5 : freq;
    }

    try {
      v.osc1.frequency.cancelScheduledValues(safeStart);
      v.osc2.frequency.cancelScheduledValues(safeStart);
      v.osc1.frequency.setValueAtTime(curve1[0], safeStart);
      v.osc2.frequency.setValueAtTime(curve2[0], safeStart);
      v.osc1.frequency.setValueCurveAtTime(curve1, safeStart, safeDur);
      v.osc2.frequency.setValueCurveAtTime(curve2, safeStart, safeDur);
    } catch {
      // Fallback if WebAudio rejects overlapping curve at exact boundary
      const endFreq = midiToFreq(toMidi);
      v.osc1.frequency.setTargetAtTime(endFreq, safeStart, safeDur * 0.3);
      v.osc2.frequency.setTargetAtTime(v.isBass ? endFreq * 0.5 : endFreq, safeStart, safeDur * 0.3);
    }

    v.currentMidi = toMidi;
  }

  /**
   * Release all voices smoothly (when Latch is turned off or Stop is pressed)
   */
  releaseAllVoices() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.isGateOpen = false;
    for (const v of this.voices) {
      v.voiceGain.gain.cancelScheduledValues(now);
      v.voiceGain.gain.setTargetAtTime(0, now, 0.09);
      v.voiceGain.gain.setValueAtTime(0, now + 0.5);
    }
  }

  /**
   * Compute exact real-time MIDI pitch of voice `i` at `audioTime` for the UI visualizer and MPE output
   */
  getLiveVoiceMidi(voiceIndex, audioTime = this.ctx?.currentTime ?? 0) {
    const v = this.voices[voiceIndex];
    if (!v) return 60;
    if (audioTime <= v.glideStartTime) return v.fromMidi;
    const elapsed = audioTime - v.glideStartTime;
    if (elapsed >= v.glideDuration) return v.toMidi;
    const t = elapsed / v.glideDuration;
    const y = evaluateGlideCurve(t, v.curveType, v.tension);
    return v.fromMidi + (v.toMidi - v.fromMidi) * y;
  }

  getAllLiveVoiceMidis() {
    if (!this.isInitialized) return [41, 53, 57, 61, 65, 69, 74];
    const now = this.ctx.currentTime;
    return this.voices.map((_, idx) => this.getLiveVoiceMidi(idx, now));
  }
}
