import { AlertCircle, CheckCircle2, X } from "lucide-react";

export function Toast({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error"; onClose: () => void }) {
  return <div className={`toast toast--${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "error" ? <AlertCircle /> : <CheckCircle2 />}<span>{message}</span><button onClick={onClose} aria-label="Dismiss"><X /></button></div>;
}
