import type { MediaItem } from "@jellyfuse/api";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MediaCard } from "./media-card";

const movie: MediaItem = {
  id: { kind: "jellyfin", jellyfinId: "jf-1" },
  source: "jellyfin",
  availability: { kind: "available" },
  mediaType: "movie",
  title: "Big Buck Bunny",
  sortTitle: undefined,
  year: 2008,
  overview: undefined,
  posterUrl: "https://example.test/poster.jpg",
  backdropUrl: undefined,
  logoUrl: undefined,
  genres: [],
  rating: undefined,
  progress: undefined,
  runtimeMinutes: undefined,
  userData: undefined,
  seasonCount: undefined,
  episodeCount: undefined,
  seriesName: undefined,
  seasonNumber: undefined,
  episodeNumber: undefined,
  seriesId: undefined,
};

const episode: MediaItem = {
  ...movie,
  mediaType: "episode",
  title: "Pilot",
  seriesName: "Breaking Bad",
  seasonNumber: 1,
  episodeNumber: 1,
};

const defaultProps = { item: movie, width: 120, posterHeight: 180, gap: 16 };

describe("<MediaCard />", () => {
  it("renders the title and year subtitle for a movie", () => {
    render(<MediaCard {...defaultProps} onPress={() => {}} />);
    expect(screen.getByText("Big Buck Bunny")).toBeTruthy();
    expect(screen.getByText("2008")).toBeTruthy();
  });

  it("renders the episode label as subtitle for an episode", () => {
    render(<MediaCard {...defaultProps} item={episode} onPress={() => {}} />);
    expect(screen.getByText("Pilot")).toBeTruthy();
    expect(screen.getByText("S1 · E1")).toBeTruthy();
  });

  it("exposes an accessibility label combining title and subtitle", () => {
    render(<MediaCard {...defaultProps} onPress={() => {}} />);
    expect(screen.getByLabelText("Big Buck Bunny, 2008")).toBeTruthy();
  });

  it("falls back to title-only accessibility label when no subtitle is derivable", () => {
    const bare: MediaItem = { ...movie, year: undefined };
    render(<MediaCard {...defaultProps} item={bare} onPress={() => {}} />);
    expect(screen.getByLabelText("Big Buck Bunny")).toBeTruthy();
  });

  it("invokes onPress when the card is pressed", () => {
    const onPress = jest.fn();
    render(<MediaCard {...defaultProps} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("Big Buck Bunny, 2008"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows the first-letter fallback when posterUrl is missing", () => {
    const bare: MediaItem = { ...movie, posterUrl: undefined };
    render(<MediaCard {...defaultProps} item={bare} onPress={() => {}} />);
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("does not mutate when different props arrive (pure component contract)", () => {
    const onPress = jest.fn();
    const { rerender } = render(<MediaCard {...defaultProps} onPress={onPress} />);
    rerender(
      <MediaCard
        {...defaultProps}
        item={{ ...movie, title: "Sintel", year: 2010 }}
        onPress={onPress}
      />,
    );
    expect(screen.getByText("Sintel")).toBeTruthy();
    expect(screen.getByText("2010")).toBeTruthy();
    expect(screen.queryByText("Big Buck Bunny")).toBeNull();
  });
});
