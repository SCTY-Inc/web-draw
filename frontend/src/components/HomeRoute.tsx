import React from "react";
import { useAuth } from "../context/AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

interface HomeRouteProps {
  landing: React.ReactNode;
  children: React.ReactNode;
}

// A plain signed-out visit to "/" sees the lab note. Every other case
// (loading, no auth, first-run setup, OIDC, signed in) keeps ProtectedRoute's behavior.
export const HomeRoute: React.FC<HomeRouteProps> = ({ landing, children }) => {
  const {
    loading,
    authEnabled,
    isAuthenticated,
    bootstrapRequired,
    oidcEnforced,
    authOnboardingRequired,
  } = useAuth();

  const signedOutVisitor =
    !loading &&
    authEnabled === true &&
    !isAuthenticated &&
    !bootstrapRequired &&
    !oidcEnforced &&
    !authOnboardingRequired;

  if (signedOutVisitor) return <>{landing}</>;
  return <ProtectedRoute>{children}</ProtectedRoute>;
};
