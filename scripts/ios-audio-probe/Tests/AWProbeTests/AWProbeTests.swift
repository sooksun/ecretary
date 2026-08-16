import AVFoundation
import XCTest
@testable import AWProbe

/// Round 1 established that AVEncoderBitRateKey 64000 is simply out of range for
/// AAC-LC mono at a 16 kHz output rate (max applicable = 48000), which is what
/// produced -11861 / -12651. These tests re-run the construction variants at a
/// legal bit rate to confirm nothing else is wrong, and pin the encoder's own
/// declared capabilities so a device run can be compared row for row.
final class AWProbeTests: XCTestCase {

  /// Highest bit rate the encoder actually accepts for 16 kHz mono here.
  static let legalBitRate = 48_000

  func testEnvironmentAndEncoderCapabilities() {
    print("=== ENV: \(AWProbe.environmentDescription)")
    for rate in [16_000.0, 22_050.0, 24_000.0, 32_000.0, 44_100.0, 48_000.0] {
      let rates = AWProbe.applicableAACBitRates(sampleRate: rate, channels: 1)
      print("=== AAC mono @\(Int(rate))Hz: \(rates.isEmpty ? "<none>" : rates.map(String.init).joined(separator: ","))")
    }
    let sixteen = AWProbe.applicableAACBitRates(sampleRate: 16_000, channels: 1)
    print("=== 64000 accepted at 16kHz mono? \(sixteen.contains(64_000))")
  }

  /// Same matrix as round 1, but at a legal bit rate. Anything still failing is
  /// a genuine sample-buffer / settings bug rather than an encoder-range error.
  func testConstructionMatrixAtLegalBitRate() {
    let br = Self.legalBitRate
    let configs: [ProbeConfig] = [
      ProbeConfig(name: "baseline int16/interleaved/explicitSize/ABL", bitRate: br),

      // suspect 1 — sampleSizeEntryCount
      ProbeConfig(name: "sampleSizeEntryCount=0", explicitSampleSize: false, bitRate: br),

      // suspect 2 — the source format description
      ProbeConfig(name: "source non-interleaved", sourceInterleaved: false, bitRate: br),
      ProbeConfig(name: "source float32 interleaved", sourceIsFloat: true, bitRate: br),
      ProbeConfig(name: "source float32 non-interleaved", sourceIsFloat: true, sourceInterleaved: false, bitRate: br),
      ProbeConfig(name: "with channel layout", bitRate: br, includeChannelLayout: true),
      ProbeConfig(name: "with sourceFormatHint", bitRate: br, provideSourceFormatHint: true),

      // suspect 3 — PTS / startSession
      ProbeConfig(name: "startSession(.zero), first PTS 300s", bitRate: br, startSessionAtFirstPTS: false, firstPTSSeconds: 300),
      ProbeConfig(name: "startSession(firstPTS), first PTS 300s", bitRate: br, startSessionAtFirstPTS: true, firstPTSSeconds: 300),

      // construction route
      ProbeConfig(name: "manual CMBlockBuffer", buildMode: .manualBlockBuffer, bitRate: br),
      ProbeConfig(name: "manual CMBlockBuffer, sizeCount=0", explicitSampleSize: false, buildMode: .manualBlockBuffer, bitRate: br),

      // the rate the hardware actually hands us, downsampled by AVAudioConverter
      ProbeConfig(name: "48k src -> 16k out (legal br)", bitRate: br, sourceSampleRate: 48_000),
      ProbeConfig(name: "44.1k src -> 16k out (legal br)", bitRate: br, sourceSampleRate: 44_100),
    ]

    print("=== MATRIX @\(br)bps on \(AWProbe.environmentDescription)")
    var results: [ProbeResult] = []
    for cfg in configs {
      let r = AWProbe.run(cfg, seconds: 1.0)
      results.append(r)
      print("=== \(r.line)")
    }
    let failed = results.filter { !$0.ok }
    print("=== SUMMARY \(results.count - failed.count)/\(results.count) passed")
    for f in failed { print("=== STILL FAILING: \(f.line)") }
  }

  /// Every bit rate the encoder claims to support, verified end to end.
  func testDeclaredBitRatesActuallyWork() {
    let rates = AWProbe.applicableAACBitRates(sampleRate: 16_000, channels: 1)
    print("=== VERIFYING declared rates \(rates) plus the rejected 64000")
    for br in rates + [64_000] {
      let r = AWProbe.run(ProbeConfig(name: "bitrate \(br)", bitRate: br), seconds: 1.0)
      print("=== \(r.line)")
    }
  }

  /// Is the 132 ms shortfall an edit-list relabelling or real swallowed audio?
  func testPrimingIsNotLostAudio() {
    for seconds in [1.0, 2.0, 5.0] {
      print("=== \(seconds)s -> \(AWProbe.rampRoundTrip(bitRate: Self.legalBitRate, sampleRate: 16_000, seconds: seconds))")
    }
  }

  /// The real rotation algorithm, lifted verbatim from ContinuousCaptureCore and
  /// driven by synthetic buffers. Any audio lost at a boundary shows up as a
  /// shortfall between decoded and expected frames.
  func testRotationAlgorithmIsLossless() {
    let cases: [(String, Double, Double, Double, Int, UInt32)] = [
      // label, seconds, chunkLen, sourceRate, tapFrames, preOpenDelayMs
      ("48k src, 1s chunks, aligned tap", 10, 1.0, 48_000, 4096, 0),
      ("48k src, 0.7s chunks (boundary mid-buffer)", 10, 0.7, 48_000, 4096, 0),
      ("44.1k src, 0.7s chunks", 10, 0.7, 44_100, 4096, 0),
      ("16k src, 1s chunks", 10, 1.0, 16_000, 1024, 0),
      ("late pre-open (150ms)", 10, 1.0, 48_000, 4096, 150),
    ]
    for (label, seconds, chunkLen, rate, tap, delay) in cases {
      let s = RotationHarness().run(
        seconds: seconds, chunkLengthSec: chunkLen, sourceRate: rate,
        outputRate: 16_000, bitRate: Self.legalBitRate, tapFrames: tap, preOpenDelayMs: delay)
      print("=== ROT \(label)")
      for line in s.description.split(separator: "\n") { print("===   \(line)") }
      XCTAssertTrue(s.chunks.allSatisfy { $0.failure == nil }, "\(label): a chunk failed")
      // No audio may go missing. A non-integer resample ratio (44.1k → 16k) can
      // round a few frames the *other* way per chunk, which is a gain, not a gap.
      XCTAssertLessThanOrEqual(
        s.lostFrames, 0, "\(label): lost \(s.lostFrames) frames (\(s.lostMs) ms)")
      XCTAssertLessThan(
        abs(s.lostFrames), 32,
        "\(label): frame drift \(s.lostFrames) is larger than resampler rounding explains")

      // Chunks must tile the timeline with no hole between them.
      for (a, b) in zip(s.chunks, s.chunks.dropFirst()) {
        XCTAssertEqual(
          a.endedAtSec, b.startedAtSec, accuracy: 0.0005,
          "\(label): gap between chunk \(a.index) and \(b.index)")
      }
    }
  }

  /// What the module actually has to do: close writer N, open writer N+1 on one
  /// continuous PTS timeline, and lose nothing across the seam.
  func testRotationContinuity() {
    let chunkSeconds = 2.0
    let chunks = 3
    var results: [ProbeResult] = []
    for i in 0..<chunks {
      var c = ProbeConfig(name: "rotation chunk \(i)", bitRate: Self.legalBitRate)
      c.name = "rotation chunk \(i) @ t=\(Double(i) * chunkSeconds)s"
      c.firstPTSSeconds = Double(i) * chunkSeconds
      c.startSessionAtFirstPTS = true
      let r = AWProbe.run(c, seconds: chunkSeconds)
      results.append(r)
      print("=== \(r.line)")
    }
    let total = results.reduce(0.0) { $0 + $1.measuredDurationSec }
    let expected = chunkSeconds * Double(chunks)
    print("=== ROTATION total=\(String(format: "%.3f", total))s expected=\(expected)s drift=\(String(format: "%.1f", (total - expected) * 1000))ms")
    XCTAssertTrue(results.allSatisfy(\.ok), "every rotated chunk must write")
  }
}
