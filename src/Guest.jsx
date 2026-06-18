import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import GuestApp from "./GuestApp.jsx";
import Toast from "./components/Toast.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <GuestApp />
      <Toast />
    </MotionConfig>
  </React.StrictMode>
);
