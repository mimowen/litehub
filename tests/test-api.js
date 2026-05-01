// 测试脚本 - 验证LiteHub API功能
import fetch from 'node-fetch';

const API_URL = (process.env.LITEHUB_URL || process.argv[2] || 'http://localhost:3000') + '/api';

async function testAPI() {
  console.log('=== 测试 LiteHub API ===\n');
  
  // 测试 1: 根路径
  console.log('1. 测试根路径 /api');
  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n2. 测试 /api/agents');
  try {
    const response = await fetch(`${API_URL}/agents`);
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n3. 测试 /api/queues');
  try {
    const response = await fetch(`${API_URL}/queues`);
    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n4. 测试 /api/skill');
  try {
    const response = await fetch(`${API_URL}/skill`);
    const data = await response.text();
    console.log('状态码:', response.status);
    console.log('响应长度:', data.length, '字符');
    console.log('前200字符:', data.substring(0, 200) + '...');
  } catch (error) {
    console.error('错误:', error.message);
  }
  
  console.log('\n=== 测试完成 ===');
}

testAPI();