import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少 root 节点。");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
