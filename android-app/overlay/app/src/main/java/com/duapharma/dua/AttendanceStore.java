package com.duapharma.dua;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What this phone keeps for automatic attendance, in encrypted storage (Android Keystore): the places to watch, the stability period,
 * whose phone it is, whether the geofence was registered, and a short journal of what the geofence detected. It holds no password and no
 * secret. Signing out of Dua wipes all of it. If encrypted storage is not available on a phone, nothing is stored and automatic
 * attendance reports itself as unavailable instead of falling back to plain text.
 */
final class AttendanceStore {

    private static final Object LOCK = new Object();
    private final SharedPreferences prefs;

    AttendanceStore(Context context) {
        SharedPreferences opened = null;
        try {
            MasterKey key = new MasterKey.Builder(context.getApplicationContext()).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            opened = EncryptedSharedPreferences.create(
                context.getApplicationContext(),
                "dua_attendance",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            // leave null: not available
        }
        prefs = opened;
    }

    boolean available() {
        return prefs != null;
    }

    boolean enrolled() {
        return prefs != null && prefs.getString("user_id", null) != null;
    }

    String userId() {
        return prefs == null ? null : prefs.getString("user_id", null);
    }

    /** Replaces the places and the period; keeps the journal. */
    boolean save(String userId, JSONArray sites, int stableSeconds) {
        if (prefs == null) return false;
        prefs.edit().putString("user_id", userId).putString("sites", sites.toString()).putInt("stable_seconds", stableSeconds).apply();
        return true;
    }

    JSONArray sites() {
        if (prefs == null) return new JSONArray();
        try {
            return new JSONArray(prefs.getString("sites", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    int stableSeconds() {
        return prefs == null ? 120 : prefs.getInt("stable_seconds", 120);
    }

    /** Sign-out, or the person no longer has the right: forget everything. */
    void clear() {
        if (prefs != null) prefs.edit().clear().apply();
    }

    // ───── registration state ─────

    void setRegistered(boolean ok, String error) {
        if (prefs == null) return;
        SharedPreferences.Editor e = prefs.edit().putBoolean("registered", ok).putString("last_error", error);
        if (ok) e.putLong("registered_at", System.currentTimeMillis());
        e.apply();
    }

    boolean registered() {
        return prefs != null && prefs.getBoolean("registered", false);
    }

    long registeredAt() {
        return prefs == null ? 0 : prefs.getLong("registered_at", 0);
    }

    String lastError() {
        return prefs == null ? null : prefs.getString("last_error", null);
    }

    /** What the last check found wrong (see AttendanceLogic.problem), so the person is told once per change and not every 15 minutes. */
    String lastProblem() {
        return prefs == null ? null : prefs.getString("last_problem", null);
    }

    void setLastProblem(String problem) {
        if (prefs != null) prefs.edit().putString("last_problem", problem).putLong("last_check_at", System.currentTimeMillis()).apply();
    }

    long lastCheckAt() {
        return prefs == null ? 0 : prefs.getLong("last_check_at", 0);
    }

    // ───── journal: the last detections, newest first ─────

    void addJournal(String type, long at, double lat, double lng, float accuracy, String siteId) {
        if (prefs == null) return;
        synchronized (LOCK) {
            try {
                JSONObject entry = new JSONObject().put("type", type).put("at", at);
                if (!Double.isNaN(lat) && !Double.isNaN(lng)) entry.put("lat", lat).put("lng", lng).put("accuracy", accuracy);
                if (siteId != null) entry.put("site", siteId);
                JSONArray old = journal();
                JSONArray next = new JSONArray().put(entry);
                for (int i = 0; i < old.length() && next.length() < AttendanceLogic.JOURNAL_MAX; i++) next.put(old.get(i));
                prefs.edit().putString("journal", next.toString()).apply();
            } catch (JSONException ignored) {
                // a lost journal line is not worth failing for
            }
        }
    }

    JSONArray journal() {
        if (prefs == null) return new JSONArray();
        try {
            return new JSONArray(prefs.getString("journal", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
