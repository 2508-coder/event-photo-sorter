import { useState } from "react";
import { signIn, signUp } from "../lib/auth.js";
import { showToast } from "../lib/toast.js";

export default function Login() {
  const [mode, setMode] = useState("in"); // "in" | "up"
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "in") { await signIn(email, pw); showToast("\u2705 Signed in successfully", "success"); }
      else { await signUp(email, pw); showToast("\ud83c\udf89 Account created \u2014 welcome!", "success"); }
    } catch (e2) {
      const m = e2.message.replace("Firebase: ", "");
      setErr(m);
      showToast("\u274c " + m, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <h1>🧠 AI Photo Sorter</h1>
        <p className="tagline">
          {mode === "in" ? "Sign in to your photo space" : "Create your photo space"}
        </p>
        <form onSubmit={submit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
        {err && <div className="auth-err">{err}</div>}
        <button className="link" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
