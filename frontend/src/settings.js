import { createContext, useContext } from "react";

// Admin settings (Settings tab). The server is the authority and checks every one of these again; the screens use
// them to show the right buttons and limits. These defaults match the server's and are used until the real values
// have loaded (or if they can't be loaded).
export const DEFAULT_SETTINGS = {
  ssoNewUsersGetAccess: false,
  usersCanEditDvps: true,
  usersCanRaiseLop: true,
  usersCanAddObservations: true,
  usersCanRemoveOwnObservations: true,
  observationMaxPerDvp: 12,
  observationMaxMb: 5,
  lopMaxImages: 4,
  lopMaxMb: 3,
  vrReportMaxMb: 200,
  reportObservationsPerDvp: 6,
};

export const SettingsContext = createContext(DEFAULT_SETTINGS);
export const useSettings = () => useContext(SettingsContext);

/** What the signed-in person may do, from their role and the settings. Admins may always. */
export function permissions(user, s) {
  const admin = user?.role === "ADMIN";
  const user_ = user?.role === "USER";
  return {
    admin,
    editDvps: admin || (user_ && s.usersCanEditDvps),
    raiseLop: admin || (user_ && s.usersCanRaiseLop),
    addObservations: admin || (user_ && s.usersCanAddObservations),
    removeOwnObservations: admin || (user_ && s.usersCanRemoveOwnObservations),
  };
}
