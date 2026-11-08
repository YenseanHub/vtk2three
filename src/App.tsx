import "./App.css";
import type { ReactElement } from "react";
import { BrowserRouter } from "react-router-dom";
import Router from "./routes/root";

function App(): ReactElement {
  return (
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  );
}

export default App;
