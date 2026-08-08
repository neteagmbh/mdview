import assert from "node:assert/strict";
import test from "node:test";
import {
  requireMacOsNotarizationCredentials,
  requireMacOsSigningIdentity,
  runMacOsBuild,
} from "./build-macos.mjs";

/** Verifies signed macOS builds cannot accidentally run on another host OS. */
test("rejects non-macOS hosts", () => {
  assert.throws(
    () => requireMacOsSigningIdentity("linux", {}),
    /must run on macOS/,
  );
});

/** Verifies the build fails early instead of silently producing an unsigned bundle. */
test("requires an Apple signing identity", () => {
  assert.throws(
    () => requireMacOsSigningIdentity("darwin", {}),
    /APPLE_SIGNING_IDENTITY is required/,
  );
});

/** Verifies the identity is normalized before Tauri uses the signing environment. */
test("accepts and trims an Apple signing identity", () => {
  assert.equal(
    requireMacOsSigningIdentity("darwin", {
      APPLE_SIGNING_IDENTITY: "  Developer ID Application: Example  ",
    }),
    "Developer ID Application: Example",
  );
});

/** Verifies App Store Connect API credentials enable notarization. */
test("accepts App Store Connect API notarization credentials", () => {
  assert.equal(
    requireMacOsNotarizationCredentials({
      APPLE_API_ISSUER: "issuer",
      APPLE_API_KEY: "key-id",
      APPLE_API_KEY_PATH: "/secure/AuthKey.p8",
    }),
    "App Store Connect API",
  );
});

/** Verifies Apple ID credentials provide the supported notarization alternative. */
test("accepts Apple ID notarization credentials", () => {
  assert.equal(
    requireMacOsNotarizationCredentials({
      APPLE_ID: "developer@example.com",
      APPLE_PASSWORD: "app-specific-password",
      APPLE_TEAM_ID: "TEAMID",
    }),
    "Apple ID",
  );
});

/** Verifies incomplete credentials cannot silently produce an unnotarized installer. */
test("rejects incomplete notarization credentials", () => {
  assert.throws(
    () =>
      requireMacOsNotarizationCredentials({
        APPLE_ID: "developer@example.com",
      }),
    /Complete Apple notarization credentials are required/,
  );
});

/** Verifies the procedure builds both the notarized application and disk image. */
test("runs the signed and notarized Tauri app and DMG build", () => {
  const environment = {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
    APPLE_API_ISSUER: "issuer",
    APPLE_API_KEY: "key-id",
    APPLE_API_KEY_PATH: "/secure/AuthKey.p8",
  };
  const calls = [];
  const status = runMacOsBuild({
    platform: "darwin",
    environment,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    {
      command: "npm",
      args: ["run", "tauri", "build", "--", "--bundles", "app,dmg"],
      options: {
        env: environment,
        stdio: "inherit",
      },
    },
  ]);
});
