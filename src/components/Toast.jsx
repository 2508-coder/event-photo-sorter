import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { onToast } from "../lib/toast.js";

export default function Toast() {
  const [items, setItems] = useState([]);
  useEffect(() => onToast((t) => {
    setItems((s) => [...s, t]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 3500);
  }), []);
  return (
    <div className="toast-wrap">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={"toast toast-" + t.type}
            onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
