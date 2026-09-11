import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConnectionState, CredentialPatch } from "../shared/types.js";

interface SecretValues {
  apifyToken?: string;
  openrouterKey?: string;
  companiesHouseKey?: string;
}

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

export class LocalSecretStore {
  private local: SecretValues = {};

  constructor(
    private readonly path = "data/secrets.json",
    private readonly environment: SecretValues = {},
  ) {
    if (!existsSync(path)) return;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretValues;
      this.local = {
        apifyToken: clean(parsed.apifyToken),
        openrouterKey: clean(parsed.openrouterKey),
        companiesHouseKey: clean(parsed.companiesHouseKey),
      };
    } catch {
      throw new Error("The local credential file could not be read. Fix or remove data/secrets.json and restart Signal Desk.");
    }
  }

  values(): SecretValues {
    return {
      apifyToken: this.local.apifyToken ?? clean(this.environment.apifyToken),
      openrouterKey: this.local.openrouterKey ?? clean(this.environment.openrouterKey),
      companiesHouseKey: this.local.companiesHouseKey ?? clean(this.environment.companiesHouseKey),
    };
  }

  update(patch: CredentialPatch): SecretValues {
    for (const key of ["apifyToken", "openrouterKey", "companiesHouseKey"] as const) {
      if (!(key in patch)) continue;
      const value = clean(patch[key]);
      if (value) this.local[key] = value;
      else delete this.local[key];
    }
    this.write();
    return this.values();
  }

  connectionState(): ConnectionState {
    const values = this.values();
    const source = (key: keyof SecretValues): "local" | "environment" | "none" => this.local[key] ? "local" : clean(this.environment[key]) ? "environment" : "none";
    return {
      apify: Boolean(values.apifyToken),
      openrouter: Boolean(values.openrouterKey),
      companiesHouse: Boolean(values.companiesHouseKey),
      sources: {
        apify: source("apifyToken"),
        openrouter: source("openrouterKey"),
        companiesHouse: source("companiesHouseKey"),
      },
    };
  }

  private write() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.local, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, this.path);
    chmodSync(this.path, 0o600);
  }
}
