// Jest mock for react-native-mmkv. The real module pulls in Nitro
// Modules via TurboModules which aren't wired in jest-expo's default
// preset. Tests that exercise persistence live-on-device; at unit-test
// time we stub the factory with an in-memory Map so the AsyncStorage
// adapter in `services/query/storage.ts` can round-trip values.

function createMMKV() {
  const store = new Map();
  return {
    set(key, value) {
      store.set(key, value);
    },
    getString(key) {
      const value = store.get(key);
      return typeof value === "string" ? value : undefined;
    },
    getNumber(key) {
      const value = store.get(key);
      return typeof value === "number" ? value : undefined;
    },
    getBoolean(key) {
      const value = store.get(key);
      return typeof value === "boolean" ? value : undefined;
    },
    contains(key) {
      return store.has(key);
    },
    remove(key) {
      store.delete(key);
    },
    delete(key) {
      store.delete(key);
    },
    getAllKeys() {
      return Array.from(store.keys());
    },
    clearAll() {
      store.clear();
    },
  };
}

module.exports = {
  createMMKV,
  MMKV: createMMKV,
};
