import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Selects an available iPad on iOS 27, optionally by exact name or UDID. */
export function selectIpadSimulator({ devices }, requested = "") {
  const candidates = Object.entries(devices)
    .filter(([runtime]) => /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-27-\d+$/.test(runtime))
    .sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))
    .flatMap(([, entries]) => entries.filter((device) =>
      device.isAvailable && (device.deviceTypeIdentifier ?? device.name).includes("iPad"),
    ));
  const device = requested
    ? candidates.find((candidate) => candidate.udid === requested || candidate.name === requested)
    : candidates.find((candidate) => candidate.state === "Booted") ?? candidates[0];
  if (!device) {
    throw new Error(
      requested
        ? `No available iOS 27 iPad matches "${requested}". Check: xcrun simctl list devices available`
        : "No available iOS 27 iPad simulator. Install the iOS 27 runtime in Xcode Settings > Components and create an iPad in Device Hub.",
    );
  }
  return device;
}

/** Builds the bundled frontend and unsigned simulator app, then installs and launches it. */
export function runIpadSimulator({
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
  spawn = spawnSync,
  exists = existsSync,
} = {}) {
  if (platform !== "darwin") {
    throw new Error("The iPad simulator requires macOS and Xcode.");
  }
  if (!["arm64", "x64"].includes(architecture)) {
    throw new Error(`Unsupported simulator host architecture: ${architecture}`);
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const project = join(root, "src-tauri/gen/apple/mdview.xcodeproj");
  if (!exists(project)) {
    throw new Error("The iOS project is missing. Run: npm run tauri -- ios init");
  }

  /** Runs one command and stops the workflow immediately on failure. */
  function run(command, args, capture = false) {
    const result = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status ?? "unknown status"}).`);
    }
    return result.stdout;
  }

  const device = selectIpadSimulator(
    JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "--json"], true)),
    environment.IPAD_SIMULATOR?.trim(),
  );
  const target = architecture === "arm64" ? "aarch64-sim" : "x86_64";
  const app = join(root, "src-tauri/gen/apple/build", architecture === "arm64" ? "arm64-sim" : "x86_64", "mdview.app");
  const developer = environment.DEVELOPER_DIR?.trim()
    || run("xcode-select", ["--print-path"], true).trim();
  const developerDirectory = developer.endsWith(".app")
    ? join(developer, "Contents/Developer") : developer;
  const simulator = join(developerDirectory, "Applications/Simulator.app");
  const deviceHub = join(developerDirectory, "../Applications/DeviceHub.app");
  if (!exists(simulator) && !exists(deviceHub)) {
    throw new Error("The selected Xcode installation has no Simulator or Device Hub app.");
  }
  console.log(`Building mdview for ${device.name} on iOS 27 (${device.udid}).`);
  run("npm", ["run", "tauri", "--", "ios", "build", "--debug", "--target", target, "--no-sign", "--ci"]);
  if (!exists(app)) {
    throw new Error(`The simulator build did not produce ${app}.`);
  }
  run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
  if (exists(simulator)) {
    run("open", ["-a", simulator, "--args", "-CurrentDeviceUDID", device.udid]);
  } else {
    run("open", ["-a", deviceHub]);
    run("open", [`devices://device/open?id=${encodeURIComponent(device.udid)}`]);
  }
  run("xcrun", ["simctl", "install", device.udid, app]);
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  run("xcrun", ["simctl", "launch", "--terminate-running-process", device.udid, config.identifier]);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runIpadSimulator();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
