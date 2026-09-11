import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, KeyRound, LockKeyhole, Save } from "lucide-react";
import type { ConnectionState, CredentialPatch } from "../../shared/types";
import { Button } from "./Ui";

type CredentialName = "openrouterKey" | "apifyToken" | "companiesHouseKey";

const fields: Array<{
  name: CredentialName;
  connection: keyof Pick<ConnectionState, "openrouter" | "apify" | "companiesHouse">;
  label: string;
  description: string;
}> = [
  { name: "openrouterKey", connection: "openrouter", label: "OpenRouter", description: "Scores opportunities and drafts replies." },
  { name: "apifyToken", connection: "apify", label: "Apify", description: "Collects approved public posts and group discussions." },
  { name: "companiesHouseKey", connection: "companiesHouse", label: "Companies House", description: "Verifies active UK companies and company age." },
];

export function SetupModal({ connections, busy, onSave }: { connections: ConnectionState; busy: boolean; onSave: (patch: CredentialPatch) => Promise<unknown> }) {
  const [values, setValues] = useState<Record<CredentialName, string>>({ openrouterKey: "", apifyToken: "", companiesHouseKey: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const missing = useMemo(() => fields.filter((field) => !connections[field.connection]), [connections]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = missing.find((field) => !values[field.name].trim());
    if (empty) {
      setValidationError(`Add your ${empty.label} API key to continue.`);
      return;
    }
    setValidationError(null);
    const patch = Object.fromEntries(missing.map((field) => [field.name, values[field.name].trim()])) as CredentialPatch;
    try {
      await onSave(patch);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The keys could not be saved locally.");
    }
  };

  const firstMissing = fields.findIndex((field) => !connections[field.connection]);

  return <div className="setup-overlay">
    <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-description">
      <div className="setup-modal__header">
        <span className="setup-modal__icon"><AlertTriangle /></span>
        <div><span className="setup-modal__eyebrow">Initial setup</span><h2 id="setup-title">API keys required</h2></div>
      </div>
      <p id="setup-description" className="setup-modal__intro">Signal Desk contains no sample records or offline results. Add all three keys to unlock live collection, company verification and AI drafting.</p>

      <form onSubmit={(event) => void submit(event)}>
        <div className="setup-key-list">
          {fields.map((field, index) => {
            const configured = connections[field.connection];
            return <label className={`setup-key-field${configured ? " setup-key-field--connected" : ""}`} key={field.name}>
              <span className="setup-key-field__copy"><KeyRound /><span><strong>{field.label}</strong><small>{field.description}</small></span><b>{configured ? "Saved locally" : "Required"}</b></span>
              {!configured ? <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                autoFocus={index === firstMissing}
                value={values[field.name]}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                placeholder={`Paste ${field.label} API key`}
                aria-label={`${field.label} API key`}
              /> : null}
            </label>;
          })}
        </div>
        {validationError ? <p className="setup-modal__error" role="alert">{validationError}</p> : null}
        <div className="setup-modal__security"><LockKeyhole /><span><strong>Stored only on this machine</strong><small>Keys are sent to the local Express backend, saved with owner-only file permissions, and never returned to the browser.</small></span></div>
        <div className="setup-modal__actions">
          <span>After setup, add a LinkedIn post search in Sources and refresh signals.</span>
          <Button type="submit" variant="primary" disabled={busy} icon={<Save />}>{busy ? "Saving keys…" : "Save keys and unlock"}</Button>
        </div>
      </form>
    </section>
  </div>;
}
