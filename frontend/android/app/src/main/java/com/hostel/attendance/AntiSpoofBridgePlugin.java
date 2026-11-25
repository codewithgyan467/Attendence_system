package com.hostel.attendance;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "AntiSpoofBridge")
public class AntiSpoofBridgePlugin extends Plugin {

    private static final List<String> KNOWN_MOCK_PACKAGES = Arrays.asList(
        "com.lexa.fakegps",
        "com.incorporateapps.fakegps",
        "com.incorporateapps.fakegps_route",
        "com.rosteam.gpsemulator",
        "com.fakegps.mock",
        "com.location.mock",
        "com.gsmartstudio.fakegps",
        "com.theappninjas.fakegpsjoystick",
        "com.fly.gps",
        "org.hola.gpslocation",
        "com.msl.locationchanger",
        "com.ninja.gps",
        "com.marlove.mockgps",
        "ru.gavrikov.mocklocations"
    );

    private int satellitesVisible = 0;
    private int satellitesUsedInFix = 0;

    @Override
    public void load() {
        super.load();
        initGnssTracker();
    }

    private void initGnssTracker() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                if (lm != null) {
                    lm.registerGnssStatusCallback(new android.location.GnssStatus.Callback() {
                        @Override
                        public void onSatelliteStatusChanged(@NonNull android.location.GnssStatus status) {
                            int total = status.getSatelliteCount();
                            int used = 0;
                            for (int i = 0; i < total; i++) {
                                if (status.usedInFix(i)) {
                                    used++;
                                }
                            }
                            satellitesVisible = total;
                            satellitesUsedInFix = used;
                        }
                    }, new Handler(Looper.getMainLooper()));
                }
            } catch (SecurityException ignored) {
            } catch (Exception ignored) {
            }
        }
    }

    private boolean isLocationMocked(Location location) {
        if (location == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return location.isMock();
        } else {
            return location.isFromMockProvider();
        }
    }

    private JSObject buildDeviceSpoofReport() {
        Context context = getContext();
        JSObject ret = new JSObject();
        boolean isMock = false;
        List<String> reasons = new ArrayList<>();
        JSArray detectedApps = new JSArray();
        JSArray detectedAppDetails = new JSArray();

        // 1. Check if known fake GPS packages are installed
        PackageManager pm = context.getPackageManager();
        for (String pkg : KNOWN_MOCK_PACKAGES) {
            try {
                PackageInfo pi = pm.getPackageInfo(pkg, 0);
                String appName = pm.getApplicationLabel(pi.applicationInfo).toString();
                detectedApps.put(pkg);
                
                JSObject detail = new JSObject();
                detail.put("packageName", pkg);
                detail.put("appName", appName);
                detail.put("isMockApp", true);
                detectedAppDetails.put(detail);

                isMock = true;
                reasons.add("KNOWN_SPOOFER_INSTALLED:" + pkg + " (" + appName + ")");
            } catch (PackageManager.NameNotFoundException ignored) {}
        }

        // 2. Check AppOpsManager for OPSTR_MOCK_LOCATION (Android 6.0+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
                if (ops != null) {
                    List<PackageInfo> installed = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS);
                    for (PackageInfo p : installed) {
                        if (p.requestedPermissions != null) {
                            for (String perm : p.requestedPermissions) {
                                if ("android.permission.ACCESS_MOCK_LOCATION".equals(perm) && !p.packageName.equals(context.getPackageName())) {
                                    try {
                                        ApplicationInfo ai = pm.getApplicationInfo(p.packageName, 0);
                                        int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_MOCK_LOCATION, ai.uid, p.packageName);
                                        if (mode == AppOpsManager.MODE_ALLOWED) {
                                            isMock = true;
                                            detectedApps.put(p.packageName);

                                            String appName = pm.getApplicationLabel(ai).toString();
                                            JSObject detail = new JSObject();
                                            detail.put("packageName", p.packageName);
                                            detail.put("appName", appName);
                                            detail.put("isMockApp", true);
                                            detectedAppDetails.put(detail);

                                            reasons.add("APPOPS_MOCK_ACTIVE:" + p.packageName);
                                        }
                                    } catch (Exception ignored) {}
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        // 3. Check Location object from LocationManager
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm != null) {
            try {
                Location lastGps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (lastGps != null && isLocationMocked(lastGps)) {
                    isMock = true;
                    reasons.add("LAST_GPS_IS_MOCK");
                }
                Location lastNet = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (lastNet != null && isLocationMocked(lastNet)) {
                    isMock = true;
                    reasons.add("LAST_NETWORK_IS_MOCK");
                }
            } catch (SecurityException ignored) {}
        }

        // 4. Developer Settings Mock Location & ADB Check
        boolean isAdbEnabled = false;
        boolean isDevOptionsEnabled = false;
        try {
            String allowMock = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ALLOW_MOCK_LOCATION);
            if (allowMock != null && !allowMock.equals("0")) {
                isMock = true;
                reasons.add("SECURE_SETTINGS_ALLOW_MOCK_LOCATION");
            }
            int adb = Settings.Global.getInt(context.getContentResolver(), Settings.Global.ADB_ENABLED, 0);
            isAdbEnabled = (adb == 1);
            int dev = Settings.Global.getInt(context.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
            isDevOptionsEnabled = (dev == 1);
        } catch (Exception ignored) {}

        ret.put("isMock", isMock);
        ret.put("mockDetected", isMock);
        ret.put("isMockLocation", isMock);
        ret.put("mockConfidence", isMock ? 100 : 0);
        ret.put("mockReason", reasons.isEmpty() ? "NONE" : String.join(";", reasons));
        ret.put("reasons", reasons);
        ret.put("detectedApps", detectedApps);
        ret.put("detectedSpoofApps", detectedApps);
        ret.put("detectedAppDetails", detectedAppDetails);
        ret.put("isAdbEnabled", isAdbEnabled);
        ret.put("isDeveloperOptionsEnabled", isDevOptionsEnabled);
        ret.put("satellitesVisible", satellitesVisible);
        ret.put("satellitesUsed", satellitesUsedInFix);
        ret.put("isNativeBridge", true);
        return ret;
    }

    @PluginMethod
    public void checkMockStatus(PluginCall call) {
        JSObject ret = buildDeviceSpoofReport();
        call.resolve(ret);
    }

    @PluginMethod
    public void evaluateDeviceSpoofState(PluginCall call) {
        JSObject ret = buildDeviceSpoofReport();
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        String packageName = call.getString("packageName");
        try {
            Intent intent;
            if (packageName != null && !packageName.trim().isEmpty()) {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + packageName.trim()));
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open settings: " + e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void getHardwareLocation(PluginCall call) {
        Context context = getContext();
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            call.reject("LocationManager not available");
            return;
        }

        boolean isMock = false;
        List<String> reasons = new ArrayList<>();
        JSArray detectedApps = new JSArray();

        try {
            Location lastGps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location lastNet = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            Location best = lastGps != null ? lastGps : lastNet;

            if (best != null) {
                // Reject locations older than 15 seconds
                long ageNanos = SystemClock.elapsedRealtimeNanos() - best.getElapsedRealtimeNanos();
                if (ageNanos > 15_000_000_000L) {
                    call.reject("Location fix is older than 15 seconds. Please acquire a fresh GPS lock.");
                    return;
                }

                if (isLocationMocked(best)) {
                    isMock = true;
                    reasons.add("HARDWARE_LOCATION_IS_MOCK");
                }

                // Raw GNSS Satellite Verification: Injected mock coordinates report 0 satellites
                if (LocationManager.GPS_PROVIDER.equals(best.getProvider())) {
                    Bundle extras = best.getExtras();
                    int satsInExtras = extras != null ? extras.getInt("satellites", -1) : -1;
                    if (satsInExtras == 0 || (satellitesVisible == 0 && best.getAccuracy() < 25.0f && isLocationMocked(best))) {
                        isMock = true;
                        reasons.add("ZERO_GNSS_SATELLITES_IN_GPS_FIX");
                    }
                }

                JSObject res = new JSObject();
                res.put("latitude", best.getLatitude());
                res.put("longitude", best.getLongitude());
                res.put("accuracy", best.getAccuracy());
                res.put("altitude", best.hasAltitude() ? best.getAltitude() : null);
                res.put("speed", best.hasSpeed() ? best.getSpeed() : 0.0);
                res.put("isMock", isMock);
                res.put("mockReason", reasons.isEmpty() ? "NONE" : String.join(";", reasons));
                res.put("detectedApps", detectedApps);
                res.put("satellitesVisible", satellitesVisible);
                res.put("satellitesUsed", satellitesUsedInFix);
                res.put("source", "NATIVE_ANDROID_LOCATION_MANAGER");
                call.resolve(res);
                return;
            }
        } catch (SecurityException e) {
            call.reject("Location permission not granted: " + e.getMessage());
            return;
        }

        // If no last known location, resolve with mock status
        JSObject res = new JSObject();
        res.put("isMock", isMock);
        res.put("mockReason", reasons.isEmpty() ? "NONE" : String.join(";", reasons));
        res.put("detectedApps", detectedApps);
        res.put("source", "NATIVE_MOCK_CHECK_ONLY");
        call.resolve(res);
    }

    @PluginMethod
    public void getConnectedWifi(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        try {
            WifiManager wm = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                WifiInfo info = wm.getConnectionInfo();
                if (info != null) {
                    String ssid = info.getSSID();
                    if (ssid != null && ssid.startsWith("\"") && ssid.endsWith("\"")) {
                        ssid = ssid.substring(1, ssid.length() - 1);
                    }
                    String bssid = info.getBSSID();
                    int rssi = info.getRssi();
                    boolean isConnected = bssid != null && !bssid.equals("02:00:00:00:00:00") && !"<unknown ssid>".equalsIgnoreCase(ssid);
                    ret.put("isConnected", isConnected);
                    ret.put("ssid", ssid);
                    ret.put("bssid", bssid);
                    ret.put("rssi", rssi);
                    call.resolve(ret);
                    return;
                }
            }
        } catch (Exception e) {
            ret.put("error", e.getMessage());
        }
        ret.put("isConnected", false);
        call.resolve(ret);
    }

    private static String intToLittleEndianIp(int ipInt) {
        if (ipInt == 0) return "";
        try {
            byte[] bytes = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(ipInt).array();
            return InetAddress.getByAddress(bytes).getHostAddress();
        } catch (Exception e) {
            return "";
        }
    }

    private static Network findWifiNetwork(Context context) {
        if (context == null) return null;
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return null;
            for (Network net : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    return net;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String normalizeOriginUrl(String rawUrl, int defaultPort) {
        if (rawUrl == null) return "";
        String clean = rawUrl.trim().replaceAll("/+$", "");
        if (clean.isEmpty()) return "";
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
            clean = "http://" + clean;
        }
        clean = clean.replaceAll("/api/v1$", "");
        try {
            URL parsed = new URL(clean);
            String host = parsed.getHost();
            int port = parsed.getPort();
            String proto = parsed.getProtocol();
            if (port == -1 && "http".equalsIgnoreCase(proto) && host != null && !host.isEmpty()) {
                return proto + "://" + host + ":" + defaultPort;
            }
            return proto + "://" + host + (port != -1 ? ":" + port : "");
        } catch (Exception e) {
            return clean;
        }
    }

    private static JSObject pingHostelHttp(Network wifiNetwork, String targetOrigin, int connectTimeoutMs, int readTimeoutMs) {
        String baseOrigin = normalizeOriginUrl(targetOrigin, 5000);
        if (baseOrigin.isEmpty()) return null;

        HttpURLConnection conn = null;
        try {
            URL pingUrl = new URL(baseOrigin + "/api/v1/ping-hostel");
            if (wifiNetwork != null && "http".equalsIgnoreCase(pingUrl.getProtocol())) {
                try {
                    conn = (HttpURLConnection) wifiNetwork.openConnection(pingUrl);
                } catch (Exception oemEx) {
                    conn = (HttpURLConnection) pingUrl.openConnection();
                }
            } else {
                conn = (HttpURLConnection) pingUrl.openConnection();
            }
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(connectTimeoutMs);
            conn.setReadTimeout(readTimeoutMs);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Cache-Control", "no-store");

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                String body = sb.toString().trim();
                if (body.startsWith("{")) {
                    JSONObject json = new JSONObject(body);
                    if ("ok".equals(json.optString("status")) || !json.optString("wardenIp", "").isEmpty()) {
                        String hostOnly = new URL(baseOrigin).getHost();
                        int port = new URL(baseOrigin).getPort();
                        if (port == -1) port = json.optInt("port", 5000);
                        JSObject hit = new JSObject();
                        hit.put("ok", true);
                        hit.put("baseOrigin", baseOrigin);
                        hit.put("fullApi", baseOrigin + "/api/v1");
                        hit.put("wardenIp", hostOnly != null && !hostOnly.isEmpty() ? hostOnly : json.optString("wardenIp", ""));
                        hit.put("port", port);
                        hit.put("hostname", json.optString("hostname", ""));
                        return hit;
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
        return null;
    }

    /**
     * Verifies a single Warden URL using native Wi-Fi-bound sockets with strict timeouts,
     * completely bypassing WebViewLocalServer proxy thread queues.
     */
    @PluginMethod
    public void verifyServerUrl(PluginCall call) {
        final String targetUrl = call.getString("url", "");
        final int timeoutMs = call.getInt("timeoutMs", 2000);

        new Thread(() -> {
            Network wifiNetwork = findWifiNetwork(getContext());
            JSObject hit = pingHostelHttp(wifiNetwork, targetUrl, timeoutMs, timeoutMs);
            if (hit == null && wifiNetwork != null) {
                // Retry once via default route (needed for public Cloud domains if Wi-Fi has no internet and cellular is used)
                hit = pingHostelHttp(null, targetUrl, timeoutMs, timeoutMs);
            }
            if (hit != null) {
                call.resolve(hit);
            } else {
                JSObject fail = new JSObject();
                fail.put("ok", false);
                fail.put("baseOrigin", normalizeOriginUrl(targetUrl, 5000));
                call.resolve(fail);
            }
        }).start();
    }

    /**
     * Offline Zero-Config Wi-Fi Warden Discovery:
     * 1. Binds explicitly to the Android Wi-Fi Network so cellular data never hijacks LAN probes.
     * 2. Reads CIDR subnet, gateway, and broadcast address via LinkProperties + WifiManager + NetworkInterface.
     * 3. Runs UDP discovery (port 45678) AND fast bounded native TCP+HTTP probing in parallel,
     *    completely outside WebView's proxy pool.
     */
    @PluginMethod
    public void discoverWardenServer(PluginCall call) {
        final int discoveryPort = call.getInt("udpPort", 45678);
        final int httpPort = call.getInt("httpPort", 5000);

        new Thread(() -> {
            Context context = getContext();
            Network wifiNetwork = findWifiNetwork(context);
            String deviceIp = "";
            String gatewayIp = "";
            String broadcastIp = "";
            String subnetPrefix = "";
            int prefixLength = 24;
            Set<String> broadcastTargets = new LinkedHashSet<>();
            Set<String> discoveredUrls = new LinkedHashSet<>();
            AtomicReference<JSObject> verifiedHit = new AtomicReference<>(null);

            WifiManager.MulticastLock multicastLock = null;
            ExecutorService probePool = Executors.newFixedThreadPool(36);
            try {
                ConnectivityManager cm = context != null
                    ? (ConnectivityManager) context.getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE)
                    : null;

                if (cm != null && wifiNetwork != null) {
                    LinkProperties lp = cm.getLinkProperties(wifiNetwork);
                    if (lp != null) {
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            InetAddress addr = la.getAddress();
                            if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                deviceIp = addr.getHostAddress();
                                prefixLength = la.getPrefixLength();
                                break;
                            }
                        }
                        for (RouteInfo route : lp.getRoutes()) {
                            if (route.isDefaultRoute() && route.getGateway() instanceof Inet4Address) {
                                String gw = route.getGateway().getHostAddress();
                                if (gw != null && !gw.isEmpty() && !gw.equals("0.0.0.0")) {
                                    gatewayIp = gw;
                                    break;
                                }
                            }
                        }
                    }
                }

                WifiManager wm = context != null
                    ? (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE)
                    : null;

                if (wm != null) {
                    DhcpInfo dhcp = wm.getDhcpInfo();
                    if (dhcp != null) {
                        String dhcpIp = intToLittleEndianIp(dhcp.ipAddress);
                        String dhcpGw = intToLittleEndianIp(dhcp.gateway);
                        if (deviceIp.isEmpty() && !dhcpIp.isEmpty() && !dhcpIp.equals("0.0.0.0")) deviceIp = dhcpIp;
                        if (gatewayIp.isEmpty() && !dhcpGw.isEmpty() && !dhcpGw.equals("0.0.0.0")) gatewayIp = dhcpGw;
                    }
                    try {
                        multicastLock = wm.createMulticastLock("attendra_lan_discovery");
                        multicastLock.setReferenceCounted(false);
                        multicastLock.acquire();
                    } catch (Exception ignored) {}
                }

                Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
                String fallbackPrivateIp = "";
                while (ifaces != null && ifaces.hasMoreElements()) {
                    NetworkInterface iface = ifaces.nextElement();
                    if (!iface.isUp() || iface.isLoopback()) continue;
                    String ifaceName = iface.getName() != null ? iface.getName().toLowerCase() : "";
                    if (ifaceName.contains("rmnet") || ifaceName.contains("ccmni") || ifaceName.contains("tun")) {
                        continue;
                    }
                    boolean isWifiLike = ifaceName.contains("wlan") || ifaceName.contains("wifi") || ifaceName.contains("ap");

                    for (InterfaceAddress ia : iface.getInterfaceAddresses()) {
                        InetAddress addr = ia.getAddress();
                        if (addr instanceof Inet4Address && addr.isSiteLocalAddress()) {
                            String hostIp = addr.getHostAddress();
                            String bcast = ia.getBroadcast() != null ? ia.getBroadcast().getHostAddress() : "";
                            if (isWifiLike) {
                                if (deviceIp.isEmpty()) deviceIp = hostIp;
                                if (ia.getNetworkPrefixLength() > 0 && ia.getNetworkPrefixLength() <= 30) {
                                    prefixLength = ia.getNetworkPrefixLength();
                                }
                                if (!bcast.isEmpty()) {
                                    broadcastIp = bcast;
                                    broadcastTargets.add(bcast);
                                }
                            } else if (fallbackPrivateIp.isEmpty()) {
                                fallbackPrivateIp = hostIp;
                                if (!bcast.isEmpty()) broadcastTargets.add(bcast);
                            }
                        }
                    }
                }
                if (deviceIp.isEmpty() && !fallbackPrivateIp.isEmpty()) {
                    deviceIp = fallbackPrivateIp;
                }

                String prefixSource = !deviceIp.isEmpty() ? deviceIp : gatewayIp;
                if (!prefixSource.isEmpty()) {
                    String[] parts = prefixSource.split("\\.");
                    if (parts.length == 4) {
                        subnetPrefix = parts[0] + "." + parts[1] + "." + parts[2];
                        broadcastTargets.add(subnetPrefix + ".255");
                    }
                }
                if (!gatewayIp.isEmpty()) broadcastTargets.add(gatewayIp);
                broadcastTargets.add("255.255.255.255");

                // 1. Async UDP Discovery thread (runs concurrently with fast native TCP+HTTP probing)
                final Network netForLambda = wifiNetwork;
                final String prefixForLambda = subnetPrefix;
                final Set<String> bcastSet = new LinkedHashSet<>(broadcastTargets);
                Thread udpThread = new Thread(() -> {
                    DatagramSocket socket = null;
                    try {
                        socket = new DatagramSocket();
                        if (netForLambda != null) {
                            try { netForLambda.bindSocket(socket); } catch (Exception ignored) {}
                        }
                        socket.setBroadcast(true);
                        socket.setSoTimeout(180);

                        byte[] probeBytes = "ATTENDRA_DISCOVER".getBytes(StandardCharsets.UTF_8);
                        for (String target : bcastSet) {
                            try {
                                InetAddress targetAddr = InetAddress.getByName(target);
                                socket.send(new DatagramPacket(probeBytes, probeBytes.length, targetAddr, discoveryPort));
                            } catch (Exception ignored) {}
                        }

                        long deadline = System.currentTimeMillis() + 600L;
                        byte[] recvBuf = new byte[2048];
                        while (System.currentTimeMillis() < deadline && verifiedHit.get() == null) {
                            try {
                                DatagramPacket packet = new DatagramPacket(recvBuf, recvBuf.length);
                                socket.receive(packet);
                                String body = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).trim();
                                if (!body.startsWith("{")) continue;

                                JSONObject json = new JSONObject(body);
                                int serverPort = json.optInt("port", httpPort);
                                String senderIp = packet.getAddress() != null ? packet.getAddress().getHostAddress() : "";

                                JSONArray ipsArr = json.optJSONArray("ips");
                                List<String> allIps = new ArrayList<>();
                                if (!senderIp.isEmpty()) allIps.add(senderIp);
                                String wardenIp = json.optString("wardenIp", "");
                                if (!wardenIp.isEmpty()) allIps.add(wardenIp);
                                if (ipsArr != null) {
                                    for (int i = 0; i < ipsArr.length(); i++) {
                                        String candidateIp = ipsArr.optString(i, "");
                                        if (!candidateIp.isEmpty()) allIps.add(candidateIp);
                                    }
                                }

                                List<String> orderedUrls = new ArrayList<>();
                                if (!prefixForLambda.isEmpty()) {
                                    for (String ip : allIps) {
                                        if (ip.startsWith(prefixForLambda + ".")) orderedUrls.add("http://" + ip + ":" + serverPort);
                                    }
                                }
                                for (String ip : allIps) {
                                    orderedUrls.add("http://" + ip + ":" + serverPort);
                                }

                                synchronized (discoveredUrls) {
                                    discoveredUrls.addAll(orderedUrls);
                                }
                                for (String candUrl : orderedUrls) {
                                    if (verifiedHit.get() != null) break;
                                    JSObject hit = pingHostelHttp(netForLambda, candUrl, 800, 900);
                                    if (hit != null) {
                                        verifiedHit.compareAndSet(null, hit);
                                        break;
                                    }
                                }
                            } catch (SocketTimeoutException ignored) {
                            } catch (Exception ignored) {}
                        }
                    } catch (Exception ignored) {
                    } finally {
                        if (socket != null) {
                            try { socket.close(); } catch (Exception ignored) {}
                        }
                    }
                });
                udpThread.start();

                // 2. Native Wi-Fi Socket Subnet Scanner (Wave 1: CIDR / high-probability, Wave 2: full /24)
                Set<String> wave1Ips = new LinkedHashSet<>();
                if (!gatewayIp.isEmpty()) wave1Ips.add(gatewayIp);

                int deviceLast = -1;
                if (!deviceIp.isEmpty()) {
                    String[] p = deviceIp.split("\\.");
                    if (p.length == 4) {
                        try { deviceLast = Integer.parseInt(p[3]); } catch (Exception ignored) {}
                    }
                }

                // Exact narrow CIDR block (e.g. iPhone hotspot /28 gives only 14 host IPs!)
                if (!subnetPrefix.isEmpty() && prefixLength >= 25 && prefixLength <= 30 && deviceLast >= 0) {
                    int blockSize = 1 << (32 - prefixLength);
                    int networkStart = (deviceLast / blockSize) * blockSize;
                    for (int h = networkStart + 1; h < networkStart + blockSize - 1; h++) {
                        if (h > 0 && h < 255 && h != deviceLast) {
                            wave1Ips.add(subnetPrefix + "." + h);
                        }
                    }
                }

                if (!subnetPrefix.isEmpty()) {
                    if (deviceLast > 0) {
                        for (int d = Math.max(1, deviceLast - 10); d <= Math.min(254, deviceLast + 10); d++) {
                            if (d != deviceLast) wave1Ips.add(subnetPrefix + "." + d);
                        }
                    }
                    int[] priorityOctets = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25, 50, 100, 101, 102, 103, 105, 110, 150, 200, 250, 254};
                    for (int oct : priorityOctets) {
                        if (oct != deviceLast) wave1Ips.add(subnetPrefix + "." + oct);
                    }
                }

                for (int i = 1; i <= 14; i++) wave1Ips.add("172.20.10." + i);
                for (int i = 1; i <= 5; i++) wave1Ips.add("192.168.137." + i);
                for (int i = 1; i <= 5; i++) wave1Ips.add("192.168.43." + i);
                int[] commonRouterOctets = {1, 2, 3, 4, 5, 10, 100, 101, 102, 105};
                for (int oct : commonRouterOctets) {
                    wave1Ips.add("192.168.1." + oct);
                    wave1Ips.add("192.168.0." + oct);
                    wave1Ips.add("192.168.29." + oct);
                    wave1Ips.add("10.0.0." + oct);
                }

                // Helper lambda to run bounded TCP-connect + HTTP-verify scan over an IP batch
                probeIpsBatch(probePool, wifiNetwork, wave1Ips, httpPort, 340, verifiedHit);

                // Wave 2: scan any remaining .1..254 IPs on detected /24 Wi-Fi subnet if Wave 1 + UDP missed
                if (verifiedHit.get() == null && !subnetPrefix.isEmpty()) {
                    Set<String> wave2Ips = new LinkedHashSet<>();
                    for (int h = 1; h <= 254; h++) {
                        if (h == deviceLast) continue;
                        String cand = subnetPrefix + "." + h;
                        if (!wave1Ips.contains(cand)) wave2Ips.add(cand);
                    }
                    if (!wave2Ips.isEmpty()) {
                        probeIpsBatch(probePool, wifiNetwork, wave2Ips, httpPort, 320, verifiedHit);
                    }
                }

                try { udpThread.join(150); } catch (InterruptedException ignored) {}
            } catch (Exception ignored) {
            } finally {
                probePool.shutdownNow();
                if (multicastLock != null && multicastLock.isHeld()) {
                    try { multicastLock.release(); } catch (Exception ignored) {}
                }
            }

            JSObject winner = verifiedHit.get();
            if (winner != null) {
                String base = winner.getString("baseOrigin");
                if (base != null && !base.isEmpty()) {
                    synchronized (discoveredUrls) {
                        Set<String> reordered = new LinkedHashSet<>();
                        reordered.add(base);
                        reordered.addAll(discoveredUrls);
                        discoveredUrls.clear();
                        discoveredUrls.addAll(reordered);
                    }
                }
            }

            JSArray urlsJson = new JSArray();
            for (String u : discoveredUrls) {
                urlsJson.put(u);
            }

            JSObject result = new JSObject();
            result.put("deviceIp", deviceIp);
            result.put("prefixLength", prefixLength);
            result.put("subnetPrefix", subnetPrefix);
            result.put("gatewayIp", gatewayIp);
            result.put("broadcastIp", broadcastIp);
            result.put("wifiConnected", wifiNetwork != null || !deviceIp.isEmpty());
            result.put("discoveredUrls", urlsJson);
            if (winner != null) {
                result.put("verifiedServer", winner);
            }
            call.resolve(result);
        }).start();
    }

    private static void probeIpsBatch(
        ExecutorService pool,
        Network wifiNetwork,
        Set<String> ipList,
        int port,
        int tcpTimeoutMs,
        AtomicReference<JSObject> verifiedHit
    ) {
        if (ipList == null || ipList.isEmpty() || verifiedHit.get() != null) return;
        List<Future<Void>> futures = new ArrayList<>(ipList.size());
        for (final String ip : ipList) {
            futures.add(pool.submit((Callable<Void>) () -> {
                if (verifiedHit.get() != null) return null;
                boolean portOpen = false;
                Socket sock = null;
                try {
                    if (wifiNetwork != null) {
                        try {
                            sock = wifiNetwork.getSocketFactory().createSocket();
                        } catch (Exception oemEx) {
                            sock = new Socket();
                        }
                    } else {
                        sock = new Socket();
                    }
                    sock.connect(new InetSocketAddress(ip, port), tcpTimeoutMs);
                    portOpen = true;
                } catch (Exception ignored) {
                } finally {
                    if (sock != null) {
                        try { sock.close(); } catch (Exception ignored) {}
                    }
                }

                if (portOpen && verifiedHit.get() == null) {
                    JSObject hit = pingHostelHttp(wifiNetwork, "http://" + ip + ":" + port, 900, 1000);
                    if (hit != null) {
                        verifiedHit.compareAndSet(null, hit);
                    }
                }
                return null;
            }));
        }

        long waitDeadline = System.currentTimeMillis() + 2600L;
        for (Future<Void> f : futures) {
            if (verifiedHit.get() != null) {
                f.cancel(true);
                continue;
            }
            long rem = Math.max(40L, waitDeadline - System.currentTimeMillis());
            try {
                f.get(rem, java.util.concurrent.TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                f.cancel(true);
            }
        }
    }
}

