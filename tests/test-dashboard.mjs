// Test Dashboard API endpoints
const BASE_URL = process.env.LITEHUB_URL || "https://litehub.feiyangyang.cn";
const TOKEN = process.env.TOKEN || "litehub";

async function test() {
  console.log("Testing Dashboard API endpoints...");
  console.log("Base URL:", BASE_URL);

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TOKEN}`,
  };

  // Test 1: Dashboard HTML
  console.log("\n1. Testing Dashboard HTML...");
  const dashRes = await fetch(`${BASE_URL}/dashboard`);
  const dashHtml = await dashRes.text();
  console.log("  Status:", dashRes.status);
  console.log("  Content-Type:", dashRes.headers.get("content-type"));
  console.log("  HTML length:", dashHtml.length);
  console.log("  Contains loadData:", dashHtml.includes("loadData"));
  console.log("  Contains error handling:", dashHtml.includes("error"));

  // Test 2: API endpoints used by Dashboard
  console.log("\n2. Testing API endpoints...");

  const endpoints = [
    "/api/agents",
    "/api/queues",
    "/api/pools",
    "/api/a2a/tasks",
    "/api/acp/runs",
  ];

  for (const endpoint of endpoints) {
    const res = await fetch(`${BASE_URL}${endpoint}`, { headers });
    const data = await res.json();
    console.log(`  ${endpoint}:`);
    console.log(`    Status: ${res.status}`);
    console.log(`    OK: ${data.ok}`);
    if (data.error) {
      console.log(`    Error: ${data.error}`);
    } else {
      const key = Object.keys(data).find(k => k !== "ok");
      console.log(`    Count: ${Array.isArray(data[key]) ? data[key].length : "N/A"}`);
    }
  }

  console.log("\n✅ Dashboard API test completed!");
}

test().catch(console.error);
