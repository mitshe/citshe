export interface LocalUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: { emailAddress: string }[];
  imageUrl: string | null;
}

export interface LocalOrganization {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
}

export interface LocalMembership {
  id: string;
  role: "org:admin" | "org:member";
  publicUserData: {
    userId: string;
    firstName: string | null;
    lastName: string | null;
    identifier: string;
    imageUrl: string | null;
  };
  createdAt: Date;
}

export interface AuthOrganization {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

export interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  orgId: string | null;
  userEmail: string | null;
  userName: string | null;
  organizations: AuthOrganization[];
  currentOrg: AuthOrganization | null;
  switchOrganization: (organizationId: string) => Promise<void>;
  createOrganization: (name: string) => Promise<AuthOrganization>;
  deleteOrganization: (organizationId: string) => Promise<void>;
  isSwitchingOrg: boolean;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}
