#if os(iOS)
@preconcurrency import AVFoundation
import AudioToolbox
import os

// MARK: - Lock-free SPSC Ring Buffer

/// Single-producer single-consumer ring buffer for real-time audio playback.
/// Producer (main thread) writes 48kHz PCM16 via `write()`.
/// Consumer (audio thread) reads via `read()`, filling remainder with silence.
///
/// Thread safety: Each index is written by exactly one thread and read by the other (SPSC pattern).
/// On ARM64, naturally-aligned word loads/stores are atomic, which is sufficient for SPSC.
nonisolated final class PlaybackRingBuffer: @unchecked Sendable {
    private let storage: UnsafeMutablePointer<Int16>
    private let capacity: Int

    nonisolated(unsafe) private var writePos: Int = 0
    nonisolated(unsafe) private var readPos: Int = 0

    init(capacity: Int) {
        self.capacity = capacity
        self.storage = .allocate(capacity: capacity)
        self.storage.initialize(repeating: 0, count: capacity)
    }

    deinit { storage.deallocate() }

    var availableFrames: Int {
        let w = writePos, r = readPos
        return w >= r ? w - r : capacity - r + w
    }

    /// Write frames. Returns number actually written.
    func write(_ src: UnsafePointer<Int16>, count: Int) -> Int {
        let r = readPos, w = writePos
        let free = r > w ? r - w - 1 : capacity - w + r - 1
        let n = min(count, free)
        guard n > 0 else { return 0 }

        let first = min(n, capacity - w)
        storage.advanced(by: w).update(from: src, count: first)
        if n > first {
            storage.update(from: src.advanced(by: first), count: n - first)
        }
        writePos = (w + n) % capacity
        return n
    }

    /// Read frames into dst. Fills any shortfall with silence. Returns frames of real data read.
    func read(_ dst: UnsafeMutablePointer<Int16>, count: Int) -> Int {
        let w = writePos, r = readPos
        let avail = w >= r ? w - r : capacity - r + w
        let n = min(count, avail)

        if n > 0 {
            let first = min(n, capacity - r)
            dst.update(from: storage.advanced(by: r), count: first)
            if n > first {
                dst.advanced(by: first).update(from: storage, count: n - first)
            }
            readPos = (r + n) % capacity
        }

        // Fill remainder with silence
        if n < count {
            dst.advanced(by: n).initialize(repeating: 0, count: count - n)
        }

        return n
    }

    func reset() {
        readPos = 0
        writePos = 0
    }
}

// MARK: - AudioPipeline

/// Audio capture and playback for OpenAI Realtime API.
///
/// **Capture**: VoiceProcessingIO bus 1 at 48kHz PCM16 -> AVAudioConverter -> 24kHz PCM16
/// **Playback**: 24kHz PCM16 -> AVAudioConverter -> 48kHz PCM16 -> ring buffer -> VPIO bus 0
///
/// Both capture and playback route through the same VoiceProcessingIO audio unit.
/// VPIO uses the bus 0 output signal as an echo cancellation reference, allowing
/// accurate acoustic echo cancellation (AEC) and barge-in support.
@MainActor
final class AudioPipeline: @unchecked Sendable {
    private let logger = Logger(subsystem: "com.nimbalyst.app", category: "AudioPipeline")

    // MARK: - Constants

    /// Match the iPhone hardware sample rate (48kHz) to avoid internal resampling
    nonisolated(unsafe) private static let kHardwareSampleRate: Double = 48000

    /// OpenAI Realtime API expects 24kHz
    nonisolated(unsafe) private static let kApiSampleRate: Double = 24000

    /// Accumulate 2400 frames at 24kHz (100ms) before sending
    nonisolated(unsafe) private static let kAccumulatorTarget: AVAudioFrameCount = 2400

    // MARK: - Audio formats

    /// 48kHz PCM16 mono — matches hardware, used for VPIO capture and playback buses
    nonisolated(unsafe) private static let hardwareFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: kHardwareSampleRate, channels: 1, interleaved: true
    )!

    /// 24kHz PCM16 mono — OpenAI Realtime API wire format
    nonisolated(unsafe) private static let apiFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: kApiSampleRate, channels: 1, interleaved: true
    )!

    // MARK: - Capture state (accessed from real-time audio thread)

    nonisolated(unsafe) private var captureAudioUnit: AudioUnit?
    nonisolated(unsafe) private var captureCallbackCount: Int = 0

    /// AVAudioConverter for 48kHz -> 24kHz resampling (capture direction)
    nonisolated(unsafe) private var captureConverter: AVAudioConverter?

    /// Accumulates resampled PCM16 frames at 24kHz
    nonisolated(unsafe) private var accumulatorBuffer: AVAudioPCMBuffer?

    // MARK: - Playback state

    /// Ring buffer: main thread writes 48kHz PCM16, VPIO bus 0 render callback reads
    nonisolated(unsafe) private var playbackRingBuffer = PlaybackRingBuffer(capacity: 48000 * 5)

    /// AVAudioConverter for 24kHz -> 48kHz resampling (playback direction)
    private var playbackConverter: AVAudioConverter?

    /// Set by markEndOfPlayback(), signals no more audio chunks coming
    private var endOfPlaybackMarked = false

    // MARK: - Callbacks

    nonisolated(unsafe) var onAudioCaptured: (@Sendable (String) -> Void)?
    var onPlaybackFinished: (() -> Void)?

    // MARK: - State

    private var isCapturing = false
    private var isPlaying = false

    init() {}

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
        captureConverter = AVAudioConverter(from: Self.hardwareFormat, to: Self.apiFormat)
        playbackConverter = AVAudioConverter(from: Self.apiFormat, to: Self.hardwareFormat)
        playbackRingBuffer.reset()

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

        // Bus 0 output stays enabled (default) — VPIO uses it as the AEC reference signal.
        // This is the key difference from the old approach where bus 0 was disabled and
        // playback went through a separate AVAudioEngine, giving VPIO no reference signal.

        // Set 48kHz PCM16 mono on bus 1 output scope (capture format)
        var ioFormat = AudioStreamBasicDescription(
            mSampleRate: Self.kHardwareSampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2,
            mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0
        )
        guard AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1,
                                   &ioFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        // Set 48kHz PCM16 mono on bus 0 input scope (playback format we provide via render callback)
        guard AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0,
                                   &ioFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        // Set capture callback on bus 1
        var inputCb = AURenderCallbackStruct(inputProc: audioCaptureCallback, inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        guard AudioUnitSetProperty(au, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1,
                                   &inputCb, UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr else {
            AudioComponentInstanceDispose(au); throw AudioPipelineError.audioUnitSetupFailed
        }

        // Set render callback on bus 0 — feeds playback audio from ring buffer to VPIO output
        var outputCb = AURenderCallbackStruct(inputProc: audioPlaybackCallback, inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        guard AudioUnitSetProperty(au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0,
                                   &outputCb, UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr else {
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
        logger.info("Capture started with VoiceProcessingIO (AEC via bus 0 output)")
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
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: Self.hardwareFormat, bufferListNoCopy: &bufferList) else {
            rawPtr.deallocate()
            return
        }

        // Resample 48kHz -> 24kHz
        guard let converter = captureConverter else { rawPtr.deallocate(); return }

        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: Self.apiFormat,
            frameCapacity: AVAudioFrameCount(Self.kApiSampleRate * 2.0)
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
                pcmFormat: Self.apiFormat,
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
        captureConverter = nil
        playbackConverter = nil
        isCapturing = false
    }

    // MARK: - Playback via VPIO bus 0

    /// Called from the real-time audio thread. Reads playback data from the ring buffer
    /// into the VPIO output buffer. VPIO uses this signal as the AEC reference.
    nonisolated func handlePlaybackCallback(
        _ ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
        _ inTimeStamp: UnsafePointer<AudioTimeStamp>,
        _ inBusNumber: UInt32,
        _ inNumberFrames: UInt32,
        _ ioData: UnsafeMutablePointer<AudioBufferList>
    ) {
        guard let outputPtr = ioData.pointee.mBuffers.mData?.assumingMemoryBound(to: Int16.self) else {
            ioActionFlags.pointee.insert(.unitRenderAction_OutputIsSilence)
            return
        }

        let framesRead = playbackRingBuffer.read(outputPtr, count: Int(inNumberFrames))

        if framesRead == 0 {
            ioActionFlags.pointee.insert(.unitRenderAction_OutputIsSilence)
        }
    }

    /// Enqueue playback audio from the API (24kHz PCM16 base64).
    /// Resamples to 48kHz and writes to ring buffer for VPIO bus 0 output.
    func enqueuePlayback(base64Audio: String) {
        guard let audioData = Data(base64Encoded: base64Audio),
              let converter = playbackConverter else { return }

        let inputFrameCount = audioData.count / 2
        guard inputFrameCount > 0 else { return }

        // Create input buffer (24kHz PCM16)
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: Self.apiFormat, frameCapacity: AVAudioFrameCount(inputFrameCount)) else { return }
        inputBuffer.frameLength = AVAudioFrameCount(inputFrameCount)
        guard let inputData = inputBuffer.int16ChannelData else { return }
        audioData.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            inputData[0].update(from: src.baseAddress!, count: inputFrameCount)
        }

        // Resample 24kHz -> 48kHz
        let outputFrameCapacity = AVAudioFrameCount(Double(inputFrameCount) * (Self.kHardwareSampleRate / Self.kApiSampleRate)) + 16
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: Self.hardwareFormat, frameCapacity: outputFrameCapacity) else { return }

        var error: NSError?
        nonisolated(unsafe) var consumed: UInt32 = 0
        let inputFrameLength = inputBuffer.frameLength

        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            guard consumed < inputFrameLength else {
                outStatus.pointee = .noDataNow
                return nil
            }
            outStatus.pointee = .haveData
            consumed = inputFrameLength
            return inputBuffer
        }

        if let error {
            logger.error("Playback resample error: \(error.localizedDescription)")
            return
        }

        // Write resampled 48kHz data to ring buffer
        guard let outputData = outputBuffer.int16ChannelData else { return }
        _ = playbackRingBuffer.write(outputData[0], count: Int(outputBuffer.frameLength))

        isPlaying = true
        endOfPlaybackMarked = false
    }

    /// Signal that no more playback audio chunks are coming from the server.
    /// Fires onPlaybackFinished once the ring buffer has fully drained.
    func markEndOfPlayback() {
        endOfPlaybackMarked = true
        checkPlaybackDrained()
    }

    private func checkPlaybackDrained() {
        guard endOfPlaybackMarked, isPlaying else { return }
        if playbackRingBuffer.availableFrames == 0 {
            isPlaying = false
            endOfPlaybackMarked = false
            onPlaybackFinished?()
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.checkPlaybackDrained()
            }
        }
    }

    func stopPlayback() {
        playbackRingBuffer.reset()
        endOfPlaybackMarked = false
        isPlaying = false
    }

    // MARK: - Lifecycle

    func shutdown() {
        stopCapture()
        stopPlayback()
        deactivateAudioSession()
        NotificationCenter.default.removeObserver(self)
    }

    enum AudioPipelineError: Error, LocalizedError {
        case audioUnitSetupFailed
        var errorDescription: String? { "Failed to set up VoiceProcessingIO audio unit" }
    }
}

// MARK: - C Render Callbacks

/// Capture callback: VPIO bus 1 delivers mic audio here
private let audioCaptureCallback: AURenderCallback = { inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, _ in
    Unmanaged<AudioPipeline>.fromOpaque(inRefCon).takeUnretainedValue()
        .handleCaptureCallback(ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames)
    return noErr
}

/// Playback callback: VPIO bus 0 pulls output audio from here (also used as AEC reference)
private let audioPlaybackCallback: AURenderCallback = { inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, ioData in
    guard let ioData else {
        ioActionFlags.pointee.insert(.unitRenderAction_OutputIsSilence)
        return noErr
    }
    Unmanaged<AudioPipeline>.fromOpaque(inRefCon).takeUnretainedValue()
        .handlePlaybackCallback(ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, ioData)
    return noErr
}
#endif
