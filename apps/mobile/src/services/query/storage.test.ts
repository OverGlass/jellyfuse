import { mmkvAsyncStorage } from "./storage";

/**
 * `react-native-mmkv` is mocked by jest-expo's preset so `createMMKV`
 * returns an in-memory Map-backed stub. That's enough to verify the
 * AsyncStorage-shaped facade wires through correctly — the real native
 * module is exercised on device, not in Jest.
 */
describe("mmkvAsyncStorage", () => {
  const key = "test-key";

  afterEach(async () => {
    await mmkvAsyncStorage.removeItem(key);
  });

  it("round-trips setItem → getItem", async () => {
    await mmkvAsyncStorage.setItem(key, "hello");
    const value = await mmkvAsyncStorage.getItem(key);
    expect(value).toBe("hello");
  });

  it("returns null when the key is absent", async () => {
    const value = await mmkvAsyncStorage.getItem("definitely-not-set");
    expect(value).toBeNull();
  });

  it("removeItem clears the entry", async () => {
    await mmkvAsyncStorage.setItem(key, "toRemove");
    await mmkvAsyncStorage.removeItem(key);
    expect(await mmkvAsyncStorage.getItem(key)).toBeNull();
  });
});
