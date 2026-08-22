"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Eye,
  EyeOff,
  Plus,
  Settings,
  Trash2,
  Check,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { GitHubIcon } from "@/components/icons/brand-icons";
import { StatusDot } from "@/components/ui/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useIntegrations,
  useCreateIntegration,
  useDeleteIntegration,
  useTestIntegration,
  useTestIntegrationBeforeConnect,
  useGithubAppStart,
  useGithubAppAvailable,
} from "@/lib/api/hooks";
import type { IntegrationType } from "@/lib/api/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url";
  required: boolean;
  helpText?: string;
}

interface IntegrationDef {
  id: IntegrationType;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  docsUrl?: string;
  fields: IntegrationField[];
}

// citshe connects to GitHub only — repos are the unit of work agents act on.
const integrationDefinitions: IntegrationDef[] = [
  {
    id: "GITHUB",
    name: "GitHub",
    description: "Sync repositories, push branches, and open pull requests",
    icon: <GitHubIcon />,
    color: "bg-[#24292e]",
    docsUrl: "https://github.com/settings/tokens/new",
    fields: [
      {
        key: "accessToken",
        label: "Personal Access Token",
        placeholder: "ghp_... or github_pat_...",
        type: "password",
        required: true,
        helpText:
          "Fine-grained token with repository access. We sync all repos you grant access to.",
      },
    ],
  },
];

type TestStatus = "idle" | "testing" | "success" | "error";

export default function IntegrationsPage() {
  const { data: connectedIntegrations = [], isLoading } = useIntegrations();
  const createIntegration = useCreateIntegration();
  const deleteIntegration = useDeleteIntegration();
  const testIntegration = useTestIntegration();
  const testBeforeConnect = useTestIntegrationBeforeConnect();
  const githubAppStart = useGithubAppStart();
  const { data: ssoAvailable } = useGithubAppAvailable();

  const startGithubSso = async () => {
    try {
      const { url } = await githubAppStart.mutateAsync();
      window.location.href = url;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "GitHub App isn't configured — use a token below.",
      );
    }
  };

  const [configureDialog, setConfigureDialog] = useState<IntegrationDef | null>(
    null,
  );
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [preConnectTest, setPreConnectTest] = useState<{
    status: TestStatus;
    message?: string;
  }>({ status: "idle" });

  const integrations = useMemo(() => {
    return integrationDefinitions.map((def) => {
      const connected = connectedIntegrations.find((c) => c.type === def.id);
      return {
        ...def,
        isConnected: !!connected,
        integrationId: connected?.id,
        status: connected?.status,
        lastSyncAt: connected?.lastSyncAt,
        errorMessage: connected?.errorMessage,
      };
    });
  }, [connectedIntegrations]);

  const openConfigDialog = (def: IntegrationDef) => {
    setConfigureDialog(def);
    setFormData({});
    setShowSecrets({});
    setPreConnectTest({ status: "idle" });
  };

  const handleTestBeforeConnect = async () => {
    if (!configureDialog) return;
    const missing = configureDialog.fields
      .filter((f) => f.required && !formData[f.key]?.trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      toast.error(`Fill required fields first: ${missing.join(", ")}`);
      return;
    }
    setPreConnectTest({ status: "testing" });
    try {
      const result = await testBeforeConnect.mutateAsync({
        type: configureDialog.id,
        config: formData,
      });
      setPreConnectTest({
        status: result.success ? "success" : "error",
        message: result.message,
      });
    } catch (error) {
      setPreConnectTest({
        status: "error",
        message:
          error instanceof Error ? error.message : "Connection test failed",
      });
    }
  };

  const handleConnect = async () => {
    if (!configureDialog) return;
    const missing = configureDialog.fields
      .filter((f) => f.required && !formData[f.key]?.trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      toast.error(`Missing required fields: ${missing.join(", ")}`);
      return;
    }
    try {
      await createIntegration.mutateAsync({
        type: configureDialog.id,
        config: formData,
      });
      toast.success(`${configureDialog.name} connected successfully`);
      setConfigureDialog(null);
      setFormData({});
    } catch {
      toast.error(`Failed to connect ${configureDialog.name}`);
    }
  };

  const handleDisconnect = async (integrationId: string, name: string) => {
    try {
      await deleteIntegration.mutateAsync(integrationId);
      toast.success(`${name} disconnected`);
    } catch {
      toast.error("Failed to disconnect integration");
    }
  };

  const handleTest = async (integrationId: string, name: string) => {
    setTestingId(integrationId);
    try {
      const result = await testIntegration.mutateAsync(integrationId);
      if (result.success) {
        toast.success(`${name} connection verified!`, {
          description: result.message,
        });
      } else {
        toast.error(`${name} connection failed`, {
          description: result.message,
        });
      }
    } catch {
      toast.error(`Failed to test ${name} connection`);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Connect GitHub so agents can clone repos, push branches, and open pull
          requests.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface-card">
        {isLoading ? (
          <div className="flex items-center gap-3 px-3.5 py-3">
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
          </div>
        ) : (
          integrations.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            onConfigure={() => openConfigDialog(integration)}
            onDisconnect={() =>
              integration.integrationId &&
              handleDisconnect(integration.integrationId, integration.name)
            }
            onTest={() =>
              integration.integrationId &&
              handleTest(integration.integrationId, integration.name)
            }
              isDisconnecting={deleteIntegration.isPending}
              isTesting={testingId === integration.integrationId}
            />
          ))
        )}
      </div>

      <Dialog
        open={!!configureDialog}
        onOpenChange={() => setConfigureDialog(null)}
      >
        <DialogContent className="max-w-full sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {configureDialog && (
                <div
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-md text-white",
                    configureDialog.color,
                  )}
                >
                  {configureDialog.icon}
                </div>
              )}
              <div>
                <DialogTitle>Connect {configureDialog?.name}</DialogTitle>
                <DialogDescription>
                  {configureDialog?.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {configureDialog?.id === "GITHUB" && ssoAvailable && (
              <>
                <Button
                  className="w-full"
                  onClick={startGithubSso}
                  disabled={githubAppStart.isPending}
                >
                  {githubAppStart.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <GitHubIcon className="w-4 h-4 mr-2" />
                  )}
                  Continue with GitHub
                </Button>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    or use a token
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            {configureDialog?.docsUrl && (
              <a
                href={configureDialog.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                How to create a token
              </a>
            )}

            {configureDialog?.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id={field.key}
                    type={
                      field.type === "password" && !showSecrets[field.key]
                        ? "password"
                        : "text"
                    }
                    placeholder={field.placeholder}
                    value={formData[field.key] || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, [field.key]: e.target.value })
                    }
                  />
                  {field.type === "password" && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowSecrets({
                          ...showSecrets,
                          [field.key]: !showSecrets[field.key],
                        })
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecrets[field.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-xs text-muted-foreground">
                    {field.helpText}
                  </p>
                )}
              </div>
            ))}

            {preConnectTest.status !== "idle" && (
              <Alert
                variant={
                  preConnectTest.status === "error" ? "destructive" : "default"
                }
              >
                <AlertDescription className="flex items-center gap-2 text-sm">
                  {preConnectTest.status === "testing" && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {preConnectTest.status === "success" && (
                    <CheckCircle2 className="w-4 h-4 text-ok" />
                  )}
                  {preConnectTest.status === "error" && (
                    <XCircle className="w-4 h-4" />
                  )}
                  {preConnectTest.message ||
                    (preConnectTest.status === "testing"
                      ? "Testing connection..."
                      : "")}
                </AlertDescription>
              </Alert>
            )}
          </DialogBody>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleTestBeforeConnect}
              disabled={testBeforeConnect.isPending}
            >
              {testBeforeConnect.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Test
            </Button>
            <Button
              onClick={handleConnect}
              disabled={createIntegration.isPending}
            >
              {createIntegration.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-1.5" />
              )}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationRow({
  integration,
  onConfigure,
  onDisconnect,
  onTest,
  isDisconnecting,
  isTesting,
}: {
  integration: {
    id: IntegrationType;
    name: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    isConnected: boolean;
    integrationId?: string;
    status?: string;
    errorMessage?: string | null;
  };
  onConfigure: () => void;
  onDisconnect: () => void;
  onTest: () => void;
  isDisconnecting: boolean;
  isTesting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 transition-linear">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md text-white",
          integration.color,
        )}
      >
        {integration.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {integration.name}
          </span>
          {integration.isConnected && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot
                state={integration.status === "ERROR" ? "failed" : "ok"}
                size={7}
              />
              {integration.status === "ERROR" ? "Error" : "Connected"}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {integration.errorMessage || integration.description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {integration.isConnected ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onTest}
              disabled={isTesting}
              title="Test connection"
              aria-label={`Test ${integration.name} connection`}
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Disconnect"
              aria-label={`Disconnect ${integration.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onConfigure}>
            <Settings className="mr-1.5 h-4 w-4" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}
