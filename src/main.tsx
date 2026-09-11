import React from "react";
import { createRoot } from "react-dom/client";
import "@gridwatch/account-kit/header.css";
import { mountAccountHeader } from "@gridwatch/account-kit";
import { accountKit } from "./services/accountKit";
import App from "./App";
import "./styles.css";

mountAccountHeader(accountKit);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
