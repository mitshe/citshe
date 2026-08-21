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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/lib/auth";

const timezones = [
  { value: "Europe/Warsaw", label: "Europe/Warsaw (CET)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "America/New_York", label: "America/New York (EST)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (PST)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "UTC", label: "UTC" },
];

export default function OrganizationSettingsPage() {
  const { organization, isLoaded } = useOrganization();
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [settings, setSettings] = useState({
    organizationName: "",
    timezone: "Europe/Warsaw",
  });

  useEffect(() => {
    if (isLoaded && organization) {
      setSettings((prev) => ({
        ...prev,
        organizationName: organization.name || "",
      }));
    }
  }, [isLoaded, organization]);

  const updateSetting = <K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Only try to update if organization has update method (Clerk mode)
      if (
        organization &&
        settings.organizationName !== organization.name &&
        "update" in organization &&
        typeof organization.update === "function"
      ) {
        await organization.update({ name: settings.organizationName });
      }

      toast.success("Organization settings saved");
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Organization</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage your portal name and regional settings.
        </p>
      </div>

      {/* General */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">General</h2>
          <p className="text-xs text-muted-foreground">
            Basic information about your organization.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="orgName">Organization name</Label>
          <Input
            id="orgName"
            value={settings.organizationName}
            onChange={(e) => updateSetting("organizationName", e.target.value)}
            placeholder="My Organization"
          />
          <p className="text-xs text-text-subtle">
            This name will be visible to all team members.
          </p>
        </div>
      </section>

      <Separator />

      {/* Regional */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Regional</h2>
          <p className="text-xs text-muted-foreground">
            Timezone used for scheduling and displaying dates.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">Default timezone</Label>
          <Select
            value={settings.timezone}
            onValueChange={(value) => updateSetting("timezone", value)}
          >
            <SelectTrigger id="timezone">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {hasChanges ? "Save changes" : "No changes"}
        </Button>
      </div>

      {/* Danger zone */}
      <section className="space-y-3 rounded-md border border-destructive/30 bg-destructive/[0.04] p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <h2 className="text-sm font-medium">Danger zone</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          These actions are irreversible. Please proceed with caution.
        </p>
        <Separator className="bg-destructive/20" />
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Delete organization
            </p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your organization, all threads, tasks, and data.
            </p>
          </div>
          <Button variant="destructive" size="sm" disabled>
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}
