import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(<App />);

reportWebVitals();
