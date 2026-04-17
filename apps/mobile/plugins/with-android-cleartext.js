// with-android-cleartext.js
//
// Enables cleartext (HTTP) traffic on Android. Jellyfin servers are
// user-supplied LAN hosts like http://192.168.1.20:8096, and API 28+
// blocks cleartext by default. Expo's `android.usesCleartextTraffic`
// shortcut was removed from the config schema in SDK 52+, so we wire
// it ourselves by:
//
//   1. Setting `android:usesCleartextTraffic="true"` on <application>
//      in AndroidManifest.xml.
//   2. Writing a permissive `res/xml/network_security_config.xml` and
//      referencing it from the manifest. Belt and braces — some OEM
//      ROMs ignore the attribute if no config is declared.

const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const withCleartextManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$ = {
      ...app.$,
      "android:usesCleartextTraffic": "true",
      "android:networkSecurityConfig": "@xml/network_security_config",
    };
    return cfg;
  });

const withNetworkSecurityConfig = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        NETWORK_SECURITY_CONFIG_XML,
      );
      return cfg;
    },
  ]);

module.exports = (config) => withNetworkSecurityConfig(withCleartextManifest(config));
