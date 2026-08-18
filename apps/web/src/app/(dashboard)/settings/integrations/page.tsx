"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  useIntegrations,
  useCreateIntegration,
  useDeleteIntegration,
  useTestIntegration,
  useTestIntegrationBeforeConnect,
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold">Integrations</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Connect GitHub so agents can clone repos, push branches, and open pull
          requests.
        </p>
      </div>

      <div className="space-y-2">
        {integrations.map((integration) => (
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
        ))}
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
                    "flex items-center justify-center w-10 h-10 rounded-lg text-white",
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
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
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
    <div className="flex items-center gap-3 p-3 rounded-lg border transition-colors">
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 shrink-0 rounded-lg text-white",
          integration.color,
        )}
      >
        {integration.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{integration.name}</span>
          {integration.isConnected && (
            <Badge
              variant={
                integration.status === "ERROR" ? "destructive" : "secondary"
              }
              className="gap-1"
            >
              {integration.status === "ERROR" ? (
                <XCircle className="w-3 h-3" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              {integration.status === "ERROR" ? "Error" : "Connected"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {integration.errorMessage || integration.description}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {integration.isConnected ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={onTest}
              disabled={isTesting}
              title="Test connection"
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Disconnect"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onConfigure}>
            <Settings className="w-4 h-4 mr-1.5" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}
