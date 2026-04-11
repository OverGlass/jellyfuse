import type { AuthenticatedUser } from "@jellyfuse/api";
import { findUserById, removeUserById, upsertUser, type UserStorage } from "./users";

function createInMemoryStorage(
  seed: { users?: AuthenticatedUser[]; activeUserId?: string } = {},
): UserStorage {
  let users: AuthenticatedUser[] = seed.users ? [...seed.users] : [];
  let activeUserId: string | undefined = seed.activeUserId;
  return {
    loadUsers: async () => [...users],
    saveUsers: async (next) => {
      users = [...next];
    },
    loadActiveUserId: async () => activeUserId,
    saveActiveUserId: async (id) => {
      activeUserId = id;
    },
  };
}

const alice: AuthenticatedUser = {
  userId: "user-alice",
  displayName: "Alice",
  token: "tok-a",
};
const bob: AuthenticatedUser = {
  userId: "user-bob",
  displayName: "Bob",
  token: "tok-b",
};

describe("users.ts", () => {
  describe("upsertUser", () => {
    it("inserts a brand-new user at the end of the list", async () => {
      const storage = createInMemoryStorage();
      const result = await upsertUser(storage, alice);
      expect(result).toEqual([alice]);
      expect(await storage.loadUsers()).toEqual([alice]);
    });

    it("appends additional users in arrival order", async () => {
      const storage = createInMemoryStorage({ users: [alice] });
      const result = await upsertUser(storage, bob);
      expect(result).toEqual([alice, bob]);
    });

    it("replaces by userId when a matching entry already exists", async () => {
      const storage = createInMemoryStorage({ users: [alice, bob] });
      const updatedAlice: AuthenticatedUser = {
        ...alice,
        token: "tok-a-rotated",
        avatarUrl: "https://example.test/alice.jpg",
      };
      const result = await upsertUser(storage, updatedAlice);
      expect(result).toEqual([updatedAlice, bob]);
      // Bob stays untouched.
      expect(result[1]).toBe(bob);
    });
  });

  describe("removeUserById", () => {
    it("removes the user from the list", async () => {
      const storage = createInMemoryStorage({
        users: [alice, bob],
        activeUserId: "user-alice",
      });
      const { users } = await removeUserById(storage, "user-bob");
      expect(users).toEqual([alice]);
    });

    it("repoints the active user when the active one was removed", async () => {
      const storage = createInMemoryStorage({
        users: [alice, bob],
        activeUserId: "user-alice",
      });
      const { users, nextActiveUserId } = await removeUserById(storage, "user-alice");
      expect(users).toEqual([bob]);
      expect(nextActiveUserId).toBe("user-bob");
      expect(await storage.loadActiveUserId()).toBe("user-bob");
    });

    it("leaves the active pointer undefined when the last user is removed", async () => {
      const storage = createInMemoryStorage({
        users: [alice],
        activeUserId: "user-alice",
      });
      const { users, nextActiveUserId } = await removeUserById(storage, "user-alice");
      expect(users).toEqual([]);
      expect(nextActiveUserId).toBeUndefined();
      expect(await storage.loadActiveUserId()).toBeUndefined();
    });

    it("leaves the active pointer untouched when removing a non-active user", async () => {
      const storage = createInMemoryStorage({
        users: [alice, bob],
        activeUserId: "user-alice",
      });
      const { nextActiveUserId } = await removeUserById(storage, "user-bob");
      expect(nextActiveUserId).toBe("user-alice");
      expect(await storage.loadActiveUserId()).toBe("user-alice");
    });

    it("is a no-op when removing a user that was not in the list", async () => {
      const storage = createInMemoryStorage({
        users: [alice],
        activeUserId: "user-alice",
      });
      const { users, nextActiveUserId } = await removeUserById(storage, "user-ghost");
      expect(users).toEqual([alice]);
      expect(nextActiveUserId).toBe("user-alice");
    });
  });

  describe("findUserById", () => {
    it("returns undefined for undefined id", () => {
      expect(findUserById([alice, bob], undefined)).toBeUndefined();
    });

    it("returns the matching user", () => {
      expect(findUserById([alice, bob], "user-bob")).toBe(bob);
    });

    it("returns undefined when no match", () => {
      expect(findUserById([alice], "user-bob")).toBeUndefined();
    });
  });
});
