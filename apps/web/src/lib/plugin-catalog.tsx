import { Server } from "lucide-react";
import type { PluginType } from "@/lib/api/types";
import {
  VercelIcon,
  CloudflareIcon,
  NeonIcon,
  GoogleAdsIcon,
} from "@/components/icons/brand-icons";

export interface PluginField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  helpText?: string;
}

export interface PluginDef {
  type: PluginType;
  name: string;
  tagline: string;
  icon: React.ReactNode;
  accent: string; // tailwind text color for the icon
  docsUrl?: string;
  fields: PluginField[];
  /** Supports picking which resources matter for this portal. */
  configurable?: boolean;
}

/** The stack tools citshe can plug into — Cloudflare, Neon, Google Ads. */
export const pluginCatalog: PluginDef[] = [
  {
    type: "CLOUDFLARE",
    name: "Cloudflare",
    tagline: "Deploys, Pages & R2 — is it live?",
    icon: <CloudflareIcon className="h-5 w-5" />,
    accent: "text-[#F38020]",
    configurable: true,
    docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    fields: [
      {
        key: "apiToken",
        label: "API Token",
        placeholder: "Cloudflare API token",
        type: "password",
        required: true,
        helpText:
          "Token with Pages, R2 and Workers read access. citshe discovers everything the token can see — no need to name a project or bucket.",
      },
      {
        key: "accountId",
        label: "Account ID",
        placeholder: "auto-detected from token (optional)",
      },
    ],
  },
  {
    type: "VERCEL",
    name: "Vercel",
    tagline: "Deployments, projects & domains",
    icon: <VercelIcon className="h-5 w-5" />,
    accent: "text-foreground",
    docsUrl: "https://vercel.com/account/tokens",
    fields: [
      {
        key: "apiToken",
        label: "API Token",
        placeholder: "Vercel API token",
        type: "password",
        required: true,
        helpText:
          "Token with read access. citshe lists the projects the token can see and shows the freshest deployment.",
      },
      {
        key: "teamId",
        label: "Team ID",
        placeholder: "team_… (optional — for team-scoped tokens)",
        helpText:
          "Only needed if the token belongs to a team. Personal tokens can leave this blank.",
      },
    ],
  },
  {
    type: "NEON",
    name: "Neon",
    tagline: "Postgres — size, branch, activity",
    icon: <NeonIcon className="h-5 w-5" />,
    accent: "text-[#00E599]",
    docsUrl: "https://console.neon.tech/app/settings/api-keys",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "neon_api_...",
        type: "password",
        required: true,
      },
      {
        key: "projectId",
        label: "Project ID",
        placeholder: "e.g. cool-forest-12345678",
        required: true,
      },
    ],
  },
  {
    type: "GOOGLE_ADS",
    name: "Google Ads",
    tagline: "Campaigns, spend & conversions",
    icon: <GoogleAdsIcon className="h-5 w-5" />,
    accent: "text-[#4285F4]",
    docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
    fields: [
      {
        key: "developerToken",
        label: "Developer Token",
        type: "password",
        required: true,
      },
      {
        key: "customerId",
        label: "Customer ID",
        placeholder: "digits only, e.g. 1234567890",
        required: true,
      },
      {
        key: "accessToken",
        label: "OAuth Access Token",
        type: "password",
        helpText: "Optional — needed to read live campaign metrics.",
      },
      {
        key: "loginCustomerId",
        label: "Login Customer ID",
        placeholder: "manager account (optional)",
      },
    ],
  },
  {
    type: "VPS",
    name: "VPS",
    tagline: "Server fleet health — up, load, disk, RAM",
    icon: <Server className="h-5 w-5" />,
    accent: "text-muted-foreground",
    docsUrl:
      "https://www.digitalocean.com/community/tutorials/how-to-set-up-ssh-keys-2",
    fields: [
      {
        key: "label",
        label: "Name",
        placeholder: "e.g. web-1 / hetzner-fsn",
        helpText:
          "Add your first server here — you can add more from the VPS page afterwards.",
      },
      {
        key: "authMethod",
        label: "Auth",
        type: "select",
        options: [
          { value: "key", label: "SSH key" },
          { value: "password", label: "Password" },
        ],
      },
      {
        key: "host",
        label: "Host",
        placeholder: "IP or hostname, e.g. 5.75.x.x",
        required: true,
      },
      { key: "username", label: "User", placeholder: "e.g. root", required: true },
      { key: "port", label: "Port", placeholder: "22 (optional)" },
      {
        key: "privateKey",
        label: "Private key",
        placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
        type: "textarea",
        helpText:
          "Paste the full PEM (BEGIN…END). Line breaks are preserved.",
      },
      {
        key: "passphrase",
        label: "Key passphrase",
        type: "password",
        placeholder: "if the key is encrypted (optional)",
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "SSH password",
      },
    ],
  },
];

export function getPluginDef(type: PluginType): PluginDef | undefined {
  return pluginCatalog.find((p) => p.type === type);
}
