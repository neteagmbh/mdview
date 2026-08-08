import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Validates the host and returns the Apple identity used by Tauri code signing. */
export function requireMacOsSigningIdentity(platform, environment) {
  if (platform !== "darwin") {
    throw new Error("The signed macOS build must run on macOS.");
  }

  const identity = environment.APPLE_SIGNING_IDENTITY?.trim();
  if (!identity) {
    throw new Error(
      "APPLE_SIGNING_IDENTITY is required. List identities with: security find-identity -v -p codesigning",
    );
  }

  return identity;
}

/** Validates and identifies the configured Apple notarization authentication method. */
export function requireMacOsNotarizationCredentials(environment) {
  const methods = [
    {
      name: "App Store Connect API",
      variables: ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"],
    },
    {
      name: "Apple ID",
      variables: ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
    },
  ];

  for (const method of methods) {
    if (method.variables.every((variable) => environment[variable]?.trim())) {
      return method.name;
    }
  }

  const requirements = methods
    .map((method) => `${method.name}: ${method.variables.join(", ")}`)
    .join("; or ");
  throw new Error(`Complete Apple notarization credentials are required. Provide ${requirements}.`);
}

/** Runs Tauri's signed, notarized, and stapled macOS app and DMG build. */
export function runMacOsBuild({
  platform = process.platform,
  environment = process.env,
  spawn = spawnSync,
} = {}) {
  requireMacOsSigningIdentity(platform, environment);
  requireMacOsNotarizationCredentials(environment);
  const result = spawn(
    "npm",
    ["run", "tauri", "build", "--", "--bundles", "app,dmg"],
    {
      env: environment,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runMacOsBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
