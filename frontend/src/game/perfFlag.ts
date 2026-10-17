// Whether the URL asks for the performance overlay (`?perf`, plan F11). Its own tiny module so the
// meter (perf.ts) and the overlay load only when asked for.
export const PERF_ON = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf");
