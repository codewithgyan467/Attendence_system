import Foundation
import Capacitor
import CoreLocation
import Darwin

@objc(AntiSpoofBridgePlugin)
public class AntiSpoofBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AntiSpoofBridgePlugin"
    public let jsName = "AntiSpoofBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkMockStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "evaluateDeviceSpoofState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getHardwareLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verifyServerUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discoverWardenServer", returnType: CAPPluginReturnPromise)
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

    @objc public func discoverWardenServer(_ call: CAPPluginCall) {
        let udpPort = UInt16(call.getInt("udpPort") ?? 45678)
        let defaultHttpPort = call.getInt("httpPort") ?? 5000

        DispatchQueue.global(qos: .userInitiated).async {
            var deviceIp = ""
            var broadcastIp = ""
            var subnetPrefix = ""
            var targets = Set<String>(["255.255.255.255"])

            var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
            if getifaddrs(&ifaddrPtr) == 0, let firstAddr = ifaddrPtr {
                defer { freeifaddrs(firstAddr) }
                var ptr: UnsafeMutablePointer<ifaddrs>? = firstAddr
                while let current = ptr {
                    let iface = current.pointee
                    if let sa = iface.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) {
                        let name = String(cString: iface.ifa_name)
                        if (iface.ifa_flags & UInt32(IFF_LOOPBACK)) == 0 && name != "pdp_ip0" {
                            var addrCopy = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
                            var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                            inet_ntop(AF_INET, &addrCopy, &buf, socklen_t(INET_ADDRSTRLEN))
                            let ipStr = String(cString: buf)
                            let isPrivate = ipStr.hasPrefix("192.168.") || ipStr.hasPrefix("10.") || ipStr.hasPrefix("172.")
                            if isPrivate && (name == "en0" || deviceIp.isEmpty) {
                                deviceIp = ipStr
                                if let netmaskPtr = iface.ifa_netmask {
                                    let maskVal = netmaskPtr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
                                    let bcastVal = addrCopy.s_addr | (~maskVal)
                                    var bcastAddr = in_addr(s_addr: bcastVal)
                                    var bcastBuf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                                    inet_ntop(AF_INET, &bcastAddr, &bcastBuf, socklen_t(INET_ADDRSTRLEN))
                                    let bcastStr = String(cString: bcastBuf)
                                    if !bcastStr.isEmpty {
                                        broadcastIp = bcastStr
                                        targets.insert(bcastStr)
                                    }
                                }
                            }
                        }
                    }
                    ptr = iface.ifa_next
                }
            }

            if !deviceIp.isEmpty {
                let parts = deviceIp.split(separator: ".")
                if parts.count == 4 {
                    subnetPrefix = "\(parts[0]).\(parts[1]).\(parts[2])"
                    targets.insert("\(subnetPrefix).255")
                }
            }

            var discoveredUrls: [String] = []
            var seenUrls = Set<String>()

            let sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            if sock >= 0 {
                defer { close(sock) }
                var broadcastEnable: Int32 = 1
                setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &broadcastEnable, socklen_t(MemoryLayout<Int32>.size))

                var tv = timeval(tv_sec: 0, tv_usec: 250_000)
                setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

                let probe = Array("ATTENDRA_DISCOVER".utf8)
                for target in targets {
                    var dest = sockaddr_in()
                    dest.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    dest.sin_family = sa_family_t(AF_INET)
                    dest.sin_port = udpPort.bigEndian
                    if inet_pton(AF_INET, target, &dest.sin_addr) == 1 {
                        probe.withUnsafeBytes { rawBuf in
                            withUnsafePointer(to: &dest) { destPtr in
                                destPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                                    _ = sendto(sock, rawBuf.baseAddress, probe.count, 0, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                                }
                            }
                        }
                    }
                }

                let deadline = Date().addingTimeInterval(0.75)
                var recvBuf = [UInt8](repeating: 0, count: 2048)
                while Date() < deadline {
                    var sender = sockaddr_in()
                    var senderLen = socklen_t(MemoryLayout<sockaddr_in>.size)
                    let bytesRead = withUnsafeMutablePointer(to: &sender) { senderPtr in
                        senderPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                            recvfrom(sock, &recvBuf, recvBuf.count, 0, saPtr, &senderLen)
                        }
                    }
                    if bytesRead <= 0 { continue }

                    let data = Data(recvBuf[0..<bytesRead])
                    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    let serverPort = (obj["port"] as? Int) ?? defaultHttpPort

                    var senderAddr = sender.sin_addr
                    var senderBuf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                    inet_ntop(AF_INET, &senderAddr, &senderBuf, socklen_t(INET_ADDRSTRLEN))
                    let senderIp = String(cString: senderBuf)

                    var allIps: [String] = []
                    if !senderIp.isEmpty { allIps.append(senderIp) }
                    if let wardenIp = obj["wardenIp"] as? String, !wardenIp.isEmpty { allIps.append(wardenIp) }
                    if let ips = obj["ips"] as? [String] { allIps.append(contentsOf: ips) }

                    let prioritized = allIps.sorted { a, b in
                        let aSame = !subnetPrefix.isEmpty && a.hasPrefix(subnetPrefix + ".")
                        let bSame = !subnetPrefix.isEmpty && b.hasPrefix(subnetPrefix + ".")
                        return (aSame ? 0 : 1) < (bSame ? 0 : 1)
                    }

                    for ip in prioritized {
                        let url = "http://\(ip):\(serverPort)"
                        if !seenUrls.contains(url) {
                            seenUrls.insert(url)
                            discoveredUrls.append(url)
                        }
                    }
                    if !discoveredUrls.isEmpty { break }
                }
            }

            call.resolve([
                "deviceIp": deviceIp,
                "subnetPrefix": subnetPrefix,
                "gatewayIp": subnetPrefix.isEmpty ? "" : "\(subnetPrefix).1",
                "broadcastIp": broadcastIp,
                "wifiConnected": !deviceIp.isEmpty,
                "discoveredUrls": discoveredUrls
            ])
        }
    }

    private func normalizeOriginUrl(_ rawUrl: String, defaultPort: Int = 5000) -> String {
        var clean = rawUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        while clean.hasSuffix("/") { clean.removeLast() }
        if clean.isEmpty { return "" }
        if !clean.hasPrefix("http://") && !clean.hasPrefix("https://") {
            clean = "http://\(clean)"
        }
        if clean.hasSuffix("/api/v1") {
            clean = String(clean.dropLast("/api/v1".count))
        }
        if let comps = URLComponents(string: clean), let host = comps.host, !host.isEmpty {
            let scheme = comps.scheme ?? "http"
            let port = comps.port ?? (scheme == "http" ? defaultPort : nil)
            if let port = port {
                return "\(scheme)://\(host):\(port)"
            }
            return "\(scheme)://\(host)"
        }
        return clean
    }

    @objc public func verifyServerUrl(_ call: CAPPluginCall) {
        let rawUrl = call.getString("url") ?? ""
        let timeoutMs = call.getInt("timeoutMs") ?? 2000
        let baseOrigin = normalizeOriginUrl(rawUrl, defaultPort: 5000)

        guard !baseOrigin.isEmpty, let pingUrl = URL(string: "\(baseOrigin)/api/v1/ping-hostel") else {
            call.resolve(["ok": false, "baseOrigin": baseOrigin])
            return
        }

        let config = URLSessionConfiguration.ephemeral
        let timeoutSec = max(0.5, TimeInterval(timeoutMs) / 1000.0)
        config.timeoutIntervalForRequest = timeoutSec
        config.timeoutIntervalForResource = timeoutSec
        config.requestCachePolicy = .reloadIgnoringLocalCacheData

        let session = URLSession(configuration: config)
        var req = URLRequest(url: pingUrl)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        session.dataTask(with: req) { data, response, _ in
            defer { session.finishTasksAndInvalidate() }
            guard let httpRes = response as? HTTPURLResponse, (200..<300).contains(httpRes.statusCode),
                  let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (obj["status"] as? String) == "ok" || !((obj["wardenIp"] as? String) ?? "").isEmpty else {
                call.resolve(["ok": false, "baseOrigin": baseOrigin])
                return
            }

            let host = URL(string: baseOrigin)?.host ?? ((obj["wardenIp"] as? String) ?? "")
            let port = URL(string: baseOrigin)?.port ?? ((obj["port"] as? Int) ?? 5000)
            call.resolve([
                "ok": true,
                "baseOrigin": baseOrigin,
                "fullApi": "\(baseOrigin)/api/v1",
                "wardenIp": host,
                "port": port,
                "hostname": (obj["hostname"] as? String) ?? ""
            ])
        }.resume()
    }
}

