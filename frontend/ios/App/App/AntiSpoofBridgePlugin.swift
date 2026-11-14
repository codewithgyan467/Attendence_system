import Foundation
import Capacitor
import CoreLocation

@objc(AntiSpoofBridgePlugin)
public class AntiSpoofBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AntiSpoofBridgePlugin"
    public let jsName = "AntiSpoofBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkMockStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "evaluateDeviceSpoofState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getHardwareLocation", returnType: CAPPluginReturnPromise)
    ]

    private let locationManager = CLLocationManager()

    @objc public func checkMockStatus(_ call: CAPPluginCall) {
        var isMock = false
        var reasons: [String] = []

        if let loc = locationManager.location {
            let ageSeconds = abs(loc.timestamp.timeIntervalSinceNow)
            if ageSeconds > 15.0 {
                reasons.append("STALE_LOCATION_FIX")
            }

            if #available(iOS 15.0, *) {
                if loc.sourceInformation?.isSimulatedBySoftware == true {
                    isMock = true
                    reasons.append("IOS_SOFTWARE_SIMULATED_LOCATION")
                }
            }
        }

        call.resolve([
            "isMock": isMock,
            "mockReason": reasons.isEmpty ? "NONE" : reasons.joined(separator: ";"),
            "detectedApps": [],
            "source": "NATIVE_IOS_CORE_LOCATION"
        ])
    }

    @objc public func evaluateDeviceSpoofState(_ call: CAPPluginCall) {
        var isMock = false
        var reasons: [String] = []

        if let loc = locationManager.location {
            let ageSeconds = abs(loc.timestamp.timeIntervalSinceNow)
            if ageSeconds > 15.0 {
                reasons.append("STALE_LOCATION_FIX")
            }

            if #available(iOS 15.0, *) {
                if loc.sourceInformation?.isSimulatedBySoftware == true {
                    isMock = true
                    reasons.append("IOS_SOFTWARE_SIMULATED_LOCATION")
                }
            }
        }

        call.resolve([
            "isMock": isMock,
            "isRooted": false,
            "isEmulator": false,
            "mockReason": reasons.isEmpty ? "NONE" : reasons.joined(separator: ";"),
            "source": "NATIVE_IOS_SPOOF_CHECK"
        ])
    }

    @objc public func getHardwareLocation(_ call: CAPPluginCall) {
        guard let loc = locationManager.location else {
            call.reject("Location not available")
            return
        }

        let ageSeconds = abs(loc.timestamp.timeIntervalSinceNow)
        if ageSeconds > 15.0 {
            call.reject("Location fix is older than 15 seconds")
            return
        }

        var isMock = false
        var reasons: [String] = []

        if #available(iOS 15.0, *) {
            if loc.sourceInformation?.isSimulatedBySoftware == true {
                isMock = true
                reasons.append("IOS_SOFTWARE_SIMULATED_LOCATION")
            }
        }

        call.resolve([
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
            "altitude": loc.altitude,
            "speed": loc.speed >= 0 ? loc.speed : 0.0,
            "isMock": isMock,
            "mockReason": reasons.isEmpty ? "NONE" : reasons.joined(separator: ";"),
            "detectedApps": [],
            "source": "NATIVE_IOS_CORE_LOCATION"
        ])
    }
}

