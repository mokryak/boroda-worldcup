const EDIT_TOKEN_STORAGE_KEY = "boroda:lastEditToken";
const EDIT_IDENTITY_STORAGE_KEY = "boroda:lastEditIdentity";

export type RememberedEditIdentity = {
  editToken: string;
  displayName: string;
};

export function rememberEditIdentity(identity: RememberedEditIdentity) {
  try {
    window.localStorage.setItem(EDIT_TOKEN_STORAGE_KEY, identity.editToken);
    window.localStorage.setItem(EDIT_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private browsing or blocked storage should not break the prediction form.
  }
}

export function clearRememberedEditIdentity() {
  try {
    window.localStorage.removeItem(EDIT_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(EDIT_IDENTITY_STORAGE_KEY);
  } catch {
    // Private browsing or blocked storage should not break the prediction form.
  }
}

export function getRememberedEditIdentity(): RememberedEditIdentity | null {
  try {
    const rawIdentity = window.localStorage.getItem(EDIT_IDENTITY_STORAGE_KEY);
    if (rawIdentity) {
      const identity = JSON.parse(rawIdentity) as Partial<RememberedEditIdentity>;
      if (identity.editToken && identity.displayName) {
        return {
          editToken: identity.editToken,
          displayName: identity.displayName
        };
      }
    }

    const editToken = window.localStorage.getItem(EDIT_TOKEN_STORAGE_KEY);
    return editToken ? { editToken, displayName: "" } : null;
  } catch {
    return null;
  }
}
