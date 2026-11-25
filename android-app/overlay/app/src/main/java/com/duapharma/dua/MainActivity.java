package com.duapharma.dua;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugin must be registered before the bridge starts. Push notifications are registered by Capacitor itself.
        registerPlugin(DuaDevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
