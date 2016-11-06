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
  a.download = "SingenBD2_" + Date.now() + ".wav"
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
    wave[t] += 0.8 * oscBody.oscillate(t, 0)
  }
  return wave
}

class Oscillator {
  // グローバルでTWO_PI = 2 * Math.PIが定義されていること。
  constructor(audioContext) {
    this.sampleRate = audioContext.sampleRate

    this.gainEnvelope = new Envelope(0.5)
    this._length = 960
    this.frequency = 440
    this.feedback = 0
    this.fmIndex = 0

    this.phase = 0
    this.phaseReset = true

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

  reset() {
    this.phase = (this.phaseReset) ? 0 : Math.abs(this.phase) % TWO_PI
  }

  // time は経過サンプル数。
  oscillate(time, modulation) {
    if (time > this._length || time < 0) {
      return 0
    }

    var envTime = time / this._length
    var output = this.gainEnvelope.decay(envTime) * Math.sin(this.phase)

    var mod = this.fmIndex * modulation + this.feedback * output
    this.phase += this.twoPiRate * this.frequency + mod

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

function random(randomBody) {
}

function refresh() {
  oscBody.length = inputLength.value
  oscBody.pitch = inputPitch.value * 100 + inputDetune.value
  oscBody.gainEnvelope.tension = inputGainTension.value

  wave.left = makeWave(inputLength.value, audioContext.sampleRate)
  wave.declick(inputDeclick.value)

  waveView.set(wave.left)
}

var audioContext = new AudioContext()

var quickSave = false
var oscBody = new Oscillator(audioContext)
var wave = new Wave(1)
wave.left = makeWave(0.02, audioContext.sampleRate, 200, 30)


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
var checkboxQuickSave = new Checkbox(divRenderControls.element, "QuickSave",
  quickSave, (checked) => { quickSave = checked })

var divOperatorControls = new Div(divMain.element, "operatorControls")
var headingOperatorControls = new Heading(divOperatorControls.element, 6,
  "Operator")
var inputLength = new NumberInput(divOperatorControls.element, "Length",
  0.2, 0.02, 1, 0.02, refresh)
var inputPitch = new NumberInput(divOperatorControls.element, "Pitch",
  0, -50, 50, 1, refresh)
var inputDetune = new NumberInput(divOperatorControls.element, "Detune",
  0, -50, 50, 1, refresh)
var inputGainTension = new NumberInput(divOperatorControls.element, "Tension",
  0.5, 0, 1, 0.01, refresh)

var divMiscControls = new Div(divMain.element, "miscControls")
var headingMiscControls = new Heading(divMiscControls.element, 6,
  "Misc.")
var tenMilliSecond = audioContext.sampleRate / 100
var inputDeclick = new NumberInput(divMiscControls.element, "DeclickIn",
  0, 0, tenMilliSecond, 1, refresh)

refresh()
