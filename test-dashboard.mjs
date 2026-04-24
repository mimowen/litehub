import { handleDashboard } from "./lib/handlers/dashboard.ts";

const req = new Request("http://localhost/api/dashboard");
const res = await handleDashboard(req);
console.log("Status:", res.status);
console.log("Content-Type:", res.headers.get("content-type"));
const text = await res.text();
console.log("Body length:", text.length);
console.log("Body starts with:", text.substring(0, 50));
