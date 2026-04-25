#!/usr/bin/env node

/**
 * Test script for LiteHub MCP with Authentication
 * Verifies that Bearer Token authentication works correctly
 */

import fetch from 'node-fetch';

// Allow custom port via environment variable or command line argument
const CUSTOM_PORT = process.env.LITEHUB_PORT || process.argv[2] || '3001';
const BASE_URL = process.env.LITEHUB_URL || `http://localhost:${CUSTOM_PORT}`;
const MCP_ENDPOINT = `${BASE_URL}/api/mcp/sse`;
const TOKEN = process.env.LITEHUB_TOKEN || '';

console.log('🧪 Testing LiteHub MCP with Authentication\n');
console.log(`Base URL: ${BASE_URL}`);
console.log(`MCP Endpoint: ${MCP_ENDPOINT}`);
console.log(`Token Set: ${TOKEN ? '✅ Yes' : '❌ No (Open Mode)'}\n`);

if (!TOKEN) {
  console.log('⚠️  Warning: LITEHUB_TOKEN is not set. Running in open mode (no authentication).\n');
}

let sessionId = null;

/**
 * Helper function to parse SSE stream and extract JSON-RPC response
 */
async function parseSSEResponse(response) {
  const contentType = response.headers.get('content-type');
  
  // If it's JSON, parse directly
  if (contentType?.includes('application/json')) {
    return await response.json();
  }
  
  // If it's SSE, parse the stream
  if (contentType?.includes('text/event-stream')) {
    const text = await response.text();
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.substring(6));
        } catch (e) {
          // Skip non-JSON data lines
          continue;
        }
      }
    }
    
    throw new Error('No valid JSON found in SSE stream');
  }
  
  // If it's plain text, try to parse as JSON anyway
  if (contentType?.includes('text/plain')) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse plain text as JSON: ${text.substring(0, 100)}`);
    }
  }
  
  throw new Error(`Unsupported content type: ${contentType}`);
}

async function testInitialize() {
  console.log('📋 Test 1: Initialize MCP Session with Authentication');
  
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    
    // Add Bearer Token if configured
    if (TOKEN) {
      headers['Authorization'] = `Bearer ${TOKEN}`;
      console.log(`   Using token: ${TOKEN.substring(0, 8)}...`);
    } else {
      console.log('   No token (open mode)');
    }
    
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'LiteHub Auth Test Client',
            version: '1.0.0',
          },
        },
      }),
    });
    
    // Check for 401 Unauthorized
    if (res.status === 401) {
      console.log('❌ Authentication failed (401 Unauthorized)');
      console.log('   Please check your LITEHUB_TOKEN environment variable');
      return false;
    }
    
    const result = await parseSSEResponse(res);
    
    if (res.ok && result.result) {
      console.log('✅ Initialization successful');
      console.log(`   Protocol Version: ${result.result.protocolVersion}`);
      console.log(`   Server: ${result.result.serverInfo.name} v${result.result.serverInfo.version}`);
      
      // Extract session ID from response headers
      sessionId = res.headers.get('mcp-session-id');
      if (sessionId) {
        console.log(`   Session ID: ${sessionId}`);
      }
      
      return true;
    } else {
      console.log('❌ Initialization failed');
      console.log('   Response:', JSON.stringify(result).substring(0, 200));
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testListTools() {
  console.log('\n📋 Test 2: List Available Tools');
  
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    
    if (TOKEN) {
      headers['Authorization'] = `Bearer ${TOKEN}`;
    }
    
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }
    
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    
    if (res.status === 401) {
      console.log('❌ Authentication failed (401 Unauthorized)');
      return false;
    }
    
    const result = await parseSSEResponse(res);
    
    if (res.ok && result.result && result.result.tools) {
      console.log(`✅ Found ${result.result.tools.length} tools:`);
      result.result.tools.forEach((tool, idx) => {
        console.log(`   ${idx + 1}. ${tool.name}: ${tool.description.substring(0, 60)}...`);
      });
      return true;
    } else {
      console.log('❌ Failed to list tools');
      console.log('   Response:', JSON.stringify(result).substring(0, 200));
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testWithoutAuth() {
  console.log('\n📋 Test 3: Test Without Authentication (Should Fail if Token Required)');
  
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        // Intentionally NOT including Authorization header
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'Unauthorized Test Client',
            version: '1.0.0',
          },
        },
      }),
    });
    
    if (res.status === 401) {
      console.log('✅ Correctly rejected (401 Unauthorized)');
      console.log('   Authentication is working as expected!');
      return true;
    } else if (TOKEN) {
      console.log('❌ Should have been rejected but got status:', res.status);
      console.log('   Authentication may not be properly configured');
      return false;
    } else {
      console.log('✅ Accepted (running in open mode, no token required)');
      return true;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('═'.repeat(70));
  
  const results = [];
  
  results.push(await testInitialize());
  results.push(await testListTools());
  results.push(await testWithoutAuth());
  
  console.log('\n' + '═'.repeat(70));
  console.log('\n📊 Test Results:');
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Passed: ${results.filter(r => r).length}`);
  console.log(`   ❌ Failed: ${results.filter(r => !r).length}`);
  
  const allPassed = results.every(r => r);
  
  if (allPassed) {
    console.log('\n🎉 SUCCESS! Authentication is working correctly!');
    console.log('\n✨ Summary:');
    if (TOKEN) {
      console.log('   ✅ Bearer Token authentication is enabled and working');
      console.log('   ✅ Requests with valid token are accepted');
      console.log('   ✅ Requests without token are rejected (401)');
    } else {
      console.log('   ⚠️  Running in open mode (no authentication)');
      console.log('   💡 Set LITEHUB_TOKEN environment variable to enable authentication');
    }
    console.log('\n💡 Next Steps:');
    console.log('   1. Configure your MCP client with the Bearer Token');
    console.log('   2. See README.md for configuration examples');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above.');
  }
  
  console.log('\n' + '═'.repeat(70));
}

runTests().catch(console.error);
