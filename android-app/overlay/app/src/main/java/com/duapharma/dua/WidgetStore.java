package com.duapharma.dua;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * Everything the Today's Sale widget keeps on the phone, in encrypted storage (Android Keystore).
 * It holds this install's widget secret (see supabase/migrations/1401_app_devices.sql) and the last figure shown, so the widget is not
 * blank when the phone is offline. Signing out of Dua, or the server saying 401, wipes it. If encrypted storage is not available on a
 * phone, nothing is stored and the widget simply asks the person to sign in: the secret is never written in plain text.
 */
final class WidgetStore {

    static final String OK = "ok";
    static final String OFFLINE = "offline";
    static final String SIGNED_OUT = "signed_out";

    private final SharedPreferences prefs;

    WidgetStore(Context context) {
        SharedPreferences opened = null;
        try {
            MasterKey key = new MasterKey.Builder(context.getApplicationContext()).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            opened = EncryptedSharedPreferences.create(
                context.getApplicationContext(),
                "dua_widget",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            // leave null: not configured
        }
        prefs = opened;
    }

    boolean isConfigured() {
        return prefs != null && prefs.getString("secret", null) != null;
    }

    String userId() {
        return prefs == null ? null : prefs.getString("user_id", null);
    }

    String deviceId() {
        return prefs == null ? null : prefs.getString("device_id", null);
    }

    String secret() {
        return prefs == null ? null : prefs.getString("secret", null);
    }

    String endpoint() {
        return prefs == null ? null : prefs.getString("endpoint", null);
    }

    boolean save(String userId, String deviceId, String secret, String endpoint) {
        if (prefs == null) return false;
        prefs.edit().clear().putString("user_id", userId).putString("device_id", deviceId).putString("secret", secret).putString("endpoint", endpoint).putString("status", OK).apply();
        return true;
    }

    /** Sign-out or revoked permission: remove the secret and the last figure. */
    void clear() {
        if (prefs != null) prefs.edit().clear().apply();
    }

    void saveResult(double total, String saleDay, String asOf, String breakdownJson) {
        if (prefs == null) return;
        prefs.edit().putString("total", Double.toString(total)).putString("sale_day", saleDay).putString("as_of", asOf).putString("breakdown", breakdownJson).putString("status", OK).apply();
    }

    /** The server answered but there is no figure today yet. */
    void saveNoFigure(String saleDay) {
        if (prefs == null) return;
        prefs.edit().remove("total").remove("breakdown").remove("as_of").putString("sale_day", saleDay).putString("status", OK).apply();
    }

    void markOffline() {
        if (prefs != null) prefs.edit().putString("status", OFFLINE).apply();
    }

    /** The server refused the secret (person signed out elsewhere, disabled, or lost the permission): stop asking and wipe the figure. */
    void markSignedOut() {
        if (prefs != null) prefs.edit().clear().putString("status", SIGNED_OUT).apply();
    }

    String status() {
        return prefs == null ? SIGNED_OUT : prefs.getString("status", SIGNED_OUT);
    }

    String total() {
        return prefs == null ? null : prefs.getString("total", null);
    }

    String saleDay() {
        return prefs == null ? null : prefs.getString("sale_day", null);
    }

    String asOf() {
        return prefs == null ? null : prefs.getString("as_of", null);
    }

    String breakdown() {
        return prefs == null ? null : prefs.getString("breakdown", null);
    }
}
