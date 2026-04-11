/**
 * Mock shelf data for Phase 0b.3. Proves FlashList + expo-image render
 * correctly on-device. Replaced in Phase 2 by the real Continue Watching
 * / Next Up / Recently Added / Latest Movies / Latest TV / Suggestions /
 * Requests / Local Downloads shelves from `@jellyfuse/query-keys`.
 *
 * Images come from the Jellyfin demo server so we exercise the network +
 * image cache path without bundling any assets.
 */

export interface MockMediaItem {
  id: string;
  title: string;
  year: number;
  posterUrl: string;
}

export interface MockShelf {
  id: string;
  title: string;
  items: MockMediaItem[];
}

const DEMO_POSTER_BASE =
  "https://demo.jellyfin.org/stable/Items/{id}/Images/Primary?fillHeight=450&fillWidth=300&quality=90";

function poster(id: string): string {
  return DEMO_POSTER_BASE.replace("{id}", id);
}

export const mockShelves: MockShelf[] = [
  {
    id: "continue-watching",
    title: "Continue Watching",
    items: [
      {
        id: "5c2f08bd-cdcc-1eef-10d0-98b72991b98c",
        title: "Big Buck Bunny",
        year: 2008,
        posterUrl: poster("5c2f08bd-cdcc-1eef-10d0-98b72991b98c"),
      },
      {
        id: "52d11b59-a5e8-b5a5-3d2b-76b95de30a59",
        title: "Elephants Dream",
        year: 2006,
        posterUrl: poster("52d11b59-a5e8-b5a5-3d2b-76b95de30a59"),
      },
      {
        id: "b6f5c42d-7d8e-4a8e-9c42-39fcb3b88b50",
        title: "Sintel",
        year: 2010,
        posterUrl: poster("b6f5c42d-7d8e-4a8e-9c42-39fcb3b88b50"),
      },
      {
        id: "4a2e16aa-c1f8-45d6-9d7a-f3e8f0e88f17",
        title: "Tears of Steel",
        year: 2012,
        posterUrl: poster("4a2e16aa-c1f8-45d6-9d7a-f3e8f0e88f17"),
      },
    ],
  },
  {
    id: "recently-added",
    title: "Recently Added",
    items: [
      {
        id: "aa11bb22-cc33-dd44-ee55-ff6677889900",
        title: "Sita Sings the Blues",
        year: 2008,
        posterUrl: poster("aa11bb22-cc33-dd44-ee55-ff6677889900"),
      },
      {
        id: "11aa22bb-33cc-44dd-55ee-66ff77889900",
        title: "Night of the Living Dead",
        year: 1968,
        posterUrl: poster("11aa22bb-33cc-44dd-55ee-66ff77889900"),
      },
      {
        id: "99887766-5544-3322-1100-aabbccddeeff",
        title: "The Kid",
        year: 1921,
        posterUrl: poster("99887766-5544-3322-1100-aabbccddeeff"),
      },
      {
        id: "ffeeddcc-bbaa-9988-7766-554433221100",
        title: "Metropolis",
        year: 1927,
        posterUrl: poster("ffeeddcc-bbaa-9988-7766-554433221100"),
      },
    ],
  },
];
