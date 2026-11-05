// Main Application Controller & Dieter Rams Oscilloscope Visualizer
import {
  NOTE_DISPLAY,
  CHORD_TYPES,
  PRESET_PROGRESSIONS,
  formatChordName,
  midiToNoteName,
} from './chords.js';
import { NUM_VOICES, evaluateGlideCurve } from './voice-leading.js';
import { GlideAudioEngine, SOUND_PRESETS } from './audio-engine.js';
import { QuantizedGlideScheduler, GRID_OPTIONS } from './clock-scheduler.js';
import { WebMidiController } from './midi-controller.js';

class GlideApp {
  constructor() {
    this.audio = new GlideAudioEngine();
    this.midi = new WebMidiController(
      (root, typeId) => this.handleChordInput(root, typeId),
      () => this.scheduler.handleInputRelease(),
      (midiState) => this.updateMidiUI(midiState),
      (root, triggerChord) => this.handleRootSelect(root, triggerChord)
    );
    this.scheduler = new QuantizedGlideScheduler(this.audio, this.midi, () => this.renderStatusUI());

    this.selectedRoot = 2; // Default D (for Dm9)
    this.selectedTypeId = 'm9';
    this.scopeCanvas = null;
    this.scopeCtx = null;
    this.curveCanvas = null;
    this.curveCtx = null;
  }

  init() {
    this.scopeCanvas = document.getElementById('glide-scope');
    this.scopeCtx = this.scopeCanvas.getContext('2d');
    this.curveCanvas = document.getElementById('curve-preview');
    this.curveCtx = this.curveCanvas.getContext('2d');

    this.buildRootButtons();
    this.buildChordButtons();
    this.buildGridButtons();
    this.buildPresetButtons();
    this.bindControls();
    this.bindKeyboard();
    this.resizeCanvases();

    window.addEventListener('resize', () => this.resizeCanvases());

    // Initialize WebMIDI
    this.midi.init();

    this.renderStatusUI();
    this.drawCurvePreview();
    this.startRenderLoop();
  }

  async ensureAudioReady() {
    if (!this.audio.isInitialized) {
      await this.audio.init();
      document.getElementById('power-led')?.classList.add('led-on-green');
    } else if (this.audio.ctx.state === 'suspended') {
      await this.audio.ctx.resume();
    }
  }

  async handleChordInput(root, typeId) {
    await this.ensureAudioReady();
    this.selectedRoot = root;
    this.selectedTypeId = typeId;
    this.scheduler.inputChord(root, typeId);
    this.highlightSelectedButtons();
  }

  async handleRootSelect(root, triggerChord = true) {
    this.selectedRoot = root;
    this.highlightSelectedButtons();
    if (triggerChord) {
      await this.handleChordInput(root, this.selectedTypeId);
    }
  }

  buildRootButtons() {
    const container = document.getElementById('root-buttons');
    container.innerHTML = '';
    const letterHints = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    const blackKeys = new Set([1, 3, 6, 8, 10]);

    for (let pc = 0; pc < 12; pc++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rams-btn root-key ${blackKeys.has(pc) ? 'root-accidental' : 'root-natural'}`;
      btn.dataset.root = String(pc);
      btn.innerHTML = `
        <span class="btn-led"></span>
        <span class="btn-main-label">${letterHints[pc]}</span>
      `;
      btn.addEventListener('mousedown', async () => {
        await this.handleRootSelect(pc, !!this.scheduler.activeChord);
      });
      container.appendChild(btn);
    }
  }

  buildChordButtons() {
    const container = document.getElementById('chord-buttons');
    container.innerHTML = '';

    for (const ct of CHORD_TYPES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rams-btn chord-key';
      btn.dataset.typeId = ct.id;
      btn.innerHTML = `
        <span class="btn-top-row">
          <span class="btn-led"></span>
          <span class="btn-key-hint">${ct.keyHint}</span>
        </span>
        <span class="btn-main-label">${ct.label}</span>
        <span class="btn-sub-label">${ct.name}</span>
      `;
      btn.addEventListener('mousedown', async () => {
        await this.handleChordInput(this.selectedRoot, ct.id);
      });
      btn.addEventListener('mouseup', () => {
        this.scheduler.handleInputRelease();
      });
      container.appendChild(btn);
    }
    this.highlightSelectedButtons();
  }

  buildGridButtons() {
    const container = document.getElementById('grid-selector');
    container.innerHTML = '';
    for (const g of GRID_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rams-seg-btn ${this.scheduler.gridId === g.id ? 'active' : ''}`;
      btn.dataset.grid = g.id;
      btn.textContent = g.label;
      btn.addEventListener('click', () => {
        this.scheduler.gridId = g.id;
        container.querySelectorAll('.rams-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.grid === g.id));
        this.renderStatusUI();
      });
      container.appendChild(btn);
    }
  }

  buildPresetButtons() {
    const container = document.getElementById('progression-presets');
    container.innerHTML = '';
    PRESET_PROGRESSIONS.forEach((prog, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rams-pill-btn';
      btn.textContent = `SEQ ${idx + 1}: ${prog.name}`;
      btn.addEventListener('click', async () => {
        await this.ensureAudioReady();
        this.scheduler.startAutoProgression(prog.chords);
        this.highlightSelectedButtons();
      });
      container.appendChild(btn);
    });
  }

  bindControls() {
    // Latch Toggle
    const latchBtn = document.getElementById('latch-toggle');
    latchBtn.addEventListener('click', () => {
      this.scheduler.latchEnabled = !this.scheduler.latchEnabled;
      latchBtn.classList.toggle('active-orange', this.scheduler.latchEnabled);
      latchBtn.querySelector('.toggle-state').textContent = this.scheduler.latchEnabled ? 'ON (HOLD)' : 'OFF (GATE)';
      if (!this.scheduler.latchEnabled && !this.scheduler.autoLoopEnabled) {
        this.scheduler.stopAndRelease();
      }
    });

    // Stop / Release Button
    document.getElementById('stop-btn').addEventListener('click', () => {
      this.scheduler.stopAndRelease();
      this.highlightSelectedButtons();
    });

    // Curve Type Selector
    const curveGroup = document.getElementById('curve-type-selector');
    curveGroup.querySelectorAll('.rams-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const curve = btn.dataset.curve;
        this.scheduler.curveType = curve;
        curveGroup.querySelectorAll('.rams-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.drawCurvePreview();
      });
    });

    // Trigger Timing Mode Selector ('on-grid' | 'land-on-grid' | 'immediate')
    const timingGroup = document.getElementById('trigger-timing-selector');
    timingGroup.querySelectorAll('.rams-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.scheduler.triggerTiming = btn.dataset.timing;
        timingGroup.querySelectorAll('.rams-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.renderStatusUI();
      });
    });

    // Arp / Voice Stagger Selector
    const arpGroup = document.getElementById('arp-motion-selector');
    arpGroup.querySelectorAll('.rams-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.scheduler.arpMotion = btn.dataset.arp;
        arpGroup.querySelectorAll('.rams-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // Sound Preset Selector
    const soundSelect = document.getElementById('sound-preset-select');
    Object.entries(SOUND_PRESETS).forEach(([key, preset]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.name;
      soundSelect.appendChild(opt);
    });
    soundSelect.addEventListener('change', (e) => {
      this.audio.applyPreset(e.target.value);
      this.syncSynthSlidersToPreset();
    });

    // Sliders / Rotary Dials
    this.bindDial('bpm-slider', 'bpm-val', (v) => {
      this.scheduler.bpm = Number(v);
      return `${v} BPM`;
    });

    this.bindDial('glide-ratio-slider', 'glide-ratio-val', (v) => {
      this.scheduler.glideRatio = Number(v) / 100;
      return `${v}% GRID`;
    });

    this.bindDial('curve-tension-slider', 'curve-tension-val', (v) => {
      this.scheduler.curveTension = Number(v) / 100;
      this.drawCurvePreview();
      return `${v}%`;
    });

    this.bindDial('strum-slider', 'strum-val', (v) => {
      this.scheduler.strumMs = Number(v);
      return `${v} ms`;
    });

    this.bindDial('cutoff-slider', 'cutoff-val', (v) => {
      this.audio.setCutoff(Number(v));
      return `${v} Hz`;
    });

    this.bindDial('detune-slider', 'detune-val', (v) => {
      this.audio.setDetune(Number(v));
      return `${v} ct`;
    });

    this.bindDial('space-slider', 'space-val', (v) => {
      this.audio.setSpaceMix(Number(v) / 100);
      return `${v}%`;
    });

    this.bindDial('volume-slider', 'volume-val', (v) => {
      this.audio.setMasterVolume(Number(v) / 100);
      return `${v}%`;
    });

    // MIDI Controls
    document.getElementById('midi-mode-select').addEventListener('change', (e) => {
      this.midi.inputMode = e.target.value;
    });
    document.getElementById('midi-in-select').addEventListener('change', (e) => {
      this.midi.selectedInputId = e.target.value;
    });
    document.getElementById('midi-out-select').addEventListener('change', (e) => {
      this.midi.selectedOutputId = e.target.value;
    });
  }

  bindDial(sliderId, labelId, onUpdate) {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (!slider || !label) return;
    const update = () => {
      label.textContent = onUpdate(slider.value);
    };
    slider.addEventListener('input', update);
    update();
  }

  syncSynthSlidersToPreset() {
    const cutoffSlider = document.getElementById('cutoff-slider');
    const detuneSlider = document.getElementById('detune-slider');
    const spaceSlider = document.getElementById('space-slider');
    if (cutoffSlider) {
      cutoffSlider.value = this.audio.params.cutoffHz;
      document.getElementById('cutoff-val').textContent = `${this.audio.params.cutoffHz} Hz`;
    }
    if (detuneSlider) {
      detuneSlider.value = this.audio.params.detuneCents;
      document.getElementById('detune-val').textContent = `${this.audio.params.detuneCents} ct`;
    }
    if (spaceSlider) {
      const pct = Math.round(this.audio.params.spaceMix * 100);
      spaceSlider.value = pct;
      document.getElementById('space-val').textContent = `${pct}%`;
    }
  }

  bindKeyboard() {
    const rootLetterMap = {
      KeyC: 0,
      KeyD: 2,
      KeyE: 4,
      KeyF: 5,
      KeyG: 7,
      KeyA: 9,
      KeyB: 11,
    };

    const chordKeyMap = {};
    CHORD_TYPES.forEach((ct) => {
      chordKeyMap[ct.keyHint.toUpperCase()] = ct.id;
    });

    window.addEventListener('keydown', async (e) => {
      if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (this.scheduler.isRunning) {
          this.scheduler.stopAndRelease();
          this.highlightSelectedButtons();
        } else {
          await this.ensureAudioReady();
          this.scheduler.startAutoProgression(PRESET_PROGRESSIONS[0].chords);
          this.highlightSelectedButtons();
        }
        return;
      }

      // Root selection via A..G letters
      if (rootLetterMap[e.code] !== undefined) {
        let pc = rootLetterMap[e.code];
        if (e.shiftKey) pc = (pc + 1) % 12;
        this.selectedRoot = pc;
        this.highlightSelectedButtons();
        if (this.scheduler.activeChord) {
          await this.handleChordInput(this.selectedRoot, this.selectedTypeId);
        }
        return;
      }

      // Flat (Z) / Sharp (X) root transpose
      if (e.code === 'KeyZ') {
        this.selectedRoot = (this.selectedRoot + 11) % 12;
        this.highlightSelectedButtons();
        if (this.scheduler.activeChord) {
          await this.handleChordInput(this.selectedRoot, this.selectedTypeId);
        }
        return;
      }
      if (e.code === 'KeyX') {
        this.selectedRoot = (this.selectedRoot + 1) % 12;
        this.highlightSelectedButtons();
        if (this.scheduler.activeChord) {
          await this.handleChordInput(this.selectedRoot, this.selectedTypeId);
        }
        return;
      }

      // Chord type trigger
      const keyChar = e.key.toUpperCase();
      if (chordKeyMap[keyChar]) {
        await this.handleChordInput(this.selectedRoot, chordKeyMap[keyChar]);
      }
    });

    window.addEventListener('keyup', (e) => {
      const keyChar = e.key.toUpperCase();
      if (chordKeyMap[keyChar]) {
        this.scheduler.handleInputRelease();
      }
    });
  }

  highlightSelectedButtons() {
    const active = this.scheduler.activeChord;
    const cued = this.scheduler.cuedChord;

    document.querySelectorAll('.root-key').forEach((btn) => {
      const r = Number(btn.dataset.root);
      btn.classList.toggle('is-selected', r === this.selectedRoot);
      btn.classList.toggle('is-active-chord', active && active.root === r);
      btn.classList.toggle('is-cued-chord', cued && cued.root === r);
    });

    document.querySelectorAll('.chord-key').forEach((btn) => {
      const id = btn.dataset.typeId;
      btn.classList.toggle('is-selected', id === this.selectedTypeId);
      btn.classList.toggle('is-active-chord', active && active.typeId === id);
      btn.classList.toggle('is-cued-chord', cued && cued.typeId === id);
    });
  }

  updateMidiUI(midiState) {
    const badge = document.getElementById('midi-status-badge');
    const led = document.getElementById('midi-led');
    if (badge) badge.textContent = midiState.text;
    if (led) {
      led.classList.toggle('led-on-green', midiState.connected);
    }

    const inSelect = document.getElementById('midi-in-select');
    const outSelect = document.getElementById('midi-out-select');
    if (inSelect && midiState.inputs) {
      const prev = inSelect.value;
      inSelect.innerHTML = '<option value="all">ALL MIDI INPUTS</option>';
      midiState.inputs.forEach((inp) => {
        const opt = document.createElement('option');
        opt.value = inp.id;
        opt.textContent = inp.name || inp.id;
        inSelect.appendChild(opt);
      });
      if ([...inSelect.options].some((o) => o.value === prev)) inSelect.value = prev;
    }

    if (outSelect && midiState.outputs) {
      const prev = outSelect.value;
      outSelect.innerHTML = '<option value="none">NO MIDI OUT</option>';
      midiState.outputs.forEach((out) => {
        const opt = document.createElement('option');
        opt.value = out.id;
        opt.textContent = out.name || out.id;
        outSelect.appendChild(opt);
      });
      if ([...outSelect.options].some((o) => o.value === prev)) outSelect.value = prev;
    }
  }

  renderStatusUI() {
    const active = this.scheduler.activeChord;
    const cued = this.scheduler.cuedChord;

    const activeNameEl = document.getElementById('active-chord-readout');
    const activeNotesEl = document.getElementById('active-notes-readout');
    const cuedNameEl = document.getElementById('cued-chord-readout');
    const cuedSubEl = document.getElementById('cued-sub-readout');
    const cuedLed = document.getElementById('cued-led');

    if (active) {
      activeNameEl.textContent = formatChordName(active.root, active.typeId);
      activeNotesEl.textContent = active.voicing.map((m) => midiToNoteName(m)).join(' · ');
    } else {
      activeNameEl.textContent = 'STANDBY';
      activeNotesEl.textContent = 'SELECT CHORD OR PRESS SPACE';
    }

    if (cued) {
      cuedNameEl.textContent = formatChordName(cued.root, cued.typeId);
      const timingDesc =
        this.scheduler.triggerTiming === 'land-on-grid'
          ? 'PRE-GLIDE TO NEXT GRID'
          : 'WAITING FOR NEXT GRID';
      cuedSubEl.textContent = timingDesc;
      cuedLed?.classList.add('led-blink-amber');
    } else {
      cuedNameEl.textContent = active ? 'HOLD (LATCHED)' : '—';
      cuedSubEl.textContent = 'PRE-INPUT NEXT CHORD ANYTIME';
      cuedLed?.classList.remove('led-blink-amber');
    }

    this.highlightSelectedButtons();
  }

  resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    if (this.scopeCanvas) {
      const rect = this.scopeCanvas.getBoundingClientRect();
      this.scopeCanvas.width = rect.width * dpr;
      this.scopeCanvas.height = rect.height * dpr;
    }
    if (this.curveCanvas) {
      const rect = this.curveCanvas.getBoundingClientRect();
      this.curveCanvas.width = rect.width * dpr;
      this.curveCanvas.height = rect.height * dpr;
      this.drawCurvePreview();
    }
  }

  drawCurvePreview() {
    if (!this.curveCanvas || !this.curveCtx) return;
    const ctx = this.curveCtx;
    const w = this.curveCanvas.width;
    const h = this.curveCanvas.height;
    const pad = 12 * (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, w, h);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }

    // Draw curve
    ctx.strokeStyle = '#EA5B0C';
    ctx.lineWidth = 2.5 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const yNorm = evaluateGlideCurve(t, this.scheduler.curveType, this.scheduler.curveTension);
      const x = pad + t * (w - pad * 2);
      const y = h - pad - yNorm * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Start & end dots
    ctx.fillStyle = '#E8E6DF';
    ctx.beginPath();
    ctx.arc(pad, h - pad, 3.5 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    ctx.arc(w - pad, pad, 3.5 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    ctx.fill();
  }

  startRenderLoop() {
    const render = () => {
      const clockState = this.scheduler.tick();
      this.updateClockStrip(clockState);
      this.drawVoiceScope(clockState);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  updateClockStrip(clockState) {
    const fill = document.getElementById('grid-progress-fill');
    const countdown = document.getElementById('grid-countdown-text');
    const ledsContainer = document.getElementById('beat-leds');

    if (fill) {
      fill.style.width = `${(clockState.gridProgress * 100).toFixed(1)}%`;
    }
    if (countdown) {
      if (!clockState.isRunning) {
        countdown.textContent = 'CLOCK IDLE';
      } else {
        countdown.textContent = `BEAT ${clockState.beatInGrid + 1}/${clockState.totalBeatsInGrid} · NEXT IN ${clockState.timeToNextGridSec.toFixed(2)}s`;
      }
    }
    if (ledsContainer) {
      const total = clockState.totalBeatsInGrid;
      if (ledsContainer.children.length !== total) {
        ledsContainer.innerHTML = '';
        for (let i = 0; i < total; i++) {
          const dot = document.createElement('span');
          dot.className = 'beat-led';
          ledsContainer.appendChild(dot);
        }
      }
      Array.from(ledsContainer.children).forEach((dot, idx) => {
        dot.classList.toggle('active', clockState.isRunning && idx === clockState.beatInGrid);
        dot.classList.toggle('downbeat', idx === 0);
      });
    }
  }

  drawVoiceScope(clockState) {
    if (!this.scopeCanvas || !this.scopeCtx) return;
    const ctx = this.scopeCtx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.scopeCanvas.width;
    const h = this.scopeCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background Grid: Current Bar (0% -> 72% width) | Next Bar Preview Zone (72% -> 100% width)
    const splitX = w * 0.72;
    const padY = 24 * dpr;

    // Next-Bar Cue Zone Shading
    ctx.fillStyle = this.scheduler.cuedChord
      ? 'rgba(229, 160, 0, 0.08)'
      : 'rgba(255, 255, 255, 0.025)';
    ctx.fillRect(splitX, 0, w - splitX, h);

    // Beat Subdivisions in Current Grid Zone
    const totalBeats = clockState.totalBeatsInGrid || 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1 * dpr;
    for (let b = 1; b < totalBeats; b++) {
      const bx = (splitX * b) / totalBeats;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, h);
      ctx.stroke();
    }

    // Horizontal Pitch Reference Lines (MIDI 36 to 80)
    const minMidi = 34;
    const maxMidi = 80;
    const midiToY = (midi) => {
      const norm = (midi - minMidi) / (maxMidi - minMidi);
      return h - padY - norm * (h - padY * 2);
    };

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let m = 36; m <= 78; m += 6) {
      const y = midiToY(m);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Next Grid Boundary Divider Line
    ctx.strokeStyle = this.scheduler.cuedChord ? 'rgba(229, 160, 0, 0.7)' : 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone Labels
    ctx.font = `600 ${10 * dpr}px "JetBrains Mono", "SF Mono", monospace`;
    ctx.fillStyle = 'rgba(232, 230, 223, 0.45)';
    ctx.fillText(`CURRENT GRID (${this.scheduler.gridId.toUpperCase()})`, 12 * dpr, 16 * dpr);
    ctx.fillStyle = this.scheduler.cuedChord ? '#F5B73B' : 'rgba(232, 230, 223, 0.4)';
    ctx.fillText(
      this.scheduler.cuedChord
        ? `NEXT GRID CUE: ${formatChordName(this.scheduler.cuedChord.root, this.scheduler.cuedChord.typeId)}`
        : 'NEXT GRID (CUE READY)',
      splitX + 12 * dpr,
      16 * dpr
    );

    const active = this.scheduler.activeChord;
    if (!active) return;

    const liveMidis = this.audio.getAllLiveVoiceMidis();
    const prevMidis = this.scheduler.previousVoicing || active.voicing;
    const targetMidis = active.voicing;
    const cued = this.scheduler.cuedChord;

    // Glide window ratio inside the current grid
    const glideDur = this.scheduler.getGlideDurationSec();
    const gridDur = this.scheduler.getGridDurationSec();
    const glideFraction = Math.min(0.85, glideDur / gridDur);
    const glideEndX = splitX * glideFraction;

    // Draw each of the 7 voices
    for (let v = 0; v < NUM_VOICES; v++) {
      const isBass = v === 0;
      const fromM = prevMidis[v];
      const toM = targetMidis[v];
      const liveM = liveMidis[v];

      // 1. Current Bar Voice Trajectory (Glide at start of bar -> sustain across bar)
      ctx.strokeStyle = isBass ? '#EA5B0C' : '#8CE071';
      ctx.lineWidth = (isBass ? 2.6 : 1.9) * dpr;
      ctx.beginPath();

      const curveSteps = 36;
      for (let s = 0; s <= curveSteps; s++) {
        const t = s / curveSteps;
        const x = t * glideEndX;
        const yCurve = evaluateGlideCurve(t, this.scheduler.curveType, this.scheduler.curveTension);
        const m = fromM + (toM - fromM) * yCurve;
        const y = midiToY(m);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(splitX, midiToY(toM));
      ctx.stroke();

      // 2. If a Cued (Pre-input) chord is waiting, draw the Planned Shortest-Path Glide Curve into Next Grid!
      if (cued && cued.previewVoicing) {
        const nextM = cued.previewVoicing[v];
        ctx.strokeStyle = isBass ? '#FF7A2F' : '#F5B73B';
        ctx.lineWidth = 2.0 * dpr;
        ctx.beginPath();
        const previewGlideWidth = (w - splitX) * 0.68;
        for (let s = 0; s <= curveSteps; s++) {
          const t = s / curveSteps;
          const x = splitX + t * previewGlideWidth;
          const yCurve = evaluateGlideCurve(t, this.scheduler.curveType, this.scheduler.curveTension);
          const m = toM + (nextM - toM) * yCurve;
          const y = midiToY(m);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(w - 8 * dpr, midiToY(nextM));
        ctx.stroke();

        // Target note label in Next Grid preview
        ctx.fillStyle = '#F5B73B';
        ctx.font = `500 ${9.5 * dpr}px "JetBrains Mono", monospace`;
        const delta = Math.round(nextM - toM);
        const deltaStr = delta === 0 ? '=' : delta > 0 ? `+${delta}` : `${delta}`;
        ctx.fillText(`${midiToNoteName(nextM)} (${deltaStr})`, w - 58 * dpr, midiToY(nextM) - 4 * dpr);
      }

      // 3. Live Playhead Voice Dot
      const playheadX = clockState.gridProgress * splitX;
      const liveY = midiToY(liveM);

      ctx.fillStyle = isBass ? '#EA5B0C' : '#E8E6DF';
      ctx.beginPath();
      ctx.arc(playheadX, liveY, (isBass ? 4.5 : 3.5) * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Voice note name tag near left
      ctx.fillStyle = isBass ? '#EA5B0C' : 'rgba(232, 230, 223, 0.78)';
      ctx.font = `500 ${9.5 * dpr}px "JetBrains Mono", monospace`;
      ctx.fillText(
        `${isBass ? 'BASS' : `V${v}`} ${midiToNoteName(liveM)}`,
        8 * dpr,
        midiToY(toM) - 5 * dpr
      );
    }

    // Live Playhead Vertical Cursor
    if (clockState.isRunning) {
      const playheadX = clockState.gridProgress * splitX;
      ctx.strokeStyle = 'rgba(234, 91, 12, 0.85)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new GlideApp();
  app.init();
});
