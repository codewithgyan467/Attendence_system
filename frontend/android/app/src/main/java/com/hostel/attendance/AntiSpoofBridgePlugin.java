package com.hostel.attendance;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

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

    @PluginMethod
    public void checkMockStatus(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        boolean isMock = false;
        List<String> reasons = new ArrayList<>();
        JSArray detectedApps = new JSArray();

        // 1. Check if known fake GPS packages are installed
        PackageManager pm = context.getPackageManager();
        for (String pkg : KNOWN_MOCK_PACKAGES) {
            try {
                pm.getPackageInfo(pkg, 0);
                detectedApps.put(pkg);
                isMock = true;
                reasons.add("KNOWN_SPOOFER_INSTALLED:" + pkg);
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

        // 4. Developer Settings Mock Location (Legacy fallback)
        try {
            String allowMock = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ALLOW_MOCK_LOCATION);
            if (allowMock != null && !allowMock.equals("0")) {
                isMock = true;
                reasons.add("SECURE_SETTINGS_ALLOW_MOCK_LOCATION");
            }
        } catch (Exception ignored) {}

        ret.put("isMock", isMock);
        ret.put("mockDetected", isMock);
        ret.put("mockReason", reasons.isEmpty() ? "NONE" : String.join(";", reasons));
        ret.put("detectedApps", detectedApps);
        ret.put("satellitesVisible", satellitesVisible);
        ret.put("satellitesUsed", satellitesUsedInFix);
        ret.put("isNativeBridge", true);
        call.resolve(ret);
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
}

