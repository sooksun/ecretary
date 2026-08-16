import AVFoundation
import CoreMedia
import Foundation
import os

/// Faithful copy of ContinuousCaptureCore's rotation algorithm (split exactly on
/// the boundary, swap a pre-opened writer, one continuous PTS timeline), driven
/// by synthetic buffers instead of a microphone tap.
///
/// This proves the *algorithm* is lossless. The on-device run then only has to
/// prove the microphone path and the encoder behave the same.
public final class RotationHarness {

  public struct ChunkReport {
    public var index: Int
    public var startedAtSec: Double
    public var endedAtSec: Double
    public var inputFrames: Int64
    public var decodedFrames: Int64
    public var sizeBytes: Int
    public var failure: String?
  }

  public struct Summary {
    public var chunks: [ChunkReport]
    public var totalInputFramesAtSource: Int64
    public var totalDecodedFrames: Int64
    public var expectedDecodedFrames: Int64
    public var sourceRate: Double
    public var outputRate: Double

    public var lostFrames: Int64 { expectedDecodedFrames - totalDecodedFrames }
    public var lostMs: Double { outputRate > 0 ? Double(lostFrames) / outputRate * 1000 : 0 }

    public var description: String {
      var s = "chunks=\(chunks.count) sourceRate=\(Int(sourceRate)) outRate=\(Int(outputRate))\n"
      for c in chunks {
        s += String(
          format: "  chunk %d  [%.3f → %.3f]s  decoded=%lldf (%.3fs)  bytes=%d%@\n",
          c.index, c.startedAtSec, c.endedAtSec, c.decodedFrames,
          Double(c.decodedFrames) / outputRate, c.sizeBytes,
          c.failure.map { "  FAILURE: \($0)" } ?? "")
      }
      s += String(
        format: "  TOTAL decoded=%lldf expected=%lldf lost=%lldf (%.1f ms)",
        totalDecodedFrames, expectedDecodedFrames, lostFrames, lostMs)
      return s
    }
  }

  // mirrors ContinuousCaptureCore state
  private var lock = os_unfair_lock_s()
  private let queue = DispatchQueue(label: "harness.rotation")
  private var current: HarnessWriter?
  private var next: HarnessWriter?
  private var chunkFrameTarget: Int64 = 0
  private var framesIntoChunk: Int64 = 0
  private var globalFrame: Int64 = 0
  private var chunkIndex = 0
  private var rotatePending = false
  private var sourceRate: Double = 48_000
  private var outputRate: Double = 16_000
  private var bitRate = 48_000
  private var formatDescription: CMFormatDescription?
  private var reports: [ChunkReport] = []
  private let group = DispatchGroup()
  private var dir: URL!

  public init() {}

  /// Streams `seconds` of continuous audio through `chunkLengthSec` rotation.
  /// `preOpenDelayMs` simulates the pre-open landing late, exercising the
  /// "boundary hit before the next writer exists" path.
  public func run(
    seconds: Double,
    chunkLengthSec: Double,
    sourceRate: Double = 48_000,
    outputRate: Double = 16_000,
    bitRate: Int = 48_000,
    tapFrames: Int = 4096,
    preOpenDelayMs: UInt32 = 0
  ) -> Summary {
    self.sourceRate = sourceRate
    self.outputRate = outputRate
    self.bitRate = bitRate
    chunkFrameTarget = Int64(chunkLengthSec * sourceRate)

    dir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rot-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sourceRate,
                                  channels: 1, interleaved: false),
          let fd = AWProbe.makeFormatDescription(fmt, includeLayout: false)
    else { return Summary(chunks: [], totalInputFramesAtSource: 0, totalDecodedFrames: 0,
                          expectedDecodedFrames: 0, sourceRate: sourceRate, outputRate: outputRate) }
    formatDescription = fd

    current = try? HarnessWriter(url: url(0), index: 0, startFrame: 0,
                                 outputRate: outputRate, bitRate: bitRate)
    prepareNext(delayMs: preOpenDelayMs)

    // Continuous sine across the whole run — a boundary that lost samples would
    // show up as a shortfall in the decoded frame count.
    let totalFrames = Int64(seconds * sourceRate)
    var produced: Int64 = 0
    var phase = 0.0
    let step = 2.0 * Double.pi * 300.0 / sourceRate

    while produced < totalFrames {
      let n = Int(min(Int64(tapFrames), totalFrames - produced))
      guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)) else { break }
      buf.frameLength = AVAudioFrameCount(n)
      let ch = buf.floatChannelData![0]
      for i in 0..<n {
        ch[i] = Float(sin(phase) * 0.5)
        phase += step
      }
      consume(buf)
      produced += Int64(n)
    }

    // drain, mirroring stop()
    os_unfair_lock_lock(&lock)
    let finishing = current
    let spare = next
    current = nil
    next = nil
    let endFrame = globalFrame
    os_unfair_lock_unlock(&lock)
    spare?.discard()
    if let finishing { finalize(finishing, endFrame: endFrame) }
    group.wait()

    let sorted = reports.sorted { $0.index < $1.index }
    let decoded = sorted.reduce(Int64(0)) { $0 + $1.decodedFrames }
    return Summary(
      chunks: sorted,
      totalInputFramesAtSource: produced,
      totalDecodedFrames: decoded,
      expectedDecodedFrames: Int64((Double(produced) / sourceRate * outputRate).rounded()),
      sourceRate: sourceRate, outputRate: outputRate)
  }

  private func url(_ index: Int) -> URL {
    dir.appendingPathComponent("chunk_\(index).m4a")
  }

  // ── identical to ContinuousCaptureCore.consume ──

  private func consume(_ buffer: AVAudioPCMBuffer) {
    guard let fd = formatDescription else { return }
    let total = Int(buffer.frameLength)
    var offset = 0

    while offset < total {
      os_unfair_lock_lock(&lock)
      let target = chunkFrameTarget
      let into = framesIntoChunk
      let writer = current
      os_unfair_lock_unlock(&lock)
      guard let writer else { return }

      let remainingInChunk = max(target - into, 0)
      let take = rotatePending || remainingInChunk == 0
        ? total - offset
        : min(total - offset, Int(remainingInChunk))
      guard take > 0 else { break }

      if let part = AWProbe.sliceBuffer(buffer, offset: offset, count: take) {
        let pts = CMTime(value: globalFrame, timescale: CMTimeScale(sourceRate))
        let (sb, _) = AWProbe.makeSampleBuffer(
          pcm: part, formatDescription: fd, pts: pts,
          explicitSampleSize: true, mode: .fromAudioBufferList)
        if let sbuf = sb {
          writer.append(sbuf, frames: Int64(take), pts: pts)
        }
      }

      os_unfair_lock_lock(&lock)
      framesIntoChunk += Int64(take)
      globalFrame += Int64(take)
      let shouldRotate = framesIntoChunk >= chunkFrameTarget
      os_unfair_lock_unlock(&lock)

      offset += take
      if shouldRotate { rotate() }
    }
  }

  private func rotate() {
    os_unfair_lock_lock(&lock)
    guard let incoming = next else {
      rotatePending = true
      os_unfair_lock_unlock(&lock)
      return
    }
    let outgoing = current
    let endFrame = globalFrame
    incoming.startFrameGlobal = endFrame
    current = incoming
    next = nil
    rotatePending = false
    framesIntoChunk = 0
    chunkIndex = incoming.index
    os_unfair_lock_unlock(&lock)

    if let outgoing { finalize(outgoing, endFrame: endFrame) }
    prepareNext(delayMs: 0)
  }

  private func prepareNext(delayMs: UInt32) {
    os_unfair_lock_lock(&lock)
    let already = next != nil
    let nextIndex = chunkIndex + 1
    os_unfair_lock_unlock(&lock)
    guard !already else { return }

    if delayMs > 0 { usleep(delayMs * 1000) }
    guard let w = try? HarnessWriter(url: url(nextIndex), index: nextIndex,
                                     startFrame: 0, outputRate: outputRate, bitRate: bitRate)
    else { return }
    os_unfair_lock_lock(&lock)
    self.next = w
    let pending = rotatePending
    os_unfair_lock_unlock(&lock)
    if pending { rotate() }
  }

  private func finalize(_ writer: HarnessWriter, endFrame: Int64) {
    guard writer.appendedFrames > 0 else {
      writer.discard()
      return
    }
    let startedAtSec = Double(writer.startFrameGlobal) / sourceRate
    let endedAtSec = Double(endFrame) / sourceRate
    group.enter()
    writer.finish { [weak self] ok in
      guard let self else { return }
      var rep = ChunkReport(
        index: writer.index, startedAtSec: startedAtSec, endedAtSec: endedAtSec,
        inputFrames: writer.appendedFrames, decodedFrames: 0, sizeBytes: 0,
        failure: writer.failure)
      if ok {
        rep.sizeBytes = (try? FileManager.default.attributesOfItem(atPath: writer.url.path)[.size] as? Int).flatMap { $0 } ?? 0
        if let f = try? AVAudioFile(forReading: writer.url) { rep.decodedFrames = f.length }
      } else if rep.failure == nil {
        rep.failure = "finish returned false"
      }
      os_unfair_lock_lock(&self.lock)
      self.reports.append(rep)
      os_unfair_lock_unlock(&self.lock)
      self.group.leave()
    }
  }
}

/// Mirrors the module's ChunkWriter.
final class HarnessWriter {
  let url: URL
  let index: Int
  var startFrameGlobal: Int64
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private var sessionStarted = false
  private(set) var appendedFrames: Int64 = 0
  private(set) var droppedFrames: Int64 = 0
  private(set) var failure: String?

  init(url: URL, index: Int, startFrame: Int64, outputRate: Double, bitRate: Int) throws {
    self.url = url
    self.index = index
    self.startFrameGlobal = startFrame
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: outputRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: bitRate,
    ])
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    guard writer.startWriting() else {
      throw NSError(domain: "harness", code: 1, userInfo: [NSLocalizedDescriptionKey: "startWriting failed"])
    }
  }

  func append(_ sbuf: CMSampleBuffer, frames: Int64, pts: CMTime) {
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
      failure = AWProbe.describe(writer.error)
    }
  }

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
      if self.writer.status != .completed { self.failure = AWProbe.describe(self.writer.error) }
      completion(self.writer.status == .completed)
    }
  }

  func discard() {
    if writer.status == .writing { writer.cancelWriting() }
    try? FileManager.default.removeItem(at: url)
  }
}
