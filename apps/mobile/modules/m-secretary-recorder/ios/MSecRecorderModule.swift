import AVFoundation
import CryptoKit
import ExpoModulesCore
import os

/**
 * iOS counterpart of the Android RecordingService + MSecRecorderModule pair.
 *
 * Same JS contract as Android (see ../src/index.ts):
 *   AsyncFunction start(chunkLengthSec) / stop / pause / resume, Function isRunning,
 *   events onStarted / onStopped / onChunkReady / onError.
 *
 * Rotation strategy: ONE continuous AVAudioEngine input tap feeding a rotating
 * AVAssetWriter. The next chunk's writer is opened ~one chunk ahead and swapped
 * in under a lock on the audio thread, so no audio is dropped at a boundary —
 * matching Android's MediaRecorder.setNextOutputFile() behaviour.
 *
 * ── Why the earlier AVAssetWriter attempt failed ──────────────────────────
 * The previous attempt was reverted after the writer rejected appended sample
 * buffers with `FigExport err -12651` / `AVFoundationErrorDomain -11861`
 * ("Cannot Encode Media"), leaving a 0-byte .m4a. That was blamed on the
 * Simulator's encoder path and on the hand-built CMSampleBuffer.
 *
 * Both diagnoses were wrong. An isolated matrix (synthetic PCM, no mic, one
 * variable at a time) showed the sample buffers were fine and the failure
 * reproduces for exactly one reason:
 *
 *     AVEncoderBitRateKey = 64000 is out of range for AAC-LC mono at a
 *     16 kHz output rate. The encoder's own applicableEncodeBitRates for
 *     16 kHz mono is {12,16,20,24,28,32,40,48} kbps — 64 kbps is not in it.
 *
 * With the bit rate inside that set, all 13 construction variants pass —
 * sampleSizeEntryCount 0 *and* 1, interleaved *and* non-interleaved, Int16
 * *and* Float32, CMSampleBufferSetDataBufferFromAudioBufferList *and* a manual
 * CMBlockBuffer, startSession at .zero *and* at the first PTS. The failure is
 * an encoder-settings error, not a Simulator limitation and not a CMSampleBuffer
 * bug. AVAudioRecorder never surfaced it because it silently clamps the
 * requested bit rate; AVAssetWriter refuses instead.
 *
 * Consequence for parity: the documented "64 kbps" was never achievable at
 * 16 kHz — AVAudioRecorder was already clamping it. `AACEncoderCapabilities`
 * now asks the encoder at runtime and clamps to the highest supported value
 * (48 kbps on every runtime measured so far), so this adapts to whatever a
 * given device reports rather than hard-coding a number that may be rejected.
 *
 * Priming is not lost audio: a ramp round-trip (encode N frames, decode back)
 * returns exactly N frames. AVURLAsset.duration reads ~132 ms short because of
 * the AAC priming edit list, but every sample is present, so a chunk boundary
 * costs nothing.
 *
 * The AVAudioFile route remains a dead end: AVAudioFile(forWriting:settings:)
 * cannot write compressed AAC at all (`AVAudioFile.mm:setBitRate error
 * 560226676` = '!dat'). It only produces PCM containers.
 *
 * ── Safety net ────────────────────────────────────────────────────────────
 * `start()` validates the encoder against the live input format before arming
 * the continuous path (a few ms of silence pushed through the identical
 * settings). If that validation fails on some runtime this was never measured
 * on, the engine falls back to the previous AVAudioRecorder stop/restart
 * rotation, which loses ~100 ms per boundary but always records. The active
 * strategy is reported through `diagnostics()` and in the onStarted payload.
 *
 * Format matches Android: AAC/MP4 (.m4a), 16 kHz, mono, bit rate clamped to the
 * encoder's maximum for that rate. Chunk payload keys and units match
 * RecordingService.emitChunkReady. Background continuation comes from the
 * `audio` UIBackgroundMode in app.json.
 */
public class MSecRecorderModule: Module {
  private let engine = RecordingEngine()

  public func definition() -> ModuleDefinition {
    Name("MSecRecorder")

    Events("onStarted", "onStopped", "onChunkReady", "onError")

    OnCreate {
      self.engine.emit = { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
    }

    OnDestroy {
      self.engine.emit = nil
      self.engine.stop()
    }

    AsyncFunction("start") { (chunkLengthSec: Int, promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        guard granted else {
          promise.reject("E_MIC_PERMISSION", "ไม่ได้รับสิทธิ์ใช้ไมโครโฟน")
          return
        }
        self.engine.start(chunkLengthSec: chunkLengthSec) { error in
          if let error {
            promise.reject("E_RECORDER_START", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }

    AsyncFunction("stop") {
      self.engine.stop()
    }

    AsyncFunction("pause") {
      self.engine.pause()
    }

    AsyncFunction("resume") {
      self.engine.resume()
    }

    Function("isRunning") {
      self.engine.isRunning
    }

    /// Device-vs-Simulator encoder report. Exposed so a physical-device run can
    /// confirm the bit-rate ceiling without rebuilding, since that ceiling is
    /// the whole reason the gapless path previously failed.
    AsyncFunction("diagnostics") { () -> [String: Any] in
      RecorderDiagnostics.run()
    }
  }
}

// ── chunk description ────────────────────────────────────────

struct FinishedChunk {
  let url: URL
  let index: Int
  let startedAtSec: Int
  let endedAtSec: Int
}

protocol RecordingCore: AnyObject {
  var strategyName: String { get }
  var onChunk: ((FinishedChunk) -> Void)? { get set }
  var onError: ((String) -> Void)? { get set }

  func start(chunkLengthSec: Int) throws
  /// Finalizes the in-flight chunk; `completion` runs once it is on disk.
  func stop(completion: @escaping () -> Void)
  func pause()
  func resume()
}

// ── recording engine (coordinator) ───────────────────────────

final class RecordingEngine: NSObject {
  /// Set by the module; called with (eventName, payload).
  var emit: ((String, [String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "msec.recorder")
  private var core: RecordingCore?
  private var running = false
  private var paused = false
  private var interruptedWhileRecording = false

  var isRunning: Bool {
    queue.sync { running }
  }

  // ── lifecycle ──────────────────────────────────────────────

  func start(chunkLengthSec: Int, completion: @escaping (Error?) -> Void) {
    queue.async {
      guard !self.running else {
        completion(nil)
        return
      }
      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth])
        try session.setActive(true)

        self.observeInterruptions()

        let length = max(chunkLengthSec, 1)
        let core = self.makeCore()
        core.onChunk = { [weak self] chunk in self?.emitChunkReady(chunk) }
        core.onError = { [weak self] message in self?.emit?("onError", ["message": message]) }
        try core.start(chunkLengthSec: length)

        self.core = core
        self.running = true
        self.paused = false
        self.emit?("onStarted", ["strategy": core.strategyName])
        completion(nil)
      } catch {
        self.cleanup()
        self.emit?("onError", ["message": error.localizedDescription])
        completion(error)
      }
    }
  }

  /// Continuous capture when the encoder validates against the live input
  /// format, otherwise the proven stop/restart recorder.
  private func makeCore() -> RecordingCore {
    if ContinuousCaptureCore.isSupported() {
      return ContinuousCaptureCore()
    }
    return LegacyRotationCore()
  }

  func stop() {
    queue.async {
      guard self.running, let core = self.core else { return }
      self.running = false
      core.stop { [weak self] in
        guard let self else { return }
        self.queue.async {
          self.cleanup()
          self.emit?("onStopped", [:])
        }
      }
    }
  }

  func pause() {
    queue.async {
      guard self.running, !self.paused else { return }
      self.core?.pause()
      self.paused = true
    }
  }

  func resume() {
    queue.async {
      guard self.running, self.paused else { return }
      self.paused = false
      self.core?.resume()
    }
  }

  // ── events ─────────────────────────────────────────────────

  private func emitChunkReady(_ chunk: FinishedChunk) {
    guard let size = ChunkFile.size(of: chunk.url), size > 0 else { return }
    var payload: [String: Any] = [
      "fileUri": chunk.url.absoluteString,
      "chunkIndex": chunk.index,
      "startedAtSec": chunk.startedAtSec,
      "endedAtSec": chunk.endedAtSec,
      "durationSec": chunk.endedAtSec - chunk.startedAtSec,
      "fileSizeBytes": size,
    ]
    if let checksum = ChunkFile.sha256(of: chunk.url) {
      payload["checksumSha256"] = checksum
    }
    emit?("onChunkReady", payload)
  }

  private func cleanup() {
    core = nil
    paused = false
    interruptedWhileRecording = false
    NotificationCenter.default.removeObserver(self)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // ── interruptions (phone call, Siri, …) ────────────────────

  private func observeInterruptions() {
    NotificationCenter.default.removeObserver(self)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance()
    )
  }

  @objc private func handleInterruption(_ note: Notification) {
    guard let info = note.userInfo,
          let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }

    switch type {
    case .began:
      queue.async {
        if self.running, !self.paused {
          self.interruptedWhileRecording = true
          self.core?.pause()
          self.paused = true
        }
      }
    case .ended:
      let optionsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
      queue.async {
        guard self.running, self.interruptedWhileRecording else { return }
        self.interruptedWhileRecording = false
        if options.contains(.shouldResume) {
          try? AVAudioSession.sharedInstance().setActive(true)
          self.paused = false
          self.core?.resume()
        } else {
          self.emit?("onError", ["message": "audio session interrupted — tap resume to continue"])
        }
      }
    @unknown default:
      break
    }
  }
}

// ── encoder capabilities ─────────────────────────────────────

/// The piece that was missing. AAC-LC's legal bit-rate range depends on the
/// output sample rate; asking the encoder is the only reliable way to know it.
enum AACEncoderCapabilities {
  /// Desired parity target with Android. Clamped down when unsupported.
  static let desiredBitRate = 64_000

  static func applicableBitRates(sampleRate: Double, channels: AVAudioChannelCount = 1) -> [Int] {
    guard let inFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16, sampleRate: sampleRate,
      channels: channels, interleaved: true
    ) else { return [] }

    var outASBD = AudioStreamBasicDescription()
    outASBD.mFormatID = kAudioFormatMPEG4AAC
    outASBD.mSampleRate = sampleRate
    outASBD.mChannelsPerFrame = channels
    guard let outFormat = AVAudioFormat(streamDescription: &outASBD),
          let converter = AVAudioConverter(from: inFormat, to: outFormat) else { return [] }
    return (converter.applicableEncodeBitRates ?? []).map(\.intValue).sorted()
  }

  /// Highest supported rate not exceeding `desiredBitRate`.
  static func bitRate(forOutputRate rate: Double) -> Int {
    let applicable = applicableBitRates(sampleRate: rate)
    guard !applicable.isEmpty else {
      // Encoder unavailable for interrogation — 32 kbps is inside every
      // measured runtime's range for 16 kHz mono.
      return min(desiredBitRate, 32_000)
    }
    if applicable.contains(desiredBitRate) { return desiredBitRate }
    return applicable.filter { $0 <= desiredBitRate }.last ?? applicable[0]
  }

  static func outputSettings(sampleRate: Double) -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: bitRate(forOutputRate: sampleRate),
    ]
  }
}

// ── CMSampleBuffer construction ──────────────────────────────

enum AudioSampleBuffer {
  static func formatDescription(for format: AVAudioFormat) -> CMFormatDescription? {
    var asbd = format.streamDescription.pointee
    var out: CMFormatDescription?
    let status = CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault, asbd: &asbd,
      layoutSize: 0, layout: nil,
      magicCookieSize: 0, magicCookie: nil,
      extensions: nil, formatDescriptionOut: &out)
    return status == noErr ? out : nil
  }

  /// Apple's documented pattern. The matrix showed the explicit per-sample size
  /// and the manual-block-buffer route are equivalent, so this keeps the
  /// simplest one and passes the size explicitly.
  static func make(
    from pcm: AVAudioPCMBuffer,
    formatDescription: CMFormatDescription,
    pts: CMTime
  ) -> CMSampleBuffer? {
    let asbd = pcm.format.streamDescription.pointee
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: CMTimeScale(asbd.mSampleRate)),
      presentationTimeStamp: pts,
      decodeTimeStamp: .invalid)

    let sizeStorage = UnsafeMutablePointer<Int>.allocate(capacity: 1)
    sizeStorage.initialize(to: Int(asbd.mBytesPerFrame))
    defer { sizeStorage.deallocate() }

    var sbuf: CMSampleBuffer?
    var status = CMSampleBufferCreate(
      allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
      makeDataReadyCallback: nil, refcon: nil,
      formatDescription: formatDescription,
      sampleCount: CMItemCount(pcm.frameLength),
      sampleTimingEntryCount: 1, sampleTimingArray: &timing,
      sampleSizeEntryCount: 1, sampleSizeArray: sizeStorage,
      sampleBufferOut: &sbuf)
    guard status == noErr, let sbuf else { return nil }

    status = CMSampleBufferSetDataBufferFromAudioBufferList(
      sbuf, blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      bufferList: pcm.audioBufferList)
    return status == noErr ? sbuf : nil
  }

  /// Copies `count` frames starting at `offset`. Only allocates when a chunk
  /// boundary falls inside a tap buffer, i.e. once per rotation.
  static func slice(_ src: AVAudioPCMBuffer, offset: Int, count: Int) -> AVAudioPCMBuffer? {
    if offset == 0 && count == Int(src.frameLength) { return src }
    guard count > 0,
          let out = AVAudioPCMBuffer(pcmFormat: src.format, frameCapacity: AVAudioFrameCount(count))
    else { return nil }
    out.frameLength = AVAudioFrameCount(count)

    let channels = Int(src.format.channelCount)
    let interleaved = src.format.isInterleaved

    switch src.format.commonFormat {
    case .pcmFormatFloat32:
      guard let s = src.floatChannelData, let d = out.floatChannelData else { return nil }
      if interleaved {
        memcpy(d[0], s[0] + offset * channels, count * channels * MemoryLayout<Float>.size)
      } else {
        for c in 0..<channels {
          memcpy(d[c], s[c] + offset, count * MemoryLayout<Float>.size)
        }
      }
    case .pcmFormatInt16:
      guard let s = src.int16ChannelData, let d = out.int16ChannelData else { return nil }
      if interleaved {
        memcpy(d[0], s[0] + offset * channels, count * channels * MemoryLayout<Int16>.size)
      } else {
        for c in 0..<channels {
          memcpy(d[c], s[c] + offset, count * MemoryLayout<Int16>.size)
        }
      }
    default:
      return nil
    }
    return out
  }
}

// ── one chunk's writer ───────────────────────────────────────

final class ChunkWriter {
  let url: URL
  let index: Int
  /// Global frame index at which this chunk begins. Assigned when the writer is
  /// actually swapped in, not at construction — a writer is pre-opened one chunk
  /// ahead, before its start position on the timeline is known.
  var startFrame: AVAudioFramePosition
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private var sessionStarted = false

  private(set) var appendedFrames: AVAudioFramePosition = 0
  private(set) var droppedFrames: AVAudioFramePosition = 0
  private(set) var failure: String?

  init(url: URL, index: Int, startFrame: AVAudioFramePosition, outputSampleRate: Double) throws {
    self.url = url
    self.index = index
    self.startFrame = startFrame
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: AACEncoderCapabilities.outputSettings(sampleRate: outputSampleRate))
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else {
      throw NSError(domain: "MSecRecorder", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "AVAssetWriter rejected the audio input",
      ])
    }
    writer.add(input)
    guard writer.startWriting() else {
      throw NSError(domain: "MSecRecorder", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "startWriting failed: \(Self.describe(writer.error))",
      ])
    }
  }

  /// Called on the audio thread. Must not block.
  func append(_ sbuf: CMSampleBuffer, frames: AVAudioFramePosition, pts: CMTime) {
    guard failure == nil else { return }
    if !sessionStarted {
      writer.startSession(atSourceTime: pts)
      sessionStarted = true
    }
    guard input.isReadyForMoreMediaData else {
      droppedFrames += frames
      return
    }
    if input.append(sbuf) {
      appendedFrames += frames
    } else {
      failure = Self.describe(writer.error)
    }
  }

  /// Finishes the file. `completion` receives true when a playable file exists.
  func finish(completion: @escaping (Bool) -> Void) {
    guard writer.status == .writing else {
      completion(writer.status == .completed)
      return
    }
    input.markAsFinished()
    writer.finishWriting { [weak self] in
      guard let self else {
        completion(false)
        return
      }
      if self.writer.status != .completed {
        self.failure = Self.describe(self.writer.error)
      }
      completion(self.writer.status == .completed)
    }
  }

  /// Tears down a pre-opened writer that will never be used.
  func discard() {
    if writer.status == .writing { writer.cancelWriting() }
    try? FileManager.default.removeItem(at: url)
  }

  static func describe(_ error: Error?) -> String {
    guard let error = error as NSError? else { return "unknown" }
    var s = "\(error.domain) \(error.code): \(error.localizedDescription)"
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
      s += " (underlying \(underlying.domain) \(underlying.code))"
    }
    return s
  }
}

// ── continuous capture (gapless) ─────────────────────────────

final class ContinuousCaptureCore: RecordingCore {
  var strategyName: String { "continuous-avassetwriter" }
  var onChunk: ((FinishedChunk) -> Void)?
  var onError: ((String) -> Void)?

  /// Output rate parity with Android. The tap's native rate is resampled by
  /// AVAssetWriter itself — verified to return exactly the expected frame count.
  static let outputSampleRate: Double = 16_000

  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "msec.recorder.continuous")
  private var lock = os_unfair_lock_s()

  private var current: ChunkWriter?
  private var next: ChunkWriter?
  private var formatDescription: CMFormatDescription?
  private var sourceFormat: AVAudioFormat?

  private var chunkFrameTarget: AVAudioFramePosition = 0
  private var framesIntoChunk: AVAudioFramePosition = 0
  private var globalFrame: AVAudioFramePosition = 0
  private var chunkIndex = 0
  private var chunkLengthSec = 300
  private var sourceRate: Double = 48_000
  private var tapInstalled = false
  private var pausedFlag = false
  /// Set when a boundary is reached but the next writer is not open yet. The
  /// current chunk is extended rather than dropping audio.
  private var rotatePending = false

  // ── support probe ────────────────────────────────────────

  /// Pushes a few ms of silence through the exact writer settings against the
  /// live input format. Cheap, and it catches any runtime where the encoder
  /// refuses these settings before we commit to the gapless path.
  static func isSupported() -> Bool {
    let inputFormat = AVAudioEngine().inputNode.inputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { return false }
    guard let fd = AudioSampleBuffer.formatDescription(for: inputFormat) else { return false }

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("msec-encoder-probe-\(UUID().uuidString).m4a")
    defer { try? FileManager.default.removeItem(at: url) }

    guard let writer = try? ChunkWriter(
      url: url, index: 0, startFrame: 0, outputSampleRate: outputSampleRate) else { return false }

    let frames = AVAudioFrameCount(inputFormat.sampleRate * 0.2)
    guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frames) else { return false }
    pcm.frameLength = frames
    // Non-silent: some encoders short-circuit pure digital silence.
    if let ch = pcm.floatChannelData {
      for c in 0..<Int(inputFormat.channelCount) {
        for i in 0..<Int(frames) {
          ch[c][i] = Float(sin(2.0 * .pi * 440.0 * Double(i) / inputFormat.sampleRate) * 0.25)
        }
      }
    }

    var offset: AVAudioFramePosition = 0
    let slice = 1024
    while offset < AVAudioFramePosition(frames) {
      let n = min(slice, Int(AVAudioFramePosition(frames) - offset))
      guard let part = AudioSampleBuffer.slice(pcm, offset: Int(offset), count: n),
            let sbuf = AudioSampleBuffer.make(
              from: part, formatDescription: fd,
              pts: CMTime(value: offset, timescale: CMTimeScale(inputFormat.sampleRate)))
      else { return false }
      writer.append(sbuf, frames: AVAudioFramePosition(n),
                    pts: CMTime(value: offset, timescale: CMTimeScale(inputFormat.sampleRate)))
      offset += AVAudioFramePosition(n)
    }

    let sem = DispatchSemaphore(value: 0)
    var ok = false
    writer.finish { completed in
      ok = completed
      sem.signal()
    }
    _ = sem.wait(timeout: .now() + 10)
    guard ok, writer.failure == nil,
          let size = ChunkFile.size(of: url), size > 0 else { return false }
    return true
  }

  // ── lifecycle ────────────────────────────────────────────

  func start(chunkLengthSec: Int) throws {
    self.chunkLengthSec = chunkLengthSec
    chunkIndex = 0
    framesIntoChunk = 0
    globalFrame = 0
    rotatePending = false
    pausedFlag = false

    let inputNode = engine.inputNode
    let format = inputNode.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(domain: "MSecRecorder", code: 5, userInfo: [
        NSLocalizedDescriptionKey: "no usable audio input format (rate=\(format.sampleRate), ch=\(format.channelCount))",
      ])
    }
    guard let fd = AudioSampleBuffer.formatDescription(for: format) else {
      throw NSError(domain: "MSecRecorder", code: 6, userInfo: [
        NSLocalizedDescriptionKey: "could not build CMAudioFormatDescription for the input format",
      ])
    }
    sourceFormat = format
    formatDescription = fd
    sourceRate = format.sampleRate
    chunkFrameTarget = AVAudioFramePosition(Double(chunkLengthSec) * format.sampleRate)

    current = try ChunkWriter(
      url: try ChunkFile.newURL(index: 0), index: 0, startFrame: 0,
      outputSampleRate: Self.outputSampleRate)

    inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      self?.consume(buffer)
    }
    tapInstalled = true

    observeConfigurationChange()

    engine.prepare()
    do {
      try engine.start()
    } catch {
      teardownTap()
      current?.discard()
      current = nil
      throw error
    }

    prepareNextWriter()
  }

  func stop(completion: @escaping () -> Void) {
    queue.async {
      self.teardownTap()
      if self.engine.isRunning { self.engine.stop() }
      NotificationCenter.default.removeObserver(
        self, name: .AVAudioEngineConfigurationChange, object: self.engine)

      os_unfair_lock_lock(&self.lock)
      let finishing = self.current
      let spare = self.next
      self.current = nil
      self.next = nil
      let endFrame = self.globalFrame
      os_unfair_lock_unlock(&self.lock)

      spare?.discard()

      guard let finishing else {
        completion()
        return
      }
      self.finalize(finishing, endFrame: endFrame, completion: completion)
    }
  }

  func pause() {
    queue.async {
      guard !self.pausedFlag else { return }
      self.pausedFlag = true
      self.engine.pause()
    }
  }

  func resume() {
    queue.async {
      guard self.pausedFlag else { return }
      self.pausedFlag = false
      do {
        try self.engine.start()
      } catch {
        self.onError?("resume failed: \(error.localizedDescription)")
      }
    }
  }

  // ── the audio thread ─────────────────────────────────────

  /// Runs on AVAudioEngine's real-time input thread. Everything expensive
  /// (opening files, finishing writers) is dispatched off it.
  private func consume(_ buffer: AVAudioPCMBuffer) {
    guard let fd = formatDescription else { return }
    let total = Int(buffer.frameLength)
    guard total > 0 else { return }

    var offset = 0
    while offset < total {
      os_unfair_lock_lock(&lock)
      let target = chunkFrameTarget
      let into = framesIntoChunk
      let writer = current
      os_unfair_lock_unlock(&lock)

      guard let writer else { return }

      // Split exactly on the boundary so chunk durations stay contiguous.
      let remainingInChunk = max(target - into, 0)
      let take = rotatePending || remainingInChunk == 0
        ? total - offset
        : min(total - offset, Int(remainingInChunk))

      guard take > 0 else { break }

      if let part = AudioSampleBuffer.slice(buffer, offset: offset, count: take) {
        let pts = CMTime(value: globalFrame, timescale: CMTimeScale(sourceRate))
        if let sbuf = AudioSampleBuffer.make(from: part, formatDescription: fd, pts: pts) {
          writer.append(sbuf, frames: AVAudioFramePosition(take), pts: pts)
        }
      }

      os_unfair_lock_lock(&lock)
      framesIntoChunk += AVAudioFramePosition(take)
      globalFrame += AVAudioFramePosition(take)
      let shouldRotate = framesIntoChunk >= chunkFrameTarget
      os_unfair_lock_unlock(&lock)

      offset += take

      if shouldRotate { rotate() }
    }
  }

  /// Swaps in the pre-opened writer. Pointer swap only — the outgoing writer is
  /// finished on the serial queue so the audio thread never waits on I/O.
  private func rotate() {
    os_unfair_lock_lock(&lock)
    guard let incoming = next else {
      // Pre-open has not landed yet: keep writing into the current chunk rather
      // than dropping audio. The rotation happens as soon as the writer exists.
      rotatePending = true
      os_unfair_lock_unlock(&lock)
      return
    }
    let outgoing = current
    let endFrame = globalFrame
    incoming.startFrame = endFrame  // the new chunk begins exactly where the old one ended
    current = incoming
    next = nil
    rotatePending = false
    framesIntoChunk = 0
    chunkIndex = incoming.index
    os_unfair_lock_unlock(&lock)

    queue.async {
      if let outgoing {
        self.finalize(outgoing, endFrame: endFrame, completion: {})
      }
      self.prepareNextWriter()
    }
  }

  /// Opens the writer for the chunk after the current one, well ahead of the
  /// boundary so the swap costs nothing on the audio thread.
  private func prepareNextWriter() {
    queue.async {
      os_unfair_lock_lock(&self.lock)
      let alreadyQueued = self.next != nil
      let nextIndex = self.chunkIndex + 1
      let pending = self.rotatePending
      os_unfair_lock_unlock(&self.lock)
      guard !alreadyQueued else { return }

      do {
        let url = try ChunkFile.newURL(index: nextIndex)
        let writer = try ChunkWriter(
          url: url, index: nextIndex, startFrame: 0,
          outputSampleRate: Self.outputSampleRate)
        os_unfair_lock_lock(&self.lock)
        self.next = writer
        os_unfair_lock_unlock(&self.lock)
        // A boundary passed while this was opening — rotate immediately.
        if pending { self.rotate() }
      } catch {
        self.onError?("could not pre-open chunk \(nextIndex): \(error.localizedDescription)")
      }
    }
  }

  /// Finishes a writer and reports the chunk. Times come from the frame counter,
  /// not the wall clock, so consecutive chunks are exactly contiguous.
  private func finalize(_ writer: ChunkWriter, endFrame: AVAudioFramePosition, completion: @escaping () -> Void) {
    // Stopping exactly on a boundary leaves the just-swapped-in writer empty.
    // Finishing it would produce a 0-byte file and a spurious onError, so drop it.
    guard writer.appendedFrames > 0 else {
      writer.discard()
      completion()
      return
    }
    let startedAtSec = Int(Double(writer.startFrame) / sourceRate)
    let endedAtSec = Int(Double(endFrame) / sourceRate)
    writer.finish { [weak self] ok in
      guard let self else {
        completion()
        return
      }
      if writer.droppedFrames > 0 {
        self.onError?("chunk \(writer.index) dropped \(writer.droppedFrames) frames (writer not ready)")
      }
      if ok {
        self.onChunk?(FinishedChunk(
          url: writer.url, index: writer.index,
          startedAtSec: startedAtSec, endedAtSec: endedAtSec))
      } else {
        self.onError?("chunk \(writer.index) failed to finish: \(writer.failure ?? "unknown")")
      }
      completion()
    }
  }

  private func teardownTap() {
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
  }

  // ── route / configuration changes ────────────────────────

  private func observeConfigurationChange() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(handleConfigurationChange),
      name: .AVAudioEngineConfigurationChange, object: engine)
  }

  /// A route change (Bluetooth in/out, headset) can change the input format
  /// mid-chunk, which would invalidate the writer's source format. Close the
  /// chunk cleanly and start a fresh one on the new format.
  @objc private func handleConfigurationChange() {
    queue.async {
      guard self.tapInstalled else { return }
      let format = self.engine.inputNode.inputFormat(forBus: 0)
      guard format.sampleRate > 0 else { return }
      if let existing = self.sourceFormat,
         existing.sampleRate == format.sampleRate,
         existing.channelCount == format.channelCount {
        if !self.engine.isRunning, !self.pausedFlag {
          try? self.engine.start()
        }
        return
      }

      self.onError?("audio route changed (\(Int(self.sourceRate))Hz → \(Int(format.sampleRate))Hz); rotating chunk")
      self.teardownTap()
      if self.engine.isRunning { self.engine.stop() }

      guard let fd = AudioSampleBuffer.formatDescription(for: format) else {
        self.onError?("route change produced an unusable input format")
        return
      }

      os_unfair_lock_lock(&self.lock)
      let outgoing = self.current
      let spare = self.next
      let endFrame = self.globalFrame
      self.current = nil
      self.next = nil
      os_unfair_lock_unlock(&self.lock)
      spare?.discard()
      if let outgoing { self.finalize(outgoing, endFrame: endFrame, completion: {}) }

      self.sourceFormat = format
      self.formatDescription = fd
      self.sourceRate = format.sampleRate
      self.chunkFrameTarget = AVAudioFramePosition(Double(self.chunkLengthSec) * format.sampleRate)

      let nextIndex = self.chunkIndex + 1
      do {
        let writer = try ChunkWriter(
          url: try ChunkFile.newURL(index: nextIndex), index: nextIndex,
          startFrame: self.globalFrame, outputSampleRate: Self.outputSampleRate)
        os_unfair_lock_lock(&self.lock)
        self.current = writer
        self.chunkIndex = nextIndex
        self.framesIntoChunk = 0
        self.rotatePending = false
        os_unfair_lock_unlock(&self.lock)

        self.engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
          self?.consume(buffer)
        }
        self.tapInstalled = true
        self.engine.prepare()
        try self.engine.start()
        self.prepareNextWriter()
      } catch {
        self.onError?("could not restart after route change: \(error.localizedDescription)")
      }
    }
  }
}

// ── legacy stop/restart rotation (fallback) ──────────────────

/// The previous strategy, kept as a safety net: one AVAudioRecorder per chunk,
/// stopped and restarted at each boundary. Loses ~100 ms per boundary but works
/// on any runtime. Selected only when the encoder probe rejects the gapless path.
final class LegacyRotationCore: NSObject, RecordingCore, AVAudioRecorderDelegate {
  var strategyName: String { "legacy-avaudiorecorder" }
  var onChunk: ((FinishedChunk) -> Void)?
  var onError: ((String) -> Void)?

  private let queue = DispatchQueue(label: "msec.recorder.legacy")
  private var recorder: AVAudioRecorder?
  private var rollTimer: DispatchSourceTimer?
  private var paused = false
  private var stopped = false

  private var chunkLengthSec = 300
  private var chunkIndex = 0
  private var startedAt = Date()
  private var pausedDuration: TimeInterval = 0
  private var pausedAt: Date?
  private var currentFile: URL?
  private var currentChunkStartedAtSec = 0

  func start(chunkLengthSec: Int) throws {
    self.chunkLengthSec = max(chunkLengthSec, 1)
    chunkIndex = 0
    startedAt = Date()
    pausedDuration = 0
    pausedAt = nil
    paused = false
    stopped = false
    currentChunkStartedAtSec = 0
    try startNewRecorder(index: 0)
    scheduleRoll()
  }

  func stop(completion: @escaping () -> Void) {
    queue.async {
      guard !self.stopped else {
        completion()
        return
      }
      self.stopped = true
      self.cancelRoll()
      let endedAt = self.elapsedSec()
      if let finished = self.finalizeCurrentRecorder() {
        self.onChunk?(FinishedChunk(
          url: finished, index: self.chunkIndex,
          startedAtSec: self.currentChunkStartedAtSec, endedAtSec: endedAt))
      }
      completion()
    }
  }

  func pause() {
    queue.async {
      guard !self.paused else { return }
      self.recorder?.pause()
      self.paused = true
      self.pausedAt = Date()
      self.cancelRoll()
    }
  }

  func resume() {
    queue.async {
      guard self.paused else { return }
      if let pausedAt = self.pausedAt {
        self.pausedDuration += Date().timeIntervalSince(pausedAt)
      }
      self.pausedAt = nil
      self.paused = false
      self.recorder?.record()
      self.scheduleRoll()
    }
  }

  private func scheduleRoll() {
    cancelRoll()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .seconds(chunkLengthSec))
    timer.setEventHandler { [weak self] in self?.rollChunk() }
    timer.resume()
    rollTimer = timer
  }

  private func cancelRoll() {
    rollTimer?.cancel()
    rollTimer = nil
  }

  private func rollChunk() {
    guard !stopped, !paused else { return }
    let endedAt = elapsedSec()
    let idx = chunkIndex
    if let finished = finalizeCurrentRecorder() {
      onChunk?(FinishedChunk(
        url: finished, index: idx,
        startedAtSec: currentChunkStartedAtSec, endedAtSec: endedAt))
    }

    chunkIndex = idx + 1
    currentChunkStartedAtSec = endedAt
    do {
      try startNewRecorder(index: chunkIndex)
      scheduleRoll()
    } catch {
      onError?("rotate failed: \(error.localizedDescription)")
      stopped = true
    }
  }

  private func finalizeCurrentRecorder() -> URL? {
    recorder?.stop()
    recorder = nil
    guard let file = currentFile,
          let size = ChunkFile.size(of: file), size > 0 else { return nil }
    return file
  }

  private func startNewRecorder(index: Int) throws {
    let file = try ChunkFile.newURL(index: index)
    let session = AVAudioSession.sharedInstance()

    // 16 kHz keeps format parity with the Android recorder. Fall back to the
    // session's own rate if the encoder refuses it.
    var rates: [Double] = [16_000]
    let hardwareRate = session.sampleRate
    if hardwareRate > 0, hardwareRate != 16_000 {
      rates.append(hardwareRate)
    }

    for rate in rates {
      let settings = AACEncoderCapabilities.outputSettings(sampleRate: rate)
      guard let rec = try? AVAudioRecorder(url: file, settings: settings) else { continue }
      rec.delegate = self
      if rec.record() {
        recorder = rec
        currentFile = file
        return
      }
    }

    throw NSError(
      domain: "MSecRecorder", code: 1,
      userInfo: [NSLocalizedDescriptionKey: """
        AVAudioRecorder.record() returned false \
        (inputAvailable=\(session.isInputAvailable), \
        permission=\(session.recordPermission.rawValue), \
        hardwareRate=\(hardwareRate), \
        inputs=\(session.availableInputs?.count ?? 0), \
        triedRates=\(rates))
        """]
    )
  }

  private func elapsedSec() -> Int {
    let now = Date()
    var active = now.timeIntervalSince(startedAt) - pausedDuration
    if paused, let pausedAt {
      active -= now.timeIntervalSince(pausedAt)
    }
    return max(Int(active), 0)
  }

  func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
    onError?(error?.localizedDescription ?? "encode error")
  }
}

// ── chunk files ──────────────────────────────────────────────

enum ChunkFile {
  static func newURL(index: Int) throws -> URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("meetings", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    return dir.appendingPathComponent("\(ts)_\(index).m4a")
  }

  static func size(of url: URL) -> Int? {
    let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attrs?[.size] as? NSNumber)?.intValue
  }

  static func sha256(of url: URL) -> String? {
    guard let stream = InputStream(url: url) else { return nil }
    stream.open()
    defer { stream.close() }
    var hasher = SHA256()
    let bufferSize = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    while stream.hasBytesAvailable {
      let read = stream.read(&buffer, maxLength: bufferSize)
      if read < 0 { return nil }
      if read == 0 { break }
      hasher.update(data: Data(bytes: buffer, count: read))
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

// ── diagnostics ──────────────────────────────────────────────

/// Surfaced to JS so a physical-device run can report the encoder's real
/// capabilities. The bit-rate ceiling is what broke the gapless path before,
/// and it is the one value that could plausibly differ between the Simulator's
/// software encoder and a device's hardware encoder.
enum RecorderDiagnostics {
  static func run() -> [String: Any] {
    #if targetEnvironment(simulator)
      let environment = "simulator"
    #else
      let environment = "device"
    #endif

    let session = AVAudioSession.sharedInstance()
    let inputFormat = AVAudioEngine().inputNode.inputFormat(forBus: 0)
    let outRate = ContinuousCaptureCore.outputSampleRate
    let applicable = AACEncoderCapabilities.applicableBitRates(sampleRate: outRate)

    return [
      "environment": environment,
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "sessionSampleRate": session.sampleRate,
      "inputSampleRate": inputFormat.sampleRate,
      "inputChannels": Int(inputFormat.channelCount),
      "outputSampleRate": outRate,
      "applicableBitRates": applicable,
      "desiredBitRate": AACEncoderCapabilities.desiredBitRate,
      "selectedBitRate": AACEncoderCapabilities.bitRate(forOutputRate: outRate),
      "desiredBitRateSupported": applicable.contains(AACEncoderCapabilities.desiredBitRate),
      "continuousCaptureSupported": ContinuousCaptureCore.isSupported(),
    ]
  }
}
