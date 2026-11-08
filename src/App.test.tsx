import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

// The real router pulls in vtk.js/three WebGL code, which jsdom cannot load.
vi.mock("./routes/root", () => ({
  default: () => <div>vtk2three</div>,
}));

test("renders the app shell", () => {
  render(<App />);
  expect(screen.getByText(/vtk2three/i)).toBeInTheDocument();
});
