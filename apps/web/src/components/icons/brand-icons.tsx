/**
 * Brand Icons - Using react-icons
 * https://react-icons.github.io/react-icons/
 */

import {
  SiDiscord,
  SiTelegram,
  SiGithub,
  SiGitlab,
  SiTrello,
  SiObsidian,
  SiAnthropic,
  SiGoogle,
  SiVercel,
  SiCloudflare,
  SiGoogleads,
} from "react-icons/si";
import { TbWebhook } from "react-icons/tb";
import { AiFillApi } from "react-icons/ai";
import { cn } from "@/lib/utils";

interface IconProps {
  className?: string;
}

// ============================================================================
// Communication Platforms
// ============================================================================

export function DiscordIcon({ className }: IconProps) {
  return <SiDiscord className={cn("w-5 h-5", className)} />;
}

export function TelegramIcon({ className }: IconProps) {
  return <SiTelegram className={cn("w-5 h-5", className)} />;
}

// ============================================================================
// Development Platforms
// ============================================================================

export function GitHubIcon({ className }: IconProps) {
  return <SiGithub className={cn("w-5 h-5", className)} />;
}

/**
 * Vercel triangle — the mark is black, which is invisible on the dark sidebar,
 * so tint it to the theme foreground (white on dark). Color baked in explicitly
 * so it overrides the muted nav-row wrapper.
 */
export function VercelIcon({ className }: IconProps) {
  return <SiVercel className={cn("w-5 h-5 text-foreground", className)} />;
}

export function GitLabIcon({ className }: IconProps) {
  return <SiGitlab className={cn("w-5 h-5", className)} />;
}

// ============================================================================
// Stack / Infrastructure Brands (carry their OWN brand color)
// ============================================================================

/** Cloudflare — brand orange (#F38020). Color baked in so it shows on muted nav. */
export function CloudflareIcon({ className }: IconProps) {
  return <SiCloudflare className={cn("w-5 h-5 text-[#F38020]", className)} />;
}

/** Google Ads — brand blue (#4285F4). Single-color for a clean nav glyph. */
export function GoogleAdsIcon({ className }: IconProps) {
  return <SiGoogleads className={cn("w-5 h-5 text-[#4285F4]", className)} />;
}

/**
 * Neon — not present in the installed react-icons `si` set, so we embed the
 * OFFICIAL Simple Icons single-path logomark (the rounded "N" mark).
 * Source: https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/neon.svg
 * Brand green per Simple Icons: #34D59A.
 */
export function NeonIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="Neon"
      className={cn("w-5 h-5 text-[#34D59A]", className)}
      fill="currentColor"
    >
      <path d="M24 0V24l-9.365-8.045V24H0V0ZM2.942 21.087h8.751V9.563l9.365 8.204V2.919L2.942 2.914Z" />
    </svg>
  );
}

// ============================================================================
// Project Management
// ============================================================================

export function TrelloIcon({ className }: IconProps) {
  return <SiTrello className={cn("w-5 h-5", className)} />;
}

// ============================================================================
// Knowledge Base
// ============================================================================

export function ObsidianIcon({ className }: IconProps) {
  return <SiObsidian className={cn("w-5 h-5", className)} />;
}

// ============================================================================
// AI Providers
// ============================================================================

export function AnthropicIcon({ className }: IconProps) {
  return <SiAnthropic className={cn("w-5 h-5", className)} />;
}

export function OpenRouterIcon({ className }: IconProps) {
  // OpenRouter aggregates AI providers - use API icon
  return <AiFillApi className={cn("w-5 h-5", className)} />;
}

export function GoogleIcon({ className }: IconProps) {
  return <SiGoogle className={cn("w-5 h-5", className)} />;
}

// ============================================================================
// Generic Icons
// ============================================================================

export function WebhookIcon({ className }: IconProps) {
  return <TbWebhook className={cn("w-5 h-5", className)} />;
}

export function APIIcon({ className }: IconProps) {
  return <AiFillApi className={cn("w-5 h-5", className)} />;
}
