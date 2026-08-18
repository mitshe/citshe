"use client";

import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useCallback,
} from "react";
import { AuthContextValue } from "./types";
import { selfhostedAuth, SelfhostedUser } from "./selfhosted-auth";

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Event fired after the active organization changes. A listener inside the
 * QueryClientProvider tree (see OrgSwitchQueryReset) clears the react-query
 * cache so all data refetches scoped to the new org.
 */
export const ORG_SWITCHED_EVENT = "citshe:org-switched";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<SelfhostedUser | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (selfhostedAuth.isAuthenticated()) {
        const userData = await selfhostedAuth.getMe();
        if (userData) {
          setUser(userData);
          setOrgId(
            selfhostedAuth.getCurrentOrganizationId() ||
              userData.organizations[0]?.id ||
              null
          );
        }
      }
      setIsLoaded(true);
    };

    checkAuth();
  }, []);

  const signOut = useCallback(async () => {
    await selfhostedAuth.logout();
    setUser(null);
    setOrgId(null);
    window.location.href = "/sign-in";
  }, []);

  const getToken = useCallback(async () => {
    return selfhostedAuth.getToken();
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      if (organizationId === orgId) return;
      setIsSwitchingOrg(true);
      try {
        await selfhostedAuth.switchOrganization(organizationId);
        setOrgId(organizationId);
        // Let the query layer (mounted under QueryClientProvider) drop cached
        // data scoped to the previous org.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(ORG_SWITCHED_EVENT));
        }
      } finally {
        setIsSwitchingOrg(false);
      }
    },
    [orgId]
  );

  const createOrganization = useCallback(async (name: string) => {
    const org = await selfhostedAuth.createOrganization(name);
    // Refresh the user so the new org appears in the list, then switch to it.
    const userData = await selfhostedAuth.getMe();
    if (userData) setUser(userData);
    setIsSwitchingOrg(true);
    try {
      await selfhostedAuth.switchOrganization(org.id);
      setOrgId(org.id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(ORG_SWITCHED_EVENT));
      }
    } finally {
      setIsSwitchingOrg(false);
    }
    return { id: org.id, name: org.name, role: "OWNER" as const };
  }, []);

  const organizations = user?.organizations ?? [];
  const currentOrg =
    organizations.find((o) => o.id === orgId) ?? organizations[0] ?? null;

  const value: AuthContextValue = {
    isLoaded,
    isSignedIn: !!user,
    userId: user?.id || null,
    orgId,
    userEmail: user?.email || null,
    userName: user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
      : null,
    organizations,
    currentOrg,
    switchOrganization,
    createOrganization,
    isSwitchingOrg,
    getToken,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}

export function useSelfhostedAuth() {
  return {
    login: selfhostedAuth.login.bind(selfhostedAuth),
    register: selfhostedAuth.register.bind(selfhostedAuth),
    logout: selfhostedAuth.logout.bind(selfhostedAuth),
    switchOrganization: selfhostedAuth.switchOrganization.bind(selfhostedAuth),
  };
}
