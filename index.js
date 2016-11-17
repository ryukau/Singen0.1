const TWO_PI = 2 * Math.PI

function play(audioContext, wave) {
  if (quickSave) {
    save(wave)
  }

  var channel = wave.channels
  var frame = wave.frames
  var buffer = audioContext.createBuffer(channel, frame, audioContext.sampleRate)

  for (var i = 0; i < wave.channels; ++i) {
    var waveFloat32 = new Float32Array(wave.data[i])
    buffer.copyToChannel(waveFloat32, i, 0)
  }

  if (this.source !== undefined) {
    this.source.stop()
  }
  this.source = audioContext.createBufferSource()
  this.source.buffer = buffer
  this.source.connect(audioContext.destination)
  this.source.start()
}

function save(wave) {
  var buffer = Wave.toBuffer(wave, wave.channels)
  var header = Wave.fileHeader(audioContext.sampleRate, wave.channels,
    buffer.length)

  var blob = new Blob([header, buffer], { type: "application/octet-stream" })
  var url = window.URL.createObjectURL(blob)

  var a = document.createElement("a")
  a.style = "display: none"
  a.href = url
  a.download = "Singen0.1_" + Date.now() + ".wav"
  document.body.appendChild(a)
  a.click()

  // 不要になった要素をすぐに消すとFirefoxでうまく動かないので
  // タイマーで少し遅らせる。
  setTimeout(() => {
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }, 100)
}

// lengthは秒数。
function makeWave(length, sampleRate) {
  var waveLength = Math.floor(sampleRate * length)
  var wave = new Array(waveLength).fill(0)
  for (var t = 0; t < wave.length; ++t) {
    wave[t] += fmTower.oscillate(t)
  }
  return wave
}

class TwoPoleLP {
  //
  // Two Poleとして紹介されていた差分方程式の
  // 定数 a1 と a2 に適当な値を入れたフィルタ。
  // y[n] = b0 * x[n] - a1 * y[n-1] - a2 * y[n-2]
  //
  // cutoff の値は [1, 10^8]
  // resonance の値は [0, 0.5]
  //
  constructor(sampleRate) {
    this.sampleRate = sampleRate
    this.y = new Array(3).fill(0)
    this._cutoff = 1e8
    this._resonance = 0

    this.a1 = null
    this.a2 = null
    this.refresh()
  }

  cutoff(value) {
    var clamped = Math.max(1, Math.min(value, 1e8))
    this._cutoff = Math.pow(10, clamped * 8)
    this.refresh()
  }

  resonance(value) {
    var clamped = 1 - Math.max(0, Math.min(value, 1))
    this._resonance = 0.5 * (1 - clamped * clamped * clamped)
    this.refresh()
  }

  refresh() {
    this.a1 = 100 * this.sampleRate * this._cutoff
    this.a2 = -this._resonance * this.a1
  }

  clear() {
    this.y.fill(0)
  }

  pass(input) {
    var numer = (input + this.a1 * this.y[1] + this.a2 * this.y[2])
    var denom = 1 + this.a1 + this.a2
    var output = numer / denom

    this.y.unshift(output)
    this.y.pop()

    return output
  }
}

class StateVariableFilter {
  // http://www.earlevel.com/main/2003/03/02/the-digital-state-variable-filter/
  constructor(audioContext) {
    this.sampleRate = audioContext.sampleRate
    this.buffer = new Array(2).fill(0)

    this._cutoff
    this.fc
    this.cutoff = audioContext.sampleRate / 2

    this._q
    this.q = 0.5
  }

  get cutoff() {
    return this._cutoff
  }

  // cutoff の範囲は [0, 1]
  set cutoff(value) {
    this._cutoff = value
    this.fc = 2 * Math.sin(Math.PI * this._cutoff / this.sampleRate)
  }

  get q() {
    return 1 / this._q
  }

  // q の範囲は [0.5, infinity]
  set q(value) {
    this._q = 1 / value
  }

  pass(input) {
    var A = input - this.buffer[0] * this._q - this.buffer[1]
    var B = A * this.fc + this.buffer[0]
    var C = B * this.fc + this.buffer[1]

    this.buffer[0] = B
    this.buffer[1] = C

    return { lowpass: C, highpass: A, bandpass: B, bandreject: A + C }
  }

  refresh() {
    this.buffer.fill(0)
  }
}

class Oscillator {
  // グローバルでTWO_PI = 2 * Math.PIが定義されていること。
  constructor(audioContext) {
    this.sampleRate = audioContext.sampleRate

    this.gain = 1
    this.gainEnvelope = new Envelope(0.5)
    this._length = 960
    this.frequency = 440
    this.fmIndex = 1

    this.phase = 0

    this.twoPiRate = TWO_PI / this.sampleRate
  }

  get length() {
    return this._length
  }

  set length(value) {
    this._length = (value < 0) ? 0 : Math.floor(this.sampleRate * value)
  }

  // 音の高さを440Hzを0としたセント値で表現。
  get pitch() {
    return Math.log2(this.frequency / 440) * 1200
  }

  set pitch(value) {
    this.frequency = 440 * Math.pow(2, value / 1200)
  }

  refresh(phase) {
    this.phase = phase
    this.bufferOutput = 0
  }

  // time は経過サンプル数。
  oscillate(time, modulation) {
    if (time > this._length || time < 0) {
      return 0
    }
    var envTime = time / this._length
    var gain = this.gain * this.gainEnvelope.decay(envTime)
    var output = gain * Math.sin(this.phase)
    var mod = this.fmIndex * modulation

    this.phase += this.twoPiRate * this.frequency + mod
    this.bufferOutput = output
    return output
  }

  // 虚数になる場合でも値を返す。
  pow(base, exponent) {
    if (base === 0) {
      return (exponent === 1) ? 1 : 0
    }
    return Math.sign(base) * Math.pow(Math.abs(base), exponent)
  }
}

class OperatorControl {
  constructor(parent, audioContext, id, refreshFunc) {
    this.div = new Div(divMain.element, "operatorControl")
    this.headingOperatorControls = new Heading(this.div.element, 6,
      "Operator" + id)
    this.length = new NumberInput(this.div.element, "Length",
      0.2, 0.02, 1, 0.02, refresh)
    this.gain = new NumberInput(this.div.element, "Gain",
      1, 0, 1, 0.01, refresh)
    this.gainTension = new NumberInput(this.div.element, "Tension",
      0.5, 0, 1, 0.01, refresh)
    this.pitch = new NumberInput(this.div.element, "Pitch",
      0, -50, 50, 1, refresh)
    this.detune = new NumberInput(this.div.element, "Detune",
      0, -50, 50, 1, refresh)
    this.phase = new NumberInput(this.div.element, "Phase",
      0, 0, 1, 0.01, refresh)

    this.oscillator = new Oscillator(audioContext)
  }

  refresh() {
    this.oscillator.gain = this.gain.value
    this.oscillator.length = this.length.value
    this.oscillator.pitch = this.pitch.value * 100 + this.detune.value
    this.oscillator.gainEnvelope.tension = this.gainTension.value
    this.oscillator.refresh(this.phase.value * TWO_PI)
  }

  random(isBottom) {
    if (!isBottom) {
      this.length.random()
      this.gain.random()
    }
    this.pitch.random()
    this.gainTension.random()
    this.detune.random()
    this.phase.random()
  }
}

class FMTower {
  constructor(parent, audioContext, numOperator, refreshFunc) {
    this.audioContext = audioContext
    this.refreshFunc = refreshFunc
    this.div = new Div(parent, "fmTower")
    this.operatorControls = []
    for (var i = 0; i < numOperator; ++i) {
      this.push()
    }
  }

  get length() {
    if (this.operatorControls.length > 0) {
      var last = this.operatorControls.length - 1
      return this.operatorControls[last].length.value
    }
    return 0
  }

  set fmIndex(value) {
    this.operatorControls.forEach(element => element.oscillator.fmIndex = value)
  }

  push() {
    this.operatorControls.push(new OperatorControl(
      this.div.element, this.audioContext, this.operatorControls.length,
      this.refreshFunc))
  }

  pop() {
    var child = this.operatorControls.pop().div.element
    this.div.element.removeChild(child)
  }

  refresh() {
    this.operatorControls.forEach(element => element.refresh())
  }

  random() {
    for (var i = 0; i < this.operatorControls.length - 1; ++i) {
      this.operatorControls[i].random(false)
    }
    this.operatorControls[i].random(true)
  }

  oscillate(time) {
    var value = 0
    for (var i = 0; i < this.operatorControls.length; ++i) {
      value = this.operatorControls[i].oscillator.oscillate(time, value)
    }
    return value
  }
}

function random() {
  fmTower.random()
  refresh()
  play(audioContext, wave)
}

function refresh() {
  fmTower.refresh()
  fmTower.fmIndex = inputFMIndex.value

  wave.left = makeWave(fmTower.length, audioContext.sampleRate)
  wave.declick(inputDeclick.value)

  waveView.set(wave.left)
}

var audioContext = new AudioContext()

var quickSave = false
var filter = new StateVariableFilter(audioContext)
var wave = new Wave(1)

var divMain = new Div(document.body, "main")
var headingTitle = new Heading(divMain.element, 1, "Singen0.1")

var description = new Description(divMain.element)

var divWaveform = new Div(divMain.element, "waveform")
var headingWaveform = new Heading(divWaveform.element, 6, "Waveform")
var waveView = new WaveView(divWaveform.element, 512, 256, wave.left, false)

var divRenderControls = new Div(divMain.element, "renderControls")
var buttonPlay = new Button(divRenderControls.element, "Play",
  () => play(audioContext, wave))
var buttonSave = new Button(divRenderControls.element, "Save",
  () => save(wave))
var buttonRandom = new Button(divRenderControls.element, "Random",
  () => random())
var checkboxQuickSave = new Checkbox(divRenderControls.element, "QuickSave",
  quickSave, (checked) => { quickSave = checked })

var fmTower = new FMTower(divMain.element, audioContext, 4, refresh)

var divFilterControls = new Div(divMain.element, "filterControls")
var headingFilterControls = new Heading(divFilterControls.element, 6, "Filter")
var inputCutoff = new NumberInput(divFilterControls.element, "Cutoff",
  0, 0, 1, 0.01, refresh)
var inputQ = new NumberInput(divFilterControls.element, "Q",
  0, 0, 0, 0, refresh)

var divMiscControls = new Div(divMain.element, "miscControls")
var headingMiscControls = new Heading(divMiscControls.element, 6,
  "Misc.")
var tenMilliSecond = audioContext.sampleRate / 100
var inputFMIndex = new NumberInput(divMiscControls.element, "FM Index",
  0.62, 0, 1, 0.01, refresh)
var inputDeclick = new NumberInput(divMiscControls.element, "DeclickIn",
  0, 0, tenMilliSecond, 1, refresh)

refresh()
