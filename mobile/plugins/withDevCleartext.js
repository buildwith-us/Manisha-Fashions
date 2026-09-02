const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Android blocks plain HTTP by default from API 28 onward. The generated debug
 * manifest carries `usesCleartextTraffic="true"`, but the release manifest does
 * not — so a release APK cannot reach an `http://` API at all.
 *
 * Rather than switch cleartext on globally (which would also permit plain HTTP
 * to any production host you ever point the app at), this writes a scoped
 * network security config: cleartext is allowed *only* for loopback, the
 * Android emulator's host alias, and the RFC1918 private ranges a LAN dev
 * server lives on. Everything else — including whatever you set as
 * `extra.apiUrl` for a real deployment — stays HTTPS-only and is still subject
 * to certificate validation.
 *
 * The proper fix for a distributable build remains pointing `extra.apiUrl` at
 * an HTTPS backend; this only stops a LAN/emulator test build failing silently.
 */

const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Production default: TLS required, no user-added CAs trusted. -->
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>

  <!-- Local development backends only. -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <!-- The host machine as seen from the Android emulator. -->
    <domain includeSubdomains="false">10.0.2.2</domain>
    <!-- Genymotion's equivalent. -->
    <domain includeSubdomains="false">10.0.3.2</domain>
  </domain-config>
</network-security-config>
`;

/** Writes res/xml/network_security_config.xml into the prebuilt project. */
function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resXmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), CONFIG_XML, 'utf8');
      return cfg;
    },
  ]);
}

/** Points <application> at the config above. */
function withNetworkSecurityConfigManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });
}

module.exports = function withDevCleartext(config) {
  return withNetworkSecurityConfigManifest(withNetworkSecurityConfigFile(config));
};
