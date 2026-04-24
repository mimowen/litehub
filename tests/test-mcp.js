// 测试脚本 - 验证MCP JSON-RPC功能
import fetch from 'node-fetch';

const MCP_URL = 'https://litehub-8vsf3bpb7-wens-projects-0631aaf3.vercel.app/api/mcp';

async function testMcpRpc() {
  console.log('=== 测试 MCP JSON-RPC 2.0 ===\n');
  
  // 测试 1: initialize
  console.log('1. 测试 initialize 方法');
  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      })
    });
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n2. 测试 tools/list 方法');
  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      })
    });
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('工具数量:', data.result?.tools?.length);
    console.log('工具列表:', data.result?.tools?.map(t => t.name).join(', '));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n3. 测试 tools/call 方法 (litehub_agents)');
  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'litehub_agents',
          arguments: {}
        }
      })
    });
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n4. 测试 GET /api/mcp (配置端点)');
  try {
    const response = await fetch(MCP_URL);
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('配置:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n=== 测试完成 ===');
}

testMcpRpc();