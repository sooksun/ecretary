require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MSecRecorder'
  s.version        = package['version']
  s.summary        = 'M-Secretary native chunked audio recorder (iOS)'
  s.description    = 'Chunked AAC meeting recorder for M-Secretary. Mirrors the Android foreground-service recorder: AAC/MP4 16 kHz mono 64 kbps, rotating chunk files every chunkLengthSec.'
  s.author         = 'M-Secretary'
  s.homepage       = 'https://msecretary.local'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '13.4' }
  s.swift_version  = '5.4'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
