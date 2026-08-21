"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Save, Loader2, Moon, Sun, Monitor, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { resetOnboardingTour } from "@/components/onboarding-tour";

const languages = [
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Fran\u00e7ais" },
];

const dateFormats = [
  { value: "relative", label: "Relative (e.g., 2 hours ago)" },
  { value: "absolute", label: "Absolute (e.g., Jan 15, 2024)" },
  { value: "iso", label: "ISO 8601 (e.g., 2024-01-15)" },
];

export default function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [preferences, setPreferences] = useState({
    language: "en",
    dateFormat: "relative",
    compactMode: false,
    showWelcomeTips: true,
  });

  useEffect(() => {
    setMounted(true);
    // Load preferences from localStorage
    const saved = localStorage.getItem("citshe-preferences");
    if (saved) {
      try {
        setPreferences(JSON.parse(saved));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const updatePreference = <K extends keyof typeof preferences>(
    key: K,
    value: (typeof preferences)[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save to localStorage
      localStorage.setItem("citshe-preferences", JSON.stringify(preferences));
      toast.success("Preferences saved");
      setHasChanges(false);
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="w-full space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Customize your citshe experience.
        </p>
      </div>

      {/* Appearance */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Appearance</h2>
          <p className="text-xs text-muted-foreground">
            Customize how citshe looks on your device.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Theme</Label>
            <p className="text-xs text-text-subtle">
              Choose your preferred color scheme.
            </p>
          </div>
          <SegmentedControl
            aria-label="Theme"
            value={(theme as "light" | "dark" | "system") ?? "system"}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "light", label: "Light", icon: <Sun /> },
              { value: "dark", label: "Dark", icon: <Moon /> },
              { value: "system", label: "System", icon: <Monitor /> },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="compact-mode">Compact mode</Label>
            <p className="text-xs text-text-subtle">
              Reduce spacing and padding throughout the interface.
            </p>
          </div>
          <Switch
            id="compact-mode"
            checked={preferences.compactMode}
            onCheckedChange={(checked) =>
              updatePreference("compactMode", checked)
            }
          />
        </div>
      </section>

      <Separator />

      {/* Language & Region */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Language &amp; region
          </h2>
          <p className="text-xs text-muted-foreground">
            Set your language and date format preferences.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="language">Language</Label>
          <Select
            value={preferences.language}
            onValueChange={(value) => updatePreference("language", value)}
          >
            <SelectTrigger id="language">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="date-format">Date format</Label>
          <Select
            value={preferences.dateFormat}
            onValueChange={(value) => updatePreference("dateFormat", value)}
          >
            <SelectTrigger id="date-format">
              <SelectValue placeholder="Select date format" />
            </SelectTrigger>
            <SelectContent>
              {dateFormats.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Separator />

      {/* Onboarding */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Onboarding</h2>
          <p className="text-xs text-muted-foreground">
            Manage tips and the welcome tour.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="welcome-tips">Show welcome tips</Label>
            <p className="text-xs text-text-subtle">
              Display helpful tips and onboarding guides.
            </p>
          </div>
          <Switch
            id="welcome-tips"
            checked={preferences.showWelcomeTips}
            onCheckedChange={(checked) =>
              updatePreference("showWelcomeTips", checked)
            }
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Reset onboarding tour</Label>
            <p className="text-xs text-text-subtle">
              Show the welcome tour again when you visit Home.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetOnboardingTour();
              toast.success(
                "Onboarding tour reset. Visit Home to see it again.",
              );
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset tour
          </Button>
        </div>
      </section>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {hasChanges ? "Save preferences" : "No changes"}
        </Button>
      </div>
    </div>
  );
}
