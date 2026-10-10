import React from "react";
import { createRoot } from "react-dom/client";
import "@gridwatch/account-kit/header.css";
import { mountAccountHeader } from "@gridwatch/account-kit";
import { accountKit } from "./services/accountKit";
import App from "./App";
import { activeBoardTheme } from "./game/boardTheme";
import "./styles.css";
import "./darkRealism.css";

// The dark-realism UI rules are all scoped to this attribute (darkRealism.css). index.html already
// carries it so the first paint is dark; this line is what turns it off for the archived classic look.
document.documentElement.dataset.boardTheme = activeBoardTheme();

mountAccountHeader(accountKit);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
