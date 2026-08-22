"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Moon, Sun, Monitor, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { resetOnboardingTour } from "@/components/onboarding-tour";

const WELCOME_KEY = "citshe.show-welcome-tips";

export default function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [showWelcomeTips, setShowWelcomeTips] = useState(true);

  useEffect(() => {
    setMounted(true);
    try {
      setShowWelcomeTips(localStorage.getItem(WELCOME_KEY) !== "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleWelcomeTips = (checked: boolean) => {
    setShowWelcomeTips(checked);
    try {
      localStorage.setItem(WELCOME_KEY, checked ? "1" : "0");
    } catch {
      /* ignore */
    }
    toast.success(checked ? "Welcome tips on" : "Welcome tips off");
  };

  if (!mounted) return null;

  return (
    <div className="w-full space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
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
            checked={showWelcomeTips}
            onCheckedChange={toggleWelcomeTips}
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
    </div>
  );
}
