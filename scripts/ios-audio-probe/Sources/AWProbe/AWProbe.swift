import AVFoundation
import CoreMedia
import Foundation

/// Isolated reproduction of the M-Secretary iOS gapless-rotation writer path:
/// synthetic PCM -> hand-built CMSampleBuffer -> AVAssetWriter (AAC .m4a).
///
/// No microphone, no AVAudioEngine, no app: just the piece that failed with
/// `FigExport err -12651` / `AVFoundationErrorDomain -11861`. Runs identically
/// on Simulator and on a physical device, so the same matrix answers
/// "Simulator limitation or sample-buffer bug?".

public struct ProbeConfig {
  public enum BuildMode: String {
    /// Apple's documented pattern: CMSampleBufferCreate(dataReady: false)
    /// + CMSampleBufferSetDataBufferFromAudioBufferList.
    case fromAudioBufferList
    /// Manual CMBlockBuffer + CMSampleBufferCreateReady.
    case manualBlockBuffer
  }

  public var name: String
  public var sourceIsFloat: Bool
  public var sourceInterleaved: Bool
  public var explicitSampleSize: Bool
  public var buildMode: BuildMode
  public var bitRate: Int
  public var outputSampleRate: Double
  public var sourceSampleRate: Double
  public var includeChannelLayout: Bool
  public var provideSourceFormatHint: Bool
  /// false = startSession(atSourceTime: .zero) — the usual bug when the first
  /// PTS is not zero. true = start the session at the first buffer's own PTS.
  public var startSessionAtFirstPTS: Bool
  /// Non-zero to emulate "engine has been running a while before the writer opened",
  /// which is exactly what happens for chunk 2+ during a rotation.
  public var firstPTSSeconds: Double

  public init(
    name: String,
    sourceIsFloat: Bool = false,
    sourceInterleaved: Bool = true,
    explicitSampleSize: Bool = true,
    buildMode: BuildMode = .fromAudioBufferList,
    bitRate: Int = 64_000,
    outputSampleRate: Double = 16_000,
    sourceSampleRate: Double = 16_000,
    includeChannelLayout: Bool = false,
    provideSourceFormatHint: Bool = false,
    startSessionAtFirstPTS: Bool = true,
    firstPTSSeconds: Double = 0
  ) {
    self.name = name
    self.sourceIsFloat = sourceIsFloat
    self.sourceInterleaved = sourceInterleaved
    self.explicitSampleSize = explicitSampleSize
    self.buildMode = buildMode
    self.bitRate = bitRate
    self.outputSampleRate = outputSampleRate
    self.sourceSampleRate = sourceSampleRate
    self.includeChannelLayout = includeChannelLayout
    self.provideSourceFormatHint = provideSourceFormatHint
    self.startSessionAtFirstPTS = startSessionAtFirstPTS
    self.firstPTSSeconds = firstPTSSeconds
  }
}

public struct ProbeResult {
  public var name: String
  public var ok: Bool
  public var appendedBuffers: Int
  public var failureStage: String
  public var writerStatus: Int
  public var errorText: String
  public var fileSizeBytes: Int
  public var measuredDurationSec: Double
  /// Frames actually recovered by decoding the .m4a back to PCM. This is the
  /// number that decides gaplessness — AVURLAsset.duration can differ from it
  /// because of the AAC priming/remainder edit list.
  public var decodedFrameCount: Int64 = 0
  public var inputFrameCount: Int64 = 0
  public var decodedRate: Double = 0

  public var line: String {
    let mark = ok ? "PASS" : "FAIL"
    var s = "[\(mark)] \(name)"
    if ok {
      let lost = inputFrameCount - decodedFrameCount
      let lostMs = decodedRate > 0 ? Double(lost) / decodedRate * 1000 : 0
      s += "  bytes=\(fileSizeBytes) dur=\(String(format: "%.3f", measuredDurationSec))s"
      s += " in=\(inputFrameCount)f decoded=\(decodedFrameCount)f"
      s += " lost=\(lost)f/\(String(format: "%.1f", lostMs))ms"
    } else {
      s += "  stage=\(failureStage) status=\(writerStatus) appended=\(appendedBuffers) err=\(errorText)"
    }
    return s
  }
}

public enum AWProbe {

  // MARK: - environment

  public static var environmentDescription: String {
    #if targetEnvironment(simulator)
      let env = "SIMULATOR"
    #else
      let env = "DEVICE"
    #endif
    let d = UIDeviceLite.model
    return "\(env) model=\(d) os=\(ProcessInfo.processInfo.operatingSystemVersionString) arch=\(archName)"
  }

  private static var archName: String {
    #if arch(arm64)
      return "arm64"
    #elseif arch(x86_64)
      return "x86_64"
    #else
      return "unknown"
    #endif
  }

  /// What bit rates the AAC encoder will actually accept for the given source.
  /// Directly tests the "64 kbps is out of range for 16 kHz mono AAC-LC" theory.
  public static func applicableAACBitRates(sampleRate: Double, channels: AVAudioChannelCount) -> [Int] {
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

  // MARK: - synthetic PCM

  /// Deterministic 440 Hz sine so a written file can be sanity-checked by ear/size.
  static func makeSineBuffer(format: AVAudioFormat, frames: AVAudioFrameCount, phase: inout Double) -> AVAudioPCMBuffer? {
    guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buf.frameLength = frames
    let step = 2.0 * Double.pi * 440.0 / format.sampleRate

    if format.commonFormat == .pcmFormatFloat32 {
      guard let ch = buf.floatChannelData else { return nil }
      for i in 0..<Int(frames) {
        let v = Float(sin(phase) * 0.5)
        for c in 0..<Int(format.channelCount) { ch[c][i] = v }
        phase += step
      }
    } else {
      guard let ch = buf.int16ChannelData else { return nil }
      for i in 0..<Int(frames) {
        let v = Int16(sin(phase) * 16_000)
        for c in 0..<Int(format.channelCount) { ch[c][i] = v }
        phase += step
      }
    }
    return buf
  }

  // MARK: - sample buffer construction

  static func makeFormatDescription(_ format: AVAudioFormat, includeLayout: Bool) -> CMFormatDescription? {
    var asbd = format.streamDescription.pointee
    var out: CMFormatDescription?
    let status: OSStatus
    if includeLayout, let layout = format.channelLayout {
      status = CMAudioFormatDescriptionCreate(
        allocator: kCFAllocatorDefault, asbd: &asbd,
        layoutSize: MemoryLayout<AudioChannelLayout>.size, layout: layout.layout,
        magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &out)
    } else {
      status = CMAudioFormatDescriptionCreate(
        allocator: kCFAllocatorDefault, asbd: &asbd,
        layoutSize: 0, layout: nil,
        magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &out)
    }
    return status == noErr ? out : nil
  }

  /// Same slice helper as the module's AudioSampleBuffer.slice.
  static func sliceBuffer(_ src: AVAudioPCMBuffer, offset: Int, count: Int) -> AVAudioPCMBuffer? {
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
        for c in 0..<channels { memcpy(d[c], s[c] + offset, count * MemoryLayout<Float>.size) }
      }
    case .pcmFormatInt16:
      guard let s = src.int16ChannelData, let d = out.int16ChannelData else { return nil }
      if interleaved {
        memcpy(d[0], s[0] + offset * channels, count * channels * MemoryLayout<Int16>.size)
      } else {
        for c in 0..<channels { memcpy(d[c], s[c] + offset, count * MemoryLayout<Int16>.size) }
      }
    default:
      return nil
    }
    return out
  }

  static func makeSampleBuffer(
    pcm: AVAudioPCMBuffer,
    formatDescription: CMFormatDescription,
    pts: CMTime,
    explicitSampleSize: Bool,
    mode: ProbeConfig.BuildMode
  ) -> (CMSampleBuffer?, OSStatus) {
    let asbd = pcm.format.streamDescription.pointee
    let frames = CMItemCount(pcm.frameLength)
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: CMTimeScale(asbd.mSampleRate)),
      presentationTimeStamp: pts,
      decodeTimeStamp: .invalid)

    // Kept alive for the whole function so the pointer handed to CoreMedia stays valid.
    let sizeStorage = UnsafeMutablePointer<Int>.allocate(capacity: 1)
    sizeStorage.initialize(to: Int(asbd.mBytesPerFrame))
    defer { sizeStorage.deallocate() }
    let sizeCount: CMItemCount = explicitSampleSize ? 1 : 0
    let sizePtr: UnsafeMutablePointer<Int>? = explicitSampleSize ? sizeStorage : nil

    switch mode {
    case .fromAudioBufferList:
      var sbuf: CMSampleBuffer?
      var status = CMSampleBufferCreate(
        allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
        makeDataReadyCallback: nil, refcon: nil,
        formatDescription: formatDescription, sampleCount: frames,
        sampleTimingEntryCount: 1, sampleTimingArray: &timing,
        sampleSizeEntryCount: sizeCount, sampleSizeArray: sizePtr,
        sampleBufferOut: &sbuf)
      guard status == noErr, let sbuf else { return (nil, status) }

      status = CMSampleBufferSetDataBufferFromAudioBufferList(
        sbuf, blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
        bufferList: pcm.audioBufferList)
      guard status == noErr else { return (nil, status) }
      return (sbuf, noErr)

    case .manualBlockBuffer:
      let byteCount = Int(pcm.frameLength) * Int(asbd.mBytesPerFrame)
      var block: CMBlockBuffer?
      var status = CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: byteCount,
        blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
        offsetToData: 0, dataLength: byteCount, flags: 0, blockBufferOut: &block)
      guard status == noErr, let block else { return (nil, status) }

      let src: UnsafeRawPointer
      if pcm.format.commonFormat == .pcmFormatFloat32 {
        guard let ch = pcm.floatChannelData else { return (nil, -1) }
        src = UnsafeRawPointer(ch[0])
      } else {
        guard let ch = pcm.int16ChannelData else { return (nil, -1) }
        src = UnsafeRawPointer(ch[0])
      }
      status = CMBlockBufferReplaceDataBytes(
        with: src, blockBuffer: block, offsetIntoDestination: 0, dataLength: byteCount)
      guard status == noErr else { return (nil, status) }

      var sbuf: CMSampleBuffer?
      status = CMSampleBufferCreateReady(
        allocator: kCFAllocatorDefault, dataBuffer: block,
        formatDescription: formatDescription, sampleCount: frames,
        sampleTimingEntryCount: 1, sampleTimingArray: &timing,
        sampleSizeEntryCount: sizeCount, sampleSizeArray: sizePtr,
        sampleBufferOut: &sbuf)
      guard status == noErr, let sbuf else { return (nil, status) }
      return (sbuf, noErr)
    }
  }

  // MARK: - the probe

  /// Writes ~`seconds` of synthetic audio through the config's construction path.
  public static func run(_ cfg: ProbeConfig, seconds: Double = 1.0) -> ProbeResult {
    var r = ProbeResult(
      name: cfg.name, ok: false, appendedBuffers: 0, failureStage: "",
      writerStatus: -1, errorText: "", fileSizeBytes: 0, measuredDurationSec: 0)

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("awprobe-\(UUID().uuidString).m4a")
    try? FileManager.default.removeItem(at: url)

    guard let sourceFormat = AVAudioFormat(
      commonFormat: cfg.sourceIsFloat ? .pcmFormatFloat32 : .pcmFormatInt16,
      sampleRate: cfg.sourceSampleRate, channels: 1, interleaved: cfg.sourceInterleaved
    ) else {
      r.failureStage = "sourceFormat"; r.errorText = "AVAudioFormat init returned nil"; return r
    }

    guard let formatDescription = makeFormatDescription(sourceFormat, includeLayout: cfg.includeChannelLayout) else {
      r.failureStage = "formatDescription"; r.errorText = "CMAudioFormatDescriptionCreate failed"; return r
    }

    var settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: cfg.outputSampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: cfg.bitRate,
    ]
    if cfg.includeChannelLayout {
      var layout = AudioChannelLayout()
      layout.mChannelLayoutTag = kAudioChannelLayoutTag_Mono
      settings[AVChannelLayoutKey] = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
    }

    let writer: AVAssetWriter
    do {
      writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    } catch {
      r.failureStage = "writerInit"; r.errorText = "\(error)"; return r
    }

    let input = cfg.provideSourceFormatHint
      ? AVAssetWriterInput(mediaType: .audio, outputSettings: settings, sourceFormatHint: formatDescription)
      : AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
    input.expectsMediaDataInRealTime = true

    guard writer.canAdd(input) else {
      r.failureStage = "canAdd"; r.errorText = "writer.canAdd(input) == false"; return r
    }
    writer.add(input)

    guard writer.startWriting() else {
      r.failureStage = "startWriting"
      r.writerStatus = writer.status.rawValue
      r.errorText = describe(writer.error)
      return r
    }

    // 1024-frame slices ≈ what an AVAudioEngine tap delivers.
    let slice: AVAudioFrameCount = 1024
    let totalFrames = Int(cfg.sourceSampleRate * seconds)
    let timescale = CMTimeScale(cfg.sourceSampleRate)
    var frameCursor = Int64(cfg.firstPTSSeconds * cfg.sourceSampleRate)
    var phase = 0.0
    var sessionStarted = false
    var written = 0

    while written < totalFrames {
      let n = AVAudioFrameCount(min(Int(slice), totalFrames - written))
      guard let pcm = makeSineBuffer(format: sourceFormat, frames: n, phase: &phase) else {
        r.failureStage = "pcmGen"; r.errorText = "AVAudioPCMBuffer alloc failed"; return r
      }
      let pts = CMTime(value: frameCursor, timescale: timescale)

      if !sessionStarted {
        writer.startSession(atSourceTime: cfg.startSessionAtFirstPTS ? pts : .zero)
        sessionStarted = true
      }

      let (sbufOpt, status) = makeSampleBuffer(
        pcm: pcm, formatDescription: formatDescription, pts: pts,
        explicitSampleSize: cfg.explicitSampleSize, mode: cfg.buildMode)
      guard let sbuf = sbufOpt else {
        r.failureStage = "sampleBufferCreate"
        r.errorText = "OSStatus \(status)"
        return r
      }

      // Real-time input; in a probe it drains instantly, but respect the contract.
      var spins = 0
      while !input.isReadyForMoreMediaData && spins < 1000 {
        usleep(1000); spins += 1
      }
      guard input.append(sbuf) else {
        r.failureStage = r.appendedBuffers == 0 ? "firstAppend" : "append"
        r.writerStatus = writer.status.rawValue
        r.errorText = describe(writer.error)
        return r
      }
      r.appendedBuffers += 1
      written += Int(n)
      frameCursor += Int64(n)
    }

    input.markAsFinished()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    _ = sem.wait(timeout: .now() + 30)

    r.writerStatus = writer.status.rawValue
    if writer.status != .completed {
      r.failureStage = "finishWriting"
      r.errorText = describe(writer.error)
      return r
    }

    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
    r.fileSizeBytes = size ?? 0
    if r.fileSizeBytes == 0 {
      r.failureStage = "emptyFile"; r.errorText = "writer completed but file is 0 bytes"; return r
    }

    let asset = AVURLAsset(url: url)
    r.measuredDurationSec = CMTimeGetSeconds(asset.duration)
    r.inputFrameCount = Int64(written)

    // Decode back to PCM: the only way to tell "the edit list trimmed the
    // reported duration" from "the encoder actually swallowed audio".
    if let f = try? AVAudioFile(forReading: url) {
      r.decodedFrameCount = f.length
      r.decodedRate = f.processingFormat.sampleRate
    }

    r.ok = true
    try? FileManager.default.removeItem(at: url)
    return r
  }

  /// Encodes `seconds` of a monotonically increasing ramp, decodes it back, and
  /// reports where the recovered signal starts and ends. If the encoder is
  /// eating audio rather than just relabelling it, the ramp will be truncated.
  public static func rampRoundTrip(bitRate: Int, sampleRate: Double, seconds: Double) -> String {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("awramp-\(UUID().uuidString).m4a")
    try? FileManager.default.removeItem(at: url)
    defer { try? FileManager.default.removeItem(at: url) }

    guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true),
          let fd = makeFormatDescription(fmt, includeLayout: false),
          let writer = try? AVAssetWriter(outputURL: url, fileType: .m4a)
    else { return "ramp: setup failed" }

    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: bitRate,
    ])
    input.expectsMediaDataInRealTime = false
    writer.add(input)
    guard writer.startWriting() else { return "ramp: startWriting failed \(describe(writer.error))" }
    writer.startSession(atSourceTime: .zero)

    let total = Int(sampleRate * seconds)
    let slice = 1024
    var cursor = 0
    // Low-frequency full-scale square-ish ramp: survives lossy coding well enough
    // that the first and last non-silent sample are unambiguous.
    while cursor < total {
      let n = min(slice, total - cursor)
      guard let pcm = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)) else { break }
      pcm.frameLength = AVAudioFrameCount(n)
      let ch = pcm.int16ChannelData![0]
      for i in 0..<n {
        let t = Double(cursor + i) / sampleRate
        ch[i] = Int16(sin(2 * .pi * 200 * t) * 20_000)
      }
      let pts = CMTime(value: Int64(cursor), timescale: CMTimeScale(sampleRate))
      guard let (sbuf, _) = Optional(makeSampleBuffer(pcm: pcm, formatDescription: fd, pts: pts,
                                                      explicitSampleSize: true, mode: .fromAudioBufferList)),
            let sb = sbuf else { break }
      while !input.isReadyForMoreMediaData { usleep(500) }
      guard input.append(sb) else { return "ramp: append failed \(describe(writer.error))" }
      cursor += n
    }
    input.markAsFinished()
    let sem = DispatchSemaphore(value: 0)
    writer.finishWriting { sem.signal() }
    _ = sem.wait(timeout: .now() + 30)
    guard writer.status == .completed else { return "ramp: finish failed \(describe(writer.error))" }

    guard let f = try? AVAudioFile(forReading: url),
          let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(f.length)),
          (try? f.read(into: buf)) != nil
    else { return "ramp: decode failed" }

    let n = Int(buf.frameLength)
    var firstLoud = -1, lastLoud = -1
    if let ch = buf.floatChannelData?[0] {
      for i in 0..<n where abs(ch[i]) > 0.05 {
        if firstLoud < 0 { firstLoud = i }
        lastLoud = i
      }
    }
    let lost = Int64(total) - f.length
    return "ramp in=\(total)f decoded=\(f.length)f lost=\(lost)f "
      + "firstLoud=\(firstLoud) lastLoud=\(lastLoud) "
      + "leadingSilence=\(firstLoud)f trailingSilence=\(n - 1 - lastLoud)f"
  }

  static func describe(_ error: Error?) -> String {
    guard let error = error as NSError? else { return "nil" }
    var s = "\(error.domain) \(error.code): \(error.localizedDescription)"
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
      s += " | underlying \(underlying.domain) \(underlying.code)"
    }
    return s
  }
}

/// Avoids importing UIKit into a target that may be built without it.
enum UIDeviceLite {
  static var model: String {
    var sysinfo = utsname()
    uname(&sysinfo)
    let raw = withUnsafeBytes(of: &sysinfo.machine) { buf -> String in
      let bytes = buf.prefix(while: { $0 != 0 })
      return String(decoding: bytes, as: UTF8.self)
    }
    return raw.isEmpty ? "?" : raw
  }
}
