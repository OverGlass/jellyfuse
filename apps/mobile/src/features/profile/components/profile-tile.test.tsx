import { fireEvent, render, screen } from "@testing-library/react-native";
import { AddUserTile, ProfileTile } from "./profile-tile";

describe("<ProfileTile />", () => {
  const defaults = {
    displayName: "alice",
    onPress: () => {},
    onLongPress: () => {},
  };

  it("renders the display name", () => {
    render(<ProfileTile {...defaults} avatarUrl={undefined} />);
    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("exposes the display name as the accessibility label", () => {
    render(<ProfileTile {...defaults} avatarUrl={undefined} />);
    expect(screen.getByLabelText("alice")).toBeTruthy();
  });

  it("shows the first letter of the name in the fallback avatar when no URL is provided", () => {
    render(<ProfileTile {...defaults} displayName="alice" avatarUrl={undefined} />);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("invokes onPress on tap", () => {
    const onPress = jest.fn();
    render(<ProfileTile {...defaults} avatarUrl={undefined} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("alice"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("invokes onLongPress on long press", () => {
    const onLongPress = jest.fn();
    render(<ProfileTile {...defaults} avatarUrl={undefined} onLongPress={onLongPress} />);
    fireEvent(screen.getByLabelText("alice"), "longPress");
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe("<AddUserTile />", () => {
  it("exposes an 'Add user' accessibility label", () => {
    render(<AddUserTile onPress={() => {}} />);
    expect(screen.getByLabelText("Add user")).toBeTruthy();
  });

  it("invokes onPress on tap", () => {
    const onPress = jest.fn();
    render(<AddUserTile onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("Add user"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
