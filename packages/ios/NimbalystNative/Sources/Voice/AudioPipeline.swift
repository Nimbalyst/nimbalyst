#if os(iOS)
@preconcurrency import AVFoundation
import AudioToolbox
import os

/// Audio capture and playback for OpenAI Realtime API.
///
/// **Capture**: VoiceProcessingIO at 48kHz PCM16 -> AVAudioConverter -> 24kHz PCM16
/// **Playback**: AVAudioEngine + AVAudioPlayerNode for audio response output
///
/// VoiceProcessingIO provides built-in acoustic echo cancellation (AEC),
/// allowing barge-in (user can interrupt the agent while it speaks).
/// Playback goes through a separate AVAudioEngine — VPIO still gets AEC
/// benefit from the .voiceChat audio session mode even without owning bus 0.
@MainActor
final class AudioPipeline: @unchecked Sendable {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "AudioPipeline")

    // MARK: - Capture constants

    /// Match the iPhone hardware sample rate (48kHz) to avoid internal resampling
    nonisolated(unsafe) private static let kCaptureSampleRate: Double = 48000

    /// OpenAI Realtime API expects 24kHz
    nonisolated(unsafe) private static let kOutputSampleRate: Double = 24000

    /// Accumulate 2400 frames at 24kHz (100ms) before sending
    nonisolated(unsafe) private static let kAccumulatorTarget: AVAudioFrameCount = 2400

    // MARK: - Capture state (accessed from real-time audio thread)

    nonisolated(unsafe) private var captureAudioUnit: AudioUnit?
    nonisolated(unsafe) private var captureCallbackCount: Int = 0

    /// AVAudioConverter for 48kHz -> 24kHz resampling
    nonisolated(unsafe) private var audioConverter: AVAudioConverter?

    /// Accumulates resampled PCM16 frames at 24kHz
    nonisolated(unsafe) private var accumulatorBuffer: AVAudioPCMBuffer?

    // MARK: - Audio formats

    nonisolated(unsafe) private static let captureFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: kCaptureSampleRate, channels: 1, interleaved: true
    )!

    nonisolated(unsafe) private static let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: kOutputSampleRate, channels: 1, interleaved: true
    )!

    // MARK: - Playback (AVAudioEngine)

    private let playbackEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let playbackFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: true)!

    // MARK: - Callbacks

    nonisolated(unsafe) var onAudioCaptured: (@Sendable (String) -> Void)?
    var onPlaybackFinished: (() -> Void)?

    // MARK: - State

    private var isCapturing = false
    private var isPlaying = false
    private var scheduledBufferCount = 0

    init() {
        playbackEngine.attach(playerNode)
        playbackEngine.connect(playerNode, to: playbackEngine.outputNode, format: playbackFormat)
    }

    // MARK: - Audio Session

    func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try session.setPreferredSampleRate(48000)
        try session.setPreferredIOBufferDuration(0.02) // 20ms buffers
        try session.setActive(true, options: [])

        if session.isInputGainSettable {
            try? session.setInputGain(1.0)
        }

        logger.info("Audio session configured: sampleRate=\(session.sampleRate), route=\(session.currentRoute.inputs.map { $0.portName })")

        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main
        ) { [weak self] notification in
            let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor in
                guard let typeValue, let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
                if type == .began {
                    self?.stopCapture()
                    self?.stopPlayback()
                }
            }
        }
    }

    func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Microphone Permission

    func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Capture

    func startCapture() throws {
        guard !isCapturing else { return }
        captureCallbackCount = 0
        accumulatorBuffer = nil
        audioConverter = AVAudioConverter(from: Self.captureFormat, to: Self.outputFormat)

        // VoiceProcessingIO provides built-in acoustic echo cancellation (AEC).
        // The render err: -1 warnings on bus 0 are expected since playback goes
        // through a separate AVAudioEngine, but capture still works correctly
        // and AEC is still active via the .voiceChat audio session mode.
        var desc = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_VoiceProcessingIO,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0, componentFlagsMask: 0
        )
        guard let component = AudioComponentFindNext(nil, &desc) else {
            throw AudioPipelineError.audioUnitSetupFailed
        }

        var au: AudioUnit?
        guard AudioComponentInstanceNew(component, &au) == noErr, let au else {
            throw AudioPipelineError.audioUnitSetupFailed
        }

        // Enable mic input on bus 1
        var one: UInt32 = 1
        guard AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1,
                                   &one, UInt32(MemoryLayout.size(ofValue: one))) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        // Disable output on bus 0 — we don't use VPIO for playback
        var zero: UInt32 = 0
        AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0,
                             &zero, UInt32(MemoryLayout.size(ofValue: zero)))

        // Set 48kHz PCM16 mono on bus 1 output scope
        var ioFormat = AudioStreamBasicDescription(
            mSampleRate: Self.kCaptureSampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2,
            mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0
        )
        guard AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1,
                                   &ioFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        // Set render callback
        var cb = AURenderCallbackStruct(inputProc: audioCaptureCallback, inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        guard AudioUnitSetProperty(au, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1,
                                   &cb, UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        guard AudioUnitInitialize(au) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }
        guard AudioOutputUnitStart(au) == noErr else {
            AudioUnitUninitialize(au); AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        captureAudioUnit = au
        isCapturing = true
        logger.info("Capture started with VoiceProcessingIO")
    }

    /// Called from real-time audio thread. Renders mic data at 48kHz, resamples to 24kHz,
    /// accumulates into 100ms chunks, and sends as base64.
    nonisolated func handleCaptureCallback(
        _ ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
        _ inTimeStamp: UnsafePointer<AudioTimeStamp>,
        _ inBusNumber: UInt32,
        _ inNumberFrames: UInt32
    ) {
        guard let au = captureAudioUnit else { return }

        let byteCount = Int(inNumberFrames) * 2
        let rawPtr = UnsafeMutableRawPointer.allocate(byteCount: byteCount, alignment: MemoryLayout<Int16>.alignment)
        var bufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: UInt32(byteCount), mData: rawPtr)
        )

        let status = AudioUnitRender(au, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, &bufferList)
        guard status == noErr else { rawPtr.deallocate(); return }

        captureCallbackCount += 1

        // Wrap raw PCM16 in AVAudioPCMBuffer for the converter
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: Self.captureFormat, bufferListNoCopy: &bufferList) else {
            rawPtr.deallocate()
            return
        }

        // Resample 48kHz -> 24kHz
        guard let converter = audioConverter else { rawPtr.deallocate(); return }

        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: Self.outputFormat,
            frameCapacity: AVAudioFrameCount(Self.kOutputSampleRate * 2.0)
        ) else { rawPtr.deallocate(); return }

        var error: NSError?
        nonisolated(unsafe) var consumed: UInt32 = 0
        let inputFrameLength = inputBuffer.frameLength

        converter.convert(to: outputBuffer, error: &error) { numberOfFrames, outStatus in
            guard consumed < inputFrameLength else {
                outStatus.pointee = .noDataNow
                return nil
            }
            let audioBufferList = inputBuffer.mutableAudioBufferList
            if consumed > 0, let data = audioBufferList.pointee.mBuffers.mData {
                audioBufferList.pointee.mBuffers.mData = data.advanced(by: Int(consumed) * MemoryLayout<Int16>.size)
            }
            let amountToFill = min(numberOfFrames, inputFrameLength - consumed)
            outStatus.pointee = .haveData
            consumed += amountToFill
            inputBuffer.frameLength = amountToFill
            return inputBuffer
        }

        inputBuffer.frameLength = inputFrameLength

        if let error {
            let log = Logger(subsystem: "com.nimbalyst.app", category: "AudioCapture")
            log.error("AVAudioConverter error: \(error.localizedDescription)")
            return
        }

        accumulateAndSend(outputBuffer)
    }

    /// Accumulate resampled PCM16 frames and send when we have 100ms worth
    nonisolated private func accumulateAndSend(_ buf: AVAudioPCMBuffer) {
        if accumulatorBuffer == nil {
            accumulatorBuffer = AVAudioPCMBuffer(
                pcmFormat: Self.outputFormat,
                frameCapacity: Self.kAccumulatorTarget * 2
            )
            accumulatorBuffer?.frameLength = 0
        }
        guard let accumulator = accumulatorBuffer,
              let srcData = buf.int16ChannelData,
              let dstData = accumulator.int16ChannelData else { return }

        let copyFrames = min(buf.frameLength, accumulator.frameCapacity - accumulator.frameLength)
        let dst = dstData[0].advanced(by: Int(accumulator.frameLength))
        let src = srcData[0]
        dst.update(from: src, count: Int(copyFrames))
        accumulator.frameLength += copyFrames

        if accumulator.frameLength >= Self.kAccumulatorTarget {
            let frameCount = Int(accumulator.frameLength)
            let byteCount = frameCount * 2
            let data = Data(bytes: dstData[0], count: byteCount)
            let base64 = data.base64EncodedString()

            accumulatorBuffer = nil

            let callback = onAudioCaptured
            Task { @MainActor in callback?(base64) }
        }
    }

    func stopCapture() {
        guard isCapturing else { return }
        if let au = captureAudioUnit {
            AudioOutputUnitStop(au)
            AudioUnitUninitialize(au)
            AudioComponentInstanceDispose(au)
            captureAudioUnit = nil
        }
        accumulatorBuffer = nil
        audioConverter = nil
        isCapturing = false
    }

    // MARK: - Playback

    func enqueuePlayback(base64Audio: String) {
        guard let audioData = Data(base64Encoded: base64Audio) else { return }
        let frameCount = audioData.count / 2
        guard let buf = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frameCount)) else { return }
        buf.frameLength = AVAudioFrameCount(frameCount)

        guard let floatData = buf.floatChannelData else { return }
        audioData.withUnsafeBytes { raw in
            let int16 = raw.bindMemory(to: Int16.self)
            for i in 0..<frameCount { floatData[0][i] = Float(int16[i]) / 32768.0 }
        }

        scheduledBufferCount += 1
        if !playbackEngine.isRunning { try? playbackEngine.start() }
        if !playerNode.isPlaying { playerNode.play(); isPlaying = true }

        playerNode.scheduleBuffer(buf) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.scheduledBufferCount -= 1
                if self.scheduledBufferCount <= 0 {
                    self.scheduledBufferCount = 0
                    self.isPlaying = false
                    self.onPlaybackFinished?()
                }
            }
        }
    }

    func stopPlayback() {
        playerNode.stop()
        scheduledBufferCount = 0
        isPlaying = false
    }

    // MARK: - Lifecycle

    func shutdown() {
        stopCapture()
        stopPlayback()
        playbackEngine.stop()
        deactivateAudioSession()
        NotificationCenter.default.removeObserver(self)
    }

    enum AudioPipelineError: Error, LocalizedError {
        case audioUnitSetupFailed
        var errorDescription: String? { "Failed to set up VoiceProcessingIO audio unit" }
    }
}

// MARK: - C Render Callback

private let audioCaptureCallback: AURenderCallback = { inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, _ in
    Unmanaged<AudioPipeline>.fromOpaque(inRefCon).takeUnretainedValue()
        .handleCaptureCallback(ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames)
    return noErr
}
#endif
