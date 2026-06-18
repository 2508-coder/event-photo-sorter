// Email/password auth via Supabase. A normalized user { uid, email } is exposed
// so the rest of the app stays backend-agnostic.
import { supabase } from "../supabase.js";

function mapUser(u) {
  return u ? { uid: u.id, email: u.email } : null;
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logOut() {
  await supabase.auth.signOut();
}

// Calls cb(user|null). Returns an unsubscribe function.
export function watchAuth(cb) {
  supabase.auth.getSession().then(({ data }) => cb(mapUser(data.session?.user)));
  const { data } = supabase.auth.onAuthStateChange((_event, session) =>
    cb(mapUser(session?.user))
  );
  return () => data.subscription.unsubscribe();
}
