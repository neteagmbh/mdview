import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { runIpadSimulator, selectIpadSimulator } from "./run-ipad.mjs";

/** Creates simulator inventory fixtures with configurable availability and runtime. */
function inventory(entries = [{ name: "iPad Pro", udid: "ipad-27", isAvailable: true }], version = "27-0") {
  return { devices: { [`com.apple.CoreSimulator.SimRuntime.iOS-${version}`]: entries } };
}

/** Captures workflow commands while replacing external tools with controlled results. */
function harness(overrides = {}) {
  const calls = [];
  const options = {
    platform: "darwin",
    architecture: "arm64",
    environment: {},
    exists: () => true,
    spawn(command, args, settings) {
      calls.push({ command, args, settings });
      return {
        status: 0,
        stdout: command === "xcode-select"
          ? "/Applications/Xcode Beta.app/Contents/Developer\n"
          : JSON.stringify(inventory()),
      };
    },
    ...overrides,
  };
  return { calls, options };
}

/** Prevents fallback to iPhones, unavailable iPads, and older iOS runtimes. */
test("requires an available iOS 27 iPad", () => {
  for (const devices of [inventory([], "27-0"), inventory(undefined, "26-5"), inventory([
    { name: "iPhone", isAvailable: true },
    { name: "iPad", isAvailable: false },
  ])]) {
    assert.throws(() => selectIpadSimulator(devices), /No available iOS 27 iPad/);
  }
});

/** Selects booted devices by default and honors explicit names and UDIDs. */
test("selects booted iPads and accepts exact overrides", () => {
  const devices = inventory([
    { name: "iPad Pro", udid: "pro", isAvailable: true },
    { name: "iPad mini", udid: "mini", isAvailable: true, state: "Booted" },
  ]);
  assert.equal(selectIpadSimulator(devices).udid, "mini");
  assert.equal(selectIpadSimulator(devices, "iPad Pro").udid, "pro");
  assert.equal(selectIpadSimulator(devices, "pro").udid, "pro");
  assert.throws(() => selectIpadSimulator(devices, "unknown"), /matches "unknown"/);
});

/** Uses numeric runtime ordering when multiple iOS 27 minor versions exist. */
test("prefers the newest iOS 27 runtime when no iPad is booted", () => {
  const devices = { devices: {
    ...inventory([{ name: "iPad", udid: "old", isAvailable: true }], "27-2").devices,
    ...inventory([{ name: "iPad", udid: "new", isAvailable: true }], "27-10").devices,
  } };
  assert.equal(selectIpadSimulator(devices).udid, "new");
});

/** Rejects unsupported hosts and missing projects before invoking external commands. */
test("validates host and iOS project", () => {
  assert.throws(() => runIpadSimulator(harness({ platform: "linux" }).options), /requires macOS/);
  assert.throws(() => runIpadSimulator(harness({ architecture: "riscv64" }).options), /Unsupported/);
  assert.throws(() => runIpadSimulator(harness({ exists: () => false }).options), /ios init/);
});

/** Verifies build, boot, installation and relaunch use the same explicitly selected device. */
test("builds and launches the app for Apple Silicon and Intel simulators", () => {
  for (const [architecture, target, folder] of [["arm64", "aarch64-sim", "arm64-sim"], ["x64", "x86_64", "x86_64"]]) {
    const { calls, options } = harness({ architecture, environment: { IPAD_SIMULATOR: " ipad-27 " } });
    assert.equal(runIpadSimulator(options), 0);
    assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
      ["xcrun", "simctl", "list", "devices", "available", "--json"],
      ["xcode-select", "--print-path"],
      ["npm", "run", "tauri", "--", "ios", "build", "--debug", "--target", target, "--no-sign", "--ci"],
      ["xcrun", "simctl", "bootstatus", "ipad-27", "-b"],
      ["open", "-a", join("/Applications/Xcode Beta.app/Contents/Developer", "Applications/Simulator.app"), "--args", "-CurrentDeviceUDID", "ipad-27"],
      ["xcrun", "simctl", "install", "ipad-27", join(calls[0].settings.cwd, "src-tauri/gen/apple/build", folder, "mdview.app")],
      ["xcrun", "simctl", "launch", "--terminate-running-process", "ipad-27", "tools.netea.mdview"],
    ]);
    assert.ok(calls.every(({ settings }) => settings.env === options.environment));
  }
});

/** Ensures a failed build never installs stale output or boots a simulator. */
test("stops after command failures and missing build output", () => {
  const { calls, options } = harness();
  const success = options.spawn;
  options.spawn = (command, args, settings) => command === "npm"
    ? (calls.push({ command, args, settings }), { status: 65 })
    : success(command, args, settings);
  assert.throws(() => runIpadSimulator(options), /failed \(65\)/);
  assert.equal(calls.length, 3);
  assert.throws(() => runIpadSimulator(harness({
    exists: (path) => !path.endsWith("mdview.app"),
  }).options), /did not produce/);
  assert.throws(() => runIpadSimulator(harness({
    spawn: () => ({ error: new Error("missing xcrun") }),
  }).options), /missing xcrun/);
});

/** Uses Device Hub's device URL when Xcode 27 no longer ships Simulator.app. */
test("opens the selected iPad in Xcode 27 Device Hub", () => {
  const { calls, options } = harness({ exists: (path) => !path.endsWith("Simulator.app") });
  runIpadSimulator(options);
  assert.deepEqual(calls.filter(({ command }) => command === "open").map(({ args }) => args), [
    ["-a", join("/Applications/Xcode Beta.app/Contents/Developer", "../Applications/DeviceHub.app")],
    ["devices://device/open?id=ipad-27"],
  ]);
});

/** Rejects incomplete Xcode installations before starting an expensive build. */
test("requires an installed simulator UI", () => {
  const { calls, options } = harness({ exists: (path) => path.endsWith(".xcodeproj") });
  assert.throws(() => runIpadSimulator(options), /no Simulator or Device Hub/);
  assert.ok(calls.every(({ command }) => command !== "npm"));
});

/** Honors Xcode overrides supplied as either an app bundle or developer directory. */
test("opens Simulator from the selected DEVELOPER_DIR", () => {
  for (const developer of ["/Applications/Custom Xcode.app", "/Applications/Custom Xcode.app/Contents/Developer"]) {
    const { calls, options } = harness({ environment: { DEVELOPER_DIR: developer } });
    runIpadSimulator(options);
    assert.ok(calls.every(({ command }) => command !== "xcode-select"));
    assert.equal(calls.find(({ command }) => command === "open").args[1],
      join(developer.endsWith(".app") ? join(developer, "Contents/Developer") : developer,
        "Applications/Simulator.app"));
  }
});
