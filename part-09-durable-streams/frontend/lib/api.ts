// One place for the backend's address; everything that talks to it (or
// embeds it in an iframe src) imports from here.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
