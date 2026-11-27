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
 * whose phone it is, whether the geofence was registered, a short journal of what the geofence detected, and - only when the owner has
 * switched automatic recording on - this phone's attendance secret (it can do one thing: report an arrival or a departure) and the
 * events waiting to be sent. It holds no password. Signing out of Dua wipes all of it. If encrypted storage is not available on a phone, nothing is stored and automatic
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

    /**
     * Replaces the places, the period and the switch; keeps the journal, the queue and (when no new one is given) the secret.
     * deviceId, endpoint and secret may be null while automatic recording is off.
     */
    boolean save(String userId, JSONArray sites, int stableSeconds, boolean auto, int maxAccuracy, String deviceId, String endpoint, String secret) {
        if (prefs == null) return false;
        SharedPreferences.Editor e = prefs
            .edit()
            .putString("user_id", userId)
            .putString("sites", sites.toString())
            .putInt("stable_seconds", stableSeconds)
            .putBoolean("auto", auto)
            .putInt("max_accuracy", maxAccuracy);
        if (deviceId != null) e.putString("device_id", deviceId);
        if (endpoint != null) e.putString("endpoint", endpoint);
        if (secret != null) e.putString("secret", secret);
        e.apply();
        return true;
    }

    /** The owner's switch, as the server last told this phone. Off = test mode: detections are only listed. */
    boolean autoOn() {
        return prefs != null && prefs.getBoolean("auto", false);
    }

    int maxAccuracy() {
        return prefs == null ? 100 : prefs.getInt("max_accuracy", 100);
    }

    String deviceId() {
        return prefs == null ? null : prefs.getString("device_id", null);
    }

    String endpoint() {
        return prefs == null ? null : prefs.getString("endpoint", null);
    }

    String secret() {
        return prefs == null ? null : prefs.getString("secret", null);
    }

    boolean hasKey() {
        return secret() != null && deviceId() != null && endpoint() != null;
    }

    /** The server said this phone's secret is no longer good: forget it so the app asks for a new one the next time it is opened. */
    void clearKey() {
        if (prefs != null) prefs.edit().remove("secret").apply();
    }

    JSONObject siteById(String id) {
        JSONArray all = sites();
        for (int i = 0; i < all.length(); i++) {
            JSONObject site = all.optJSONObject(i);
            if (site != null && id != null && id.equals(site.optString("id"))) return site;
        }
        return null;
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

    // ───── events waiting to be sent (oldest first) ─────

    int queueSize() {
        return queue().length();
    }

    JSONArray queue() {
        if (prefs == null) return new JSONArray();
        try {
            return new JSONArray(prefs.getString("queue", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    void queueAdd(JSONObject event) {
        if (prefs == null) return;
        synchronized (LOCK) {
            JSONArray old = queue();
            JSONArray next = new JSONArray();
            int from = Math.max(0, old.length() + 1 - AttendanceLogic.QUEUE_MAX);
            for (int i = from; i < old.length(); i++) next.put(old.opt(i));
            next.put(event);
            prefs.edit().putString("queue", next.toString()).apply();
        }
    }

    /** The oldest waiting event, or null. */
    JSONObject queueHead() {
        return queue().optJSONObject(0);
    }

    void queueRemoveHead() {
        if (prefs == null) return;
        synchronized (LOCK) {
            JSONArray old = queue();
            JSONArray next = new JSONArray();
            for (int i = 1; i < old.length(); i++) next.put(old.opt(i));
            prefs.edit().putString("queue", next.toString()).apply();
        }
    }

    // ───── journal: the last detections, newest first ─────

    /** What happened to an event: recorded, refused, ignored, cancelled, queued, dropped ... (type), for kind in/out, with the reason if any. */
    void addJournalResult(String type, String kind, String reason, long at) {
        if (prefs == null) return;
        synchronized (LOCK) {
            try {
                JSONObject entry = new JSONObject().put("type", type).put("at", at);
                if (kind != null) entry.put("kind", kind);
                if (reason != null) entry.put("reason", reason);
                JSONArray old = journal();
                JSONArray next = new JSONArray().put(entry);
                for (int i = 0; i < old.length() && next.length() < AttendanceLogic.JOURNAL_MAX; i++) next.put(old.get(i));
                prefs.edit().putString("journal", next.toString()).apply();
            } catch (JSONException ignored) {
                // a lost journal line is not worth failing for
            }
        }
    }

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
