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
 * Neon — no Simple Icons glyph in the installed react-icons version, so this is
 * an inline logomark tinted with Neon brand green (#00E599). Rounded-square
 * badge with the Neon "N" cut-out.
 */
export function NeonIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="Neon"
      className={cn("w-5 h-5 text-[#00E599]", className)}
      fill="currentColor"
    >
      <path d="M3.732 2A2.732 2.732 0 0 0 1 4.732v14.535a2.732 2.732 0 0 0 2.732 2.733h4.845a2.19 2.19 0 0 0 1.573-.665V17.35a1.09 1.09 0 0 1 1.09-1.09h.001a1.09 1.09 0 0 1 1.09 1.09v3.53a2.19 2.19 0 0 0 .18.897 2.734 2.734 0 0 0 3.586-2.51V4.732A2.732 2.732 0 0 0 16.905 2H3.732ZM4.82 5.82h8.363a1.09 1.09 0 0 1 1.09 1.09v7.918l-4.914-6.36a2.19 2.19 0 0 0-3.965 1.286v3.63A1.09 1.09 0 0 1 4.82 12.294V5.82Z" />
      <path d="M21.268 2a2.732 2.732 0 0 1 2.732 2.732v14.536A2.732 2.732 0 0 1 21.268 22h-.09a2.732 2.732 0 0 0 .636-1.755V4.732c0-.64-.22-1.229-.588-1.695A2.72 2.72 0 0 0 20.09 2h1.178Z" opacity="0.5" />
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
