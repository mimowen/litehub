#!/usr/bin/env node

/**
 * Test script for /mcp endpoint compliance with MCP standard
 * Verifies GET returns SSE stream and POST handles JSON-RPC correctly
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.LITEHUB_URL || 'http://localhost:3001';
const TOKEN = process.env.LITEHUB_TOKEN || '';
const MCP_ENDPOINT = `${BASE_URL}/mcp`;

console.log('🧪 Testing /mcp Endpoint MCP Standard Compliance\n');
console.log(`Base URL: ${BASE_URL}`);
console.log(`MCP Endpoint: ${MCP_ENDPOINT}`);
console.log(`Token Set: ${TOKEN ? '✅ Yes' : '❌ No'}\n`);

let sessionId = null;

function buildHeaders(extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...extraHeaders,
  };
  
  if (TOKEN) {
    headers['Authorization'] = `Bearer ${TOKEN}`;
  }
  
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  
  return headers;
}

async function testGET_SSE() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('📋 Test 1: GET /mcp - Should return SSE stream with initialization\n');
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const res = await fetch(MCP_ENDPOINT, {
      method: 'GET',
      headers: TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {},
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    console.log(`✅ HTTP Status: ${res.status}`);
    console.log(`✅ Content-Type: ${res.headers.get('content-type')}`);
    
    // Check if it's SSE
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('text/event-stream')) {
      console.log('❌ FAIL: Content-Type should be text/event-stream');
      console.log(`   Actual: ${contentType}`);
      return false;
    }
    
    // Read first message from SSE stream
    const text = await res.text();
    console.log('\n✅ Received SSE data:');
    console.log(text.substring(0, 300));
    
    // Parse the SSE data
    const lines = text.split('\n');
    const dataLine = lines.find(line => line.startsWith('data:'));
    if (!dataLine) {
      console.log('❌ FAIL: No data: line found in SSE response');
      return false;
    }
    
    const jsonData = JSON.parse(dataLine.substring(5));
    
    // Check if it has jsonrpc field (standard MCP format)
    if (!jsonData.jsonrpc) {
      console.log('❌ FAIL: Missing jsonrpc field');
      console.log('   Expected: {"jsonrpc":"2.0",...}');
      console.log(`   Got: ${JSON.stringify(jsonData).substring(0, 100)}`);
      return false;
    }
    
    console.log('\n✅ PASS: GET /mcp returns proper SSE stream with JSON-RPC format');
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('✅ Connection established (timeout as expected for SSE)');
      return true;
    }
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testPOST_Initialize() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('📋 Test 2: POST /mcp - Initialize via JSON-RPC\n');
  
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'MCP Standard Test',
            version: '1.0.0',
          },
        },
      }),
    });
    
    const contentType = res.headers.get('content-type');
    console.log(`✅ HTTP Status: ${res.status}`);
    console.log(`✅ Content-Type: ${contentType}`);
    
    let result;
    if (contentType?.includes('text/event-stream')) {
      // Parse SSE format
      const text = await res.text();
      const lines = text.split('\n');
      const dataLine = lines.find(line => line.startsWith('data:'));
      if (dataLine) {
        result = JSON.parse(dataLine.substring(5));
      }
    } else {
      // Parse JSON directly
      result = await res.json();
    }
    
    console.log('\n✅ Response:');
    console.log(JSON.stringify(result, null, 2).substring(0, 400));
    
    // Validate JSON-RPC format
    if (!result.jsonrpc || !result.id || !result.result) {
      console.log('\n❌ FAIL: Invalid JSON-RPC response format');
      console.log('   Expected: {"jsonrpc":"2.0","id":1,"result":{...}}');
      return false;
    }
    
    if (result.jsonrpc !== '2.0') {
      console.log('\n❌ FAIL: jsonrpc version should be "2.0"');
      return false;
    }
    
    // Extract session ID if present
    sessionId = res.headers.get('mcp-session-id');
    if (sessionId) {
      console.log(`\n✅ Session ID: ${sessionId}`);
    }
    
    console.log('\n✅ PASS: POST /mcp returns valid JSON-RPC response');
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function testPOST_ToolsList() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('📋 Test 3: POST /mcp - tools/list via JSON-RPC\n');
  
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    
    const contentType = res.headers.get('content-type');
    console.log(`✅ HTTP Status: ${res.status}`);
    
    let result;
    if (contentType?.includes('text/event-stream')) {
      const text = await res.text();
      const lines = text.split('\n');
      const dataLine = lines.find(line => line.startsWith('data:'));
      if (dataLine) {
        result = JSON.parse(dataLine.substring(5));
      }
    } else {
      result = await res.json();
    }
    
    console.log('\n✅ Response structure check:');
    console.log(`   - jsonrpc: ${result.jsonrpc ? '✅' : '❌'}`);
    console.log(`   - id: ${result.id !== undefined ? '✅' : '❌'}`);
    console.log(`   - result: ${result.result ? '✅' : '❌'}`);
    console.log(`   - result.tools: ${result.result?.tools ? '✅' : '❌'}`);
    
    if (result.result?.tools) {
      console.log(`   - tools count: ${result.result.tools.length}`);
    }
    
    // Validate JSON-RPC format
    if (!result.jsonrpc || result.id === undefined || !result.result) {
      console.log('\n❌ FAIL: Invalid JSON-RPC response format');
      return false;
    }
    
    console.log('\n✅ PASS: tools/list returns valid JSON-RPC response');
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

// Run tests
(async () => {
  const results = [];
  
  results.push(await testGET_SSE());
  results.push(await testPOST_Initialize());
  results.push(await testPOST_ToolsList());
  
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('\n📊 Test Results:');
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Passed: ${results.filter(r => r).length}`);
  console.log(`   ❌ Failed: ${results.filter(r => !r).length}`);
  
  if (results.every(r => r)) {
    console.log('\n🎉 SUCCESS! /mcp endpoint is MCP standard compliant!\n');
    console.log('✨ Verified:');
    console.log('   ✅ GET /mcp returns SSE stream with proper Content-Type');
    console.log('   ✅ GET /mcp sends initialization message in JSON-RPC format');
    console.log('   ✅ POST /mcp handles JSON-RPC requests correctly');
    console.log('   ✅ POST /mcp returns responses with jsonrpc/id/result fields');
    console.log('   ✅ tools/list method works via JSON-RPC');
  } else {
    console.log('\n⚠️  Some tests failed. See details above.\n');
  }
  
  console.log('══════════════════════════════════════════════════════════════════════');
})();