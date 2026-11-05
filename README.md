# TG-07 // QUANTIZED POLYPHONIC GLIDE SYNTHESIZER
> **Dieter Rams (Braun) Inspired Industrial Instrument with Shortest-Path Polyphonic Voice Leading & Clock-Quantized Pre-input (Cue) Engine**

![Braun TG-07 Banner](https://img.shields.io/badge/DESIGN-DIETER_RAMS_BRAUN-orange)
![WebAudio](https://img.shields.io/badge/AUDIO-WEB_AUDIO_API-green)
![WebMIDI](https://img.shields.io/badge/MIDI-WEB_MIDI_API-blue)
![Architecture](https://img.shields.io/badge/VOICES-7_INDEPENDENT_POLY-darkred)

---

## 📻 개요 (Overview)

**TG-07**은 [Swanek Audio의 Swan Glide](https://swanekaudio.com/swan-glide)에서 영감을 받아, **디터 람스(Dieter Rams)의 브라운(Braun) 인더스트리얼 오디오 랩 디자인 철학**(*"Weniger, aber besser" - 더 적게, 그러나 더 좋게*)을 바탕으로 구현된 **7성부 다성 글라이드 신디사이저 & 화성 시퀀서 프로토타입**입니다.

일반적인 신디사이저의 모노포닉 포르타멘토나 단순 피치 벤드와 달리, 코드가 변경될 때 **7개의 개별 보이스(베이스 1개 + 상성부 6개)가 각자 독립적으로 가장 가까운 음정(Shortest-Path Voice Leading)을 찾아 서로 다른 방향과 간격으로 액체처럼 미끄러지며(Glide)** 화성을 형성합니다.

---

## ⚡ 핵심 메커니즘 (Core Mechanics)

### 1. Latch & 선입력 큐 (Quantized Pre-input / Cue)
* **손을 떼도 유지되는 Latch:** 코드를 건반이나 버튼으로 계속 누르고 있을 필요가 없습니다. 한 번 입력된 코드는 Latch되어 유지됩니다.
* **마디 단위 선입력 (Pre-input Cue):** 코드가 연주되는 동안 언제든 다음 코드를 여유롭게 누르면, 음악이 끊기거나 즉시 바뀌지 않고 **`NEXT GRID PRE-INPUT (CUE)`** 대기열에 저장됩니다. (상단 화면에서 앰버색 점멸 LED로 대기 표시)
* **그리드 경계 자동 글라이드:** 마스터 클락의 다음 Grid(예: 1 BAR 첫 박)에 도달하는 순간, 대기 중이던 코드로 7개 성부가 지정된 곡선으로 미끄러집니다.

### 2. 다성부 최단 경로 보이스 리딩 (7-Voice Shortest-Path Engine)
* **7개 독립 오실레이터 보이스:** 베이스 1개와 상성부 6개가 화성의 근음, 3음, 7음, 텐션(9th, 11th, 13th, Altered)을 빈틈없이 분배합니다.
* **음역대 중력(Register Gravity) & 보이스 드리프트 방지:** 단순 최근접 매칭만 수행하면 코드가 바뀔 때마다 전체 음역이 고음이나 저음으로 치우치는 현상이 발생합니다. TG-07은 빔 서치(Beam Search) 알고리즘을 통해 **이전 음정과의 최소 이동 거리(78%) + 음역대 밸런스 중심축(22%)**을 최적으로 계산합니다.

### 3. 보간 커브 & 타이밍 선택
* **`EXP OUT` (기본값):** 초반에 빠르게 출발하여 목표 화성에 부드럽게 감속 착지 (아날로그 RC 필터 감각)
* **`EXP IN`:** 기존 음정을 오래 유지하다가 마디 끝자락에서 급격히 빨려 들어가는 텐션감
* **`S-CURVE` / `LINEAR`:** 완만한 시그모이드 곡선 및 선형 슬라이드
* **`START ON GRID` vs `LAND ON GRID`:**
  * **START ON GRID:** 다음 마디 정박(Beat 1)에 글라이드를 시작
  * **LAND ON GRID:** 다음 마디 정박(Beat 1)에 새 코드 음정에 정확히 착지하도록 마디 끝자락에 미리 출발

### 4. 아르페지에이터 & 보이스 모션 (Voice Motion)
* **`UNISON`:** 7개 보이스가 동시에 글라이드
* **`STRUM ↑ / STRUM ↓`:** 베이스부터 최고음까지(또는 역순) 설정된 시차(`0 ~ 130ms`)를 두고 아르페지오처럼 순차 출발
* **`ARP WAVE`:** 긴 마디(1~2 Bars) 동안 코드가 Latch되어 있을 때, 8분음표마다 상성부 보이스들이 현재 코드의 인접 구성음 사이를 오가며 물결치듯 움직이는 동적 아르페지오 모드

---

## 🎹 조작 및 단축키 안내 (Controls & Shortcuts)

웹앱 우측 상단의 **`[?] MANUAL`** 버튼을 누르거나 키보드에서 <kbd>?</kbd> 또는 <kbd>/</kbd> 키를 누르면 화면 내 팝오버로 전체 설명서와 단축키를 열람할 수 있습니다.

### 컴퓨터 키보드 단축키
| 키 | 기능 |
|:---|:---|
| <kbd>A</kbd> ~ <kbd>G</kbd> | 기본 근음(Natural Root) 선택 (`A`, `B`, `C`, `D`, `E`, `F`, `G`) |
| <kbd>Shift</kbd> + <kbd>A~G</kbd> | 반음 올린 근음 선택 (Sharp ♯) |
| <kbd>Z</kbd> / <kbd>X</kbd> | 현재 선택된 근음 반음 내림(♭) / 반음 올림(♯) |
| <kbd>1</kbd> ~ <kbd>=</kbd> (상단 숫자열) | 3화음, Sus, Add9, 6th, Dim, Aug 코드 12가지 즉시 트리거 |
| <kbd>Q</kbd> ~ <kbd>\</kbd> (QWERTY 문자열) | 7th, 9th, 11th, 13th, Altered 재즈 코드 12가지 즉시 트리거 |
| <kbd>Space</kbd> | 데모 시퀀스 1 자동 재생 / 전체 보이스 릴리즈 및 클락 정지 |
| <kbd>?</kbd> 또는 <kbd>/</kbd> | 오퍼레이팅 매뉴얼 & 단축키 팝오버 열기/닫기 |
| <kbd>Esc</kbd> | 팝오버 닫기 |

### 24가지 코드 매핑 표
* **상단 행 (`1` ~ `=`)**: `maj`(`1`), `m`(`2`), `sus2`(`3`), `sus4`(`4`), `dim`(`5`), `aug`(`6`), `add9`(`7`), `6`(`8`), `m6`(`9`), `6/9`(`0`), `7sus4`(`-`), `dim7`(`=`)
* **하단 행 (`Q` ~ `\`)**: `maj7`(`Q`), `m7`(`W`), `7`(`R`), `m7♭5`(`T`), `maj9`(`Y`), `m9`(`U`), `9`(`I`), `m11`(`O`), `13`(`P`), `7♭9`(`[`), `7♯9`(`]`), `maj7♯11`(`\`)

---

## 🎛️ WebMIDI 지원 (WebMIDI Routing)

하드웨어 MIDI 건반이 연결되면 Chrome / Edge 브라우저에서 자동으로 인식하며, 3가지 모드를 지원합니다:

1. **`ROOT ONLY (ANY KEY = SELECT ROOT)` (기본 모드):**
   * 건반의 옥타브 위치와 무관하게, **아무 건반이나 단음으로 누르면 그 음이 즉시 Root로 선택**되며 현재 선택된 코드 타입으로 다음 Grid에 선입력됩니다.
   * 복잡한 화음을 연주할 필요 없이 베이스 라인을 연주하듯 건반을 치면 7성부 고급 화성이 미끄러지듯 연주됩니다.
2. **`SPLIT (BELOW C3=ROOT / C3+=CHORD)`:**
   * C3(MIDI 48) 미만은 왼손으로 Root를 선택하고, C3 이상 2옥타브는 24개 코드 타입을 선택합니다. (Swan Glide 원작 스타일)
3. **`POLY CHORD AUTO-DETECT`:**
   * 건반으로 3~4개 이상의 화음을 직접 누르면 화성을 실시간으로 인식하여 자동 큐잉합니다.
4. **MIDI Out 지원:**
   * 외장 신디사이저나 가상악기 트랙으로 보이싱된 7개 MIDI 노트를 실시간 전송할 수 있습니다.

---

## 🛠️ 프로젝트 구조 (Project Structure)

```
glideAnything/
├── index.html            # Dieter Rams 인더스트리얼 UI & 오실로스코프, 매뉴얼 팝오버
├── styles.css            # Braun 하드웨어 질감, 섀시, 슬라이더, 반응형 CSS
├── js/
│   ├── app.js            # 메인 앱 컨트롤러, 이벤트 바인딩 & 60fps 캔버스 오실로스코프
│   ├── chords.js         # 24개 코드 사전, 인터벌 계산 & 화성 분석 유틸리티
│   ├── voice-leading.js  # 7성부 최단 경로 빔서치 알고리즘 & 4종 지수 커브 수식
│   ├── clock-scheduler.js# 퀀타이즈 마스터 클락, Latch 선입력(Cue) 스케줄러
│   ├── audio-engine.js   # 7-Voice WebAudio 신스, 스테레오 핑퐁 딜레이 & 리버브
│   └── midi-controller.js# WebMIDI In/Out 입출력 처리기 (Split/Root/Detect)
└── README.md             # 프로젝트 설명서
```

---

## 🚀 로컬 실행 방법 (Quick Start)

외부 라이브러리나 빌드 도구 의존성 없이 순수 모던 웹 표준(Vanilla JS ES Modules + Web Audio API)으로 작성되어 브라우저에서 바로 동작합니다.

```bash
# 1. 저장소 디렉토리로 이동
cd glideAnything

# 2. 로컬 웹 서버 구동 (Python 3 내장 서버 사용)
python3 -m http.server 8080

# 3. 브라우저 접속 (WebMIDI 지원을 위해 Chrome 또는 Edge 권장)
open http://localhost:8080
```

---

## 🎨 디자인 레퍼런스 (Design References)
* **Braun T 1000 / TG 60 / SK 4:** 디터 람스의 기능주의 미학과 정밀 가공 알루미늄 질감, 시그널 오렌지 포인트
* **Swanek Audio Swan Glide:** 다성부 독립 최단 거리 글라이드 보이스 리딩
* **Ableton Live:** 클립 런치 퀀타이즈 및 넥스트 바 선입력(Next Bar Cueing) 워크플로우
