import SwiftUI

/// Data parsed from a Nimbalyst pairing QR code.
///
/// The desktop generates a v4 payload:
/// ```json
/// {
///   "version": 4,
///   "serverUrl": "wss://...",
///   "encryptionKeySeed": "base64...",
///   "expiresAt": 1234567890,
///   "analyticsId": "...",
///   "syncEmail": "user@example.com"
/// }
/// ```
public struct QRPairingData: Equatable {
    public let seed: String
    public let serverUrl: String
    public let userId: String
    /// Desktop's PostHog analytics ID for cross-device identity linking.
    public let analyticsId: String?

    /// Parse QR code string into pairing data.
    /// Supports the desktop v4 payload format (encryptionKeySeed, syncEmail)
    /// and falls back to legacy format (seed, userId).
    /// Returns nil if the string is not valid JSON with required fields.
    public static func parse(_ string: String) -> QRPairingData? {
        guard let data = string.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        // Required: serverUrl
        guard let serverUrl = json["serverUrl"] as? String, !serverUrl.isEmpty else {
            return nil
        }

        // Encryption key: "encryptionKeySeed" (v4) or "seed" (legacy)
        let seed: String
        if let keySeed = json["encryptionKeySeed"] as? String, !keySeed.isEmpty {
            seed = keySeed
        } else if let legacySeed = json["seed"] as? String, !legacySeed.isEmpty {
            seed = legacySeed
        } else {
            return nil
        }

        // User identifier: "syncEmail" (v4) or "userId" (legacy), or "analyticsId" as fallback
        let userId: String
        if let email = json["syncEmail"] as? String, !email.isEmpty {
            userId = email
        } else if let legacyUserId = json["userId"] as? String, !legacyUserId.isEmpty {
            userId = legacyUserId
        } else if let analyticsId = json["analyticsId"] as? String, !analyticsId.isEmpty {
            // analyticsId can serve as a device identifier when no email is configured
            userId = analyticsId
        } else {
            return nil
        }

        // Check expiration if present (v4 payloads have expiresAt)
        if let expiresAt = json["expiresAt"] as? Double {
            let expirationDate = Date(timeIntervalSince1970: expiresAt / 1000.0)
            if expirationDate < Date() {
                return nil // QR code has expired
            }
        }

        let analyticsId = json["analyticsId"] as? String

        return QRPairingData(seed: seed, serverUrl: serverUrl, userId: userId, analyticsId: analyticsId)
    }
}

#if canImport(UIKit)
import AVFoundation
import UIKit

/// Camera-based QR code scanner using AVCaptureSession.
/// Wraps AVCaptureVideoPreviewLayer in a UIViewRepresentable for SwiftUI.
struct QRScannerView: UIViewRepresentable {
    let onScanned: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScanned: onScanned)
    }

    func makeUIView(context: Context) -> QRScannerUIView {
        let view = QRScannerUIView(coordinator: context.coordinator)
        return view
    }

    func updateUIView(_ uiView: QRScannerUIView, context: Context) {}

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onScanned: (String) -> Void
        private var hasScanned = false

        init(onScanned: @escaping (String) -> Void) {
            self.onScanned = onScanned
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !hasScanned,
                  let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  object.type == .qr,
                  let value = object.stringValue else { return }

            hasScanned = true
            onScanned(value)
        }

        func reset() {
            hasScanned = false
        }
    }
}

/// UIView that manages AVCaptureSession for QR code scanning.
class QRScannerUIView: UIView {
    private let coordinator: QRScannerView.Coordinator
    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var metadataOutput: AVCaptureMetadataOutput?

    init(coordinator: QRScannerView.Coordinator) {
        self.coordinator = coordinator
        super.init(frame: .zero)
        setupCamera()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
        updateVideoOrientation()
        updateRectOfInterest()
    }

    /// Rotate the preview layer's video to match the current interface orientation.
    private func updateVideoOrientation() {
        guard let connection = previewLayer?.connection, connection.isVideoRotationAngleSupported(0) else { return }
        let angle: CGFloat
        switch window?.windowScene?.interfaceOrientation {
        case .landscapeLeft:  angle = 180
        case .landscapeRight: angle = 0
        case .portraitUpsideDown: angle = 270
        default: angle = 90 // portrait
        }
        if connection.isVideoRotationAngleSupported(angle) {
            connection.videoRotationAngle = angle
        }
    }

    /// Set rectOfInterest using the preview layer's coordinate conversion,
    /// which accounts for device orientation and video gravity automatically.
    private func updateRectOfInterest() {
        guard let previewLayer, let metadataOutput,
              bounds.width > 0, bounds.height > 0 else { return }
        // Scan center 60% of the visible preview
        let insetX = bounds.width * 0.2
        let insetY = bounds.height * 0.2
        let scanRect = bounds.insetBy(dx: insetX, dy: insetY)
        metadataOutput.rectOfInterest = previewLayer.metadataOutputRectConverted(fromLayerRect: scanRect)
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        session.sessionPreset = .medium // 480p is sufficient for QR codes, much faster than default

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else { return }

        // Configure autofocus for fast QR detection
        if device.isFocusModeSupported(.continuousAutoFocus) {
            try? device.lockForConfiguration()
            device.focusMode = .continuousAutoFocus
            if device.isAutoFocusRangeRestrictionSupported {
                device.autoFocusRangeRestriction = .near
            }
            device.unlockForConfiguration()
        }

        if session.canAddInput(input) {
            session.addInput(input)
        }

        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(coordinator, queue: .main)
            output.metadataObjectTypes = [.qr]
        }
        metadataOutput = output

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = bounds
        layer.addSublayer(preview)

        previewLayer = preview
        captureSession = session

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    func stopScanning() {
        captureSession?.stopRunning()
    }

    deinit {
        // captureSession cleanup happens via stopScanning() called by parent
    }
}
#endif
