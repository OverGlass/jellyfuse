import { createEndOfEpisodeStore } from "./end-of-episode-store";

describe("createEndOfEpisodeStore", () => {
  it("starts idle with no dismiss flags", () => {
    const store = createEndOfEpisodeStore();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      creditsDismissed: false,
      nearEndDismissed: false,
    });
  });

  it("enter() transitions idle → credits", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    expect(store.getSnapshot().phase).toBe("credits");
  });

  it("enter() is a no-op when already in the target phase", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    const before = store.getSnapshot();
    store.enter("credits");
    expect(store.getSnapshot()).toBe(before);
  });

  it("enter('credits') is ignored once creditsDismissed", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    store.watchCredits();
    expect(store.getSnapshot().creditsDismissed).toBe(true);
    store.enter("credits");
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("enter('nearEnd') is ignored once nearEndDismissed", () => {
    const store = createEndOfEpisodeStore();
    store.enter("nearEnd");
    store.dismiss();
    expect(store.getSnapshot().nearEndDismissed).toBe(true);
    store.enter("nearEnd");
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("complete() clears phase without latching dismiss flags", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    store.complete();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      creditsDismissed: false,
      nearEndDismissed: false,
    });
    // re-entry still allowed
    store.enter("credits");
    expect(store.getSnapshot().phase).toBe("credits");
  });

  it("complete() while idle is a no-op", () => {
    const store = createEndOfEpisodeStore();
    const before = store.getSnapshot();
    store.complete();
    expect(store.getSnapshot()).toBe(before);
  });

  it("watchCredits() latches credits off without affecting nearEnd", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    store.watchCredits();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      creditsDismissed: true,
      nearEndDismissed: false,
    });
  });

  it("dismiss() during credits sets creditsDismissed only", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    store.dismiss();
    expect(store.getSnapshot().creditsDismissed).toBe(true);
    expect(store.getSnapshot().nearEndDismissed).toBe(false);
  });

  it("dismiss() during nearEnd sets nearEndDismissed only", () => {
    const store = createEndOfEpisodeStore();
    store.enter("nearEnd");
    store.dismiss();
    expect(store.getSnapshot().creditsDismissed).toBe(false);
    expect(store.getSnapshot().nearEndDismissed).toBe(true);
  });

  it("dismiss() while idle is a no-op", () => {
    const store = createEndOfEpisodeStore();
    const before = store.getSnapshot();
    store.dismiss();
    expect(store.getSnapshot()).toBe(before);
  });

  it("reset() clears every flag, mirroring backward-seek > 2s in Rust", () => {
    const store = createEndOfEpisodeStore();
    store.enter("credits");
    store.watchCredits();
    store.enter("nearEnd"); // no-op (was already dismissed indirectly? no — only credits)
    store.dismiss();
    store.reset();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      creditsDismissed: false,
      nearEndDismissed: false,
    });
  });

  it("subscribers are notified on every state change but not on no-ops", () => {
    const store = createEndOfEpisodeStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    store.enter("credits"); // change
    store.enter("credits"); // no-op
    store.complete(); // change
    store.dismiss(); // no-op (already idle)
    unsubscribe();
    store.reset(); // not observed
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("getSnapshot() returns a stable identity until a real change", () => {
    const store = createEndOfEpisodeStore();
    const a = store.getSnapshot();
    store.complete(); // idle no-op
    expect(store.getSnapshot()).toBe(a);
    store.enter("nearEnd");
    expect(store.getSnapshot()).not.toBe(a);
  });
});
