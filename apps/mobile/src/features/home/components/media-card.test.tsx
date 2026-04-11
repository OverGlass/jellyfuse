import { fireEvent, render, screen } from "@testing-library/react-native";
import { MediaCard } from "./media-card";

describe("<MediaCard />", () => {
  const defaults = {
    title: "Big Buck Bunny",
    year: 2008,
    posterUrl: "https://example.test/poster.jpg",
  };

  it("renders the title and year from props", () => {
    render(<MediaCard {...defaults} onPress={() => {}} />);
    expect(screen.getByText("Big Buck Bunny")).toBeTruthy();
    expect(screen.getByText("2008")).toBeTruthy();
  });

  it("exposes an accessibility label combining title and year", () => {
    render(<MediaCard {...defaults} onPress={() => {}} />);
    expect(screen.getByLabelText("Big Buck Bunny, 2008")).toBeTruthy();
  });

  it("invokes onPress when the card is pressed", () => {
    const onPress = jest.fn();
    render(<MediaCard {...defaults} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("Big Buck Bunny, 2008"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not mutate when different props arrive (pure component contract)", () => {
    const onPress = jest.fn();
    const { rerender } = render(<MediaCard {...defaults} onPress={onPress} />);
    rerender(<MediaCard {...defaults} title="Sintel" year={2010} onPress={onPress} />);
    expect(screen.getByText("Sintel")).toBeTruthy();
    expect(screen.getByText("2010")).toBeTruthy();
    expect(screen.queryByText("Big Buck Bunny")).toBeNull();
  });
});
