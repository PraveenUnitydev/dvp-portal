import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Font is bundled into the build - no request to Google Fonts,
// which corporate networks often block
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
