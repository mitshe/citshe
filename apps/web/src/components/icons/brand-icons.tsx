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

export function GitLabIcon({ className }: IconProps) {
  return <SiGitlab className={cn("w-5 h-5", className)} />;
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
