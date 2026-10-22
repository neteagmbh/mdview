import { afterEach, expect, it, vi } from "vitest";
import { createDocumentReload } from "./document-reload";

afterEach(() => vi.useRealTimers());

/** Editor save bursts do not create concurrent renderer/preparation jobs. */
it("coalesces bursts and queues one follow-up while a reload is running", async () => {
  vi.useFakeTimers();
  let finish!: (success: boolean) => void;
  const reload = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const controller = createDocumentReload(() => "/source.pdf", reload);
  controller.request(); controller.request(); controller.request();
  await vi.advanceTimersByTimeAsync(150);
  expect(reload).toHaveBeenCalledTimes(1);
  controller.request(); controller.request();
  finish(true);
  await vi.advanceTimersByTimeAsync(250);
  expect(reload).toHaveBeenCalledTimes(2);
  finish(true);
  await vi.runAllTimersAsync();
  expect(reload).toHaveBeenCalledTimes(2);
});

/** Atomic replacement gaps are retried briefly; navigating away drops stale source requests. */
it("retries a temporarily missing replacement and stops after switching sources", async () => {
  vi.useFakeTimers();
  let path: string | null = "/source.pdf";
  const reload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const controller = createDocumentReload(() => path, reload);
  controller.request();
  await vi.runAllTimersAsync();
  expect(reload).toHaveBeenCalledTimes(2);
  controller.request(); path = "/other.md";
  await vi.runAllTimersAsync();
  expect(reload).toHaveBeenCalledTimes(2);
});

/** Persistent failures have a finite retry budget, including thrown transport errors. */
it("bounds retries after persistent source errors", async () => {
  vi.useFakeTimers();
  const reload = vi.fn(async () => { throw new Error("unavailable"); });
  const controller = createDocumentReload(() => "/source.pdf", reload);
  controller.request();
  await vi.runAllTimersAsync();
  expect(reload).toHaveBeenCalledTimes(3);
});
