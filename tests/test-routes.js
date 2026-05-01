#!/usr/bin/env node

// 测试脚本：验证所有LiteHub API端点
import fetch from 'node-fetch';

const BASE_URL = 'https://litehub-wen.vercel.app'; // 新部署测试地址
const TOKEN = process.env.LITEHUB_TOKEN || '';

// 测试用的Agent ID
const TEST_AGENT_ID = 'test-agent-' + Date.now();
const TEST_QUEUE = 'test-queue-' + Date.now();
const TEST_POOL = 'test-pool-' + Date.now();

// 构建请求头～
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (TOKEN) {
    headers['Authorization'] = `Bearer ${TOKEN}`;
  }
  return headers;
}

// 测试函数
async function testEndpoint(name, method, url, body = null) {
  console.log(`\n=== 测试 ${name} ===`);
  console.log(`${method} ${url}`);
  
  try {
    const options = {
      method,
      headers: getHeaders()
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${BASE_URL}${url}`, options);
    let data;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    
    console.log(`状态码: ${response.status}`);
    console.log(`响应: ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`);
    
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.error(`错误: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 主测试函数
async function runTests() {
  console.log('开始测试LiteHub API端点...');
  console.log(`测试地址: ${BASE_URL}`);
  
  const results = [];
  
  // 测试公共端点
  results.push(await testEndpoint('API根路径', 'GET', '/api'));
  results.push(await testEndpoint('获取所有Agents', 'GET', '/api/agents'));
  results.push(await testEndpoint('获取所有Queues', 'GET', '/api/queues'));
  results.push(await testEndpoint('获取所有Pools', 'GET', '/api/pools'));
  results.push(await testEndpoint('获取Skill', 'GET', '/api/skill'));
  results.push(await testEndpoint('获取Dashboard', 'GET', '/api/dashboard'));
  results.push(await testEndpoint('获取MCP配置', 'GET', '/api/mcp'));
  
  // 测试认证端点
  results.push(await testEndpoint('注册Agent', 'POST', '/api/agent/register', {
    agentId: TEST_AGENT_ID,
    name: 'Test Agent',
    role: 'producer',
    queues: [TEST_QUEUE]
  }));
  
  results.push(await testEndpoint('生产数据', 'POST', '/api/agent/produce', {
    agentId: TEST_AGENT_ID,
    queue: TEST_QUEUE,
    data: 'Test data'
  }));
  
  results.push(await testEndpoint('消费数据', 'POST', '/api/agent/consume', {
    agentId: TEST_AGENT_ID,
    queue: TEST_QUEUE
  }));
  
  results.push(await testEndpoint('创建Pool', 'POST', '/api/pool/create', {
    name: TEST_POOL,
    description: 'Test pool'
  }));
  
  results.push(await testEndpoint('加入Pool', 'POST', '/api/pool/join', {
    pool: TEST_POOL,
    agentId: TEST_AGENT_ID
  }));
  
  results.push(await testEndpoint('在Pool发言', 'POST', '/api/pool/speak', {
    pool: TEST_POOL,
    agentId: TEST_AGENT_ID,
    content: 'Hello from test agent'
  }));
  
  results.push(await testEndpoint('获取Pool消息', 'GET', `/api/pool/messages?pool=${TEST_POOL}`));
  results.push(await testEndpoint('获取Pool成员', 'GET', `/api/pool/members?pool=${TEST_POOL}`));
  results.push(await testEndpoint('获取Pool详情', 'GET', `/api/pool/${TEST_POOL}`));
  
  results.push(await testEndpoint('离开Pool', 'POST', '/api/pool/leave', {
    pool: TEST_POOL,
    agentId: TEST_AGENT_ID
  }));
  
  // 测试Peek端点
  results.push(await testEndpoint('Peek队列', 'GET', `/api/peek?queue=${TEST_QUEUE}`));
  
  // 测试管道端点
  results.push(await testEndpoint('管道传输', 'POST', '/api/agent/pipe', {
    agentId: TEST_AGENT_ID,
    sourceQueue: TEST_QUEUE,
    targetQueue: `${TEST_QUEUE}-target`,
    data: 'Piped data'
  }));
  
  // 总结测试结果
  console.log('\n=== 测试结果总结 ===');
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  console.log(`成功: ${successCount}/${totalCount}`);
  
  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log('\n失败的测试:');
    failedTests.forEach((test, index) => {
      console.log(`${index + 1}. ${test.error || '未知错误'}`);
    });
  }
  
  console.log('\n测试完成！');
}

// 运行测试
runTests().catch(console.error);